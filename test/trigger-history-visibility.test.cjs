'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { shouldShowTriggerHistory } = loadTs('src/shared/triggers.ts');

const empty = {
  webhookCount: 0,
  sharedOfficeEnabled: false,
  officeId: '',
  hasLegacyCredential: false
};

test('history stays hidden when no trigger sources exist', () => {
  assert.equal(shouldShowTriggerHistory(empty), false);
});

test('history appears for webhook activity', () => {
  assert.equal(shouldShowTriggerHistory({ ...empty, webhookCount: 1 }), true);
});

test('shared-office task approvals remain reachable without a legacy credential', () => {
  assert.equal(shouldShowTriggerHistory({ ...empty, sharedOfficeEnabled: true }), true);
  assert.equal(shouldShowTriggerHistory({ ...empty, officeId: 'office-team' }), true);
});

test('existing installs with a legacy credential keep their prior history visibility', () => {
  assert.equal(shouldShowTriggerHistory({ ...empty, hasLegacyCredential: true }), true);
});
