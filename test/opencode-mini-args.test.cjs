'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { withOpenCodeMiniArgs, providerPreset } = loadTs('src/shared/agentProvider.ts');

test('OpenCode launches its minimal TUI with the --mini FLAG, never a `mini` subcommand', () => {
  assert.equal(providerPreset('opencode').launchFlag, '--mini');
  // `opencode mini …` makes OpenCode chdir into ./mini and exit, leaving a blank terminal.
  assert.deepEqual(withOpenCodeMiniArgs(['mini', '--model', 'opencode-go/glm-5', '--prompt', 'hi']),
    ['--mini', '--model', 'opencode-go/glm-5', '--prompt', 'hi']);
  assert.deepEqual(withOpenCodeMiniArgs(['--model', 'opencode-go/glm-5']), ['--mini', '--model', 'opencode-go/glm-5']);
  assert.deepEqual(withOpenCodeMiniArgs(['--mini', '--prompt', 'hi']), ['--mini', '--prompt', 'hi'], 'idempotent');
  assert.deepEqual(withOpenCodeMiniArgs([]), ['--mini']);
  // Only a leading `mini` token is the stale subcommand; a prompt that says "mini" is untouched.
  assert.deepEqual(withOpenCodeMiniArgs(['--prompt', 'mini']), ['--mini', '--prompt', 'mini']);
});
