# CoverageFit v3.20.209 / CF-LEAD-OPS-1.0 deployment

## 1. Deploy CoverageFit first

Keep the existing `COVERAGEFIT_DB` D1 binding. The lead operations implementation uses the existing record store and does not require a new migration.

Set encrypted secrets in the CoverageFit Cloudflare Pages project:

| Name | Purpose |
| --- | --- |
| `COVERAGEFIT_LEAD_SYNC_SECRET` | Verifies signed early-lead requests; must match 408FARMERS |
| `COVERAGEFIT_LEAD_RETRY_TOKEN` | Protects the producer-only retry endpoint |
| `AGENCYZOOM_WEB_LEAD_URL` | Unique Web Lead URL for the personal/manual pipeline stage |
| `AGENCYZOOM_MARKETING_SMS_WEB_LEAD_URL` | Different Web Lead URL for the consent-verified automation stage |

Set plain variables:

| Name | Production value |
| --- | --- |
| `COVERAGEFIT_LEAD_RETENTION_DAYS` | `730` unless the agency adopts a different approved schedule |
| `AGENCYZOOM_AUTOMATION_SUPPRESSION_CONFIRMED` | `true` only after the manual destination is verified to start no automation |
| `AGENCYZOOM_MARKETING_SMS_AUTOMATION_CONFIRMED` | `true` only after the consented destination and STOP behavior are verified |
| `AGENCYZOOM_ALLOW_ZAPIER_WEBHOOK` | `false` unless Zapier is intentionally approved and configured |

Webhook URLs are treated as secrets because they can create CRM records.

## 2. Create two AgencyZoom Web Lead integrations

Use AgencyZoom’s Web Lead Integration to create unique URLs that land in different pipeline stages.

1. **CoverageFit — Personal follow-up:** assign Dylan, add the CoverageFit source/tags, and ensure the destination stage has no automated marketing sequence.
2. **CoverageFit — Automated SMS consent verified:** assign Dylan, add the consent-verified tag, and attach only the approved marketing sequence.
3. Do not point both variables at the same Web Lead URL.
4. Configure AgencyZoom/RingCentral opt-out handling so STOP suppresses every remaining automated message from the shared number.

CoverageFit refuses to post a consented lead to the manual URL and refuses to post an unconsented lead to the automated URL.

## 3. Production canary

Use agency-controlled test numbers only:

1. Unchecked checkbox → D1 `started` record → manual AgencyZoom stage → no automated text.
2. Checked checkbox → same durable contract plus exact version/timestamp → consented AgencyZoom stage → one approved automated message.
3. Reply `STOP` → confirm suppression in the live messaging provider and no later sequence messages.
4. Re-submit the same journey → confirm one logical record and no duplicate started notification.
5. Complete Snapshot → confirm milestone only, with no second generic new-lead message.
6. Request Dylan → confirm `contact_requested` upgrades the same checkpoint.
7. Disable an AgencyZoom URL → confirm the D1 record remains durable and CRM state becomes blocked/pending without blocking the customer.

## Compliance checkpoint

The current FCC rule defines prior express written consent for automated telemarketing/advertising calls and texts and requires seller-specific authorization and a statement that consent is not required as a condition of purchase. Electronic/digital signatures may qualify. Revocation must be honored through reasonable means, including common opt-out words. See [47 CFR § 64.1200](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200).

This engineering contract is not legal advice. Obtain agency/carrier counsel or compliance approval for the disclosure, campaign content, frequency, quiet hours, registration, record retention, and opt-out implementation before enabling live marketing automation.
