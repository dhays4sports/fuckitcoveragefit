import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { handleCustomerWebBooking, handleSignedWebBooking, normalizeSignedBooking } from '../server/callback-web-booking-core.mjs';
import { hashToken } from '../server/pvx-checkpoint-core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SECRET = 'test-secret-that-is-longer-than-thirty-two-characters';
const NOW = new Date('2026-08-29T12:00:00.000Z');
const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const validPayload = () => ({
  schema_version:'408-callback-browser-booking-v1',
  request_id:REQUEST_ID,
  correlation_id:'408d_callback_test',
  first_name:'Maya',
  phone:'+14085551234',
  product_type:'home',
  source_route:'/home/',
  date:'2026-08-31',
  time:'14:00',
  call_request:true,
  call_request_version:'408-callback-browser-booking-v1',
  call_request_timestamp:NOW.toISOString()
});

class MemoryStore {
  constructor(seed = {}) { this.rows = new Map(Object.entries(seed)); }
  async get(key) { return structuredClone(this.rows.get(key) || null); }
  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && this.rows.has(key)) throw new Error('duplicate');
    this.rows.set(key, structuredClone(value));
  }
}

function signedRequest(payload, sentAt = NOW.getTime()) {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', SECRET).update(`${sentAt}.${body}`).digest('hex');
  return new Request('https://coveragefit.com/api/callback/web-book', {
    method:'POST',
    body,
    headers:{
      'Content-Type':'application/json',
      'X-CoverageFit-Sent-At':String(sentAt),
      'X-CoverageFit-Signature':signature,
      'X-CoverageFit-Contract':'coveragefit-callback-web-booking-v1'
    }
  });
}

function customerRequest(value, origin = 'https://coveragefit.com') {
  return new Request('https://coveragefit.com/api/callback/customer-book', {
    method:'POST',
    body:JSON.stringify(value),
    headers:{ Origin:origin, 'Content-Type':'application/json', 'X-CoverageFit-Callback-Version':'1' }
  });
}

function calendarFetch(options = {}) {
  const calls = [];
  let freeBusyCalls = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url:href, init });
    if (href === 'https://oauth2.googleapis.com/token') return Response.json({ access_token:'google-test-token', expires_in:3600 });
    if (href === 'https://www.googleapis.com/calendar/v3/freeBusy') {
      freeBusyCalls += 1;
      const busy = options.busyFirst && freeBusyCalls === 1
        ? [{ start:'2026-08-31T21:00:00.000Z', end:'2026-08-31T21:30:00.000Z' }]
        : [];
      return Response.json({ calendars:{ 'calendar-test-id':{ busy } } });
    }
    if (/\/events$/.test(href) && init.method === 'POST') {
      const event = JSON.parse(init.body);
      return Response.json({ id:event.id, htmlLink:`https://calendar.google.com/calendar/event?eid=${event.id}` }, { status:200 });
    }
    if (/\/events\/[a-f0-9]{32}$/.test(href) && init.method === 'GET') {
      return Response.json({ id:href.split('/').at(-1), htmlLink:'https://calendar.google.com/calendar/event?eid=existing' });
    }
    throw new Error(`Unexpected calendar request: ${init.method || 'GET'} ${href}`);
  };
  return { fetchImpl, calls };
}

const calendarEnv = {
  GOOGLE_CALENDAR_ID:'calendar-test-id',
  GOOGLE_CALENDAR_CLIENT_ID:'calendar-client-id',
  GOOGLE_CALENDAR_CLIENT_SECRET:'calendar-client-secret',
  GOOGLE_CALENDAR_REFRESH_TOKEN:'calendar-refresh-token',
  CALLBACK_TIME_ZONE:'America/Los_Angeles'
};

test('signed browser payload is bounded and cannot carry marketing-text consent', () => {
  const normalized = normalizeSignedBooking(validPayload());
  assert.equal(normalized.phone, '+14085551234');
  assert.equal(normalized.date, '2026-08-31');
  assert.equal(normalized.time, '14:00');
  const noCall = validPayload();
  noCall.call_request = false;
  assert.equal(normalizeSignedBooking(noCall), null);
  const extra = validPayload();
  extra.automated_marketing_sms_consent = true;
  assert.equal(normalizeSignedBooking(extra), null);
});

test('a signed browser request books Google Calendar once and retry returns the same appointment', async () => {
  const store = new MemoryStore();
  const google = calendarFetch();
  const options = { store, env:{ ...calendarEnv, COVERAGEFIT_LEAD_SYNC_SECRET:SECRET }, fetchImpl:google.fetchImpl, now:NOW };
  const first = await handleSignedWebBooking(signedRequest(validPayload()), options);
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.booked, true);
  assert.match(firstBody.appointment.calendarUrl, /^https:\/\/coveragefit\.com\/appointment\/\?token=[A-Za-z0-9_-]{24,96}$/);
  assert.equal(new URL(firstBody.appointment.calendarUrl).searchParams.has('phone'), false);
  assert.equal(google.calls.filter(call => /\/events$/.test(call.url) && call.init.method === 'POST').length, 1);

  const retry = await handleSignedWebBooking(signedRequest(validPayload()), options);
  assert.equal(retry.status, 200);
  const retryBody = await retry.json();
  assert.equal(retryBody.idempotent, true);
  assert.equal(retryBody.appointment.calendarUrl, firstBody.appointment.calendarUrl);
  assert.equal(google.calls.filter(call => /\/events$/.test(call.url) && call.init.method === 'POST').length, 1);

  const publicRecord = [...store.rows.entries()].find(([key]) => key.startsWith('sms-callback-calendar/'))?.[1];
  assert.ok(publicRecord);
  assert.equal(JSON.stringify(publicRecord).includes('+14085551234'), false);
});

test('a busy time returns bounded browser alternatives without creating an event', async () => {
  const payload = { ...validPayload(), request_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const google = calendarFetch({ busyFirst:true });
  const response = await handleSignedWebBooking(signedRequest(payload), {
    store:new MemoryStore(), env:{ ...calendarEnv, COVERAGEFIT_LEAD_SYNC_SECRET:SECRET }, fetchImpl:google.fetchImpl, now:NOW
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.booked, false);
  assert.equal(body.available, false);
  assert.ok(body.alternatives.length > 0 && body.alternatives.length <= 2);
  assert.match(body.alternatives[0].date, /^20\d{2}-\d{2}-\d{2}$/);
  assert.match(body.alternatives[0].time, /^\d{2}:\d{2}$/);
  assert.equal(google.calls.filter(call => /\/events$/.test(call.url)).length, 0);
});

test('bad and expired signatures are rejected before calendar access', async () => {
  const store = new MemoryStore();
  let calendarCalls = 0;
  const bad = signedRequest(validPayload());
  bad.headers.set('X-CoverageFit-Signature', '0'.repeat(64));
  assert.equal((await handleSignedWebBooking(bad, { store, env:{ COVERAGEFIT_LEAD_SYNC_SECRET:SECRET }, fetchImpl:async () => { calendarCalls += 1; } , now:NOW })).status, 401);
  const stale = signedRequest(validPayload(), NOW.getTime() - 10 * 60 * 1000);
  assert.equal((await handleSignedWebBooking(stale, { store, env:{ COVERAGEFIT_LEAD_SYNC_SECRET:SECRET }, fetchImpl:async () => { calendarCalls += 1; }, now:NOW })).status, 401);
  assert.equal(calendarCalls, 0);
});

test('Snapshot booking requires a same-origin request and previously saved explicit call permission', async () => {
  const token = `pvx_${'A'.repeat(43)}`;
  const key = `pvx/checkpoint/${await hashToken(token)}`;
  const leadStore = new MemoryStore({
    [key]: {
      expiresAt:'2099-01-01T00:00:00.000Z', checkpointId:'cp_test',
      contact:{ name:'Maya Chen', mobile:'+14085551234', preferredMethod:'call' },
      consent:{ contact:true, call:false }
    }
  });
  const value = {
    action:'book_from_checkpoint', token, request_id:REQUEST_ID, date:'2026-08-31', time:'14:00',
    call_request:true, call_request_version:'408-callback-browser-booking-v1', call_request_timestamp:NOW.toISOString()
  };
  const options = { store:new MemoryStore(), leadStore, env:calendarEnv, now:NOW };
  assert.equal((await handleCustomerWebBooking(customerRequest(value), options)).status, 409);
  assert.equal((await handleCustomerWebBooking(customerRequest(value, 'https://attacker.example'), options)).status, 403);
});

test('Snapshot call request can book in-browser and returns the polished appointment page', async () => {
  const token = `pvx_${'B'.repeat(43)}`;
  const key = `pvx/checkpoint/${await hashToken(token)}`;
  const leadStore = new MemoryStore({
    [key]: {
      expiresAt:'2099-01-01T00:00:00.000Z', checkpointId:'cp_snapshot_callback',
      contact:{ name:'Maya Chen', mobile:'+14085551234', preferredMethod:'call' },
      consent:{ contact:true, call:true }
    }
  });
  const google = calendarFetch();
  const value = {
    action:'book_from_checkpoint', token, request_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc', date:'2026-08-31', time:'14:00',
    call_request:true, call_request_version:'408-callback-browser-booking-v1', call_request_timestamp:NOW.toISOString()
  };
  const response = await handleCustomerWebBooking(customerRequest(value), {
    store:new MemoryStore(), leadStore, env:calendarEnv, fetchImpl:google.fetchImpl, now:NOW
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.booked, true);
  assert.match(body.appointment.calendarUrl, /^https:\/\/coveragefit\.com\/appointment\/\?token=/);
});

test('Snapshot UI is browser-first, accessible, and never asks the visitor to schedule by text', async () => {
  const source = await readFile(resolve(here, '../assets/js/pvx-callback-continuity.js'), 'utf8');
  const page = await readFile(resolve(here, '../appointment/index.html'), 'utf8');
  assert.match(source, /ENDPOINT = '\/api\/callback\/customer-book'/);
  assert.match(source, /type="date" data-pvx-callback-date/);
  assert.match(source, /data-pvx-callback-time/);
  assert.match(source, /Confirm callback/);
  assert.match(source, /Times are shown in Pacific Time/);
  assert.match(source, /This does not enroll you in marketing texts/);
  assert.match(source, /coveragefit:contact_requested/);
  assert.match(source, /\/appointment\//);
  assert.doesNotMatch(source, /scheduling text|reply with the best day|text CALLBACK/i);
  assert.doesNotMatch(source, /[?&](?:phone|mobile|name|consent)=/);
  assert.match(page, /Add to Google Calendar/);
  assert.match(page, /Add to phone calendar/);
});
