# CoverageFit v3.20.210 / CF-LEAD-OPS-1.1 deployment

This release preserves the existing UI and routes. It adds route-aware AgencyZoom source projection, a privacy-minimized Life application-start projection, idempotent SMS source records, and the bounded `TECH` SMS intake.

## AgencyZoom setup

Create the two pipelines first:

1. **Personal Insurance** → entry stage **New — Review Needed** with no automation.
2. **Life** → entry stage **New — Review Needed** with no automation.

Use `CF-LEAD-OPS-1.1_AGENCYZOOM_SOURCE_CATALOG.json` as the exact source-name list. For every active source, create an AgencyZoom Web Lead integration that assigns Dylan and lands in the listed pipeline and entry stage. Do not attach automated messages to either entry stage.

AgencyZoom Web Lead URLs are credentials. Store their mapping as the encrypted Cloudflare secret `AGENCYZOOM_SOURCE_ROUTES_JSON`; never commit real URLs.

Example shape with fake URLs:

```json
{
  "web_408_home": {
    "manual_url": "https://api.agencyzoom.com/REPLACE_HOME_MANUAL",
    "manual_confirmed": true,
    "marketing_url": "https://api.agencyzoom.com/REPLACE_HOME_CONSENT_VERIFIED",
    "marketing_confirmed": true
  },
  "web_408_life": {
    "manual_url": "https://api.agencyzoom.com/REPLACE_LIFE_MANUAL",
    "manual_confirmed": true,
    "marketing_url": "https://api.agencyzoom.com/REPLACE_LIFE_CONSENT_VERIFIED",
    "marketing_confirmed": true
  },
  "sms_life": {
    "manual_url": "https://api.agencyzoom.com/REPLACE_SMS_LIFE_MANUAL",
    "manual_confirmed": true
  }
}
```

`manual_confirmed` means the destination starts no automated marketing. `marketing_confirmed` means the destination is approved to receive a record carrying complete automated-marketing consent evidence; the user’s preferred operating model may still keep that destination’s entry stage quiet until a human moves the lead.

The existing `AGENCYZOOM_WEB_LEAD_URL` and `AGENCYZOOM_MARKETING_SMS_WEB_LEAD_URL` remain safe compatibility fallbacks. Route-specific URLs take priority. A present but unconfirmed route-specific URL fails closed instead of falling through.

## Cloudflare secrets and variables

CoverageFit secrets:

- `COVERAGEFIT_LEAD_SYNC_SECRET` — must match 408farmers.com.
- `COVERAGEFIT_LEAD_RETRY_TOKEN` — protects retry operations.
- `AGENCYZOOM_SOURCE_ROUTES_JSON` — per-source URL map.
- `AGENCYZOOM_WEB_LEAD_URL` — compatibility/manual fallback.
- `AGENCYZOOM_MARKETING_SMS_WEB_LEAD_URL` — compatibility/consent-verified fallback.

CoverageFit variables:

- `AGENCYZOOM_AUTOMATION_SUPPRESSION_CONFIRMED=true` only after the manual fallback is verified quiet.
- `AGENCYZOOM_MARKETING_SMS_AUTOMATION_CONFIRMED=true` only after the consent-verified fallback is verified correctly routed.
- `AGENCYZOOM_ALLOW_ZAPIER_WEBHOOK=false` unless Zapier was separately approved.

408farmers.com secret:

- `COVERAGEFIT_LEAD_SYNC_SECRET` — same value as CoverageFit.

Keep the existing `COVERAGEFIT_DB`, `LIFE_QUEUE_DB`, `LIFE_QUEUE_ENCRYPTION_KEY_B64`, RingCentral, Google Calendar, and producer Access settings unchanged.

## Life behavior

The full `/life/` application-start payload remains encrypted in the existing Life D1 queue. Only after that write succeeds, 408farmers.com sends CoverageFit this bounded operational summary:

- opaque checkpoint ID;
- first and last name;
- email and optional mobile;
- `web_408_life` source and campaign attribution;
- versioned `requested_transaction_follow_up` evidence.

DOB, address, ZIP, SSN last four, protection priorities, income runway, and existing coverage answers are never sent to AgencyZoom. Automated-marketing permission remains false. A downstream CRM outage never reverses or blocks the encrypted Life queue submission.

## SMS behavior

- Exact `HOME`, `AUTO`, `LIFE`, `BUSINESS`, `BUYER`, `BUNDLE`, and `TECH` keywords start a fresh bounded intake, including after an older callback episode.
- `STOP` remains globally authoritative.
- A day/time reply remains in callback scheduling.
- The SMS conversation becomes the recoverable early checkpoint immediately; AgencyZoom receives one manual-only source record when the short bounded intake reaches Dylan/continuation-ready, so its first CRM payload includes the useful answers.
- Inbound SMS does not create automated-marketing consent.
- Replayed RingCentral webhooks and repeated messages reuse one logical checkpoint.

## Canary sequence

1. Submit `/home/` without automated-marketing consent; confirm `Web — 408farmers.com Home`, Personal Insurance, quiet entry stage.
2. Submit `/home/` with the optional automated-marketing checkbox; confirm exact consent evidence and the configured consent-verified destination.
3. Submit `/life/`; confirm the encrypted Life queue item and one `Web — 408farmers.com Life` record in the Life pipeline. Inspect the AgencyZoom payload/record for absence of sensitive Life fields.
4. Text `LIFE`; confirm the Life SMS questions and one `SMS — 408-FARMERS LIFE` record.
5. Text `CALLBACK`, enter a time, then text `HOME`; confirm the callback episode is replaced by a new HOME intake.
6. Text `TECH`, select a bounded role and homeowner/renter; confirm no discount or eligibility inference.
7. Replay the same webhook; confirm no duplicate logical lead.
8. Disable one AgencyZoom URL; confirm CoverageFit keeps the durable lead pending and the visitor flow is not blocked.

## Tests

```bash
npm test
npm run test:lead-ops
```

For the 408farmers.com archive:

```bash
node --test tests/lead-operations-1.0.test.cjs tests/lead-operations-1.1.test.cjs
```
