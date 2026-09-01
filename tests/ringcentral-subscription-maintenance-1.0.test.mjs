import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  clearRingCentralTokenCache,
  maintainRingCentralSmsWebhook,
  ringCentralConfig,
  ringCentralSubscriptionHealth
} from '../server/ringcentral-client.mjs';
import { ringCentralConnectionStatus } from '../server/ringcentral-sms-connection-core.mjs';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const WEBHOOK_URL = 'https://coveragefit.com/api/sms/ringcentral/webhook';
const EVENT_FILTER = '/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS';

const env = overrides => ({
  RINGCENTRAL_SERVER_URL: 'https://platform.ringcentral.com',
  RINGCENTRAL_CLIENT_ID: 'client',
  RINGCENTRAL_CLIENT_SECRET: 'secret',
  RINGCENTRAL_JWT_TOKEN: 'jwt',
  RINGCENTRAL_FROM_NUMBER: '+14083276377',
  RINGCENTRAL_WEBHOOK_URL: WEBHOOK_URL,
  RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN: 'validation',
  RINGCENTRAL_CONVERSATION_HASH_SECRET: '0123456789abcdef',
  ...overrides
});

const subscription = overrides => ({
  id: 'subscription-1',
  status: 'Active',
  expirationTime: '2026-09-08T11:59:59.000Z',
  expiresIn: 604799,
  eventFilters: [EVENT_FILTER],
  deliveryMode: { transportType: 'WebHook', address: WEBHOOK_URL },
  ...overrides
});

function apiFetch({ subscriptions = [], onRequest } = {}) {
  return async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === '/restapi/oauth/token') return Response.json({ access_token: 'test-token', expires_in: 3600 });
    if (typeof onRequest === 'function') {
      const response = await onRequest(parsed, init);
      if (response) return response;
    }
    if (parsed.pathname === '/restapi/v1.0/subscription' && (init.method || 'GET') === 'GET') return Response.json({ records: subscriptions });
    if (parsed.pathname.endsWith('/phone-number')) return Response.json({ records: [{ phoneNumber: '+14083276377', features: ['SmsSender'] }] });
    throw new Error(`Unexpected RingCentral request: ${init.method || 'GET'} ${parsed.pathname}`);
  };
}

test('subscription defaults are seven days with renewal inside 24 hours', () => {
  const config = ringCentralConfig(env());
  assert.equal(config.subscriptionExpiresIn, 604799);
  assert.equal(config.subscriptionRenewBeforeSeconds, 86400);
});

test('subscription health rejects missing, expired, suspended, and blacklisted records', () => {
  assert.equal(ringCentralSubscriptionHealth(null, { now: NOW }).state, 'missing');
  assert.equal(ringCentralSubscriptionHealth(subscription({ expirationTime: '2026-09-01T11:59:59.000Z' }), { now: NOW }).state, 'expired');
  assert.equal(ringCentralSubscriptionHealth(subscription({ status: 'Suspended' }), { now: NOW }).state, 'suspended');
  assert.equal(ringCentralSubscriptionHealth(subscription({ status: 'Blacklisted', blacklistedData: { reason: 'timeout' } }), { now: NOW }).state, 'blacklisted');
  assert.equal(ringCentralSubscriptionHealth(subscription(), { now: NOW }).active, true);
});

test('healthy subscriptions are left unchanged outside the renewal window', async () => {
  clearRingCentralTokenCache();
  const result = await maintainRingCentralSmsWebhook(env(), { now: NOW, fetchImpl: apiFetch({ subscriptions: [subscription()] }) });
  assert.equal(result.action, 'healthy');
  assert.equal(result.health.active, true);
});

test('active subscriptions renew when fewer than 24 hours remain', async () => {
  clearRingCentralTokenCache();
  const calls = [];
  const expiring = subscription({ expirationTime: '2026-09-01T13:00:00.000Z', expiresIn: 3600 });
  const renewed = subscription({ expirationTime: '2026-09-08T11:59:59.000Z', expiresIn: 604799 });
  const fetchImpl = apiFetch({
    subscriptions: [expiring],
    onRequest: async (url, init) => {
      calls.push({ path: url.pathname, method: init.method || 'GET', body: init.body || '' });
      if (url.pathname.endsWith('/subscription/subscription-1/renew')) return Response.json(renewed);
      return null;
    }
  });
  const result = await maintainRingCentralSmsWebhook(env(), { now: NOW, fetchImpl });
  assert.equal(result.action, 'renewed');
  const renew = calls.find(call => call.path.endsWith('/renew'));
  assert.equal(renew.method, 'POST');
  assert.equal(JSON.parse(renew.body).expiresIn, 604799);
});

test('a transient renewal failure never deletes a still-active subscription', async () => {
  clearRingCentralTokenCache();
  const calls = [];
  const expiring = subscription({ expirationTime: '2026-09-01T13:00:00.000Z', expiresIn: 3600 });
  const fetchImpl = apiFetch({
    subscriptions: [expiring],
    onRequest: async (url, init) => {
      calls.push({ path: url.pathname, method: init.method || 'GET' });
      if (url.pathname.endsWith('/subscription/subscription-1/renew')) return Response.json({ message: 'temporarily unavailable' }, { status: 503 });
      return null;
    }
  });
  await assert.rejects(() => maintainRingCentralSmsWebhook(env(), { now: NOW, fetchImpl }), /temporarily unavailable/i);
  assert.equal(calls.some(call => call.method === 'DELETE'), false);
  assert.equal(calls.some(call => call.method === 'POST' && call.path === '/restapi/v1.0/subscription'), false);
});

test('blacklisted subscriptions are deleted and recreated', async () => {
  clearRingCentralTokenCache();
  const calls = [];
  const blocked = subscription({ status: 'Blacklisted', blacklistedData: { reason: 'timeout' } });
  const replacement = subscription({ id: 'subscription-2' });
  const fetchImpl = apiFetch({
    subscriptions: [blocked],
    onRequest: async (url, init) => {
      calls.push({ path: url.pathname, method: init.method || 'GET' });
      if (url.pathname.endsWith('/subscription/subscription-1') && init.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.pathname === '/restapi/v1.0/subscription' && init.method === 'POST') return Response.json(replacement);
      return null;
    }
  });
  const result = await maintainRingCentralSmsWebhook(env(), { now: NOW, fetchImpl });
  assert.equal(result.action, 'recreated');
  assert.equal(result.subscription.id, 'subscription-2');
  assert.ok(calls.some(call => call.method === 'DELETE'));
  assert.ok(calls.some(call => call.method === 'POST' && call.path === '/restapi/v1.0/subscription'));
});

test('connected requires sender capability and a healthy active subscription', async () => {
  clearRingCentralTokenCache();
  const blocked = await ringCentralConnectionStatus(env(), { now: NOW, fetchImpl: apiFetch({ subscriptions: [subscription({ status: 'Blacklisted', blacklistedData: { reason: 'timeout' } })] }) });
  assert.equal(blocked.senderReady, true);
  assert.equal(blocked.connected, false);
  assert.equal(blocked.connectionState, 'subscription_blacklisted');

  clearRingCentralTokenCache();
  const healthy = await ringCentralConnectionStatus(env(), { now: NOW, fetchImpl: apiFetch({ subscriptions: [subscription()] }) });
  assert.equal(healthy.senderReady, true);
  assert.equal(healthy.connected, true);
  assert.equal(healthy.connectionState, 'connected');
});

test('scheduled maintenance worker and protected Pages endpoint are included', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const endpoint = fs.readFileSync(path.join(root, 'functions/api/sms/ringcentral/maintenance.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'workers/ringcentral-maintenance-worker.mjs'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'workers/ringcentral-maintenance-wrangler.example.jsonc'), 'utf8');
  assert.match(endpoint, /ringCentralSmsMaintenance/);
  assert.match(worker, /RINGCENTRAL_MAINTENANCE_SECRET/);
  assert.match(config, /20 \*\/6 \* \* \*/);
});
