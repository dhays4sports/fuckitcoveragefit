# CF-CALLBACK-WEB-1.1 release notes

CoverageFit v3.20.212 is a forward-only reliability and evidence repair for direct browser callback booking. It does not change the established visual design, customer date/time picker, appointment confirmation page, product discovery, or inbound SMS flows.

Exact Google Calendar slots now use deterministic slot identifiers. The booking request UUID is stored as private event-owner evidence. If two different requests race for the same time, Google Calendar event uniqueness permits only one owner and the other request receives bounded alternatives.

If Google creates the event but CoverageFit is interrupted before the public appointment record or durable booking is finalized, a retry verifies that the existing event belongs to the same request, rebuilds the same opaque appointment record, and completes the booking without creating a duplicate event. A deterministic public token keeps that recovery idempotent.

Callback consent evidence now uses the CoverageFit server receipt time as the authoritative timestamp. The client-captured time and authenticated relay time remain separate evidence fields. Client times outside the five-minute authenticated request window are rejected instead of being accepted as authoritative evidence.

Four confirmed non-runtime artifacts were removed: `server/sms-callback-scheduling-coreold.mjs`, `server/wrongfile`, `assets/hi`, and `assets/js/hi`. No referenced runtime file was removed.

New regression tests reproduce interrupted public-record persistence, concurrent different-request slot booking, and future client-timestamp manipulation. Historical CF-CALLBACK-WEB-1.0 evidence remains unchanged.
