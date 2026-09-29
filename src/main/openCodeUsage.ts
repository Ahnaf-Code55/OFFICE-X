/** OpenCode Go account usage for the floating Plan Usage panel.
 *
 * The API key stays in the main process: read the active OpenCode Go credential
 * from OpenCode's local SQLite store, call its read-only usage endpoint, and only
 * return the parsed percentages/reset times over IPC. Never log or expose the key.
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { openCodeGoLimits, type UsageLimits } from '../shared/usageLimits';

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const CACHE_MS = 60_000;
let cachedAt = 0;
let cached: UsageLimits | undefined;
let pending: Promise<UsageLimits | undefined> | undefined;

function databaseCandidates(): string[] {
  const home = homedir();
  const xdgData = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
  const candidates = process.platform === 'win32'
    ? [
        join(process.env.LOCALAPPDATA || app.getPath('appData'), 'opencode', 'opencode.db'),
        join(process.env.APPDATA || app.getPath('appData'), 'opencode', 'opencode.db')
      ]
    : process.platform === 'darwin'
      ? [join(home, 'Library', 'Application Support', 'opencode', 'opencode.db'), join(xdgData, 'opencode', 'opencode.db')]
      : [join(xdgData, 'opencode', 'opencode.db')];
  return [...new Set(candidates)];
}

function activeGoApiKey(): string | undefined {
  for (const path of databaseCandidates()) {
    if (!existsSync(path)) continue;
    let db: Database.Database | undefined;
    try {
      db = new Database(path, { readonly: true, fileMustExist: true, timeout: 500 });
      const row = db.prepare(
        "SELECT value FROM credential WHERE integration_id = 'opencode-go' AND active = 1 ORDER BY time_updated DESC LIMIT 1"
      ).get() as { value?: string } | undefined;
      if (!row?.value) continue;
      const parsed = JSON.parse(row.value) as { key?: unknown };
      if (typeof parsed.key === 'string' && parsed.key.trim()) return parsed.key.trim();
    } catch {
      // OpenCode may be closing/upgrading its DB; no credentials leave this process.
    } finally {
      db?.close();
    }
  }
  return undefined;
}

export async function fetchOpenCodeGoLimits(): Promise<UsageLimits | undefined> {
  if (Date.now() - cachedAt < CACHE_MS) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const apiKey = activeGoApiKey();
      if (!apiKey) return undefined;
      const response = await fetch(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': `OFFICE-X/${app.getVersion()}`
        },
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) return undefined;
      return openCodeGoLimits(await response.json());
    } catch {
      return undefined;
    }
  })();
  try {
    cached = await pending;
    cachedAt = Date.now();
    return cached;
  } finally {
    pending = undefined;
  }
}
