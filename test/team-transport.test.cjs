'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { generateKeyPairSync } = require('node:crypto');
const loadTs = require('./load-ts.cjs');
const { createTeamIdentity, sealTeamMessage } = loadTs('src/shared/teamProtocol.ts');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath() { throw new Error('test supplies dbPath'); } } };
  return originalLoad.call(this, request, parent, isMain);
};
const { PersistStore } = loadTs('src/main/db.ts');
Module._load = originalLoad;
const { acceptIncomingTeamEnvelope } = loadTs('src/main/teamIngress.ts');
const { dispatchTeamAction } = loadTs('src/main/teamDispatch.ts');
const { decidePendingEntry } = loadTs('src/main/triggerHistoryDecision.ts');
const {
  TEAM_PRESENCE_MAX_FRAME_BYTES,
  TEAM_PRESENCE_PROTOCOL,
  TEAM_MESSAGE_PROTOCOL,
  TEAM_CONTROL_MESSAGES_PER_MINUTE,
  TEAM_PRESENCE_MESSAGES_PER_MINUTE,
  TEAM_PRESENCE_BYTES_PER_MINUTE,
  TEAM_TERMINAL_BATCH_INTERVAL_MS,
  TEAM_TERMINAL_MAX_BATCH_CHARS,
  TEAM_TERMINAL_MAX_STREAMS_PER_PEER,
  TEAM_TERMINAL_MESSAGES_PER_SECOND,
  TEAM_TERMINAL_MESSAGES_PER_MINUTE,
  TEAM_TERMINAL_BYTES_PER_MINUTE,
  TeamMessageRateLimiter,
  TeamPresenceRateLimiter,
  createTeamTransport,
  sendTeamPresenceWithRouteFallback,
  decodeTeamPresenceFrame,
  encodeTeamPresenceFrame,
  encodeTeamMessageFrame,
  decodeTeamMessageFrame,
  teamPeerIdFromSigningPublicKey
} = loadTs('src/main/teamTransport.ts');
const { TeamTerminalSendGuard } = loadTs('src/main/teamTerminalSendGuard.ts');

const officeId = 'office_transport_test_01';
const samplePresence = [
  { id: 'alice', name: 'Alice', agents: [{ id: 'michael', name: 'Michael', character: 'michael', status: 'working' }] }
];

const nativeImport = new Function('specifier', 'return import(specifier)');
async function loadRuntime() {
  const [libp2p, cryptoKeys, noise, yamux, tcp, websockets, relay, identify, multiaddr, peerId] = await Promise.all([
    nativeImport('libp2p'),
    nativeImport('@libp2p/crypto/keys'),
    nativeImport('@chainsafe/libp2p-noise'),
    nativeImport('@chainsafe/libp2p-yamux'),
    nativeImport('@libp2p/tcp'),
    nativeImport('@libp2p/websockets'),
    nativeImport('@libp2p/circuit-relay-v2'),
    nativeImport('@libp2p/identify'),
    nativeImport('@multiformats/multiaddr'),
    nativeImport('@libp2p/peer-id')
  ]);
  return {
    createLibp2p: libp2p.createLibp2p,
    generateKeyPairFromSeed: cryptoKeys.generateKeyPairFromSeed,
    noise: noise.noise,
    yamux: yamux.yamux,
    tcp: tcp.tcp,
    webSockets: websockets.webSockets,
    circuitRelayTransport: relay.circuitRelayTransport,
    circuitRelayServer: relay.circuitRelayServer,
    identify: identify.identify,
    multiaddr: multiaddr.multiaddr,
    peerIdFromString: peerId.peerIdFromString,
    publicKeyFromRaw: cryptoKeys.publicKeyFromRaw,
    peerIdFromPublicKey: peerId.peerIdFromPublicKey
  };
}

test('presence route fallback keeps direct success on the direct route', async () => {
  const attempts = [];
  const sendPresence = async (target) => { attempts.push(target.multiaddr); };
  await sendTeamPresenceWithRouteFallback(sendPresence, { peerId: 'pinned-peer', memberId: 'bob' },
    ['/ip4/203.0.113.1/tcp/4001/p2p/pinned-peer', '/dns4/relay.example/tcp/443/wss/p2p/relay-peer/p2p-circuit/p2p/pinned-peer'], samplePresence);
  assert.deepEqual(attempts, ['/ip4/203.0.113.1/tcp/4001/p2p/pinned-peer']);
});

test('presence route fallback tries the relay after direct route failure', async () => {
  const attempts = [];
  const directRoute = '/ip4/203.0.113.1/tcp/4001/p2p/pinned-peer';
  const relayRoute = '/dns4/relay.example/tcp/443/wss/p2p/relay-peer/p2p-circuit/p2p/pinned-peer';
  const sendPresence = async (target) => {
    attempts.push(target.multiaddr);
    if (target.multiaddr === directRoute) throw new Error('direct route unreachable');
  };
  await sendTeamPresenceWithRouteFallback(sendPresence, { peerId: 'pinned-peer', memberId: 'bob' },
    [directRoute, relayRoute], samplePresence);
  assert.deepEqual(attempts, [directRoute, relayRoute]);
});

test('presence route fallback rejects with the relay error when both routes fail', async () => {
  const attempts = [];
  const directRoute = '/ip4/203.0.113.1/tcp/4001/p2p/pinned-peer';
  const relayRoute = '/dns4/relay.example/tcp/443/wss/p2p/relay-peer/p2p-circuit/p2p/pinned-peer';
  const sendPresence = async (target) => {
    attempts.push(target.multiaddr);
    throw new Error(target.multiaddr === directRoute ? 'direct route unreachable' : 'relay route unavailable');
  };
  await assert.rejects(sendTeamPresenceWithRouteFallback(sendPresence,
    { peerId: 'pinned-peer', memberId: 'bob' }, [directRoute, relayRoute], samplePresence), /relay route unavailable/);
  assert.deepEqual(attempts, [directRoute, relayRoute]);
});

test('presence framing is bounded and rejects non-display or cross-office payloads', () => {
  const encoded = encodeTeamPresenceFrame({ officeId, senderId: 'alice', snapshot: samplePresence });
  assert.deepEqual(decodeTeamPresenceFrame(encoded), {
    version: 1, type: 'presence', officeId, senderId: 'alice', snapshot: samplePresence
  });

  const raw = Buffer.from(encoded);
  const payload = JSON.parse(raw.subarray(4).toString('utf8'));
  payload.prompt = 'should never be transportable';
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const extraFieldFrame = Buffer.alloc(4 + payloadBytes.length);
  extraFieldFrame.writeUInt32BE(payloadBytes.length, 0);
  payloadBytes.copy(extraFieldFrame, 4);
  assert.throws(() => decodeTeamPresenceFrame(extraFieldFrame), /invalid team presence message/);
  assert.throws(() => encodeTeamPresenceFrame({ officeId, senderId: 'alice', snapshot: [{ ...samplePresence[0], prompt: 'x' }] }));
  assert.throws(() => encodeTeamPresenceFrame({ officeId: 'wrong/office', senderId: 'alice', snapshot: samplePresence }));
  assert.throws(() => decodeTeamPresenceFrame(new Uint8Array(TEAM_PRESENCE_MAX_FRAME_BYTES + 5)), /size/);
});

test('team messages have distinct bounded control and terminal-stream count and byte budgets', () => {
  const limiter = new TeamMessageRateLimiter();
  for (let i = 0; i < TEAM_CONTROL_MESSAGES_PER_MINUTE; i++) {
    assert.equal(limiter.consume('peer-a', 'control', 100, 10_000), true);
  }
  assert.equal(limiter.consume('peer-a', 'control', 100, 10_000), false, 'control retains its tighter count budget');
  for (let i = 0; i < TEAM_TERMINAL_MESSAGES_PER_MINUTE; i++) {
    assert.equal(limiter.consume('peer-a', 'terminal-stream', 100, 10_000), true);
  }
  assert.equal(limiter.consume('peer-a', 'terminal-stream', 100, 10_000), false, 'terminal traffic remains bounded');
  assert.equal(limiter.consume('peer-a', 'control', 1, 70_001), true, 'expired windows reset');

  const byteLimited = new TeamMessageRateLimiter();
  assert.equal(byteLimited.consume('peer-b', 'terminal-stream', TEAM_TERMINAL_BYTES_PER_MINUTE, 1_000), true);
  assert.equal(byteLimited.consume('peer-b', 'terminal-stream', 1, 1_000), false, 'terminal byte budget is enforced');
  assert.equal(byteLimited.consume('peer-b', 'control', 1, 1_000), true, 'traffic classes have independent budgets');
  assert.equal(byteLimited.consume('peer-c', 'unknown', 1, 1_000), false, 'unknown classes fail closed');
});

test('terminal share invalidation blocks an active batch and releases its send slot', () => {
  const guard = new TeamTerminalSendGuard();
  const key = 'bob\u0000agent-1';
  const batch = guard.begin(key);
  assert.ok(batch);
  assert.equal(guard.isCurrent(batch), true);
  assert.equal(guard.begin(key), undefined, 'only one batch per teammate/agent may be active');

  guard.invalidate(key);
  assert.equal(guard.isCurrent(batch), false, 'downgrade or share removal invalidates the batch');
  assert.equal(guard.begin(key), undefined, 'do not overlap the invalidated in-flight write');
  guard.finish(batch);

  const nextBatch = guard.begin(key);
  assert.ok(nextBatch, 'a fresh batch may start after the invalidated send settles');
  assert.equal(guard.isCurrent(nextBatch), true);
  guard.finish(nextBatch);
});

test('trusted teammate presence has per-peer count and byte budgets', () => {
  const limiter = new TeamPresenceRateLimiter();
  for (let i = 0; i < TEAM_PRESENCE_MESSAGES_PER_MINUTE; i++) {
    assert.equal(limiter.consume('peer-a', 100, 10_000), true);
  }
  assert.equal(limiter.consume('peer-a', 100, 10_000), false, 'presence update count is capped per peer');
  assert.equal(limiter.consume('peer-b', 100, 10_000), true, 'one peer cannot consume another peer budget');
  assert.equal(limiter.consume('peer-a', 100, 70_001), true, 'expired windows reset');

  const byteLimited = new TeamPresenceRateLimiter();
  for (let i = 0; i < TEAM_PRESENCE_BYTES_PER_MINUTE / 16_384; i++) {
    assert.equal(byteLimited.consume('peer-c', 16_384, 1_000), true);
  }
  assert.equal(byteLimited.consume('peer-c', 1, 1_000), false, 'presence byte budget is enforced');
  assert.equal(byteLimited.consume('peer-d', 1, 1_000), true, 'invalid or excessive traffic is isolated by peer');
});

test('terminal-stream budget sustains the 250 ms batching design for four agents with bounded headroom', () => {
  const framesPerStreamPerSecond = 1000 / TEAM_TERMINAL_BATCH_INTERVAL_MS;
  const requiredFramesPerSecond = framesPerStreamPerSecond * TEAM_TERMINAL_MAX_STREAMS_PER_PEER;
  assert.equal(requiredFramesPerSecond, 16);
  assert.ok(TEAM_TERMINAL_MESSAGES_PER_SECOND >= requiredFramesPerSecond,
    'frame rate covers all four 250 ms streams without per-peer rate drops');
  assert.ok(TEAM_TERMINAL_MESSAGES_PER_MINUTE >= requiredFramesPerSecond * 60,
    'minute count budget sustains the batching cadence');

  // A terminal frame is encrypted/base64 encoded; budget twice the raw ASCII
  // batch to allow that representation and envelope metadata.
  const expectedBytesPerMinute = TEAM_TERMINAL_MAX_BATCH_CHARS
    * requiredFramesPerSecond * 60 * 2;
  assert.ok(TEAM_TERMINAL_BYTES_PER_MINUTE >= expectedBytesPerMinute,
    'byte budget sustains four typical ASCII streams while remaining capped');
  assert.equal(TEAM_TERMINAL_MESSAGES_PER_SECOND, 20, 'stream rate remains a finite 20 frames/s per peer');
  assert.equal(TEAM_TERMINAL_BYTES_PER_MINUTE, 8 * 1024 * 1024, 'stream byte rate remains capped at 8 MiB/minute');
});

test('Noise-authenticated peers exchange only authorized presence over direct TCP and Circuit Relay v2', async (t) => {
  const runtime = loadRuntime;
  const nodes = [];
  const presenceReceived = [];
  const makeAllowList = () => new Map();
  const makeNode = async (id, extra = {}) => {
    const trusted = makeAllowList();
    const transport = await createTeamTransport({
      identity: createTeamIdentity(id),
      officeId,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      isPeerAuthorized(peerId, memberId, observedOfficeId) {
        return observedOfficeId === officeId && trusted.get(peerId) === memberId;
      },
      onPresence(value) { presenceReceived.push({ nodeId: id, ...value }); },
      loadRuntime: runtime,
      ...extra
    });
    nodes.push(transport);
    return { transport, trusted };
  };
  t.after(async () => Promise.all(nodes.reverse().map((node) => node.close())));

  const directAlice = await makeNode('alice');
  const directBob = await makeNode('bob');
  directAlice.trusted.set(directBob.transport.peerId, 'bob');
  directBob.trusted.set(directAlice.transport.peerId, 'alice');
  await directAlice.transport.sendPresence({
    peerId: directBob.transport.peerId,
    memberId: 'bob',
    multiaddr: directBob.transport.getAddresses()[0]
  }, samplePresence);
  assert.equal(presenceReceived.at(-1).nodeId, 'bob');
  assert.equal(presenceReceived.at(-1).peerId, directAlice.transport.peerId);
  assert.deepEqual(presenceReceived.at(-1).snapshot, samplePresence);

  directBob.trusted.delete(directAlice.transport.peerId);
  const receivedBeforeUntrustedAttempt = presenceReceived.length;
  await assert.rejects(directAlice.transport.sendPresence({
    peerId: directBob.transport.peerId,
    memberId: 'bob',
    multiaddr: directBob.transport.getAddresses()[0]
  }, samplePresence));
  assert.equal(presenceReceived.length, receivedBeforeUntrustedAttempt, 'untrusted inbound presence must not reach the callback');

  await assert.rejects(directAlice.transport.sendPresence({
    peerId: directBob.transport.peerId,
    memberId: 'mallory',
    multiaddr: directBob.transport.getAddresses()[0]
  }, samplePresence), /not trusted/);

  const relay = await createTeamTransport({
    identity: createTeamIdentity('relay'),
    officeId,
    listenAddresses: ['/ip4/127.0.0.1/tcp/0/ws'],
    enableRelayServer: true,
    isPeerAuthorized: () => false,
    onPresence() {},
    loadRuntime: runtime
  });
  nodes.push(relay);
  const relayAddress = relay.getAddresses()[0];
  assert.match(relayAddress, /\/ws\/p2p\//);

  const relayAlice = await makeNode('relay-alice', { relayAddress });
  const relayBob = await makeNode('relay-bob', { relayAddress });
  relayAlice.trusted.set(relayBob.transport.peerId, 'relay-bob');
  relayBob.trusted.set(relayAlice.transport.peerId, 'relay-alice');

  const deadline = Date.now() + 10_000;
  let bobRelayAddress = relayBob.transport.getAddresses().find((address) => address.includes('/p2p-circuit/p2p/'));
  while (!bobRelayAddress && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    bobRelayAddress = relayBob.transport.getAddresses().find((address) => address.includes('/p2p-circuit/p2p/'));
  }
  assert.ok(bobRelayAddress, 'relay reservation should publish a circuit address');
  await relayAlice.transport.sendPresence({
    peerId: relayBob.transport.peerId,
    memberId: 'relay-bob',
    multiaddr: bobRelayAddress
  }, samplePresence);
  assert.equal(presenceReceived.at(-1).nodeId, 'relay-bob');
  assert.equal(presenceReceived.at(-1).peerId, relayAlice.transport.peerId);
  assert.deepEqual(presenceReceived.at(-1).snapshot, samplePresence);
  assert.ok(TEAM_PRESENCE_PROTOCOL.endsWith('/1.0.0'));
});

test('Noise-authenticated transport delivers signed encrypted team envelopes and validates acknowledgement identity', async (t) => {
  const senderIdentity = createTeamIdentity('sender');
  const recipientIdentity = createTeamIdentity('recipient');
  const received = [];
  const nodes = [];
  const trustedBySender = new Map();
  const trustedByRecipient = new Map();
  const make = async (identity, trusted, onMessage = () => {}) => {
    const transport = await createTeamTransport({
      identity, officeId,
      listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
      isPeerAuthorized: (peerId, memberId, id) => id === officeId && trusted.get(peerId) === memberId,
      onPresence() {}, onMessage,
      loadRuntime
    });
    nodes.push(transport);
    return transport;
  };
  const sender = await make(senderIdentity, trustedBySender);
  const recipient = await make(recipientIdentity, trustedByRecipient, (value) => {
    received.push(value);
    return value.envelope.messageId === 'message-rejected' || value.envelope.messageId === 'terminal-stream-rejected'
      ? { status: 'rejected' } : undefined;
  });
  t.after(async () => Promise.all(nodes.reverse().map((node) => node.close())));
  trustedBySender.set(recipient.peerId, 'recipient');
  trustedByRecipient.set(sender.peerId, 'sender');
  const issuedAt = Date.now();
  const envelope = sealTeamMessage({
    sender: senderIdentity,
    recipientEncryptionPublicKey: recipientIdentity.encryptionPublicKey,
    message: { id: 'message-1', officeId, senderId: 'sender', recipientId: 'recipient', action: 'task-request',
      body: { title: 'Review', message: 'Check this patch' }, issuedAt, expiresAt: issuedAt + 60_000 }
  });
  const frame = encodeTeamMessageFrame({ officeId, senderId: 'sender', envelope });
  assert.equal(decodeTeamMessageFrame(frame).envelope.messageId, 'message-1');
  await sender.sendMessage({ peerId: recipient.peerId, memberId: 'recipient', multiaddr: recipient.getAddresses()[0] }, envelope);
  assert.equal(received.length, 1);
  assert.equal(received[0].peerId, sender.peerId);
  assert.equal(received[0].memberId, 'sender');
  assert.deepEqual(received[0].envelope, envelope);
  const rejectedEnvelope = sealTeamMessage({
    sender: senderIdentity,
    recipientEncryptionPublicKey: recipientIdentity.encryptionPublicKey,
    message: { id: 'message-rejected', officeId, senderId: 'sender', recipientId: 'recipient', action: 'task-request',
      body: { title: 'Review', message: 'This should be rejected' }, issuedAt, expiresAt: issuedAt + 60_000 }
  });
  await assert.rejects(sender.sendMessage({ peerId: recipient.peerId, memberId: 'recipient', multiaddr: recipient.getAddresses()[0] }, rejectedEnvelope), /rejected/);
  const terminalEnvelope = sealTeamMessage({
    sender: senderIdentity,
    recipientEncryptionPublicKey: recipientIdentity.encryptionPublicKey,
    message: { id: 'terminal-stream-1', officeId, senderId: 'sender', recipientId: 'recipient', action: 'terminal-stream',
      body: { agentId: 'agent-remote', output: '\u001b[32mReady ✓\u001b[0m\r\n', sequence: 1, streamId: '0123456789abcdef', gap: false }, issuedAt,
      expiresAt: issuedAt + 60_000 }
  });
  await sender.sendMessage({ peerId: recipient.peerId, memberId: 'recipient', multiaddr: recipient.getAddresses()[0] }, terminalEnvelope, 'terminal-stream');
  assert.equal(received.at(-1).envelope.messageId, 'terminal-stream-1');
  assert.equal(received.at(-1).trafficClass, 'terminal-stream');
  const terminalEnvelopeAfterRevocation = sealTeamMessage({
    sender: senderIdentity,
    recipientEncryptionPublicKey: recipientIdentity.encryptionPublicKey,
    message: { id: 'terminal-stream-after-revocation', officeId, senderId: 'sender', recipientId: 'recipient', action: 'terminal-stream',
      body: { agentId: 'agent-remote', output: 'must not leave after share revocation', sequence: 2, streamId: '0123456789abcdef', gap: false }, issuedAt,
      expiresAt: issuedAt + 60_000 }
  });
  const receivedBeforeRevokedSend = received.length;
  await assert.rejects(sender.sendMessage({ peerId: recipient.peerId, memberId: 'recipient', multiaddr: recipient.getAddresses()[0] },
    terminalEnvelopeAfterRevocation, 'terminal-stream', () => false), /authorization changed before write/);
  assert.equal(received.length, receivedBeforeRevokedSend, 'revoked stream batch must not reach the peer');
  const rejectedStreamEnvelope = sealTeamMessage({
    sender: senderIdentity,
    recipientEncryptionPublicKey: recipientIdentity.encryptionPublicKey,
    message: { id: 'terminal-stream-rejected', officeId, senderId: 'sender', recipientId: 'recipient', action: 'terminal-stream',
      body: { agentId: 'agent-remote', output: 'dropped', sequence: 2, streamId: '0123456789abcdef', gap: false }, issuedAt,
      expiresAt: issuedAt + 60_000 }
  });
  await assert.rejects(sender.sendMessage({ peerId: recipient.peerId, memberId: 'recipient', multiaddr: recipient.getAddresses()[0] },
    rejectedStreamEnvelope, 'terminal-stream'), /rejected/);
  assert.ok(TEAM_MESSAGE_PROTOCOL.endsWith('/1.0.0'));
});

test('relayed encrypted teammate actions pass SQLite trust, approval, and local agent dispatch', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-relayed-actions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new PersistStore(path.join(dir, 'harness.db'));
  store.open();
  t.after(() => store.close());

  const sharedOfficeId = 'office-relayed-acceptance';
  const teammate = createTeamIdentity('device-teammate');
  const owner = createTeamIdentity('device-owner');
  store.upsertTrustedTeamMember({
    officeId: sharedOfficeId, memberId: teammate.deviceId, displayName: 'Teammate',
    signingPublicKey: teammate.signingPublicKey, encryptionPublicKey: teammate.encryptionPublicKey,
    controlLevel: 'task-requests'
  });

  const nodes = [];
  const relay = await createTeamTransport({
    identity: createTeamIdentity('device-relay'), officeId: sharedOfficeId,
    listenAddresses: ['/ip4/127.0.0.1/tcp/0'], enableRelayServer: true,
    isPeerAuthorized: () => false, onPresence() {}, loadRuntime
  });
  nodes.push(relay);
  const relayAddress = relay.getAddresses()[0];
  const teammatePeerId = await teamPeerIdFromSigningPublicKey(teammate.signingPublicKey, loadRuntime);
  const received = [];
  const dispatchedTasks = [];
  const steered = [];
  const ptyWrites = [];
  const receiver = await createTeamTransport({
    identity: owner, officeId: sharedOfficeId,
    listenAddresses: ['/ip4/127.0.0.1/tcp/0'], relayAddress,
    isPeerAuthorized: (peerId, memberId, office) => office === sharedOfficeId
      && peerId === teammatePeerId
      && memberId === teammate.deviceId,
    onPresence() {},
    onMessage: ({ envelope }) => {
      try {
        const message = acceptIncomingTeamEnvelope({ envelope, identity: owner, officeId: sharedOfficeId, store });
        const member = store.getTrustedTeamMember(sharedOfficeId, message.senderId);
        const outcome = dispatchTeamAction({
          message,
          member: { memberId: member.memberId, displayName: member.displayName, controlLevel: member.controlLevel },
          triggerMode: 'allow-all',
          targets: [{ id: 'agent-build', name: 'Build worker' }],
          hasTerminal: (agentId) => agentId === 'agent-build',
          dispatchTaskRequest: (request) => { dispatchedTasks.push(request); return true; },
          steerAgent: (agentId, prompt) => steered.push({ agentId, prompt }),
          writeTerminal: (agentId, input) => ptyWrites.push({ agentId, input }),
          receiveTerminalStream() {}
        });
        received.push({ message, outcome });
        return { status: 'accepted' };
      } catch (error) {
        received.push({ error });
        return { status: 'rejected' };
      }
    },
    loadRuntime
  });
  nodes.push(receiver);
  const sender = await createTeamTransport({
    identity: teammate, officeId: sharedOfficeId,
    listenAddresses: ['/ip4/127.0.0.1/tcp/0'], relayAddress,
    isPeerAuthorized: (peerId, memberId, office) => office === sharedOfficeId
      && peerId === receiver.peerId && memberId === owner.deviceId,
    onPresence() {}, onMessage() {}, loadRuntime
  });
  nodes.push(sender);
  t.after(async () => Promise.all(nodes.reverse().map((node) => node.close())));

  // The transport peer ACL and OFFICE-X's SQLite membership check are distinct;
  // both must pass before the encrypted action reaches the local dispatcher.
  const deadline = Date.now() + 10_000;
  let relayedAddress = receiver.getAddresses().find((address) => address.includes('/p2p-circuit/p2p/'));
  while (!relayedAddress && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    relayedAddress = receiver.getAddresses().find((address) => address.includes('/p2p-circuit/p2p/'));
  }
  assert.ok(relayedAddress, 'recipient reserves a Circuit Relay v2 route');

  const send = async (id, action, body) => {
    const issuedAt = Date.now();
    const envelope = sealTeamMessage({
      sender: teammate,
      recipientEncryptionPublicKey: owner.encryptionPublicKey,
      message: { id, officeId: sharedOfficeId, senderId: teammate.deviceId, recipientId: owner.deviceId,
        action, body, issuedAt, expiresAt: issuedAt + 60_000 }
    });
    await sender.sendMessage({ peerId: receiver.peerId, memberId: owner.deviceId,
      multiaddr: relayedAddress }, envelope,
      action === 'terminal-stream' ? 'terminal-stream' : 'control');
    return envelope;
  };

  await send('relayed-task-request', 'task-request', { title: 'Review release', message: 'Check the release checklist.' });
  assert.equal(received.at(-1).outcome.decision, 'pending');
  assert.deepEqual(dispatchedTasks, [], 'task request must wait for owner approval');
  const held = { id: 'history-relayed-task', decision: 'pending' };
  const approved = decidePendingEntry({
    entry: held, decision: 'approved', dispatch: () => { dispatchedTasks.push(received[0].outcome); return true; },
    update: (decision) => ({ ...held, decision })
  });
  assert.equal(approved.entry.decision, 'approved');
  assert.equal(approved.dispatched, true);
  assert.equal(dispatchedTasks.length, 1);
  const duplicateApproval = decidePendingEntry({
    entry: approved.entry, decision: 'approved', dispatch: () => { dispatchedTasks.push(received[0].outcome); return true; },
    update: (decision) => ({ ...approved.entry, decision })
  });
  assert.equal(duplicateApproval.dispatched, false, 'an already-approved request cannot dispatch twice');
  assert.equal(dispatchedTasks.length, 1);

  const beforeRequestOnlySteer = steered.length;
  await assert.rejects(send('relayed-request-only-steer', 'agent-prompt', {
    agentId: 'agent-build', prompt: 'Request-only access must not steer agents.'
  }), /rejected/);
  assert.equal(steered.length, beforeRequestOnlySteer, 'task-request access cannot steer a local agent');

  store.upsertTrustedTeamMember({
    officeId: sharedOfficeId, memberId: teammate.deviceId, displayName: 'Teammate',
    signingPublicKey: teammate.signingPublicKey, encryptionPublicKey: teammate.encryptionPublicKey,
    controlLevel: 'delegated'
  });
  await send('relayed-agent-prompt', 'agent-prompt', { agentId: 'agent-build', prompt: 'Run compiler checks.' });
  assert.equal(received.at(-1).outcome.type, 'agent-prompt');
  assert.deepEqual(steered, [{ agentId: 'agent-build', prompt: 'Run compiler checks.' }]);

  store.upsertTrustedTeamMember({
    officeId: sharedOfficeId, memberId: teammate.deviceId, displayName: 'Teammate',
    signingPublicKey: teammate.signingPublicKey, encryptionPublicKey: teammate.encryptionPublicKey,
    controlLevel: 'full-control'
  });
  await send('relayed-terminal-input', 'terminal-input', { agentId: 'agent-build', input: 'git status\r' });
  assert.equal(received.at(-1).outcome.type, 'terminal-input');
  assert.deepEqual(ptyWrites, [{ agentId: 'agent-build', input: 'git status\r' }]);

  store.upsertTrustedTeamMember({
    officeId: sharedOfficeId, memberId: teammate.deviceId, displayName: 'Teammate',
    signingPublicKey: teammate.signingPublicKey, encryptionPublicKey: teammate.encryptionPublicKey,
    controlLevel: 'delegated'
  });
  const writesBeforeDeniedInput = ptyWrites.length;
  await assert.rejects(send('relayed-denied-terminal-input', 'terminal-input', {
    agentId: 'agent-build', input: 'must not run\r'
  }), /rejected/);
  assert.equal(ptyWrites.length, writesBeforeDeniedInput, 'downgraded access cannot write to the PTY');
  assert.match(String(received.at(-1).error), /not allowed for this member/);

  assert.equal(store.revokeTrustedTeamMember(sharedOfficeId, teammate.deviceId), true);
  const writesBeforeRevokedPrompt = steered.length;
  await assert.rejects(send('relayed-revoked-agent-prompt', 'agent-prompt', {
    agentId: 'agent-build', prompt: 'Revoked peers must not steer agents.'
  }), /rejected/);
  assert.equal(steered.length, writesBeforeRevokedPrompt, 'SQLite revocation prevents subsequent remote agent control');
  assert.match(String(received.at(-1).error), /not a trusted member/);
});

test('transport validates signing key pairing and closes idempotently', async () => {
  const identity = createTeamIdentity('broken');
  const other = createTeamIdentity('other');
  const rsaPublicKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
  const options = {
    identity: { ...identity, signingPublicKey: other.signingPublicKey },
    officeId,
    isPeerAuthorized: () => false,
    onPresence() {},
    loadRuntime: loadRuntime
  };
  await assert.rejects(createTeamTransport(options), /libp2p signing key does not match/);

  const transport = await createTeamTransport({ ...options, identity, listenAddresses: ['/ip4/127.0.0.1/tcp/0'] });
  assert.equal(await teamPeerIdFromSigningPublicKey(identity.signingPublicKey, loadRuntime), transport.peerId);
  await assert.rejects(teamPeerIdFromSigningPublicKey(rsaPublicKey, loadRuntime), /requires an Ed25519/);
  await assert.rejects(teamPeerIdFromSigningPublicKey('not a key', loadRuntime), /invalid team signing public key/);
  await transport.close();
  await transport.close();
  await assert.rejects(transport.sendPresence({ peerId: transport.peerId, memberId: 'broken' }, samplePresence), /closed/);
});
