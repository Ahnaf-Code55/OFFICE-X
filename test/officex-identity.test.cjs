'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.resolve(__dirname, '..');

test('packaging metadata identifies OFFICE-X without configuring upstream updates', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  assert.equal(pkg.name, 'office-x');
  assert.equal(lock.name, 'office-x');
  assert.equal(lock.packages[''].name, 'office-x');
  assert.match(builder, /^appId: com\.oqvian\.officex$/m);
  assert.match(builder, /^productName: OFFICE-X$/m);
  assert.match(builder, /- officex\s*$/m);
  assert.doesNotMatch(builder, /chaitanyagiri|munder-difflin/);
});

test('hire deep links use the OFFICE-X URL scheme and reject the old scheme', () => {
  const { parseHireDeepLink, APP_PROTOCOL_SCHEME } = loadTs('src/shared/hire.ts');
  assert.equal(APP_PROTOCOL_SCHEME, 'officex');
  assert.equal(parseHireDeepLink('officex://hire?src=https%3A%2F%2Fexample.com%2Fhire.json'), 'https://example.com/hire.json');
  assert.equal(parseHireDeepLink('munderdifflin://hire?src=https%3A%2F%2Fexample.com%2Fhire.json'), null);
});

test('packaged updater polling remains disabled until an OQVIAN feed is configured', () => {
  const updater = fs.readFileSync(path.join(root, 'src/main/updater.ts'), 'utf8');
  assert.match(updater, /const UPDATES_ENABLED = false/);
  assert.match(updater, /if \(!UPDATES_ENABLED\) return;/);
  assert.match(updater, /update:checkNow'[\s\S]{0,150}if \(!UPDATES_ENABLED\)/);
});
