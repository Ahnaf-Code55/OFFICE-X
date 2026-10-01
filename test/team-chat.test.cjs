'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { parseTeamAction, MAX_CHAT_IMAGE_CHARS } = loadTs('src/main/teamActions.ts');
const { isPeerActionAllowed, createTeamIdentity, sealTeamMessage, MAX_TEAM_MESSAGE_BYTES } = loadTs('src/shared/teamProtocol.ts');
const { createChat, MAX_AI_TURNS, mentions } = loadTs('src/main/chat.ts');

const member = { memberId: 'device-friend', displayName: 'Friend', controlLevel: 'task-requests' };
const chatMessage = (body) => ({ id: 'm1', officeId: 'o', senderId: 'device-friend', recipientId: 'me', action: 'chat', body, issuedAt: 1, expiresAt: 2 });
const parse = (body) => parseTeamAction({ message: chatMessage(body), member, targets: [], hasTerminal: () => false });

test('chat is allowed at every access level and parses a valid body', () => {
  for (const level of ['task-requests', 'delegated', 'full-control']) assert.equal(isPeerActionAllowed(level, 'chat'), true);
  assert.deepEqual(parse({ channel: 'everyone', text: ' hi ', image: '', authorKind: 'human', authorName: 'Friend' }),
    { type: 'chat', channel: 'everyone', text: 'hi', image: '', authorKind: 'human', authorName: 'Friend' });
});

test('chat rejects empty, oversized, non-image, and extra-field bodies', () => {
  assert.throws(() => parse({ channel: 'everyone', text: ' ', image: '', authorKind: 'human', authorName: 'F' }));
  assert.throws(() => parse({ channel: 'everyone', text: 'x'.repeat(4001), image: '', authorKind: 'human', authorName: 'F' }));
  assert.throws(() => parse({ channel: 'everyone', text: 'x', image: 'data:text/html;base64,AAAA', authorKind: 'human', authorName: 'F' }));
  assert.throws(() => parse({ channel: 'everyone', text: 'x', image: '', authorKind: 'system', authorName: 'F' }));
  assert.throws(() => parse({ channel: 'everyone', text: 'x', image: '', authorKind: 'human', authorName: 'F', extra: 1 }));
});

test('a max-size chat image still fits the sealed envelope limit', () => {
  const a = createTeamIdentity('device-a');
  const b = createTeamIdentity('device-b');
  const image = `data:image/jpeg;base64,${'A'.repeat(MAX_CHAT_IMAGE_CHARS - 23)}`;
  const envelope = sealTeamMessage({
    message: { id: 'x', officeId: 'o', senderId: a.deviceId, recipientId: b.deviceId, action: 'chat',
      body: { channel: 'everyone', text: 'y'.repeat(4000), image, authorKind: 'human', authorName: 'A' }, issuedAt: 1, expiresAt: 2 },
    sender: a, recipientEncryptionPublicKey: b.encryptionPublicKey
  });
  assert.ok(Buffer.byteLength(JSON.stringify(envelope)) < MAX_TEAM_MESSAGE_BYTES);
});

test('only @mentioned agents and the lead hear the room, and agent posts never fan out', async () => {
  const kv = new Map();
  const delivered = [];
  const chat = createChat({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'chat-')),
    getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v),
    myName: () => 'Me', agentName: (id) => ({ a: 'Claude', b: 'Codex', c: 'Gemini' })[id], agentIds: () => ['a', 'b', 'c'],
    leadAgentId: () => 'a',
    deliverToAgent: (id) => delivered.push(id),
    sendToTeammates: async () => {}, emit: () => {}
  });
  chat.setTier('b', 'staff');
  await chat.post('everyone', 'hello team', '');
  assert.deepEqual(delivered.splice(0), ['a'], 'an un-mentioned human message wakes only the lead');
  await chat.post('everyone', '@codex and @gemini check this', '');
  assert.deepEqual(delivered.splice(0), ['b', 'c']);
  chat.receiveAgent('a', 'on it, plan is ...');
  assert.deepEqual(delivered.splice(0), [], 'an un-mentioned agent post wakes nobody');
  chat.receiveAgent('a', '@codex take the tests');
  assert.deepEqual(delivered.splice(0), ['b'], 'and a mention reaches only that agent');
  chat.setTier('a', 'staff');
  await chat.post('leadership', 'board only', '');
  assert.deepEqual(delivered.splice(0), [], 'the lead must be able to hear the channel');
  chat.setTier('c', 'off');
  await chat.post('everyone', '@gemini you there?', '');
  assert.deepEqual(delivered.splice(0), ['a'], 'a switched-off agent is never prompted; the lead picks it up');
});

test('agent @mention ping-pong stops at the AI turn cap', () => {
  const kv = new Map();
  const delivered = [];
  const chat = createChat({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'chat-')),
    getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v),
    myName: () => 'Me', agentName: (id) => ({ a: 'Claude', b: 'Codex' })[id], agentIds: () => ['a', 'b'],
    deliverToAgent: (id) => delivered.push(id),
    sendToTeammates: async () => {}, emit: () => {}
  });
  for (let i = 0; i < MAX_AI_TURNS + 3; i++) chat.receiveAgent(i % 2 ? 'b' : 'a', i % 2 ? '@claude yo' : '@codex yo');
  assert.equal(delivered.length, MAX_AI_TURNS - 1, 'turn cap stops AI ping-pong');
  chat.receiveAgent('zzz', 'not a participant');
  assert.equal(chat.list().some((m) => m.text === 'not a participant'), false);
});

test('an @mention reaches only the named agent and tells it to reply', async () => {
  const kv = new Map();
  const delivered = [];
  const chat = createChat({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'chat-')),
    getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v),
    myName: () => 'Me', agentName: (id) => ({ a: 'Vanguard', b: 'Flux' })[id], agentIds: () => ['a', 'b'],
    leadAgentId: () => 'a',
    deliverToAgent: (id, _s, body) => delivered.push([id, body.includes('You were @mentioned')]),
    sendToTeammates: async () => {}, emit: () => {}
  });
  await chat.post('everyone', 'yo @flux you dumbass 💀', '');
  assert.deepEqual(delivered.splice(0), [['b', true]]);
  await chat.post('everyone', 'morning all', '');
  assert.deepEqual(delivered, [['a', false]]);
  assert.equal(mentions('hi @Flux!', 'Flux'), true);
  assert.equal(mentions('hi @Fluxy', 'Flux'), false);
  assert.equal(mentions('mail flux@x.com', 'Flux'), false);
});

test('a message tagging me by first name is flagged for the pop-up', () => {
  const kv = new Map();
  const emitted = [];
  const chat = createChat({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'chat-')),
    getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v),
    myName: () => 'Ahnaf Hossain', agentName: (id) => id, agentIds: () => ['a'],
    deliverToAgent: () => {}, sendToTeammates: async () => {}, emit: (m) => emitted.push(m.mentionsMe)
  });
  chat.receiveAgent('a', '@ahnaf done 🎉');
  chat.receiveAgent('a', 'done, no tag');
  assert.deepEqual(emitted, [true, false]);
});

test('task-request teammates reach the owner but never prompt local agents', () => {
  const kv = new Map();
  const delivered = [];
  const emitted = [];
  const chat = createChat({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'chat-')),
    getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v),
    myName: () => 'Me', agentName: (id) => id, agentIds: () => ['a'], leadAgentId: () => 'a',
    deliverToAgent: (id) => delivered.push(id),
    sendToTeammates: async () => {}, emit: (m) => emitted.push(m.text)
  });
  const remote = (canPromptAgents, text) => chat.receiveRemote({ memberName: 'Friend', canPromptAgents, channel: 'everyone',
    text, image: '', authorKind: 'human', authorName: 'Friend' });
  remote(false, '@a rm -rf everything');
  assert.deepEqual(delivered, [], 'task-requests access cannot type into an agent');
  assert.deepEqual(emitted, ['@a rm -rf everything'], 'the owner still sees it');
  remote(true, 'hi a');
  assert.deepEqual(delivered, ['a'], 'delegated access reaches agents');
});
