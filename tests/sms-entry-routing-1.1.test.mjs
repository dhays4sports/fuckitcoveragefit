import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSmsEntryKeyword, normalizeSmsIntent, routeSmsInbound } from '../server/sms-conversation-core.mjs';
import { normalizeSmsOrchestration, resolveSmsInboundRoute } from '../server/sms-orchestrator-core.mjs';

test('HOME AUTO LIFE BUSINESS BUYER BUNDLE and TECH remain exact restartable entry keywords', () => {
  const expected = { HOME:'home_review', AUTO:'auto', LIFE:'life', BUSINESS:'business', BUYER:'buyer', BUNDLE:'bundle', TECH:'tech' };
  for (const [keyword,intent] of Object.entries(expected)) {
    assert.equal(normalizeSmsEntryKeyword(keyword),intent);
    assert.equal(normalizeSmsIntent(keyword),intent);
  }
});

test('exact intake keyword supersedes an older callback reply context without weakening STOP', () => {
  const conversation = {
    id:'sms-live-1234567890abcdef1234567890abcdef', state:'human_takeover', intent:'', createdAt:'2026-08-29T10:00:00.000Z',
    orchestration:{
      channel:{status:'active'}, ownership:{owner:'producer'}, automationMode:'human_only',
      workflow:{id:'wf-callback',type:'missed_call_callback_v1',status:'paused',state:'new',startedAt:'2026-08-29T10:00:00.000Z'},
      replyContext:{id:'reply-callback',context:'callback_time_request',route:'appointment',workflow:'missed_call_callback_v1',source:'agencyzoom',createdAt:'2026-08-29T10:00:00.000Z',expiresAt:'2026-09-01T10:00:00.000Z'}
    }
  };
  const home = resolveSmsInboundRoute(conversation,'HOME',{occurredAt:'2026-08-29T12:00:00.000Z'});
  assert.equal(home.route,'coveragefit');
  assert.equal(home.reason,'explicit_entry_keyword');
  assert.equal(home.intent,'home_review');
  const stop = resolveSmsInboundRoute(conversation,'STOP',{occurredAt:'2026-08-29T12:00:00.000Z'});
  assert.equal(stop.reason,'stop_command');
});

test('TECH intake collects bounded role and housing without eligibility inference', () => {
  const first = routeSmsInbound({state:'new'},'TECH',{mode:'live',isFirstMessage:true});
  assert.equal(first.state,'tech_role_requested');
  assert.equal(first.intent,'tech');
  const role = routeSmsInbound({state:first.state,intent:'tech',answers:{}},'2',{mode:'live'});
  assert.equal(role.state,'tech_housing_requested');
  assert.equal(role.answers.professionalRole,'it_cybersecurity');
  const housing = routeSmsInbound({state:role.state,intent:'tech',answers:role.answers},'RENTER',{mode:'live'});
  assert.equal(housing.state,'awaiting_producer');
  assert.equal(housing.answers.housing,'renter');
  assert.match(housing.reply,/does not confirm a discount, eligibility, or underwriting approval/i);
});

test('orchestration can represent the bounded TECH workflow', () => {
  const orchestration = normalizeSmsOrchestration({ state:'tech_role_requested', intent:'tech', createdAt:'2026-08-29T12:00:00.000Z' });
  assert.equal(orchestration.workflow.type,'coveragefit_tech');
  assert.equal(orchestration.ownership.owner,'coveragefit');
});
