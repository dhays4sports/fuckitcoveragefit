import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RINGCENTRAL_RECOVERY_CURSOR_KEY,
  noteConfirmedRingCentralWebhookEvent,
  recoverMissedRingCentralSms
} from '../server/ringcentral-webhook-recovery-core.mjs';
import {
  clearRingCentralTokenCache,
  listRingCentralMessageHistory
} from '../server/ringcentral-client.mjs';

class MemoryStore {
  constructor() { this.rows = new Map(); }
  async get(key) { return this.rows.get(key) || null; }
  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && this.rows.has(key)) throw new Error('duplicate');
    this.rows.set(key, structuredClone(value));
  }
  async delete(key) { this.rows.delete(key); }
}

const sms = (id, creationTime, from = '+14085550111', to = '+14083276377') => ({
  id,
  type: 'SMS',
  direction: 'Inbound',
  creationTime,
  subject: id,
  from: { phoneNumber: from },
  to: [{ phoneNumber: to, target: true }]
});

test('recovery replays only missing inbound SMS records in chronological order', async () => {
  const store = new MemoryStore();
  await store.setJSON(RINGCENTRAL_RECOVERY_CURSOR_KEY, {
    lastConfirmedEventAt: '2026-09-01T10:00:00.000Z'
  });
  await store.setJSON('sms-live-events/already-seen', { status: 'processed' });
  const records = [
    sms('missing-two', '2026-09-01T10:03:00.000Z'),
    sms('already-seen', '2026-09-01T10:01:00.000Z'),
    sms('missing-one', '2026-09-01T10:02:00.000Z'),
    { ...sms('outbound', '2026-09-01T10:04:00.000Z'), direction: 'Outbound' }
  ];
  const replayed = [];
  const result = await recoverMissedRingCentralSms({
    store,
    env: { RINGCENTRAL_FROM_NUMBER: '+14083276377' },
    now: new Date('2026-09-01T11:00:00.000Z'),
    listHistory: async () => ({ records, page: 1, totalPages: 1, hasMore: false }),
    processEvent: async payload => {
      replayed.push(payload.body.id);
      await store.setJSON(`sms-live-events/${payload.body.id}`, { status: 'processed' });
      return { ok: true, deduped: false };
    }
  });
  assert.deepEqual(replayed, ['missing-one', 'missing-two']);
  assert.deepEqual(result.counts, { found: 3, replayed: 2, deduped: 1, ignored: 0, failed: 0 });
  const cursor = await store.get(RINGCENTRAL_RECOVERY_CURSOR_KEY);
  assert.equal(cursor.lastRecoveryStatus, 'completed');
  assert.equal(cursor.lastRecoveryCompletedThrough, '2026-09-01T11:00:00.000Z');
});

test('the normal event ledger makes a repeated recovery scan idempotent', async () => {
  const store = new MemoryStore();
  await store.setJSON('sms-live-events/processed-message', { status: 'processed' });
  let calls = 0;
  const result = await recoverMissedRingCentralSms({
    store,
    env: { RINGCENTRAL_FROM_NUMBER: '+14083276377' },
    now: new Date('2026-09-01T12:00:00.000Z'),
    listHistory: async () => ({ records: [sms('processed-message', '2026-09-01T11:58:00.000Z')], page: 1, totalPages: 1, hasMore: false }),
    processEvent: async () => { calls += 1; return { ok: true }; }
  });
  assert.equal(calls, 0);
  assert.equal(result.counts.deduped, 1);
  assert.equal(result.counts.replayed, 0);
});

test('a failed replay does not advance the checkpoint past that message', async () => {
  const store = new MemoryStore();
  const result = await recoverMissedRingCentralSms({
    store,
    env: { RINGCENTRAL_FROM_NUMBER: '+14083276377' },
    now: new Date('2026-09-01T13:00:00.000Z'),
    listHistory: async () => ({ records: [sms('failed-message', '2026-09-01T12:30:00.000Z')], page: 1, totalPages: 1, hasMore: false }),
    processEvent: async () => ({ ok: false, error: { code: 'send_failed' } })
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'partial');
  assert.equal(result.counts.failed, 1);
  assert.ok(Date.parse(result.completedThrough) < Date.parse('2026-09-01T12:30:00.000Z'));
});

test('live webhook checkpoints are tracked without allowing recovery replays to move them', async () => {
  const store = new MemoryStore();
  await noteConfirmedRingCentralWebhookEvent(store, { messageId: 'live-one', occurredAt: '2026-09-01T09:00:00.000Z' });
  await noteConfirmedRingCentralWebhookEvent(store, { messageId: 'replayed-old', occurredAt: '2026-09-01T10:00:00.000Z' }, { recoveryReplay: true });
  const cursor = await store.get(RINGCENTRAL_RECOVERY_CURSOR_KEY);
  assert.equal(cursor.lastConfirmedMessageId, 'live-one');
  assert.equal(cursor.lastConfirmedEventAt, '2026-09-01T09:00:00.000Z');
});

test('subscription renewal starts recovery and a protected manual endpoint is deployed', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const connection = fs.readFileSync(path.join(root, 'server/ringcentral-sms-connection-core.mjs'), 'utf8');
  const handlers = fs.readFileSync(path.join(root, 'server/cloudflare-pages-handlers.mjs'), 'utf8');
  const endpoint = fs.readFileSync(path.join(root, 'functions/api/sms/ringcentral/recovery.js'), 'utf8');
  assert.match(connection, /const recoveryTask = runRingCentralRecovery\(request, options\)/);
  assert.match(connection, /authorizeProducer\(request, options\.env/);
  assert.match(connection, /sameOrigin\(request\)/);
  assert.match(handlers, /ringCentralSmsRecovery/);
  assert.match(endpoint, /ringCentralSmsRecovery as onRequest/);
});

test('history lookup uses RingCentral inbound SMS date and paging filters', async () => {
  clearRingCentralTokenCache();
  let historyUrl = '';
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/restapi/oauth/token')) {
      return Response.json({ access_token: 'test-token', expires_in: 3600 });
    }
    historyUrl = String(url);
    return Response.json({ records: [sms('history-one', '2026-09-01T10:00:00.000Z')], paging: { page: 2, totalPages: 3 } });
  };
  const env = {
    RINGCENTRAL_SERVER_URL: 'https://platform.ringcentral.com',
    RINGCENTRAL_CLIENT_ID: 'client',
    RINGCENTRAL_CLIENT_SECRET: 'secret',
    RINGCENTRAL_JWT_TOKEN: 'jwt',
    RINGCENTRAL_FROM_NUMBER: '+14083276377',
    RINGCENTRAL_WEBHOOK_URL: 'https://coveragefit.com/api/sms/ringcentral/webhook',
    RINGCENTRAL_WEBHOOK_VALIDATION_TOKEN: 'validation',
    RINGCENTRAL_CONVERSATION_HASH_SECRET: '0123456789abcdef'
  };
  const result = await listRingCentralMessageHistory({
    dateFrom: '2026-09-01T09:00:00.000Z',
    dateTo: '2026-09-01T11:00:00.000Z',
    page: 2,
    perPage: 100
  }, env, { fetchImpl });
  const url = new URL(historyUrl);
  assert.equal(url.pathname, '/restapi/v1.0/account/~/extension/~/message-store');
  assert.equal(url.searchParams.get('messageType'), 'SMS');
  assert.equal(url.searchParams.get('direction'), 'Inbound');
  assert.equal(url.searchParams.get('dateFrom'), '2026-09-01T09:00:00.000Z');
  assert.equal(url.searchParams.get('dateTo'), '2026-09-01T11:00:00.000Z');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('perPage'), '100');
  assert.equal(result.hasMore, true);
});
