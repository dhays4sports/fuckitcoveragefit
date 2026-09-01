import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEAD_SOURCE_DEFINITIONS,
  agencyZoomConfig,
  normalizeLeadPayload,
  projectAgencyZoomLead,
  resolveLeadSourceKey,
  syncAgencyZoomLead,
  upsertLeadJourney,
  upsertSmsLeadJourney
} from '../server/lead-operations-core.mjs';

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

test('route catalog resolves every governed website family without using campaign as source', () => {
  const cases = [
    ['https://408farmers.com/home/','web_408_home'],
    ['https://408farmers.com/auto-bundle/','web_408_home_auto'],
    ['https://408farmers.com/buyer/','web_408_buyer'],
    ['https://408farmers.com/life/','web_408_life'],
    ['https://408farmers.com/tech/','web_408_tech'],
    ['https://408farmers.com/teachers/','web_408_teachers'],
    ['https://408farmers.com/healthcare/','web_408_healthcare'],
    ['https://408farmers.com/engineers/','web_408_engineers'],
    ['https://408farmers.com/contact/','web_408_contact'],
    ['https://coveragefit.com/home/','web_coveragefit_home'],
    ['https://coveragefit.com/business/','web_coveragefit_business'],
    ['https://coveragefit.com/landlord/','web_coveragefit_landlord'],
    ['https://coveragefit.com/nonrenewal/','web_coveragefit_nonrenewal']
  ];
  for (const [landing_page, expected] of cases) {
    assert.equal(resolveLeadSourceKey({ landing_page, campaign:'must_not_choose_source' }), expected);
    assert.ok(LEAD_SOURCE_DEFINITIONS[expected].label);
  }
});

test('per-source AgencyZoom destination overrides generic URL only after its own confirmation', () => {
  const env = {
    AGENCYZOOM_WEB_LEAD_URL:'https://api.agencyzoom.com/generic',
    AGENCYZOOM_AUTOMATION_SUPPRESSION_CONFIRMED:'true',
    AGENCYZOOM_SOURCE_ROUTES_JSON:JSON.stringify({
      web_408_life:{ manual_url:'https://api.agencyzoom.com/life-entry', manual_confirmed:true },
      web_408_home:{ manual_url:'https://api.agencyzoom.com/home-entry', manual_confirmed:false }
    })
  };
  const life = agencyZoomConfig(env,false,'web_408_life');
  assert.equal(life.configured,true);
  assert.equal(life.endpoint.toString(),'https://api.agencyzoom.com/life-entry');
  assert.equal(life.routeSpecific,true);
  const home = agencyZoomConfig(env,false,'web_408_home');
  assert.equal(home.configured,false,'an unconfirmed route must not fall through to the generic endpoint');
});

test('life application-start projection accepts only requested-transaction evidence and never infers marketing consent', () => {
  const result = normalizeLeadPayload({
    lead_checkpoint_id:'408d_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    lead_stage:'started', first_name:'Maya', last_name:'Chen', email:'maya@example.com',
    contact_basis:'requested_transaction_follow_up',
    contact_basis_version:'408farmers-life-application-follow-up-v1',
    contact_basis_timestamp:'2026-08-29T12:00:00.000Z',
    source_key:'web_408_life', review_track:'life', submitted_at:'2026-08-29T12:00:00.000Z'
  });
  assert.equal(result.valid,true);
  assert.equal(result.value.identity.email,'maya@example.com');
  assert.equal(result.value.consent.agencyContact.granted,false);
  assert.equal(result.value.consent.agencyContact.basis,'requested_transaction_follow_up');
  assert.equal(result.value.consent.agencyContact.emailPermitted,true);
  assert.equal(result.value.consent.agencyContact.personalTextPermitted,false);
  assert.equal(result.value.consent.automatedMarketingSms.granted,false);
  const projection = projectAgencyZoomLead({ ...result.value, stages:[], crm:{} });
  assert.equal(projection.source_key,'web_408_life');
  assert.equal(projection.source,'Web — 408farmers.com Life');
  assert.equal(projection.target_pipeline,'life');
  assert.equal(projection.automated_sms_permission,false);
  assert.equal(projection.automation_suppressed,true);
});

test('SMS intent creates one idempotent manual-only source record without a name requirement', async () => {
  const store = new MemoryStore();
  const tasks = [];
  const calls = [];
  const conversation = {
    id:'sms-live-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    contactPhone:'+14085551234', intent:'life', state:'awaiting_producer', answers:{ lifeGoal:'family_income' },
    createdAt:'2026-08-29T12:00:00.000Z', lastInboundAt:'2026-08-29T12:00:00.000Z'
  };
  const env = {
    AGENCYZOOM_SOURCE_ROUTES_JSON:JSON.stringify({ sms_life:{ manual_url:'https://api.agencyzoom.com/sms-life', manual_confirmed:true } })
  };
  const options = { store, env, fetch:async (url,init) => { calls.push({url:String(url),body:JSON.parse(init.body)}); return Response.json({leadId:'az-life-sms'}); }, waitUntil:task => tasks.push(task) };
  const first = await upsertSmsLeadJourney(store,conversation,options);
  await Promise.all(tasks.splice(0));
  const second = await upsertSmsLeadJourney(store,conversation,options);
  await Promise.all(tasks.splice(0));
  assert.equal(first.checkpointId,second.checkpointId);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.agencyzoom.com/sms-life');
  assert.equal(calls[0].body.source_key,'sms_life');
  assert.equal(calls[0].body.automated_sms_permission,false);
  assert.equal(calls[0].body.personal_text_permitted,true);
  assert.equal(calls[0].body.first_name,'');
});

test('source-specific sync retains safe legacy fallback when the route map is not deployed yet', async () => {
  const store = new MemoryStore();
  const normalized = normalizeLeadPayload({
    lead_checkpoint_id:'408d_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', lead_stage:'started',
    first_name:'Maya', phone:'4085551234', consent:true, contact_consent_state:'granted',
    contact_consent_version:'408farmers-agency-contact-v2', contact_consent_timestamp:'2026-08-29T12:00:00.000Z',
    landing_page:'https://408farmers.com/home/', submitted_at:'2026-08-29T12:00:00.000Z'
  });
  const { record } = await upsertLeadJourney(store,normalized.value,{});
  const calls=[];
  const result = await syncAgencyZoomLead(store,record.checkpointId,'started',{
    env:{ AGENCYZOOM_WEB_LEAD_URL:'https://api.agencyzoom.com/legacy', AGENCYZOOM_AUTOMATION_SUPPRESSION_CONFIRMED:'true' },
    fetch:async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return Response.json({leadId:'legacy'});}
  });
  assert.equal(result.state,'synced');
  assert.equal(calls[0].body.source_key,'web_408_home');
  assert.equal(calls[0].body.source,'Web — 408farmers.com Home');
});
