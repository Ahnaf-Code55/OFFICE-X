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
const { PersistStore } = loadTs('src/main/db.ts');
const { acceptIncomingTeamEnvelope } = loadTs('src/main/teamIngress.ts');
const { dispatchTeamAction } = loadTs('src/main/teamDispatch.ts');
const { decidePendingEntry } = loadTs('src/main/triggerHistoryDecision.ts');
const { createTeamIdentity, sealTeamMessage } = loadTs('src/shared/teamProtocol.ts');
Module._load = originalLoad;

function makeEnvelope(sender, recipient, action, body, id) {
  return sealTeamMessage({
    message: {
      id, officeId: 'office-shared', senderId: sender.deviceId, recipientId: recipient.deviceId,
      action, body, issuedAt: 1_000, expiresAt: 61_000
    },
    sender,
    recipientEncryptionPublicKey: recipient.encryptionPublicKey
  });
}

function runAction(message, member, callbacks = {}) {
  return dispatchTeamAction({
    message,
    member,
    triggerMode: 'allow-all',
    targets: [{ id: 'agent-build', name: 'Build worker' }],
    hasTerminal: (agentId) => agentId === 'agent-build',
    dispatchTaskRequest: callbacks.dispatchTaskRequest ?? (() => true),
    steerAgent: callbacks.steerAgent ?? (() => {}),
    writeTerminal: callbacks.writeTerminal ?? (() => {}),
    receiveTerminalStream: callbacks.receiveTerminalStream ?? (() => {})
  });
}

test('encrypted task request stays held until owner approval or rejection', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-team-dispatch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new PersistStore(path.join(dir, 'harness.db'));
  store.open();
  t.after(() => store.close());

  const teammate = createTeamIdentity('device-teammate');
  const owner = createTeamIdentity('device-owner');
  const memberRecord = store.upsertTrustedTeamMember({
    officeId: 'office-shared', memberId: teammate.deviceId, displayName: 'Teammate',
    signingPublicKey: teammate.signingPublicKey, encryptionPublicKey: teammate.encryptionPublicKey,
    controlLevel: 'task-requests'
  });
  const envelope = makeEnvelope(teammate, owner, 'task-request', {
    title: 'Review the release', message: 'Check the release checklist before publishing.'
  }, 'task-approval-1');
  const message = acceptIncomingTeamEnvelope({ envelope, identity: owner, officeId: 'office-shared', store, now: 2_000 });
  const dispatched = [];
  const result = runAction(message, {
    memberId: memberRecord.memberId, displayName: memberRecord.displayName, controlLevel: memberRecord.controlLevel
  }, { dispatchTaskRequest: (task) => { dispatched.push(task); return true; } });

  assert.equal(result.type, 'task-request');
  assert.equal(result.decision, 'pending');
  assert.deepEqual(dispatched, []);

  const held = { id: 'history-1', source: 'org', decision: 'pending', title: result.title, body: result.message };
  const rejected = decidePendingEntry({
    entry: held, decision: 'rejected', dispatch: () => { dispatched.push('unexpected'); return true; },
    update: (decision) => ({ ...held, decision })
  });
  assert.equal(rejected.entry.decision, 'rejected');
  assert.equal(rejected.dispatched, false);
  assert.deepEqual(dispatched, []);

  const approved = decidePendingEntry({
    entry: held, decision: 'approved', dispatch: () => { dispatched.push({ title: held.title, message: held.body }); return true; },
    update: (decision) => ({ ...held, decision })
  });
  assert.equal(approved.entry.decision, 'approved');
  assert.equal(approved.dispatched, true);
  assert.equal(dispatched.length, 1);
  const repeated = decidePendingEntry({
    entry: approved.entry, decision: 'approved', dispatch: () => { dispatched.push('duplicate'); return true; },
    update: (decision) => ({ ...approved.entry, decision })
  });
  assert.equal(repeated.changed, false);
  assert.equal(dispatched.length, 1);
});

test('delegated encrypted prompt steers only an eligible local agent', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-team-dispatch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new PersistStore(path.join(dir, 'harness.db'));
  store.open();
  t.after(() => store.close());

  const teammate = createTeamIdentity('device-teammate');
  const owner = createTeamIdentity('device-owner');
  const memberRecord = store.upsertTrustedTeamMember({
    officeId: 'office-shared', memberId: teammate.deviceId, displayName: 'Teammate',
    signingPublicKey: teammate.signingPublicKey, encryptionPublicKey: teammate.encryptionPublicKey,
    controlLevel: 'delegated'
  });
  const envelope = makeEnvelope(teammate, owner, 'agent-prompt', {
    agentId: 'agent-build', prompt: 'Run the focused compiler checks.'
  }, 'delegated-prompt-1');
  const message = acceptIncomingTeamEnvelope({ envelope, identity: owner, officeId: 'office-shared', store, now: 2_000 });
  const steered = [];
  const result = runAction(message, {
    memberId: memberRecord.memberId, displayName: memberRecord.displayName, controlLevel: memberRecord.controlLevel
  }, { steerAgent: (agentId, prompt) => steered.push({ agentId, prompt }) });

  assert.deepEqual(result, {
    type: 'agent-prompt', decision: 'auto-allowed', agentId: 'agent-build', prompt: 'Run the focused compiler checks.'
  });
  assert.deepEqual(steered, [{ agentId: 'agent-build', prompt: 'Run the focused compiler checks.' }]);
  assert.throws(() => runAction({ ...message, action: 'terminal-input' }, {
    memberId: memberRecord.memberId, displayName: memberRecord.displayName, controlLevel: memberRecord.controlLevel
  }), /access changed/);
});

test('full-control encrypted terminal input reaches only the active local PTY target', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-team-dispatch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new PersistStore(path.join(dir, 'harness.db'));
  store.open();
  t.after(() => store.close());

  const teammate = createTeamIdentity('device-teammate');
  const owner = createTeamIdentity('device-owner');
  const memberRecord = store.upsertTrustedTeamMember({
    officeId: 'office-shared', memberId: teammate.deviceId, displayName: 'Teammate',
    signingPublicKey: teammate.signingPublicKey, encryptionPublicKey: teammate.encryptionPublicKey,
    controlLevel: 'full-control'
  });
  const envelope = makeEnvelope(teammate, owner, 'terminal-input', {
    agentId: 'agent-build', input: 'git status\r'
  }, 'terminal-input-1');
  const message = acceptIncomingTeamEnvelope({ envelope, identity: owner, officeId: 'office-shared', store, now: 2_000 });
  const writes = [];
  const result = runAction(message, {
    memberId: memberRecord.memberId, displayName: memberRecord.displayName, controlLevel: memberRecord.controlLevel
  }, { writeTerminal: (agentId, input) => writes.push({ agentId, input }) });

  assert.deepEqual(result, { type: 'terminal-input', decision: 'auto-allowed', agentId: 'agent-build', input: 'git status\r' });
  assert.deepEqual(writes, [{ agentId: 'agent-build', input: 'git status\r' }]);
  assert.throws(() => dispatchTeamAction({
    message, member: { memberId: teammate.deviceId, displayName: 'Teammate', controlLevel: 'delegated' },
    triggerMode: 'allow-all', targets: [{ id: 'agent-build', name: 'Build worker' }], hasTerminal: () => true,
    dispatchTaskRequest: () => true, steerAgent: () => {}, writeTerminal: () => { writes.push('unexpected'); },
    receiveTerminalStream: () => {}
  }), /access changed/);
  assert.equal(writes.length, 1);
});
