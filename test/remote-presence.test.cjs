'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { getRemotePresence, parseRemotePresence, publishRemotePresence, subscribeRemotePresence } =
  loadTs('src/renderer/src/scene/office/remotePresence.ts');

const sample = [{ id: 'guest-1', name: 'Alex', agents: [
  { id: 'worker-1', name: 'Build agent', character: 'pam', status: 'working' }
] }];

test('remote presence accepts only bounded display DTO fields and canonicalizes copies', () => {
  const parsed = parseRemotePresence(sample);
  assert.deepEqual(parsed, sample);
  assert.notEqual(parsed, sample);
  assert.notEqual(parsed[0], sample[0]);
  assert.notEqual(parsed[0].agents[0], sample[0].agents[0]);
});

test('agent presence preserves existing local agent identifiers for remote targeting', () => {
  const id = 'agent.project:work-item_23';
  assert.equal(parseRemotePresence([{ id: 'guest-1', name: 'Alex', agents: [
    { id, name: 'Build agent', character: 'pam', status: 'working' }
  ] }])[0].agents[0].id, id);
  assert.throws(() => parseRemotePresence([{ id: 'guest-1', name: 'Alex', agents: [
    { id: '../private', name: 'Build agent', character: 'pam', status: 'working' }
  ] }]));
});

test('remote presence rejects overflow, duplicate IDs, unknown fields, and local-runtime data', () => {
  assert.throws(() => parseRemotePresence(Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, name: 'Guest', agents: [] }))));
  assert.throws(() => parseRemotePresence([{ ...sample[0], cwd: '/secret/project' }]));
  assert.throws(() => parseRemotePresence([{ ...sample[0], agents: [{ ...sample[0].agents[0], prompt: 'secret' }] }]));
  assert.throws(() => parseRemotePresence([{ ...sample[0], agents: [{ ...sample[0].agents[0], status: 'terminal' }] }]));
  assert.throws(() => parseRemotePresence([sample[0], sample[0]]));
  assert.throws(() => parseRemotePresence([{ id: 'guest', name: 'Guest', agents: Array.from({ length: 33 }, (_, i) => ({
    id: `a${i}`, name: 'Worker', character: 'jim', status: 'idle'
  })) }]));
});

test('publishing remote presence is volatile and has an isolated subscription surface', () => {
  let notifications = 0;
  const unsubscribe = subscribeRemotePresence(() => notifications++);
  publishRemotePresence(sample);
  const exposed = getRemotePresence();
  assert.deepEqual(exposed, sample);
  exposed[0].agents[0].name = 'tampered';
  sample[0].agents[0].name = 'mutated input';
  assert.equal(getRemotePresence()[0].agents[0].name, 'Build agent');
  assert.equal(notifications, 1);
  unsubscribe();
  publishRemotePresence([]);
  assert.equal(notifications, 1);
  assert.deepEqual(getRemotePresence(), []);
});
