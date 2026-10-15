'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { static isSupported() { return false; } } } };
const { HookServer } = load('src/main/hooks.ts');
const { ControlRegistry } = load('src/main/control.ts');

function floor(provider) {
  const control = new ControlRegistry();
  const hive = { recordSession() {}, isGod: () => false, registry: () => ({ agents: { manager: { provider } } }) };
  let goal = 'Original goal';
  const server = new HookServer(hive, () => null, () => ({ notifications: false }), control, undefined, () => goal);
  const fire = event => server.handle({ agent_id: 'manager', session_id: 'native-session', hook_event_name: event });
  return { control, fire, setGoal: value => { goal = value; } };
}

test('Antigravity steering waits for an invocation that can accept injected context', () => {
  const { control, fire } = floor('antigravity');
  fire('SessionStart');
  control.steer('manager', 'Include the QA marker');
  assert.deepEqual(fire('PostToolUse'), {}, 'PostToolUse cannot inject context in Antigravity');
  assert.equal(control.snapshot('manager').pendingSteers, 1, 'unsupported boundaries must not discard guidance');
  assert.equal(fire('PreInvocation').hookSpecificOutput.additionalContext, 'Include the QA marker');
  assert.equal(control.snapshot('manager').pendingSteers, 0);
  assert.deepEqual(fire('PreInvocation'), {}, 'guidance must be delivered exactly once');
});

test('Antigravity observes goal changes at invocation without repeating unchanged goals', () => {
  const { fire, setGoal } = floor('antigravity');
  fire('SessionStart');
  assert.deepEqual(fire('PreInvocation'), {});
  setGoal('Updated owner goal');
  assert.match(fire('PreInvocation').hookSpecificOutput.additionalContext, /Updated owner goal/);
  assert.deepEqual(fire('PreInvocation'), {});
});

test('Claude steering still arrives at its supported post-tool boundary', () => {
  const { control, fire } = floor('claude');
  control.steer('manager', 'Keep this instruction');
  assert.equal(fire('PostToolUse').hookSpecificOutput.additionalContext, 'Keep this instruction');
  assert.equal(control.snapshot('manager').pendingSteers, 0);
});
