# RingCentral webhook maintenance

CoverageFit creates seven-day RingCentral webhook subscriptions and renews them when fewer than 24 hours remain. A missing, expired, suspended, inactive, or blacklisted matching subscription is replaced. When a subscription is restored after an interruption, CoverageFit starts its idempotent missed-message recovery scan.

## One-time Cloudflare setup

1. Add a strong random `RINGCENTRAL_MAINTENANCE_SECRET` to the CoverageFit Pages project.
2. Copy `ringcentral-maintenance-wrangler.example.jsonc` to `ringcentral-maintenance-wrangler.jsonc` and confirm the production maintenance URL.
3. Set the same secret on the maintenance Worker with `wrangler secret put RINGCENTRAL_MAINTENANCE_SECRET --config workers/ringcentral-maintenance-wrangler.jsonc`.
4. Deploy it with `wrangler deploy --config workers/ringcentral-maintenance-wrangler.jsonc`.
5. Trigger it once or wait for the scheduled cron, then verify the protected SMS simulator reports `Connected` and an automatic-maintenance timestamp.

The default schedule checks every six hours. Healthy subscriptions outside the 24-hour renewal window are left untouched. The maintenance endpoint is secret-protected and cannot be invoked by an unauthenticated browser.
