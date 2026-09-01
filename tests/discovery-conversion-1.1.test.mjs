import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { PVX_DISCOVERY_ORDERS } from '../server/pvx-discovery-plan-core.mjs';
import { mapWebToPvx } from '../server/web-pvx-mapping-core.mjs';
import { mapSmsToPvx } from '../server/sms-pvx-mapping-core.mjs';

const require = createRequire(import.meta.url);
const contract = require('../assets/js/pvx-discovery-contract.js');
const questionPlan = require('../assets/js/pvx-question-plan.js');

test('conversion-safe catalogs keep the core worksheet and defer lower-priority detail until after Snapshot', () => {
  assert.equal(contract.BUILD, 'CF-DISCOVERY-1.1');
  assert.equal(contract.questionsFor('home').length, 6);
  assert.equal(contract.questionsFor('buyer').length, 7);
  assert.equal(contract.questionsFor('bundle').length, 6);
  assert.equal(contract.questionsFor('auto').length, 6);
  assert.equal(contract.questionsFor('renter').length, 5);
  assert.equal(PVX_DISCOVERY_ORDERS.buyer.includes('stayIntent'), false);
  assert.equal(PVX_DISCOVERY_ORDERS.home.includes('otherProperties'), false);
  assert.equal(PVX_DISCOVERY_ORDERS.home.includes('stayIntent'), false);
  assert.equal(PVX_DISCOVERY_ORDERS.auto.includes('drivers'), false);
  assert.equal(PVX_DISCOVERY_ORDERS.bundle.includes('upgradeSummary'), false);
  assert.equal(PVX_DISCOVERY_ORDERS.bundle.includes('drivers'), false);
});

test('408 home context leaves only four genuinely new questions and repeats none', () => {
  const mapping = mapWebToPvx({
    entry_type: 'home',
    customer_selection: 'review_owned_home',
    product_track: 'home',
    discovery_shopping_reason: 'renewal_increase',
    discovery_improvement_priorities: 'understanding'
  });
  const plan = questionPlan.resolve(mapping.discovery);
  assert.equal(plan.carriedQuestionCount, 2);
  assert.equal(plan.remainingCount, 4);
  assert.equal(plan.nextQuestionId, 'ownershipDuration');
  assert.deepEqual(plan.repeatedQuestionIds, []);
  assert.equal(plan.guardrails.snapshotPrimaryNextStep, true);
});

test('HOME SMS context leaves five remaining questions without fabricating a priority', () => {
  const mapping = mapSmsToPvx({ conversationId:'sms-home-conversion-1', intent:'home_review', answers:{ reviewReason:'renewal' }, mobile:'+14085550100' });
  const plan = questionPlan.resolve(mapping.discovery);
  assert.equal(plan.carriedQuestionCount, 1);
  assert.equal(plan.remainingCount, 5);
  assert.equal(mapping.discovery.answers.improvementPriorities, undefined);
});

test('buyer and bundle web context stay within five remaining questions', () => {
  const buyer = questionPlan.resolve(mapWebToPvx({ entry_type:'buyer', customer_selection:'buying_home' }).discovery);
  const bundle = questionPlan.resolve(mapWebToPvx({ entry_type:'home_auto', customer_selection:'review_home_auto' }).discovery);
  assert.equal(buyer.remainingCount, 5);
  assert.equal(bundle.remainingCount, 5);
});

test('AUTO SMS context leaves five remaining questions before Snapshot', () => {
  const mapping = mapSmsToPvx({ conversationId:'sms-auto-conversion-1', intent:'auto', answers:{ autoNeed:'new_options' }, mobile:'+14085550100' });
  const plan = questionPlan.resolve(mapping.discovery);
  assert.equal(plan.carriedQuestionCount, 1);
  assert.equal(plan.remainingCount, 5);
  assert.equal(plan.nextQuestionId, 'improvementPriorities');
});

test('the first Snapshot is the primary completion action and refinement is optional', async () => {
  const html = await readFile(new URL('../pvx/discovery/index.html', import.meta.url), 'utf8');
  const snapshot = html.indexOf('class="pvx-button pvx-button--primary" href="/pvx/snapshot/"');
  const refine = html.indexOf('href="/pvx/refine/"');
  assert.ok(snapshot > -1);
  assert.ok(refine > snapshot);
  assert.match(html, /Your first Snapshot is ready/);
  assert.match(html, /Add optional details first/);
  assert.doesNotMatch(html, /Eight easy questions/);
});

test('progress reports only questions the visitor actually has left', async () => {
  const source = await readFile(new URL('../assets/js/pvx-discovery.js', import.meta.url), 'utf8');
  assert.match(source, /editableIndices/);
  assert.match(source, /journeyQuestionCount:editableTotal/);
  assert.match(source, /carriedQuestionCount:carriedCount/);
  assert.match(source, /repeatedQuestions: 0/);
  assert.match(source, /snapshotIsPrimaryNextStep: true/);
});

test('the additive continuity component stays responsive and forced-colors safe', async () => {
  const css = await readFile(new URL('../assets/css/pvx-discovery-conversion-1.1.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /(?:min-)?width\s*:/i);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /var\(--pvx-navy\)/);
  assert.match(css, /var\(--pvx-muted\)/);
});
