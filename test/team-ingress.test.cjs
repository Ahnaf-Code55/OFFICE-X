'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath() { throw new Error('test supplies dbPath'); } } };
  return originalLoad.call(this, request, parent, isMain);
};
const loadTs = require('./load-ts.cjs');
const { acceptIncomingTeamEnvelope } = loadTs('src/main/teamIngress.ts');
const { createTeamIdentity, sealTeamMessage } = loadTs('src/shared/teamProtocol.ts');
const { PersistStore } = loadTs('src/main/db.ts');
Module._load = originalLoad;

test('main ingress uses SQLite-pinned office membership and durable replay protection', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-ingress-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new PersistStore(path.join(dir, 'harness.db'));
  store.open();
  t.after(() => store.close());
  const alice = createTeamIdentity('alice');
  const bob = createTeamIdentity('bob');
  store.upsertTrustedTeamMember({
    officeId: 'office-1', memberId: 'alice', displayName: 'Alice',
    signingPublicKey: alice.signingPublicKey,
    encryptionPublicKey: alice.encryptionPublicKey,
    controlLevel: 'task-requests'
  });
  const envelope = sealTeamMessage({
    message: {
      id: 'ingress-1', officeId: 'office-1', senderId: 'alice', recipientId: 'bob',
      action: 'task-request', body: { prompt: 'Review this' }, issuedAt: 1_000, expiresAt: 61_000
    },
    sender: alice,
    recipientEncryptionPublicKey: bob.encryptionPublicKey
  });
  assert.equal(acceptIncomingTeamEnvelope({
    envelope, identity: bob, officeId: 'office-1', store, now: 2_000
  }).body.prompt, 'Review this');
  assert.throws(() => acceptIncomingTeamEnvelope({
    envelope, identity: bob, officeId: 'office-1', store, now: 2_000
  }), /replay/);
  assert.throws(() => acceptIncomingTeamEnvelope({
    envelope, identity: bob, officeId: 'other-office', store, now: 2_000
  }), /trusted member/);
  assert.equal(store.revokeTrustedTeamMember('office-1', 'alice'), true);
  assert.throws(() => acceptIncomingTeamEnvelope({
    envelope: { ...envelope, messageId: 'fresh-id' }, identity: bob, officeId: 'office-1', store, now: 2_000
  }), /trusted member/);
});
