'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { parseTeamAction, teamTaskRequestRequiresApproval } = loadTs('src/main/teamActions.ts');

const member = { memberId: 'device-friend', displayName: 'Friend', controlLevel: 'task-requests' };
const target = { id: 'agent-local', name: 'Local Agent' };
function message(action, body, senderId = member.memberId) {
  return { id: 'message-1', officeId: 'office-1', senderId, recipientId: 'device-owner', action, body, issuedAt: 1, expiresAt: 2 };
}
const parse = (action, body, access = member.controlLevel, overrides = {}) => parseTeamAction({
  message: message(action, body, overrides.senderId),
  member: { ...member, controlLevel: access },
  targets: overrides.targets ?? [target],
  hasTerminal: overrides.hasTerminal ?? (() => true)
});

test('task-request access accepts only bounded, exact task request bodies', () => {
  assert.deepEqual(parse('task-request', { title: 'Review', message: 'Check this patch' }), {
    type: 'task-request', title: 'Review', message: 'Check this patch'
  });
  assert.throws(() => parse('task-request', { title: 'Review', message: 'x', command: 'run this' }), /invalid teammate task request/);
  assert.throws(() => parse('task-request', { title: 'x'.repeat(121), message: 'work' }), /title size/);
});

test('delegated access can steer only an existing eligible local agent', () => {
  assert.deepEqual(parse('agent-prompt', { agentId: target.id, prompt: 'Continue with the approved task' }, 'delegated'), {
    type: 'agent-prompt', agentId: target.id, prompt: 'Continue with the approved task'
  });
  assert.throws(() => parse('agent-prompt', { agentId: target.id, prompt: 'x' }), /access changed/);
  assert.throws(() => parse('agent-prompt', { agentId: 'missing', prompt: 'x' }, 'delegated'), /unavailable/);
  assert.throws(() => parse('agent-prompt', { agentId: 'god', prompt: 'x' }, 'delegated', {
    targets: [{ id: 'god', name: 'God', isGod: true }]
  }), /unavailable/);
  assert.throws(() => parse('agent-prompt', { agentId: target.id, prompt: 'x' }, 'delegated', {
    targets: [{ ...target, onHold: true }]
  }), /unavailable/);
});

test('full-control terminal input is limited to an active existing local PTY', () => {
  assert.deepEqual(parse('terminal-input', { agentId: target.id, input: 'review status\r' }, 'full-control'), {
    type: 'terminal-input', agentId: target.id, input: 'review status\r'
  });
  assert.throws(() => parse('terminal-input', { agentId: target.id, input: 'x' }, 'delegated'), /access changed/);
  assert.throws(() => parse('terminal-input', { agentId: target.id, input: 'x' }, 'full-control', { hasTerminal: () => false }), /terminal is unavailable/);
  assert.throws(() => parse('terminal-input', { agentId: target.id, input: 'x' }, 'full-control', {
    targets: [{ ...target, archived: true }]
  }), /terminal is unavailable/);
});

test('full-control terminal output stream is bounded and rejects other access levels', () => {
  const body = { agentId: 'remote-agent', output: '\u001b[32mready\u001b[0m', sequence: 1, streamId: '0123456789abcdef', gap: false };
  assert.deepEqual(parse('terminal-stream', body, 'full-control'), {
    type: 'terminal-stream', agentId: 'remote-agent', output: body.output, sequence: 1,
    streamId: body.streamId, gap: false
  });
  assert.throws(() => parse('terminal-stream', body, 'delegated'), /access changed/);
  assert.throws(() => parse('terminal-stream', { ...body, extra: true }, 'full-control'), /invalid full-control terminal stream/);
  assert.throws(() => parse('terminal-stream', { ...body, output: 'x'.repeat(4097) }, 'full-control'), /invalid full-control terminal stream/);
  assert.throws(() => parse('terminal-stream', { ...body, sequence: Number.MAX_SAFE_INTEGER + 1 }, 'full-control'), /invalid full-control terminal stream/);
});

test('dispatch permission is checked against the current pinned identity', () => {
  assert.throws(() => parse('task-request', { title: 'x', message: 'work' }, 'task-requests', { senderId: 'attacker' }), /identity changed/);
});

test('task-request access always waits for owner approval; higher levels follow the owner trigger mode', () => {
  assert.equal(teamTaskRequestRequiresApproval('task-requests', 'allow-all'), true);
  assert.equal(teamTaskRequestRequiresApproval('delegated', 'strict'), true);
  assert.equal(teamTaskRequestRequiresApproval('delegated', 'communication-only'), true);
  assert.equal(teamTaskRequestRequiresApproval('delegated', 'allow-all'), false);
  assert.equal(teamTaskRequestRequiresApproval('full-control', 'allow-all'), false);
});
