/**
 * Platform default: every agent compacts its context once it holds about
 * AUTO_COMPACT_TOKENS, whatever its window size. Each CLI is told in its own
 * dialect at spawn (Claude Code: an env var; Codex: a `-c` config override),
 * and the app-driven compact trigger uses the same number as an absolute floor
 * for the CLIs that have no such knob.
 */
export const AUTO_COMPACT_TOKENS = 150_000;

/** Claude Code's auto-compact percent override, read as a percent of the
 *  EFFECTIVE window (see claudeAutoCompactPct). */
export const CLAUDE_AUTOCOMPACT_ENV = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';
/** Claude Code's auto-compact window override. When the user sets it, the
 *  window our percent is computed against is no longer the model's, so we
 *  leave the percent alone too. */
export const CLAUDE_AUTOCOMPACT_WINDOW_ENV = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
/** Codex config key for its token-count compaction threshold. */
export const CODEX_AUTOCOMPACT_KEY = 'model_auto_compact_token_limit';

/** Tokens Claude Code reserves for output before applying the percent:
 *  effective window = window - min(maxOutputTokens, 20k), and every current
 *  model's max output is above 20k. */
const CLAUDE_OUTPUT_RESERVE = 20_000;

/** Context window implied by a Claude `--model` value. Only the `[1m]` suffix
 *  selects the 1M window; anything else (incl. no model = CLI default) is
 *  treated as 200k. */
export function claudeContextWindow(model: string | undefined): number {
  return /\[1m\]/i.test(model ?? '') ? 1_000_000 : 200_000;
}

/**
 * Value for CLAUDE_AUTOCOMPACT_PCT_OVERRIDE that makes Claude Code compact at
 * ~AUTO_COMPACT_TOKENS. Claude Code's threshold is
 * `min(floor(effective * pct/100), effective - 13k)` with
 * `effective = window - 20k`, so a percent of the raw window (75 / 15) would
 * fire early (135k / 147k). Rounded UP to two decimals so the floor lands at or
 * just above the target: '83.34' for 200k, '15.31' for 1M.
 */
export function claudeAutoCompactPct(model: string | undefined): string {
  const effective = claudeContextWindow(model) - CLAUDE_OUTPUT_RESERVE;
  const pct = Math.ceil((AUTO_COMPACT_TOKENS / effective) * 100 * 100) / 100;
  return String(Math.min(100, pct));
}

/** The `--model` value in a Claude argv (`--model x` or `--model=x`), if any. */
export function modelFromArgs(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model') return args[i + 1];
    if (args[i].startsWith('--model=')) return args[i].slice('--model='.length);
  }
  return undefined;
}

/** Env to add for a Claude Code agent, or {} when the agent's own env already
 *  chose its compaction point (a per-agent value always wins). */
export function claudeAutoCompactEnv(
  args: readonly string[],
  env: Readonly<Record<string, string>> = {}
): Record<string, string> {
  if (env[CLAUDE_AUTOCOMPACT_ENV] || env[CLAUDE_AUTOCOMPACT_WINDOW_ENV]) return {};
  return { [CLAUDE_AUTOCOMPACT_ENV]: claudeAutoCompactPct(modelFromArgs(args)) };
}

/**
 * Codex argv with `-c model_auto_compact_token_limit=150000` added, unless the
 * args already set that key. Goes first so it precedes codex's positional
 * prompt; after a leading `resume` subcommand so the resume reorder in
 * spawnAgentCore (which keys on args[0]) and withCodexRemoteArgs still see it.
 */
export function withCodexAutoCompactArgs(args: readonly string[]): string[] {
  // Only a real config override counts (`-c k=v`, `--config k=v`, `--config=k=v`),
  // not a mention of the key inside the positional prompt text.
  const setsKey = args.some((a, i) => {
    const value = a.startsWith('--config=') ? a.slice('--config='.length)
      : (args[i - 1] === '-c' || args[i - 1] === '--config') ? a : undefined;
    return value !== undefined && value.trimStart().startsWith(CODEX_AUTOCOMPACT_KEY);
  });
  if (setsKey) return [...args];
  const pair = ['-c', `${CODEX_AUTOCOMPACT_KEY}=${AUTO_COMPACT_TOKENS}`];
  const at = args[0] === 'resume' ? 1 : 0;
  return [...args.slice(0, at), ...pair, ...args.slice(at)];
}
