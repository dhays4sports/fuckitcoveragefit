import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const words = value => String(value).trim().split(/\s+/).filter(Boolean).length;
const contract = JSON.parse(read('CF-DISCOVERY-1.3_UX_CLARITY_CONTRACT.json'));

test('secure opening follows the calendar reference without copying unrelated behavior', () => {
  const html = read('pvx/web/index.html');
  const css = read('assets/css/pvx-clarity-1.3.css');
  assert.match(html, /coveragefit-logo-board\.png/);
  assert.match(html, /Connected from Virginia Tam Insurance Agency/);
  assert.match(html, /Opening your Snapshot\./);
  assert.doesNotMatch(html, /guided review experience|securely connecting the answers/i);
  assert.match(css, /width: min\(620px, 100%\)/);
  assert.match(css, /place-items: center/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('discovery shows obvious remaining work and outcome-first completion', () => {
  const html = read('pvx/discovery/index.html');
  const script = read('assets/js/pvx-discovery.js');
  assert.match(html, /You won’t have to start over\./);
  assert.match(script, /Your earlier answers are already connected\./);
  assert.match(script, /quick \$\{remaining === 1 \? 'question' : 'questions'\} left/);
  assert.match(html, /Your first Snapshot is ready\./);
  assert.match(html, />See my Snapshot</);
  assert.match(html, />Add optional details first</);
  assert.ok(words(contract.approved_copy.primary_completion_action) <= contract.clarity_rules.primary_cta_max_words);
  assert.match(html, /Personal discovery does not evaluate your current policy or change a Protection Score\./);
});

test('continuity remains truthful for direct and carried entries', () => {
  const script = read('assets/js/pvx-discovery.js');
  const bootstrap = read('assets/js/pvx-web-bootstrap.js');
  assert.match(script, /continuity\.hidden = carriedCount === 0/);
  assert.match(bootstrap, /carriedAnswerCount > 0/);
  assert.match(bootstrap, /Connected\. Opening your Snapshot/);
  assert.match(bootstrap, /history\.replaceState/);
  assert.match(bootstrap, /credentials: 'same-origin'/);
});

test('add-to-calendar reference remains byte-for-byte protected', () => {
  for (const [file, expected] of Object.entries(contract.reference_surface.protected_hashes)) {
    assert.equal(hash(file), expected, `${file} changed unexpectedly`);
  }
});

test('clarity release preserves semantic and permission boundaries', () => {
  assert.equal(contract.protected_boundaries.contact_permission_inferred, false);
  assert.equal(contract.protected_boundaries.automated_sms_permission_inferred, false);
  assert.equal(contract.protected_boundaries.professional_eligibility_inferred, false);
  assert.equal(contract.protected_boundaries.protection_score_changed, false);
  assert.equal(contract.protected_boundaries.bind_authority, false);
});
