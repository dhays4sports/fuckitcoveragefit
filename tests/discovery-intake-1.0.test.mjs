import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  PVX_DISCOVERY_ORDERS,
  buildDiscoverySeed,
  firstUnansweredDiscoveryQuestion,
  validateDiscoverySeed
} from '../server/pvx-discovery-plan-core.mjs';
import { mapWebToPvx, validateWebPvxMapping } from '../server/web-pvx-mapping-core.mjs';
import { mapSmsToPvx, validateSmsPvxMapping } from '../server/sms-pvx-mapping-core.mjs';
import { normalizeSmsIntent, routeSmsInbound } from '../server/sms-conversation-core.mjs';
import { shouldHandleCallbackInbound } from '../server/sms-callback-scheduling-core.mjs';
import { handlePvxWebBootstrap } from '../server/pvx-web-journey-core.mjs';
import { projectUnifiedProducerRecord } from '../server/pvx-unified-producer-record-core.mjs';

const require = createRequire(import.meta.url);
const contract = require('../assets/js/pvx-discovery-contract.js');

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    async get(key) { return rows.get(key) || null; },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && rows.has(key)) throw new Error('already_exists');
      rows.set(key, structuredClone(value));
    },
    async delete(key) { rows.delete(key); },
    async list({ prefix = '', limit = 500 } = {}) {
      return { blobs: [...rows.keys()].filter(key => key.startsWith(prefix)).slice(0, limit).map(key => ({ key })) };
    }
  };
}

test('all discovery tracks are bounded and free of prohibited promises', () => {
  assert.deepEqual(contract.TRACKS, ['home', 'auto', 'bundle', 'buyer', 'renter']);
  for (const track of contract.TRACKS) assert.equal(contract.validateCatalog(track).valid, true, track);
  assert.equal(contract.questionsFor('home').length, 8);
  assert.equal(contract.questionsFor('auto').length, 7);
  assert.equal(contract.questionsFor('renter').length, 5);
});

test('worksheet-first order is consistent between browser and server', () => {
  for (const track of contract.TRACKS) assert.deepEqual(contract.orderFor(track), [...PVX_DISCOVERY_ORDERS[track]]);
  assert.deepEqual(contract.orderFor('home'), ['shoppingReason','improvementPriorities','ownershipDuration','stayIntent','upgradeSummary','otherProperties','claimExperience','permissionToAdvise']);
  assert.deepEqual(contract.orderFor('auto'), ['shoppingReason','improvementPriorities','annualMileage','vehicleCount','drivers','liabilityKnowledge','permissionToAdvise']);
});

test('prefilled answers advance to the first genuinely new question', () => {
  const seed = buildDiscoverySeed({ productTrack:'home', answers:{ shoppingReason:'comparison', improvementPriorities:['understanding'] }, answerSources:{ shoppingReason:'408farmers_web', improvementPriorities:'408farmers_web' } });
  assert.equal(seed.currentQuestionId, 'ownershipDuration');
  assert.deepEqual(seed.prefilledQuestionIds, ['shoppingReason','improvementPriorities']);
  assert.equal(seed.questionOrder.length, 8);
  assert.equal(validateDiscoverySeed(seed).valid, true);
  assert.equal(firstUnansweredDiscoveryQuestion('auto', { shoppingReason:'comparison' }), 'improvementPriorities');
});

test('confirmed early capture carries identity and exact consent without SMS inference', () => {
  const mapping = mapWebToPvx({
    entry_type:'home', customer_selection:'review_owned_home', product_track:'home',
    discovery_shopping_reason:'renewal_increase', discovery_improvement_priorities:'understanding,agent_access',
    lead_capture_status:'confirmed', contact_consent:'true', first_name:'Dylan', phone:'4083276377',
    lead_checkpoint_id:'408d_abcdefghijklmnop', consent_at:'2026-08-29T12:00:00.000Z', consent_version:'agency-contact-v2'
  });
  assert.equal(validateWebPvxMapping(mapping).valid, true);
  assert.deepEqual(mapping.contact.identity, { firstName:'Dylan', mobile:'4083276377' });
  assert.equal(mapping.contact.agencyContactConsent.granted, true);
  assert.equal(mapping.contact.agencyContactConsent.automatedSmsAuthorized, false);
  assert.deepEqual(mapping.consent, { reportSaved:false, contact:true, sms:false, call:false, email:false, knownContactIsPermission:false });
  assert.equal(mapping.discovery.currentQuestionId, 'ownershipDuration');
});

test('anonymous skip remains anonymous and still enters discovery', () => {
  const mapping = mapWebToPvx({ entry_type:'renter', customer_selection:'renter', product_track:'renter', lead_capture_status:'skipped', contact_consent:'false', first_name:'ShouldNotCarry', phone:'4085550100' });
  assert.equal(mapping.canEnterPvx, true);
  assert.equal(mapping.contact.leadCaptureStatus, 'skipped');
  assert.deepEqual(mapping.contact.identity, { firstName:'', mobile:'' });
  assert.equal(mapping.consent.contact, false);
  assert.equal(mapping.discovery.productTrack, 'renter');
  assert.equal(mapping.semantics.identityMatchedByContactAlone, false);
});

test('buyer, bundle, auto and renter select distinct bounded plans', () => {
  const cases = [
    ['buyer','buying_home','buyer'], ['home_auto','review_home_auto','bundle'],
    ['auto','start_snapshot','auto'], ['renter','renter','renter']
  ];
  for (const [entry_type, customer_selection, expected] of cases) {
    const mapping = mapWebToPvx({ entry_type, customer_selection });
    assert.equal(mapping.entry.productTrack, expected);
    assert.equal(mapping.discovery.productTrack, expected);
    assert.equal(validateWebPvxMapping(mapping).valid, true);
  }
});

test('professional context never implies eligibility or a discount', () => {
  const mapping = mapWebToPvx({ entry_type:'professional', customer_selection:'review_professional_home', professional_program:'technology' });
  assert.equal(mapping.context.professional.active, true);
  assert.equal(mapping.context.professional.eligibilityDetermined, false);
  assert.equal(mapping.context.professional.discountDetermined, false);
  assert.equal(mapping.semantics.occupationProvesEligibility, false);
});

test('HOME AUTO LIFE BUSINESS and BUYER keyword starts remain available', () => {
  const expected = { HOME:'home_review_address_requested', AUTO:'auto_need_requested', LIFE:'life_goal_requested', BUSINESS:'business_type_requested', BUYER:'buyer_address_requested' };
  for (const [word, state] of Object.entries(expected)) {
    assert.ok(normalizeSmsIntent(word));
    assert.equal(routeSmsInbound({ state:'new' }, word, { isFirstMessage:true }).state, state);
  }
});

test('auto SMS answer becomes a secure CoverageFit discovery handoff without inferred consent', () => {
  const turn = routeSmsInbound({ state:'auto_need_requested', intent:'auto', answers:{} }, '2');
  assert.equal(turn.state, 'coveragefit_ready');
  const mapping = mapSmsToPvx({ conversationId:'sms-conv-auto-1', intent:'auto', answers:turn.answers, mobile:'+14085550100' });
  assert.equal(validateSmsPvxMapping(mapping).valid, true);
  assert.equal(mapping.destination, '/pvx/discovery/');
  assert.equal(mapping.discovery.productTrack, 'auto');
  assert.equal(mapping.contact.contactConsent, false);
  assert.equal(mapping.contact.callConsent, false);
  assert.equal(mapping.contact.emailConsent, false);
});

test('product keywords escape callback routing while actual day/time replies remain schedulable', () => {
  const conversation = { callbackScheduling:{ status:'callback_requested' }, orchestration:{ replyContext:{ context:'callback_time_request' } } };
  for (const word of ['HOME','AUTO','LIFE','BUSINESS','BUYER']) assert.equal(shouldHandleCallbackInbound(conversation, word), false, word);
  assert.equal(shouldHandleCallbackInbound(conversation, 'Friday afternoon', { now:new Date('2026-08-29T12:00:00Z') }), true);
});

test('secure bootstrap is POST-only, idempotent, and never redirects with PII', async () => {
  const store = memoryStore();
  const body = new URLSearchParams({
    bootstrap_id:'pvxb_abcdefghijklmnop', entry_type:'home', customer_selection:'review_owned_home',
    lead_capture_status:'confirmed', contact_consent:'true', first_name:'Dylan', phone:'4083276377',
    lead_checkpoint_id:'408d_abcdefghijklmnop', consent_at:'2026-08-29T12:00:00.000Z', consent_version:'agency-contact-v2'
  });
  const makeRequest = method => new Request('https://coveragefit.com/api/pvx/web-bootstrap', { method, headers:{ Origin:'https://408farmers.com', 'Content-Type':'application/x-www-form-urlencoded' }, body:method === 'POST' ? body.toString() : undefined });
  assert.equal((await handlePvxWebBootstrap(makeRequest('GET'), { store })).status, 405);
  const first = await handlePvxWebBootstrap(makeRequest('POST'), { store });
  const second = await handlePvxWebBootstrap(makeRequest('POST'), { store });
  assert.equal(first.status, 303);
  assert.equal(first.headers.get('location'), '/pvx/web/');
  assert.equal(first.headers.get('x-coveragefit-bootstrap'), 'created');
  assert.equal(second.headers.get('x-coveragefit-bootstrap'), 'reused');
  assert.doesNotMatch(first.headers.get('location'), /Dylan|4083276377|consent/i);
  assert.match(first.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
});

test('producer brief exposes product discovery without recommendations or eligibility claims', () => {
  const record = projectUnifiedProducerRecord({ checkpointId:'cp_1', snapshot:{ discovery:{ productTrack:'auto', questionOrder:[...PVX_DISCOVERY_ORDERS.auto], answers:{ shoppingReason:'comparison' }, exactCustomerWords:{ shoppingReason:'I am comparing' } } }, consent:{ contact:false, sms:false, call:false, email:false } });
  assert.equal(record.productTrack, 'auto');
  assert.equal(record.producerBrief.productTrack, 'auto');
  assert.equal(record.producerBrief.discovery.answeredCount, 1);
  assert.equal(record.producerBrief.discovery.missingQuestionIds[0], 'improvementPriorities');
  assert.deepEqual(record.producerBrief.actualRecommendations, []);
  assert.equal(record.producerBrief.eligibilityConclusion, null);
});

