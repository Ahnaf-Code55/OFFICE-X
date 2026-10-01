'use strict';

// Platform default: agents compact at ~150k tokens. Claude Code gets a percent
// override sized to its window, Codex a `-c` config override; both must leave
// an operator's own choice alone. Plus: the bundled Caveman skill ships with
// valid frontmatter (it is copied into every agent's .claude/skills).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  AUTO_COMPACT_TOKENS,
  CLAUDE_AUTOCOMPACT_ENV,
  claudeContextWindow,
  claudeAutoCompactPct,
  claudeAutoCompactEnv,
  modelFromArgs,
  withCodexAutoCompactArgs
} = loadTs('src/shared/autoCompact.ts');
const { parseSkillFrontmatter } = loadTs('src/main/skills.ts');
const { BUNDLED_SKILL_IDS } = loadTs('src/shared/hire.ts');

// Claude Code's own threshold math (autoCompact): effective = window - 20k,
// threshold = min(floor(effective * pct / 100), effective - 13k).
function claudeThreshold(window, pct) {
  const effective = window - 20_000;
  return Math.min(Math.floor(effective * (parseFloat(pct) / 100)), effective - 13_000);
}

test('the shared compaction point is 150k tokens', () => {
  assert.equal(AUTO_COMPACT_TOKENS, 150_000);
});

test('only the [1m] suffix selects the 1M window', () => {
  assert.equal(claudeContextWindow('claude-opus-4-8[1m]'), 1_000_000);
  assert.equal(claudeContextWindow('claude-sonnet-4-6[1M]'), 1_000_000);
  assert.equal(claudeContextWindow('claude-opus-4-8'), 200_000);
  assert.equal(claudeContextWindow(undefined), 200_000);
});

test('plain model: percent lands Claude Code at ~150k, not 135k', () => {
  const pct = claudeAutoCompactPct('claude-opus-4-8');
  assert.equal(pct, '83.34');
  const t = claudeThreshold(200_000, pct);
  assert.ok(t >= 150_000 && t < 150_100, `threshold ${t}`);
});

test('[1m] model: percent lands Claude Code at ~150k, not 147k', () => {
  const pct = claudeAutoCompactPct('claude-sonnet-4-6[1m]');
  assert.equal(pct, '15.31');
  const t = claudeThreshold(1_000_000, pct);
  assert.ok(t >= 150_000 && t < 150_100, `threshold ${t}`);
});

test('model is read from either --model form', () => {
  assert.equal(modelFromArgs(['--permission-mode', 'x', '--model', 'opus[1m]']), 'opus[1m]');
  assert.equal(modelFromArgs(['--model=sonnet']), 'sonnet');
  assert.equal(modelFromArgs(['--resume', 'abc']), undefined);
});

test('claude env: set from the resolved model, but a per-agent value wins', () => {
  assert.deepEqual(claudeAutoCompactEnv(['--model', 'opus[1m]']), { [CLAUDE_AUTOCOMPACT_ENV]: '15.31' });
  assert.deepEqual(claudeAutoCompactEnv([]), { [CLAUDE_AUTOCOMPACT_ENV]: '83.34' });
  assert.deepEqual(claudeAutoCompactEnv(['--model', 'opus'], { [CLAUDE_AUTOCOMPACT_ENV]: '50' }), {});
  // A user-chosen compact window changes what the percent means — hands off.
  assert.deepEqual(claudeAutoCompactEnv(['--model', 'opus'], { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '400k' }), {});
});

test('the per-agent env survives the pty CLAUDE_* strip', () => {
  const { buildPtyEnv } = loadTs('src/main/ptyEnv.ts');
  const env = buildPtyEnv({ [CLAUDE_AUTOCOMPACT_ENV]: '99' }, '/bin', claudeAutoCompactEnv([]), 'linux');
  assert.equal(env[CLAUDE_AUTOCOMPACT_ENV], '83.34');
});

test('codex: the -c override is added once, ahead of the positional prompt', () => {
  const args = withCodexAutoCompactArgs(['-a', 'never', '--dangerously-bypass-hook-trust', 'You are "Dev2"']);
  assert.deepEqual(args.slice(0, 2), ['-c', 'model_auto_compact_token_limit=150000']);
  assert.equal(args[args.length - 1], 'You are "Dev2"');
  // Idempotent: a respawn through the same path never doubles it.
  assert.deepEqual(withCodexAutoCompactArgs(args), args);
});

test('codex: a user override in any config form is respected', () => {
  for (const a of [
    ['-c', 'model_auto_compact_token_limit=90000'],
    ['--config', 'model_auto_compact_token_limit=90000'],
    ['--config=model_auto_compact_token_limit=90000']
  ]) assert.deepEqual(withCodexAutoCompactArgs(a), a);
  // A mention inside the prompt text is not an override.
  const prompt = ['say model_auto_compact_token_limit=1'];
  assert.equal(withCodexAutoCompactArgs(prompt).length, 3);
});

test('codex: a leading resume subcommand stays argv[0]', () => {
  const args = withCodexAutoCompactArgs(['resume', 'sid-1', 'prompt']);
  assert.deepEqual(args, ['resume', '-c', 'model_auto_compact_token_limit=150000', 'sid-1', 'prompt']);
});

test('caveman skill ships with valid frontmatter and is hire-allowlisted', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'resources/skills/caveman/SKILL.md'), 'utf8');
  const fm = parseSkillFrontmatter(md);
  assert.equal(fm.name, 'caveman');
  assert.ok(fm.description && fm.description.length > 40);
  assert.match(md, /^argument-hint: "\[lite\|full\|ultra\]"$/m);
  assert.match(md, /^license: MIT$/m);
  assert.ok(BUNDLED_SKILL_IDS.has('caveman'));
  assert.ok(BUNDLED_SKILL_IDS.has('ponytail'));
});
