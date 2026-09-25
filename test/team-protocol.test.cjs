'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  createTeamIdentity,
  openTeamEnvelope,
  acceptTeamEnvelope,
  sealTeamMessage,
  isPeerActionAllowed
} = loadTs('src/shared/teamProtocol.ts');

test('all three control levels enforce their intended action boundary', () => {
  assert.equal(isPeerActionAllowed('task-requests', 'task-request'), true);
  assert.equal(isPeerActionAllowed('task-requests', 'agent-prompt'), false);
  assert.equal(isPeerActionAllowed('delegated', 'agent-prompt'), true);
  assert.equal(isPeerActionAllowed('delegated', 'terminal-input'), false);
  assert.equal(isPeerActionAllowed('full-control', 'terminal-input'), true);
  assert.equal(isPeerActionAllowed('full-control', 'terminal-stream'), true);
});

test('a teammate message is encrypted, signed, and recoverable only by its recipient', () => {
  const alice = createTeamIdentity('alice');
  const bob = createTeamIdentity('bob');
  const envelope = sealTeamMessage({
    message: {
      id: 'msg-1',
      officeId: 'office-1',
      senderId: 'alice',
      recipientId: 'bob',
      action: 'task-request',
      body: { title: 'Review the API', prompt: 'Review the API boundary.' },
      issuedAt: 1_000,
      expiresAt: 61_000
    },
    sender: alice,
    recipientEncryptionPublicKey: bob.encryptionPublicKey
  });

  assert.equal(JSON.stringify(envelope).includes('Review the API boundary.'), false);
  assert.deepEqual(openTeamEnvelope({
    envelope,
    recipientId: 'bob',
    officeId: 'office-1',
    recipientEncryptionPrivateKey: bob.encryptionPrivateKey,
    expectedPeer: { id: 'alice', signingPublicKey: alice.signingPublicKey },
    now: 2_000
  }), {
    id: 'msg-1',
    officeId: 'office-1',
    senderId: 'alice',
    recipientId: 'bob',
    action: 'task-request',
    body: { title: 'Review the API', prompt: 'Review the API boundary.' },
    issuedAt: 1_000,
    expiresAt: 61_000
  });
});

test('tampering, wrong recipients, and expired messages fail closed', () => {
  const alice = createTeamIdentity('alice');
  const bob = createTeamIdentity('bob');
  const charlie = createTeamIdentity('charlie');
  const envelope = sealTeamMessage({
    message: {
      id: 'msg-2', officeId: 'office-1', senderId: 'alice', recipientId: 'bob',
      action: 'agent-prompt', body: { prompt: 'Run checks' }, issuedAt: 1_000, expiresAt: 2_000
    },
    sender: alice,
    recipientEncryptionPublicKey: bob.encryptionPublicKey
  });

  assert.throws(() => openTeamEnvelope({
    envelope: { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` },
    recipientId: 'bob', officeId: 'office-1', recipientEncryptionPrivateKey: bob.encryptionPrivateKey,
    expectedPeer: { id: 'alice', signingPublicKey: alice.signingPublicKey }, now: 1_500
  }));
  assert.throws(() => openTeamEnvelope({
    envelope, recipientId: 'charlie', officeId: 'office-1', recipientEncryptionPrivateKey: charlie.encryptionPrivateKey,
    expectedPeer: { id: 'alice', signingPublicKey: alice.signingPublicKey }, now: 1_500
  }), /recipient/);
  assert.throws(() => openTeamEnvelope({
    envelope, recipientId: 'bob', officeId: 'office-1', recipientEncryptionPrivateKey: bob.encryptionPrivateKey,
    expectedPeer: { id: 'alice', signingPublicKey: alice.signingPublicKey }, now: 2_001
  }), /expired/);
  assert.throws(() => openTeamEnvelope({
    envelope, recipientId: 'bob', officeId: 'office-1', recipientEncryptionPrivateKey: bob.encryptionPrivateKey,
    expectedPeer: { id: 'mallory', signingPublicKey: alice.signingPublicKey }, now: 1_500
  }), /trusted team member/);
});

test('messages with excessive lifetimes are rejected before encryption', () => {
  const alice = createTeamIdentity('alice');
  const bob = createTeamIdentity('bob');
  assert.throws(() => sealTeamMessage({
    message: {
      id: 'msg-long', officeId: 'office-1', senderId: 'alice', recipientId: 'bob',
      action: 'task-request', body: { prompt: 'wait forever' },
      issuedAt: 1_000, expiresAt: 1_000 + (11 * 60 * 1000)
    },
    sender: alice,
    recipientEncryptionPublicKey: bob.encryptionPublicKey
  }), /lifetime/);
});

test('central acceptance gate enforces member permissions and prevents replay', () => {
  const alice = createTeamIdentity('alice');
  const bob = createTeamIdentity('bob');
  const issuedAt = 1_000;
  const envelope = sealTeamMessage({
    message: {
      id: 'msg-replay', officeId: 'office-1', senderId: 'alice', recipientId: 'bob',
      action: 'terminal-input', body: { input: 'rm -rf /' }, issuedAt, expiresAt: 61_000
    },
    sender: alice,
    recipientEncryptionPublicKey: bob.encryptionPublicKey
  });
  const seen = new Set();
  const replayStore = {
    consume(officeId, senderId, messageId) {
      const key = `${officeId}/${senderId}/${messageId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
  };
  const input = {
    envelope,
    recipient: bob,
    officeId: 'office-1',
    expectedPeer: { id: 'alice', signingPublicKey: alice.signingPublicKey, controlLevel: 'delegated' },
    replayStore,
    now: 2_000
  };
  assert.throws(() => acceptTeamEnvelope(input), /not allowed/);
  assert.equal(seen.size, 0, 'unauthorized messages must not poison the replay ledger');

  input.expectedPeer.controlLevel = 'full-control';
  assert.equal(acceptTeamEnvelope(input).id, 'msg-replay');
  assert.throws(() => acceptTeamEnvelope(input), /replay/);
});
