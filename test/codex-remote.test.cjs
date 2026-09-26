'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  codexRemoteAliasPath,
  codexRemoteEndpoint,
  codexRemoteSocketFits,
  moveCodexAddDirArgsToServer,
  codexRemoteWritableRootsConfig,
  withCodexRemoteArgs,
  CODEX_REMOTE_SOCKET_MAX,
  CODEX_REMOTE_SOCKET_RELATIVE
} = loadTs('src/shared/codexRemote.ts');

test('Codex remote uses a short stable per-agent home alias', () => {
  const first = codexRemoteAliasPath('/very/long/hive/agent/.codex', 'dev-1', '/tmp');
  const again = codexRemoteAliasPath('/very/long/hive/agent/.codex', 'dev-1', '/tmp');
  const other = codexRemoteAliasPath('/very/long/hive/agent/.codex', 'dev-2', '/tmp');
  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.ok(first.length < 80);
  assert.match(codexRemoteEndpoint(first), /^unix:\/\/\/tmp\//);
});

test('the default alias root yields a socket within sun_path', () => {
  // The real hive home that failed with "path must be shorter than SUN_LEN".
  const realHome =
    '/Users/vyapakgoyal/Documents/HarnessAgents/hive/agents/dev2-mrxb3l43/.codex';
  const socket =
    codexRemoteAliasPath(realHome, 'dev2-mrxb3l43') + '/' + CODEX_REMOTE_SOCKET_RELATIVE;
  assert.ok(
    socket.length < CODEX_REMOTE_SOCKET_MAX,
    `socket path is ${socket.length} bytes: ${socket}`
  );
  // …and shorter than the home it replaces, which the $TMPDIR version was not.
  assert.ok(socket.length < (realHome + '/' + CODEX_REMOTE_SOCKET_RELATIVE).length);
});

test('an over-long alias root is rejected instead of failing at bind time', () => {
  const tmpdirStyle = '/var/folders/v6/9f10q5d148z7bxdzhr22xl7r0000gn/T/munder-codex';
  assert.equal(codexRemoteSocketFits(codexRemoteAliasPath('/h/.codex', 'a', tmpdirStyle)), false);
  assert.equal(codexRemoteSocketFits(codexRemoteAliasPath('/h/.codex', 'a')), true);
});

test('remote endpoint precedes both fresh and resumed Codex invocations', () => {
  const endpoint = 'unix:///tmp/munder-codex/a/app-server-control/app-server-control.sock';
  assert.deepEqual(
    withCodexRemoteArgs(['--model', 'gpt-5.6-sol', 'hello'], endpoint),
    ['--remote', endpoint, '--model', 'gpt-5.6-sol', 'hello']
  );
  assert.deepEqual(
    withCodexRemoteArgs(['resume', 'session-id', '--model', 'gpt-5.6-sol'], endpoint),
    ['--remote', endpoint, 'resume', 'session-id', '--model', 'gpt-5.6-sol']
  );
  assert.deepEqual(
    withCodexRemoteArgs(['--remote', endpoint, 'resume'], endpoint),
    ['--remote', endpoint, 'resume']
  );
});

test('Codex additional roots move to server config instead of remote TUI args', () => {
  const moved = moveCodexAddDirArgsToServer([
    '--dangerously-bypass-hook-trust',
    '--add-dir', '/home/user/hive agent',
    '--model', 'gpt-6-sol',
    '--add-dir=/home/user/hive',
    'initial prompt'
  ]);

  assert.deepEqual(moved, {
    args: ['--dangerously-bypass-hook-trust', '--model', 'gpt-6-sol', 'initial prompt'],
    writableRoots: ['/home/user/hive agent', '/home/user/hive']
  });
  assert.equal(
    codexRemoteWritableRootsConfig(moved.writableRoots),
    'sandbox_workspace_write.writable_roots=["/home/user/hive agent","/home/user/hive"]'
  );
  assert.deepEqual(
    withCodexRemoteArgs(moved.args, 'unix:///tmp/codex/app-server-control/app-server-control.sock'),
    ['--remote', 'unix:///tmp/codex/app-server-control/app-server-control.sock', ...moved.args]
  );
});

test('Codex remote root config deduplicates paths and is absent without extra roots', () => {
  assert.equal(codexRemoteWritableRootsConfig([]), undefined);
  assert.equal(
    codexRemoteWritableRootsConfig(['/home/user/hive', '/home/user/hive']),
    'sandbox_workspace_write.writable_roots=["/home/user/hive"]'
  );
});

test('Codex remote root config preserves user writable roots from the isolated home', () => {
  const existingConfig = `
[sandbox_workspace_write]
writable_roots = ["/home/user/projects", "/mnt/shared"]
`;
  assert.equal(
    codexRemoteWritableRootsConfig(['/home/user/hive', '/mnt/shared'], existingConfig),
    'sandbox_workspace_write.writable_roots=["/home/user/projects","/mnt/shared","/home/user/hive"]'
  );
});
