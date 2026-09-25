'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const Database = require('better-sqlite3');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath() { throw new Error('test supplies dbPath'); } } };
  return originalLoad.call(this, request, parent, isMain);
};
const loadTs = require('./load-ts.cjs');
const { PersistStore } = loadTs('src/main/db.ts');
const { createTeamIdentity } = loadTs('src/shared/teamProtocol.ts');
Module._load = originalLoad;

function temporaryDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-team-members-'));
  const filename = path.join(dir, 'harness.db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return filename;
}

function member(officeId = 'office-a', memberId = 'device-alice', level = 'task-requests') {
  const identity = createTeamIdentity(memberId);
  return {
    officeId,
    memberId,
    displayName: ' Alice Example ',
    signingPublicKey: identity.signingPublicKey,
    encryptionPublicKey: identity.encryptionPublicKey,
    controlLevel: level
  };
}

test('trusted teammate records persist with office isolation and revocation', (t) => {
  const dbPath = temporaryDb(t);
  const store = new PersistStore(dbPath);
  store.open();
  t.after(() => store.close());

  const first = store.upsertTrustedTeamMember(member(), 1000);
  assert.equal(first.officeId, 'office-a');
  assert.equal(first.memberId, 'device-alice');
  assert.equal(first.displayName, 'Alice Example');
  assert.equal(first.controlLevel, 'task-requests');
  assert.equal(first.createdAt, 1000);
  assert.equal(first.revokedAt, null);
  assert.equal(store.listTrustedTeamMembers('office-b').length, 0);

  store.upsertTrustedTeamMember(member('office-b'), 1100);
  assert.equal(store.listTrustedTeamMembers('office-a').length, 1);
  assert.equal(store.listTrustedTeamMembers('office-b').length, 1);

  assert.equal(store.revokeTrustedTeamMember('office-a', 'device-alice', 1200), true);
  assert.equal(store.revokeTrustedTeamMember('office-a', 'device-alice', 1300), false);
  assert.deepEqual(store.listTrustedTeamMembers('office-a'), []);
  assert.equal(store.listTrustedTeamMembers('office-a', true)[0].revokedAt, 1200);

  const restored = store.upsertTrustedTeamMember(member('office-a', 'device-alice', 'delegated'), 1400);
  assert.equal(restored.revokedAt, null);
  assert.equal(restored.createdAt, 1000);
  assert.equal(restored.updatedAt, 1400);
  assert.equal(restored.controlLevel, 'delegated');

  store.close();
  store.open();
  assert.equal(store.getTrustedTeamMember('office-a', 'device-alice').controlLevel, 'delegated');
});

test('re-pinning and revoking a teammate clears any previously shared route', (t) => {
  const store = new PersistStore(temporaryDb(t));
  store.open();
  t.after(() => store.close());
  const invited = { ...member(), directEndpoint: '/ip4/8.8.8.8/tcp/4001/p2p/peer' };
  assert.equal(store.upsertTrustedTeamMember(invited, 1000).directEndpoint, invited.directEndpoint);
  assert.equal(store.upsertTrustedTeamMember(member(), 1100).directEndpoint, null);
  store.upsertTrustedTeamMember(invited, 1200);
  assert.equal(store.revokeTrustedTeamMember('office-a', 'device-alice', 1300), true);
  assert.equal(store.getTrustedTeamMember('office-a', 'device-alice', true).directEndpoint, null);
});

test('trusted teammate migration appends to existing version 2 databases', (t) => {
  const dbPath = temporaryDb(t);
  const oldDb = new Database(dbPath);
  oldDb.exec(`CREATE TABLE team_message_replays (
    sender_id TEXT NOT NULL, message_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
    PRIMARY KEY (sender_id, message_id)
  ); INSERT INTO team_message_replays VALUES ('alice', 'msg-1', 9000);`);
  oldDb.pragma('user_version = 2');
  oldDb.close();

  const store = new PersistStore(dbPath);
  store.open();
  t.after(() => store.close());
  assert.equal(store.upsertTrustedTeamMember(member()).memberId, 'device-alice');
  assert.equal(store.consumeTeamMessageReplay('office-1', 'alice', 'msg-1', 10_000, 1000), true);
  assert.equal(store.db.pragma('user_version', { simple: true }), 5);
});

test('trusted teammate stores only bounded, slash-prefixed multiaddr hints', (t) => {
  const store = new PersistStore(temporaryDb(t));
  store.open();
  t.after(() => store.close());
  const hint = '/ip4/192.0.2.8/tcp/4010/p2p/12D3KooWTest';
  const pinned = store.upsertTrustedTeamMember({ ...member(), directEndpoint: hint });
  assert.equal(pinned.directEndpoint, hint);
  assert.equal(store.getTrustedMember('office-a', 'device-alice').directEndpoint, hint);
  assert.throws(() => store.upsertTrustedTeamMember({ ...member(), directEndpoint: 'https://example.test' }), /multiaddr/);
  assert.throws(() => store.upsertTrustedTeamMember({ ...member(), directEndpoint: `/${'a'.repeat(2048)}` }), /multiaddr/);
});

test('trust import rejects malformed, private, wrong-type keys and invalid metadata', (t) => {
  const store = new PersistStore(temporaryDb(t));
  store.open();
  t.after(() => store.close());
  const good = member();
  const other = createTeamIdentity('device-bob');

  for (const bad of [
    { ...good, officeId: 'office/escape' },
    { ...good, memberId: '  ' },
    { ...good, displayName: ' \n ' },
    { ...good, displayName: 'x'.repeat(81) },
    { ...good, controlLevel: 'owner' },
    { ...good, signingPublicKey: other.encryptionPublicKey },
    { ...good, encryptionPublicKey: other.signingPublicKey },
    { ...good, signingPublicKey: other.signingPrivateKey }
  ]) {
    assert.throws(() => store.upsertTrustedTeamMember(bad), TypeError);
  }
  assert.deepEqual(store.listTrustedTeamMembers('office-a'), []);
});
