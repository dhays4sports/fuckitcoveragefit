# CoverageFit v3.20.209 / CF-LEAD-OPS-1.0

CoverageFit D1 is now the canonical durable record for early 408FARMERS leads. The same logical checkpoint ID correlates the lead from `started` through Snapshot, contact request, Home Profile, and policy-review readiness.

## CRM projection

- AgencyZoom remains an operational projection, not the source of truth.
- Unchecked or invalid automated marketing permission routes only to the separately configured personal/manual pipeline and carries `automation_suppressed=true`.
- Complete `408farmers-automated-marketing-sms-v1` evidence routes only to the separately configured marketing automation webhook.
- A consented lead never falls back into the manual webhook, and an unconsented lead never enters the automated webhook.
- Both branches require explicit deployment guards before CoverageFit will post.

## Privacy and lifecycle

PII remains in request bodies and durable records, never visible URLs or analytics. Passive Snapshot viewing advances the durable milestone but does not create a second generic producer notification. Existing RingCentral STOP/suppression behavior remains authoritative regardless of prior marketing consent.

## Deployment dependency

Create two distinct AgencyZoom Web Lead integrations: a suppressed/manual stage and a consent-verified automated-marketing stage. Keep their webhook URLs secret. Complete agency legal/compliance approval and a controlled live canary before turning on automated sends.
