'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { PtyManager } = loadTs('src/main/pty.ts');

test('PTY output observer receives only current-session output and cannot disrupt the child', { skip: process.platform === 'win32' }, async () => {
  const manager = new PtyManager();
  const chunks = [];
  const exited = new Promise((resolve) => manager.setExitHandler((id, exitCode) => resolve({ id, exitCode })));
  manager.setOutputHandler((id, data) => { chunks.push({ id, data }); });
  const spawned = manager.spawn({
    id: 'output-observer-test', cwd: process.cwd(), command: '/bin/sh',
    args: ['-c', 'printf "office-x-output-observer"']
  });
  assert.equal(spawned.ok, true, spawned.error);
  assert.deepEqual(await exited, { id: 'output-observer-test', exitCode: 0 });
  assert.match(chunks.map((chunk) => chunk.data).join(''), /office-x-output-observer/);
  assert.ok(chunks.every((chunk) => chunk.id === 'output-observer-test'));

  const secondExit = new Promise((resolve) => manager.setExitHandler((id, exitCode) => resolve({ id, exitCode })));
  manager.setOutputHandler(() => { throw new Error('observer failure'); });
  const second = manager.spawn({ id: 'output-observer-throws', cwd: process.cwd(), command: '/bin/sh', args: ['-c', 'exit 0'] });
  assert.equal(second.ok, true, second.error);
  assert.deepEqual(await secondExit, { id: 'output-observer-throws', exitCode: 0 });
});
