'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { readChatTurns } = loadTs('src/main/transcript.ts');

test('chat view keeps prompts, replies and tool calls, drops injected noise', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chat-view-')), 't.jsonl');
  const lines = [
    { type: 'user', uuid: 'u1', message: { content: 'fix the bug' } },
    { type: 'user', uuid: 'u2', isMeta: true, message: { content: 'hook noise' } },
    { type: 'user', uuid: 'u3', message: { content: '<system-reminder>x</system-reminder>' } },
    { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', uuid: 'u4', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'summary' }
  ];
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json`);
  assert.deepEqual(readChatTurns(file).map((t) => `${t.role}:${t.text}`), ['user:fix the bug', 'assistant:On it.', 'tool:Bash · npm test']);
  assert.deepEqual(readChatTurns(path.join(path.dirname(file), 'missing.jsonl')), []);
});

test('chat view reads Codex rollouts', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chat-view-')), 'rollout.jsonl');
  const item = (payload) => JSON.stringify({ type: 'response_item', payload });
  fs.writeFileSync(file, [
    item({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'rules' }] }),
    item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<turn_aborted>' }] }),
    item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'check the fleet' }] }),
    item({ type: 'custom_tool_call', name: 'exec', input: 'await tools.exec_command({cmd:"ls -la"})' }),
    item({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'All good.' }] })
  ].join('\n'));
  assert.deepEqual(readChatTurns(file).map((t) => `${t.role}:${t.text}`), ['user:check the fleet', 'tool:Bash · ls -la', 'assistant:All good.']);
});
