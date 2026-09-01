# CF-CALLBACK-WEB-1.0 release notes

CoverageFit v3.20.211 adds direct browser callback booking for the signed 408 finish-later path and for an explicit CoverageFit Snapshot call request.

Both paths reuse the existing Google Calendar availability, event creation, idempotency, and public add-to-calendar page. The customer chooses a date and time in the browser. On success, CoverageFit returns an opaque appointment URL; the browser opens the polished page with Google Calendar and phone-calendar actions.

The request UUID is persisted as the durable booking key and deterministic Google event identifier. A retry returns the prior logical appointment and cannot create a second event. A busy time returns up to two bounded alternatives without claiming a booking.

Snapshot booking appears only after the customer submits an explicit call request with a mobile number and selects call as the preferred method. Viewing or saving a Snapshot, campaign entry, identity capture, and marketing-SMS permission do not initiate booking.

The browser path sends no scheduling SMS and requires no text reply. Existing inbound SMS callback scheduling, HOME/AUTO/LIFE/BUSINESS/BUYER/BUNDLE/TECH keyword routing, SMS permission, and STOP suppression remain unchanged.

No prior CoverageFit, RC-SMS, PVX, discovery, or lead-operation evidence was rewritten.
