'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { ensureTeamIdentity, TEAM_IDENTITY_SECRET_REF } = loadTs('src/main/teamIdentity.ts');
const { createTeamIdentity } = loadTs('src/shared/teamProtocol.ts');

test('team identity is generated once and then reused', () => {
  const secrets = new Map();
  const store = {
    getSecret: (ref) => secrets.get(ref),
    hasSecret: (ref) => secrets.has(ref),
    setSecret: (ref, value) => { secrets.set(ref, value); return { ok: true }; }
  };
  const first = ensureTeamIdentity(store, 'device-one');
  const second = ensureTeamIdentity(store, 'ignored-new-name');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.identity.deviceId, 'device-one');
  assert.deepEqual(second.identity, first.identity);
  assert.equal(secrets.has(TEAM_IDENTITY_SECRET_REF), true);
});

test('team identity fails closed when encrypted secret storage refuses the write', () => {
  const result = ensureTeamIdentity({
    getSecret: () => undefined,
    hasSecret: () => false,
    setSecret: () => ({ ok: false, error: 'encryption unavailable' })
  }, 'device-one');
  assert.deepEqual(result, { ok: false, error: 'encryption unavailable' });
});

test('corrupt stored identity is rejected instead of silently rotating trust keys', () => {
  const result = ensureTeamIdentity({
    getSecret: () => '{"deviceId":"device-one"}',
    hasSecret: () => true,
    setSecret: () => ({ ok: true })
  }, 'device-one');
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid stored team identity/);
});

test('stored public and private keys must form the same Ed25519 and X25519 pairs', () => {
  const original = createTeamIdentity('device-one');
  const other = createTeamIdentity('device-two');
  const mismatched = { ...original, signingPublicKey: other.signingPublicKey };
  const result = ensureTeamIdentity({
    getSecret: () => JSON.stringify(mismatched),
    hasSecret: () => true,
    setSecret: () => ({ ok: true })
  }, 'device-one');
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid stored team identity/);
});

test('an encrypted blob that cannot be decrypted does not silently rotate the identity', () => {
  const result = ensureTeamIdentity({
    getSecret: () => undefined,
    hasSecret: () => true,
    setSecret: () => ({ ok: true })
  }, 'device-one');
  assert.equal(result.ok, false);
  assert.match(result.error, /refusing to rotate trust keys/);
});
