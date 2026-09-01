import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { bookCallbackWebAppointment } from '../server/sms-callback-scheduling-core.mjs';
import { handleSignedWebBooking } from '../server/callback-web-booking-core.mjs';

const NOW = new Date('2026-08-29T12:00:00.000Z');
const SLOT_START = '2026-08-31T21:00:00.000Z';
const BASE = {
  phone: '+14085551234',
  firstName: 'Maya',
  productType: 'home',
  correlationId: 'callback_continuity_1_1',
  source: 'regression',
  date: '2026-08-31',
  time: '14:00',
  callRequestVersion: '408-callback-browser-booking-v1',
  callRequestTimestamp: NOW.toISOString()
};
const ENV = {
  GOOGLE_CALENDAR_ID: 'calendar-test-id',
  GOOGLE_CALENDAR_CLIENT_ID: 'calendar-client-id',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'calendar-client-secret',
  GOOGLE_CALENDAR_REFRESH_TOKEN: 'calendar-refresh-token',
  CALLBACK_TIME_ZONE: 'America/Los_Angeles'
};

class Store {
  constructor() {
    this.rows = new Map();
    this.failCalendarWriteOnce = false;
  }

  async get(key) {
    return structuredClone(this.rows.get(key) || null);
  }

  async setJSON(key, value, options = {}) {
    if (options.onlyIfNew && this.rows.has(key)) throw new Error('duplicate');
    if (key.startsWith('sms-callback-calendar/') && this.failCalendarWriteOnce) {
      this.failCalendarWriteOnce = false;
      throw new Error('simulated public calendar record failure');
    }
    this.rows.set(key, structuredClone(value));
  }
}

function calendar({ busyAfterCreate = false } = {}) {
  const events = new Map();
  let eventPosts = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    if (href === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'token' });
    if (href === 'https://www.googleapis.com/calendar/v3/freeBusy') {
      const busy = busyAfterCreate && events.size
        ? [{ start: SLOT_START, end: '2026-08-31T21:15:00.000Z' }]
        : [];
      return Response.json({ calendars: { 'calendar-test-id': { busy } } });
    }
    if (/\/events$/.test(href) && init.method === 'POST') {
      const event = JSON.parse(init.body);
      if (events.has(event.id)) return Response.json({ error: { code: 409 } }, { status: 409 });
      eventPosts += 1;
      events.set(event.id, event);
      return Response.json({ ...event, htmlLink: `https://calendar.google.com/event/${event.id}` });
    }
    if (/\/events\/[a-f0-9]{32,64}$/.test(href) && init.method === 'GET') {
      const id = href.split('/').at(-1);
      if (!events.has(id)) return Response.json({}, { status: 404 });
      return Response.json({ ...events.get(id), id, htmlLink: `https://calendar.google.com/event/${id}` });
    }
    throw new Error(`Unexpected request: ${init.method || 'GET'} ${href}`);
  };
  return { fetchImpl, events, eventPosts: () => eventPosts };
}

test('an interrupted public appointment write recovers the existing Google event without a duplicate', async () => {
  const store = new Store();
  store.failCalendarWriteOnce = true;
  const google = calendar({ busyAfterCreate: true });
  const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const input = { ...BASE, requestId };

  await assert.rejects(() => bookCallbackWebAppointment(input, { store, env: ENV, fetchImpl: google.fetchImpl, now: NOW }));
  const retry = await bookCallbackWebAppointment(input, {
    store,
    env: ENV,
    fetchImpl: google.fetchImpl,
    now: new Date(NOW.getTime() + 3 * 60 * 1000)
  });

  assert.equal(retry.available, true);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.booking.requestId, requestId);
  assert.equal(retry.booking.googleEventId, retry.booking.slotEventId);
  assert.equal(google.eventPosts(), 1);
});

test('two different request IDs cannot concurrently reserve the same calendar slot', async () => {
  const store = new Store();
  const google = calendar();
  const first = { ...BASE, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const second = { ...BASE, requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
  const results = await Promise.all([
    bookCallbackWebAppointment(first, { store, env: ENV, fetchImpl: google.fetchImpl, now: NOW }),
    bookCallbackWebAppointment(second, { store, env: ENV, fetchImpl: google.fetchImpl, now: NOW })
  ]);

  assert.equal(results.filter(result => result.available).length, 1);
  assert.equal(results.filter(result => !result.available).length, 1);
  assert.equal(google.eventPosts(), 1);
  assert.equal(google.events.size, 1);
});

test('signed callback consent rejects a client timestamp outside the authenticated request window', async () => {
  const secret = 'audit-secret-that-is-longer-than-thirty-two-characters';
  const input = {
    schema_version: '408-callback-browser-booking-v1',
    request_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    correlation_id: 'callback_continuity_1_1',
    first_name: 'Maya',
    phone: '+14085551234',
    product_type: 'home',
    source_route: '/home/',
    date: '2026-08-31',
    time: '14:00',
    call_request: true,
    call_request_version: '408-callback-browser-booking-v1',
    call_request_timestamp: '2099-01-01T00:00:00.000Z'
  };
  const body = JSON.stringify(input);
  const sentAt = String(NOW.getTime());
  const signature = createHmac('sha256', secret).update(`${sentAt}.${body}`).digest('hex');
  const request = new Request('https://coveragefit.com/api/callback/web-book', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-CoverageFit-Sent-At': sentAt,
      'X-CoverageFit-Signature': signature,
      'X-CoverageFit-Contract': 'coveragefit-callback-web-booking-v1'
    }
  });
  const google = calendar();
  const response = await handleSignedWebBooking(request, {
    store: new Store(),
    env: { ...ENV, COVERAGEFIT_LEAD_SYNC_SECRET: secret },
    fetchImpl: google.fetchImpl,
    now: NOW
  });

  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'call_request_timestamp_invalid');
  assert.equal(google.eventPosts(), 0);
});

test('signed callback consent stores server receipt as authoritative and preserves client and relay evidence separately', async () => {
  const secret = 'evidence-secret-that-is-longer-than-thirty-two-characters';
  const clientTimestamp = new Date(NOW.getTime() - 4 * 60 * 1000).toISOString();
  const requestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const input = {
    schema_version: '408-callback-browser-booking-v1',
    request_id: requestId,
    correlation_id: 'callback_evidence_1_1',
    first_name: 'Maya',
    phone: '+14085551234',
    product_type: 'home',
    source_route: '/home/',
    date: '2026-08-31',
    time: '14:00',
    call_request: true,
    call_request_version: '408-callback-browser-booking-v1',
    call_request_timestamp: clientTimestamp
  };
  const body = JSON.stringify(input);
  const sentAt = String(NOW.getTime());
  const signature = createHmac('sha256', secret).update(`${sentAt}.${body}`).digest('hex');
  const request = new Request('https://coveragefit.com/api/callback/web-book', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-CoverageFit-Sent-At': sentAt,
      'X-CoverageFit-Signature': signature,
      'X-CoverageFit-Contract': 'coveragefit-callback-web-booking-v1'
    }
  });
  const store = new Store();
  const google = calendar();
  const response = await handleSignedWebBooking(request, {
    store,
    env: { ...ENV, COVERAGEFIT_LEAD_SYNC_SECRET: secret },
    fetchImpl: google.fetchImpl,
    now: NOW
  });

  assert.equal(response.status, 201);
  const booking = await store.get(`callback-web-bookings/${requestId}`);
  assert.equal(booking.callRequest.capturedAt, NOW.toISOString());
  assert.equal(booking.callRequest.clientCapturedAt, clientTimestamp);
  assert.equal(booking.callRequest.relayAuthenticatedAt, NOW.toISOString());
  assert.equal(booking.callRequest.evidenceSource, 'coveragefit_server_received_signed_408');
});
