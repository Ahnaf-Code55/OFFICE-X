'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { parseTeamAction, MAX_CHAT_IMAGE_CHARS } = loadTs('src/main/teamActions.ts');
const { isPeerActionAllowed, createTeamIdentity, sealTeamMessage, MAX_TEAM_MESSAGE_BYTES } = loadTs('src/shared/teamProtocol.ts');
const { createChat, MAX_AI_TURNS } = loadTs('src/main/chat.ts');

const member = { memberId: 'device-friend', displayName: 'Friend', controlLevel: 'task-requests' };
const chatMessage = (body) => ({ id: 'm1', officeId: 'o', senderId: 'device-friend', recipientId: 'me', action: 'chat', body, issuedAt: 1, expiresAt: 2 });
const parse = (body) => parseTeamAction({ message: chatMessage(body), member, targets: [], hasTerminal: () => false });

test('chat is allowed at every access level and parses a valid body', () => {
  for (const level of ['task-requests', 'delegated', 'full-control']) assert.equal(isPeerActionAllowed(level, 'chat'), true);
  assert.deepEqual(parse({ text: ' hi ', image: '', authorKind: 'human', authorName: 'Friend' }),
    { type: 'chat', text: 'hi', image: '', authorKind: 'human', authorName: 'Friend' });
});

test('chat rejects empty, oversized, non-image, and extra-field bodies', () => {
  assert.throws(() => parse({ text: ' ', image: '', authorKind: 'human', authorName: 'F' }));
  assert.throws(() => parse({ text: 'x'.repeat(4001), image: '', authorKind: 'human', authorName: 'F' }));
  assert.throws(() => parse({ text: 'x', image: 'data:text/html;base64,AAAA', authorKind: 'human', authorName: 'F' }));
  assert.throws(() => parse({ text: 'x', image: '', authorKind: 'system', authorName: 'F' }));
  assert.throws(() => parse({ text: 'x', image: '', authorKind: 'human', authorName: 'F', extra: 1 }));
});

test('a max-size chat image still fits the sealed envelope limit', () => {
  const a = createTeamIdentity('device-a');
  const b = createTeamIdentity('device-b');
  const image = `data:image/jpeg;base64,${'A'.repeat(MAX_CHAT_IMAGE_CHARS - 23)}`;
  const envelope = sealTeamMessage({
    message: { id: 'x', officeId: 'o', senderId: a.deviceId, recipientId: b.deviceId, action: 'chat',
      body: { text: 'y'.repeat(4000), image, authorKind: 'human', authorName: 'A' }, issuedAt: 1, expiresAt: 2 },
    sender: a, recipientEncryptionPublicKey: b.encryptionPublicKey
  });
  assert.ok(Buffer.byteLength(JSON.stringify(envelope)) < MAX_TEAM_MESSAGE_BYTES);
});

test('agents hear the room, never their own reply, and stop after the AI turn cap', async () => {
  const kv = new Map();
  const delivered = [];
  const chat = createChat({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'chat-')),
    getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v),
    myName: () => 'Me', agentName: (id) => ({ a: 'Claude', b: 'Codex' })[id],
    deliverToAgent: (id) => delivered.push(id),
    sendToTeammates: async () => {}, emit: () => {}
  });
  chat.setParticipants(['a', 'b']);
  await chat.post('hello', '');
  assert.deepEqual(delivered.splice(0), ['a', 'b']);
  chat.receiveAgent('a', 'hi from claude');
  assert.deepEqual(delivered.splice(0), ['b']);
  for (let i = 1; i < MAX_AI_TURNS; i++) chat.receiveAgent(i % 2 ? 'b' : 'a', `turn ${i}`);
  delivered.length = 0;
  chat.receiveAgent('b', 'one more');
  assert.deepEqual(delivered, [], 'turn cap stops AI ping-pong');
  chat.receiveAgent('zzz', 'not a participant');
  assert.equal(chat.list().some((m) => m.text === 'not a participant'), false);
});
