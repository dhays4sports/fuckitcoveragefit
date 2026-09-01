import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleLeadIntake,
  normalizeLeadPayload,
  recordLeadMilestone,
  syncAgencyZoomLead,
  leadRecordKey,
  recoverLeadFromWebMapping
} from '../server/lead-operations-core.mjs';
import { projectUnifiedProducerRecord } from '../server/pvx-unified-producer-record-core.mjs';

class MemoryStore {
  constructor() { this.rows = new Map(); }
  async get(key) { return structuredClone(this.rows.get(key) || null); }
  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && this.rows.has(key)) throw new Error('constraint');
    this.rows.set(key, structuredClone(value));
  }
  async delete(key) { this.rows.delete(key); }
  async list({ prefix = '', limit = 500 } = {}) {
    return { blobs:[...this.rows.keys()].filter(key => key.startsWith(prefix)).slice(0,limit).map(key => ({ key })) };
  }
}

const secret = 'test-secret-that-is-longer-than-thirty-two-characters';
const lead = (extra = {}) => ({
  lead_checkpoint_id:'408d_1234567890abcdef1234567890abcdef',
  lead_stage:'started', first_name:'Maya', phone:'(408) 555-1234', consent:'on',
  contact_consent_state:'granted', contact_consent_version:'408farmers-agency-contact-v2',
  contact_consent_timestamp:'2026-08-29T12:00:00.000Z', submitted_at:'2026-08-29T12:00:00.000Z',
  review_track:'home', housing_context:'homeowner', campaign:'direct',
  landing_page:'https://408farmers.com/home/?first_name=do-not-store', ...extra
});

async function signedRequest(payload, sentAt = Date.parse('2026-08-29T12:00:00.000Z')) {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${sentAt}.${body}`));
  const signature = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2,'0')).join('');
  return new Request('https://coveragefit.com/api/lead/intake', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-CoverageFit-Sent-At':String(sentAt), 'X-CoverageFit-Signature':signature }, body });
}

test('normalization keeps minimum identity, exact consent evidence, and removes URL query PII', () => {
  const result = normalizeLeadPayload(lead(), { now:new Date('2026-08-29T12:00:00.000Z') });
  assert.equal(result.valid,true);
  assert.deepEqual(result.value.identity,{ firstName:'Maya', mobile:'4085551234' });
  assert.equal(result.value.attribution.landingPage,'https://408farmers.com/home/');
  assert.equal(result.value.consent.agencyContact.automatedSmsAuthorized,false);
  assert.equal(result.value.consent.agencyContact.personalTextPermitted,true);
  assert.equal(result.value.consent.automatedMarketingSms.granted,false);
  assert.equal('email' in result.value.identity,false);
});

test('automated marketing SMS permission requires its own complete versioned evidence', () => {
  const granted = normalizeLeadPayload(lead({
    automated_marketing_sms_consent:'granted',
    automated_marketing_sms_consent_state:'granted',
    automated_marketing_sms_consent_version:'408farmers-automated-marketing-sms-v1',
    automated_marketing_sms_consent_timestamp:'2026-08-29T12:00:00.000Z'
  }));
  assert.equal(granted.valid,true);
  assert.equal(granted.value.consent.agencyContact.automatedSmsAuthorized,false);
  assert.equal(granted.value.consent.automatedMarketingSms.granted,true);
  assert.equal(granted.value.consent.automatedMarketingSms.seller,'Virginia Tam Insurance Agency, Inc.');
  assert.equal(granted.value.consent.automatedMarketingSms.consentRequiredForPurchase,false);
  assert.equal(granted.value.consent.automatedMarketingSms.suppressionAuthoritative,true);

  const malformed = normalizeLeadPayload(lead({
    automated_marketing_sms_consent:'granted',
    automated_marketing_sms_consent_state:'granted',
    automated_marketing_sms_consent_version:'',
    automated_marketing_sms_consent_timestamp:''
  }));
  assert.equal(malformed.valid,true,'personal follow-up and CoverageFit must not be blocked');
  assert.equal(malformed.value.consent.automatedMarketingSms.requested,true);
  assert.equal(malformed.value.consent.automatedMarketingSms.granted,false);
  assert.equal(malformed.value.consent.automatedMarketingSms.state,'invalid_evidence');
});

test('signed intake durably persists before CRM and is idempotent', async () => {
  const store = new MemoryStore(), tasks = [];
  const options = { store, env:{ COVERAGEFIT_LEAD_SYNC_SECRET:secret }, now:new Date('2026-08-29T12:00:00.000Z'), waitUntil:task => tasks.push(task) };
  const first = await handleLeadIntake(await signedRequest(lead()), options);
  assert.equal(first.status,201);
  assert.equal((await first.json()).durable,true);
  await Promise.all(tasks);
  const second = await handleLeadIntake(await signedRequest(lead()), options);
  assert.equal(second.status,200);
  const key = await leadRecordKey(lead().lead_checkpoint_id), record = await store.get(key);
  assert.equal(record.stages.filter(item => item.stage === 'started').length,1);
  assert.equal(record.crm.state,'blocked');
  assert.equal(record.consent.agencyContact.automatedSmsAuthorized,false);
});

test('invalid signatures and consent inference are rejected', async () => {
  const store = new MemoryStore();
  const unsigned = new Request('https://coveragefit.com/api/lead/intake',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(lead()) });
  assert.equal((await handleLeadIntake(unsigned,{ store, env:{ COVERAGEFIT_LEAD_SYNC_SECRET:secret } })).status,401);
  const inferred = normalizeLeadPayload(lead({ consent:'', contact_consent_state:'', contact_consent_version:'', contact_consent_timestamp:'' }));
  assert.equal(inferred.valid,false);
  assert.equal(inferred.error,'explicit_consent_required');
});

test('AgencyZoom projection is suppressed until safe stage confirmation and sends once afterward', async () => {
  const store = new MemoryStore();
  const normalized = normalizeLeadPayload(lead(),{ now:new Date('2026-08-29T12:00:00.000Z') });
  const { record } = await (await import('../server/lead-operations-core.mjs')).upsertLeadJourney(store,normalized.value,{ now:new Date('2026-08-29T12:00:00.000Z') });
  const blockedCalls = [];
  const blocked = await syncAgencyZoomLead(store,record.checkpointId,'started',{ env:{ AGENCYZOOM_WEB_LEAD_URL:'https://api.agencyzoom.com/vendor/coveragefit' }, fetch:async (...args) => { blockedCalls.push(args); return Response.json({}); } });
  assert.equal(blocked.state,'blocked');
  assert.equal(blockedCalls.length,0);
  const calls = [];
  const env = { AGENCYZOOM_WEB_LEAD_URL:'https://api.agencyzoom.com/vendor/coveragefit', AGENCYZOOM_AUTOMATION_SUPPRESSION_CONFIRMED:'true' };
  const synced = await syncAgencyZoomLead(store,record.checkpointId,'started',{ env, fetch:async (url,init) => { calls.push({url,init}); return Response.json({ leadId:'az-42' }); } });
  assert.equal(synced.state,'synced');
  assert.equal(calls.length,1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.external_lead_id,record.checkpointId);
  assert.equal(body.automated_sms_permission,false);
  assert.equal(body.automation_suppressed,true);
  assert.ok(body.tags.includes('Automation Suppressed'));
  assert.equal((await syncAgencyZoomLead(store,record.checkpointId,'started',{ env, fetch:async()=>{ throw new Error('must not repeat'); } })).state,'already_synced');
});

test('marketing-consented leads use only the separately confirmed AgencyZoom automation route', async () => {
  const store = new MemoryStore();
  const normalized = normalizeLeadPayload(lead({
    automated_marketing_sms_consent:'true',
    automated_marketing_sms_consent_state:'granted',
    automated_marketing_sms_consent_version:'408farmers-automated-marketing-sms-v1',
    automated_marketing_sms_consent_timestamp:'2026-08-29T12:00:00.000Z'
  }));
  const { record } = await (await import('../server/lead-operations-core.mjs')).upsertLeadJourney(store,normalized.value,{});
  const calls=[];
  const wrongRoute = await syncAgencyZoomLead(store,record.checkpointId,'started',{
    env:{ AGENCYZOOM_WEB_LEAD_URL:'https://api.agencyzoom.com/manual', AGENCYZOOM_AUTOMATION_SUPPRESSION_CONFIRMED:'true' },
    fetch:async (...args)=>{calls.push(args);return Response.json({});}
  });
  assert.equal(wrongRoute.state,'blocked');
  assert.equal(calls.length,0,'consented leads must not leak into the manual webhook');

  const env={
    AGENCYZOOM_MARKETING_SMS_WEB_LEAD_URL:'https://api.agencyzoom.com/marketing-sms',
    AGENCYZOOM_MARKETING_SMS_AUTOMATION_CONFIRMED:'true'
  };
  const synced = await syncAgencyZoomLead(store,record.checkpointId,'started',{ env, fetch:async(url,init)=>{calls.push({url:String(url),init});return Response.json({leadId:'az-marketing-42'});} });
  assert.equal(synced.state,'synced');
  assert.equal(calls[0].url,'https://api.agencyzoom.com/marketing-sms');
  const body=JSON.parse(calls[0].init.body);
  assert.equal(body.automated_sms_permission,true);
  assert.equal(body.automation_suppressed,false);
  assert.equal(body.automated_marketing_sms_consent_version,'408farmers-automated-marketing-sms-v1');
  assert.equal(body.sms_suppression_remains_authoritative,true);
  assert.ok(body.tags.includes('Automated SMS Consent Verified'));
});

test('milestones advance the same lead and passive Snapshot completion does not trigger CRM sync', async () => {
  const store = new MemoryStore();
  const normalized = normalizeLeadPayload(lead());
  await (await import('../server/lead-operations-core.mjs')).upsertLeadJourney(store,normalized.value,{});
  const calls = [], env = { AGENCYZOOM_WEB_LEAD_URL:'https://api.agencyzoom.com/vendor/coveragefit', AGENCYZOOM_AUTOMATION_SUPPRESSION_CONFIRMED:'true' };
  await recordLeadMilestone(store,normalized.value.checkpointId,'snapshot_completed',{ env, fetch:async (...args)=>{calls.push(args);return Response.json({});} });
  assert.equal(calls.length,0);
  const tasks=[];
  await recordLeadMilestone(store,normalized.value.checkpointId,'contact_requested',{ env, fetch:async (...args)=>{calls.push(args);return Response.json({});}, waitUntil:task=>tasks.push(task) });
  await Promise.all(tasks);
  assert.equal(calls.length,1);
  const record = await store.get(await leadRecordKey(normalized.value.checkpointId));
  assert.equal(record.stage,'contact_requested');
  assert.equal(record.stages.filter(item => item.stage === 'contact_requested').length,1);
});

test('secure bootstrap recovery recreates direct-Formspree fallback without new consent', async () => {
  const store = new MemoryStore(), tasks=[];
  const mapping = {
    entry:{ productTrack:'renter', routePath:'/tech/' },
    contact:{ leadCaptureStatus:'confirmed', leadCheckpointId:lead().lead_checkpoint_id, identity:{ firstName:'Maya', mobile:'4085551234' }, agencyContactConsent:{ granted:true, version:'408farmers-agency-contact-v2', capturedAt:'2026-08-29T12:00:00.000Z' } },
    context:{ professional:{ program:'technology', role:'software_engineering', roleLabel:'Software engineering' } },
    attribution:{ source:'408farmers', campaign:'tech', campaignId:'occupation_tech_meta_v1', campaignVariant:'puesto_a', utm:{} }
  };
  const record = await recoverLeadFromWebMapping(mapping,{ store, env:{}, waitUntil:task=>tasks.push(task) });
  await Promise.all(tasks);
  assert.equal(record.context.professionalRole,'software_engineering');
  assert.equal(record.context.housing,'renter');
  assert.equal(record.consent.agencyContact.automatedSmsAuthorized,false);
  assert.equal(record.consent.automatedMarketingSms.granted,false);
});

test('producer projection keeps early permission separate from later contact request', () => {
  const normalized = normalizeLeadPayload(lead()).value;
  const journey = { ...normalized, recordType:'coveragefit_lead_journey', stages:[{stage:'started',occurredAt:normalized.occurredAt}], crm:{state:'pending'} };
  const projected = projectUnifiedProducerRecord({},null,null,journey);
  assert.equal(projected.fallbackIdentity.firstName,'Maya');
  assert.equal(projected.consent.agencyContact.granted,true);
  assert.equal(projected.consent.contact,false);
  assert.equal(projected.consent.sms,false);
  assert.equal(projected.consent.automatedMarketingSms.granted,false);
});
