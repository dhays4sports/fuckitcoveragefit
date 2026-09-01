(function (root) {
  'use strict';
  const PROFILE_KEY = 'coveragefit_prospect_profile_v1';
  const ENTRY_KEY = 'coveragefit_pvx_entry_v1';
  const DISCOVERY_KEY = 'coveragefit_pvx_discovery_v1';
  const WEB_BRIDGE_KEY = 'coveragefit_pvx_web_bridge_v1';
  const clean = (value, max = 240) => String(value ?? '').trim().replace(/[<>\u0000-\u001f\u007f]/g, '').slice(0, max);
  const save = (storage, key, value) => { try { storage?.setItem?.(key, JSON.stringify(value)); return true; } catch (_) { return false; } };
  const status = document.getElementById('pvxWebBootstrapStatus');
  const fallback = document.getElementById('pvxWebBootstrapFallback');

  fetch('/api/pvx/web-journey', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action: 'load' })
  }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok || !data?.journey?.seed) throw new Error(data?.error?.message || 'Secure journey unavailable.');
    const journey = data.journey;
    const seed = journey.seed;
    const address = seed.entry?.address || {};
    const earlyContact = seed.contact || {};
    const consent = earlyContact.agencyContactConsent || {};
    const identityKnown = consent.granted === true && earlyContact.leadCaptureStatus === 'confirmed';
    const identity = identityKnown ? (earlyContact.identity || {}) : {};
    const profile = {
      version: '2.0',
      firstName: clean(identity.firstName,80), lastName: '', fullName: clean(identity.firstName,80), phone: clean(identity.mobile,40), email: '',
      propertyAddress: clean(address.formattedAddress),
      reviewContext: clean(seed.evidence?.exactCustomerWords || 'CoverageFit Snapshot', 120),
      contactPermission: { confirmed: identityKnown, status: identityKnown ? 'confirmed' : 'not_requested', source: '408farmers_progressive_checkpoint', capturedAt: identityKnown ? clean(consent.capturedAt,40) : '', version: identityKnown ? clean(consent.version,80) : '', scope: identityKnown ? clean(consent.scope,80) : '', automatedSmsAuthorized: false },
      address: {
        formattedAddress: clean(address.formattedAddress), street: clean(address.line1, 120),
        city: clean(address.city, 80), state: clean(address.state, 2), postalCode: clean(address.postalCode, 10),
        country: 'US', selectionMethod: 'native_web'
      },
      integration: {
        source: clean(seed.attribution?.source || '408farmers_web', 80),
        entry: clean(seed.entry?.type, 40), assessment: 'pvx', handoffVersion: 'web-1',
        senderBuild: 'CF-DISCOVERY-1.3', leadCaptured: identityKnown, leadCaptureStatus: identityKnown ? 'confirmed' : earlyContact.leadCaptureStatus === 'skipped' ? 'skipped' : 'not_requested', leadCheckpointId: identityKnown ? clean(earlyContact.leadCheckpointId,120) : '', prefilled: true,
        campaign: clean(seed.attribution?.campaign, 160), campaignId: clean(seed.attribution?.campaignId, 180),
        partnerId: clean(seed.attribution?.partnerId, 64), partnerName: clean(seed.attribution?.partnerName, 100),
        referralId: clean(seed.attribution?.referralId, 120), pvxJourneyId: clean(journey.journeyId, 120)
      },
      receivedAt: new Date().toISOString()
    };
    const entry = {
      schemaVersion: '2.0', contractId: 'coveragefit-pvx-frictionless-entry-v1', address,
      source: seed.entry?.source || '408farmers_web', campaign: seed.attribution?.campaign || '',
      currentStage: seed.journey?.resumeState?.exactStage || 'entry', updatedAt: new Date().toISOString()
    };
    const bridge = {
      schemaVersion: '2.0', build: 'CF-DISCOVERY-1.3', journeyId: journey.journeyId,
      entry: seed.entry, context: seed.context, attribution: seed.attribution, evidence: seed.evidence,
      reconciliation: seed.reconciliation, ownership: seed.ownership, consent: seed.consent, semantics: seed.semantics,
      createdAt: journey.createdAt
    };
    for (const storage of [root.sessionStorage, root.localStorage]) save(storage, PROFILE_KEY, profile);
    save(root.localStorage, ENTRY_KEY, entry);
    save(root.localStorage, DISCOVERY_KEY, seed.discovery);
    for (const storage of [root.sessionStorage, root.localStorage]) save(storage, WEB_BRIDGE_KEY, bridge);
    try { root.history.replaceState(root.history.state, document.title, root.location.pathname); } catch (_) {}
    const carriedAnswerCount = Array.isArray(seed.discovery?.prefilledQuestionIds) ? seed.discovery.prefilledQuestionIds.length : 0;
    if (status) status.textContent = carriedAnswerCount > 0 ? 'Your answers are connected. Opening your Snapshot…' : 'Connected. Opening your Snapshot…';
    root.location.replace(journey.destination || '/pvx/start/');
  }).catch(() => {
    if (status) status.textContent = 'This secure return could not be opened.';
    if (fallback) fallback.hidden = false;
    document.body.removeAttribute('aria-busy');
  });
})(window);
