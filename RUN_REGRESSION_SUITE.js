'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const testFiles = [
  path.join(__dirname, 'tests', 'discovery-intake-regression-1.1.test.mjs'),
  path.join(__dirname, 'tests', 'discovery-conversion-1.1.test.mjs'),
  path.join(__dirname, 'tests', 'discovery-ux-clarity-1.3.test.mjs'),
  path.join(__dirname, 'tests', 'lead-operations-1.0.test.mjs'),
  path.join(__dirname, 'tests', 'lead-operations-1.1.test.mjs'),
  path.join(__dirname, 'tests', 'sms-entry-routing-1.1.test.mjs'),
  path.join(__dirname, 'tests', 'sms-contact-choices-1.0.test.mjs'),
  path.join(__dirname, 'tests', 'ringcentral-webhook-recovery-1.0.test.mjs'),
  path.join(__dirname, 'tests', 'ringcentral-subscription-maintenance-1.0.test.mjs'),
  path.join(__dirname, 'tests', 'callback-web-continuity-1.0.test.mjs'),
  path.join(__dirname, 'tests', 'callback-web-continuity-1.1.test.mjs')
];
const result = spawnSync(process.execPath, ['--test', ...testFiles], { cwd: __dirname, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = Number.isInteger(result.status) ? result.status : 1;
