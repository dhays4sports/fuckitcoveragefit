# CoverageFit v3.20.206 — CF-DISCOVERY-1.1

This forward release protects the allure and pacing of the coordinated 408FARMERS → CoverageFit journey without redesigning either product.

## Shipped

- Made `See my Snapshot` the primary action immediately after discovery.
- Moved optional refinement to a visually secondary action.
- Changed the progress indicator to count only questions the current visitor genuinely has left.
- Added a compact continuity acknowledgment when answers were securely carried from 408FARMERS or another supported intake.
- Preserved canonical question positions in analytics while adding privacy-safe journey-position and carried-answer counts.
- Kept the six highest-value Home questions before the first Snapshot and deferred `stay intent` and `other properties` to optional continuation.
- Shortened Buyer to seven total questions so purchase context leaves five to answer.
- Shortened Auto to six total questions so an AUTO SMS start leaves five to answer; household drivers move to optional continuation.
- Shortened Bundle to six total questions so supported entry context leaves five or fewer to answer.
- Preserved Auto and Renter plans, `Not sure` answers, zero-repeat reconciliation, anonymous continuation, secure bootstrap, consent separation, SMS suppression, producer records, and Protection Score behavior.

## Verification

Run:

```text
npm test
```
