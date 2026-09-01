# CoverageFit v3.20.205 — CF-DISCOVERY-1.0

This forward release adds a shared, product-aware discovery layer without changing CoverageFit’s established visual system.

## Shipped

- Added bounded Home, Auto, Home + Auto, Buyer, and Renter discovery plans.
- Added question planning that skips securely carried, already-answered fields.
- Made secure web bootstrap begin at the first unfinished discovery question.
- Preserved confirmed early identity for later zero-repeat contact UI; anonymous starts remain anonymous.
- Added product-aware Snapshot context and safe review topics without changing Protection Score behavior.
- Connected HOME, AUTO, BUYER, and bundle SMS intake to the same discovery model. LIFE and BUSINESS remain producer-owned flows.
- Added a producer Discovery Brief with answered/missing context and exact customer words.
- Preserved explicit channel consent, SMS suppression, underwriting, eligibility, privacy, and no-bind boundaries.

## Deployment dependencies

- Cloudflare Pages Functions must have the existing `COVERAGEFIT_DB` binding and migrations applied.
- RingCentral, callback scheduling, Google Calendar, and any existing secrets remain deployment-managed and are not included in this archive.
- `https://coveragefit.com/api/pvx/web-bootstrap` must be reachable from the production 408FARMERS origin.

## Verification

Run `npm test` from the repository root.

