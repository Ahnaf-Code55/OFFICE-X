/**
 * Slack prompt planner — the people in one Slack channel ask, a chosen agent
 * answers in-thread with a ready-to-paste coding-agent prompt for WHOEVER asked,
 * and keeps a shared ownership board so two people's work doesn't clash in git.
 *
 * Two pieces live here, both free of any `electron` import so they unit-test as
 * plain Node:
 *   - `buildPlannerProtocol` — the PURE per-message preamble typed into the
 *     planner agent's prompt ahead of the raw Slack text.
 *   - `fetchSlackUserName` / `createSlackUserNameResolver` — resolve the sender's
 *     Slack user id to a display name via `users.info` (needs the optional
 *     `users:read` bot scope). Best-effort: any failure yields undefined, and the
 *     bot token is never logged or returned.
 */

export interface PlannerProtocolInput {
  channel: string;
  threadTs: string;
  /** Reply helper command WITHOUT `--text`, e.g.
   *  `"<node>" "<helper>" --channel C --thread T`. */
  replyCommand: string;
  /** Slack user id of the sender (U…/W…), when the event carried one. */
  senderId?: string;
  /** Resolved display name, when `users.info` succeeded. */
  senderName?: string;
  /** Absolute path of the shared ownership board (`prompt-board.md`). */
  boardPath: string;
}

/** The PROMPT PLANNER protocol, built per message so it carries THIS sender and
 *  THIS thread's exact reply command. Trailing space is intentional so the raw
 *  Slack message reads naturally after it. */
export function buildPlannerProtocol(input: PlannerProtocolInput): string {
  const { channel, threadTs, replyCommand, senderId, senderName, boardPath } = input;
  const mention = senderId ? `<@${senderId}>` : '';
  const who = senderId
    ? `This message is from ${senderName || mention} (Slack ${mention}).`
    : 'The sender of this message is UNKNOWN (Slack gave no user id). Before writing any prompt, reply asking who it is for, then stop.';
  const replyStart = senderId ? `start the reply with ${mention}; ` : '';
  return `[SLACK PROMPT PLANNER PROTOCOL — this request arrived via Slack (channel ${channel}, thread ${threadTs}); no interactive human is watching]
You are the PROMPT PLANNER for the people in this Slack channel. ${who} A prompt is ONLY for the person who asked — never mix another person's request into it.
1. DO NOT IMPLEMENT — no code edits, no git commands that change state, no spawning or messaging agents. Your only output is a Slack reply.
2. OWNERSHIP BOARD — ${boardPath} (create it if missing). One line per task: \`task · owner · branch · owned files/folders\`. Read it BEFORE writing. Branches are \`<owner-first-name-lowercase>/<short-topic>\` (use the Slack id lowercased if no name is known) and are never shared. If the request overlaps another owner's line: give a different slice, sequence it after the other branch merges, or split the file by function/section. Update the board after replying; remove a line when its owner says "done <task>" or "merged <task>".
3. HOT FILES — before assigning, run in the project repo: git log --since=30.days --name-only --format= | sort | uniq -c | sort -rn | head -15. The top files are one-owner-at-a-time. Prompts must put new logic in new files, keep hot-file edits to a few lines, and never reformat unowned code. Only the owner of package.json may add dependencies or regenerate lockfiles.
4. PROMPT FORMAT — a header line \`For: <name> · Branch: <branch> · Owns: <files>\`, then ONE code block with: OBJECTIVE; OUTPUT; CONTEXT (paths to read — no pasted code); BOUNDARIES (branch from the latest base; edit only owned files; do NOT touch: <other owners' files>; minimal diff); FINISH (merge the latest base, run the project's typecheck + tests, add or adjust a test, open a PR with before/after evidence). Then one line on what the other person is currently doing (from the board).
5. NEVER INVENT FILE PATHS — if unsure where something lives, the prompt tells the coding agent to locate it and report back first.
6. REPLY — run exactly: ${replyCommand} --text "<reply>" (that first path is the harness's bundled Node — pass it verbatim). ${replyStart}Slack mrkdwn; keep it short. At most ONE clarifying question, and only when a wrong guess would cause a clash.
The message starts now: `;
}

// ─── Sender identity (users.info) ────────────────────────────────────────────

/** The slice of `fetch` this module uses — injectable so tests never hit Slack. */
export type SlackFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal }
) => Promise<{ json(): Promise<unknown> }>;

/** Display name from a `users.info` response body: profile.display_name, then
 *  real_name, then name. Undefined on `ok:false` or any unexpected shape. The
 *  result is flattened to one short line — it is pasted into an agent prompt. */
export function parseSlackUserName(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as { ok?: unknown; user?: { name?: unknown; real_name?: unknown; profile?: { display_name?: unknown; real_name?: unknown } } };
  if (b.ok !== true || !b.user || typeof b.user !== 'object') return undefined;
  const u = b.user;
  for (const c of [u.profile?.display_name, u.profile?.real_name, u.real_name, u.name]) {
    if (typeof c !== 'string') continue;
    // eslint-disable-next-line no-control-regex
    const clean = c.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80);
    if (clean) return clean;
  }
  return undefined;
}

/** GET users.info for one user id with a hard timeout. Never throws; any network,
 *  auth, scope (`missing_scope`) or parse failure resolves undefined. */
export async function fetchSlackUserName(
  userId: string,
  botToken: string | undefined,
  fetchImpl: SlackFetch = fetch as unknown as SlackFetch,
  timeoutMs = 3000
): Promise<string | undefined> {
  if (!userId || !botToken) return undefined;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${botToken}` },
      signal: ctrl.signal
    });
    return parseSlackUserName(await res.json());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** How long a failed lookup is remembered, so a token without `users:read` doesn't
 *  add the full timeout to every message, yet a newly granted scope still takes
 *  effect without a restart. */
export const SLACK_NAME_MISS_TTL_MS = 10 * 60_000;

/** Cached resolver: one `users.info` call per user id per app session; a failure
 *  is retried only after SLACK_NAME_MISS_TTL_MS. */
export function createSlackUserNameResolver(
  fetchName: (userId: string, botToken: string | undefined) => Promise<string | undefined> = fetchSlackUserName,
  now: () => number = Date.now
): (userId: string | undefined, botToken: string | undefined) => Promise<string | undefined> {
  const cache = new Map<string, string>();
  const missedAt = new Map<string, number>();
  return async (userId, botToken) => {
    if (!userId) return undefined;
    const hit = cache.get(userId);
    if (hit) return hit;
    const missed = missedAt.get(userId);
    if (missed !== undefined && now() - missed < SLACK_NAME_MISS_TTL_MS) return undefined;
    const name = await fetchName(userId, botToken).catch(() => undefined);
    if (name) { cache.set(userId, name); missedAt.delete(userId); } else missedAt.set(userId, now());
    return name;
  };
}
