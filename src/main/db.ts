/**
 * PersistStore — durable harness state in SQLite (better-sqlite3, synchronous).
 *
 * Phase A scope (the rest of the renderer state stays in localStorage for now):
 *   - kv:               scalar app state. Today: the main window's bounds.
 *   - command_history:  NET-NEW — every prompt the user submits to an agent.
 *
 * Lives in the Electron MAIN process (better-sqlite3 is native + synchronous);
 * the renderer reaches it over IPC. The DB file sits next to config.json under
 * app.getPath('userData'). WAL mode so reads never block the single writer.
 *
 * Schema evolves via PRAGMA user_version migrations: an ordered array where
 * migration N runs when user_version < N+1, then bumps it. NEVER edit a shipped
 * migration — only append. Phases B/C (agents + message_queue mirror) and the
 * cross-lane cost_ledger are reserved as future additive migrations (see below);
 * they are deliberately NOT built in v1.
 */
import Database from 'better-sqlite3';
import { app } from 'electron';
import { createPublicKey } from 'node:crypto';
import { join } from 'node:path';
import type { PeerControlLevel } from '../shared/triggers';
import type { TeamMember } from '../shared/teamProtocol';

/** A captured user prompt, as returned to the renderer (camelCase columns). */
export interface CommandHistoryRow {
  id: number;
  agentId: string;
  cwd: string | null;
  text: string;
  ts: number;
}

/** A locally trusted device in one shared office. Public keys are SPKI PEM. */
export interface TrustedTeamMember {
  officeId: string;
  memberId: string;
  displayName: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  controlLevel: PeerControlLevel;
  directEndpoint: string | null;
  createdAt: number;
  updatedAt: number;
  revokedAt: number | null;
}

export type TrustedTeamMemberInput = Pick<TrustedTeamMember,
  'officeId' | 'memberId' | 'displayName' | 'signingPublicKey' | 'encryptionPublicKey' | 'controlLevel'>
  & { directEndpoint?: string | null };

/**
 * Ordered, append-only migrations. Index N takes the DB from user_version N to
 * N+1. To evolve the schema, APPEND a new function — never edit an existing one
 * (shipped DBs have already run it).
 *
 * FUTURE (do NOT build in v1 — reserved so the array isn't painted into a corner):
 *   - Phase B: `agents` + `message_queue` mirror of the renderer roster/queues
 *     (dual-write), enabling the eventual authority flip off localStorage.
 *   - Cross-lane (Lane A #6): migrate Jim's cost ledger onto this DB so his
 *     circuit-breaker can move off transcript-polling. Column names match his
 *     <harnessHome>/hive/cost-ledger.jsonl keys 1:1 for a straight INSERT…SELECT
 *     (coordinated w/ jim-mq290qkn 2026-06-06):
 *       cost_ledger(id, agent_id, session_id TEXT, ts, input, output,
 *                   cache_read, cache_creation, model TEXT, usd REAL)
 *     Rows are CUMULATIVE snapshots (one per agent per heartbeat beat) — diff
 *     consecutive rows for velocity; index (agent_id, session_id, ts). Additive;
 *     lands as a later migration.
 */
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // → user_version 1 (Phase A): scalar kv + net-new command history.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,     -- JSON-encoded
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS command_history (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        cwd      TEXT,
        text     TEXT NOT NULL,
        ts       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ch_agent_ts ON command_history(agent_id, ts DESC);
    `);
  },
  // → user_version 2: replay protection for authenticated shared-office messages.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS team_message_replays (
        sender_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (sender_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_team_replays_expiry ON team_message_replays(expires_at);
    `);
  },
  // → user_version 3: explicitly pinned, office-scoped teammate trust records.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS trusted_team_members (
        office_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        signing_public_key TEXT NOT NULL,
        encryption_public_key TEXT NOT NULL,
        control_level TEXT NOT NULL CHECK (control_level IN ('task-requests', 'delegated', 'full-control')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        revoked_at INTEGER,
        PRIMARY KEY (office_id, member_id)
      );
      CREATE INDEX IF NOT EXISTS idx_trusted_team_members_office_active
        ON trusted_team_members(office_id, revoked_at, member_id);
    `);
  },
  // → user_version 4: scope replay IDs to an office as well as a device.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS team_message_replays_scoped (
        office_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (office_id, sender_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_team_replays_scoped_expiry
        ON team_message_replays_scoped(expires_at);
    `);
  },
  // → user_version 5: persist a route explicitly shared in a pinned invite.
  (db) => {
    db.exec('ALTER TABLE trusted_team_members ADD COLUMN direct_endpoint TEXT');
  }
];

export class PersistStore {
  private db: Database.Database | null = null;

  /** @param dbPath  Override the DB location (tests). Defaults to userData/harness.db. */
  constructor(private dbPath?: string) {}

  /** Open (creating if needed) and migrate the DB. Idempotent — a second call is
   *  a no-op. Throws if the native module fails to load or the file is unusable;
   *  callers should guard so a DB failure can't crash app startup. */
  open(): void {
    if (this.db) return;
    const path = this.dbPath ?? join(app.getPath('userData'), 'harness.db');
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    this.migrate(db);
    this.db = db;
  }

  private migrate(db: Database.Database): void {
    const version = db.pragma('user_version', { simple: true }) as number;
    for (let i = version; i < MIGRATIONS.length; i++) {
      // Each migration + its version bump run in one transaction so a crash
      // mid-migration never leaves a half-applied schema at the wrong version.
      const run = db.transaction(() => {
        MIGRATIONS[i](db);
        db.pragma(`user_version = ${i + 1}`);
      });
      run();
    }
  }

  /** Close the handle (checkpoints WAL). Safe to call when already closed. */
  close(): void {
    try { this.db?.close(); } catch { /* best-effort on shutdown */ }
    this.db = null;
  }

  get isOpen(): boolean { return this.db !== null; }

  // ─── kv (scalar app state) ─────────────────────────────────────────────────

  /** Read a JSON-decoded scalar, or undefined if absent/unparseable. */
  getKv<T = unknown>(key: string): T | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try { return JSON.parse(row.value) as T; } catch { return undefined; }
  }

  /** Upsert a JSON-encoded scalar. */
  setKv(key: string, value: unknown): void {
    if (!this.db) return;
    this.db.prepare(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, JSON.stringify(value), Date.now());
  }

  // ─── command history (net-new) ─────────────────────────────────────────────

  /** Record one submitted prompt. Empty text or missing agent id are ignored. */
  addHistory(entry: { agentId: string; cwd?: string | null; text: string }): void {
    if (!this.db) return;
    const text = (entry.text ?? '').trim();
    if (!text || !entry.agentId) return;
    this.db.prepare('INSERT INTO command_history (agent_id, cwd, text, ts) VALUES (?, ?, ?, ?)')
      .run(entry.agentId, entry.cwd ?? null, text, Date.now());
  }

  /** Most-recent-first history, optionally scoped to one agent. */
  listHistory(agentId?: string, limit = 100): CommandHistoryRow[] {
    if (!this.db) return [];
    const lim = clampLimit(limit, 100);
    const rows = agentId
      ? this.db.prepare(
          'SELECT id, agent_id AS agentId, cwd, text, ts FROM command_history WHERE agent_id = ? ORDER BY ts DESC, id DESC LIMIT ?'
        ).all(agentId, lim)
      : this.db.prepare(
          'SELECT id, agent_id AS agentId, cwd, text, ts FROM command_history ORDER BY ts DESC, id DESC LIMIT ?'
        ).all(lim);
    return rows as CommandHistoryRow[];
  }

  /** Substring search over prompt text, most-recent-first. */
  searchHistory(query: string, limit = 50): CommandHistoryRow[] {
    if (!this.db) return [];
    const q = (query ?? '').trim();
    if (!q) return [];
    const lim = clampLimit(limit, 50);
    // Escape LIKE wildcards so a literal % or _ in the query isn't a metachar.
    const needle = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    return this.db.prepare(
      "SELECT id, agent_id AS agentId, cwd, text, ts FROM command_history WHERE text LIKE ? ESCAPE '\\' ORDER BY ts DESC, id DESC LIMIT ?"
    ).all(needle, lim) as CommandHistoryRow[];
  }

  /**
   * Atomically record an accepted shared-office message id. Expired entries are
   * pruned in the same transaction; a duplicate sender/id is rejected.
   */
  consumeTeamMessageReplay(officeId: string, senderId: string, messageId: string, expiresAt: number, now = Date.now()): boolean {
    if (!this.db || !senderId || !messageId
      || senderId.length > 160 || messageId.length > 160
      || !Number.isSafeInteger(expiresAt) || !Number.isSafeInteger(now) || expiresAt <= now) return false;
    let office: string;
    try { office = validateTeamIdentifier(officeId, 'office id'); } catch { return false; }
    const consume = this.db.transaction(() => {
      this.db!.prepare('DELETE FROM team_message_replays_scoped WHERE expires_at < ?').run(now);
      const result = this.db!.prepare(
        'INSERT INTO team_message_replays_scoped (office_id, sender_id, message_id, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(office_id, sender_id, message_id) DO NOTHING'
      ).run(office, senderId, messageId, expiresAt);
      return result.changes === 1;
    });
    return consume();
  }

  /** TeamReplayStore contract used by the shared-office ingress gate. */
  consume(officeId: string, senderId: string, messageId: string, expiresAt: number, now: number): boolean {
    return this.consumeTeamMessageReplay(officeId, senderId, messageId, expiresAt, now);
  }

  // ─── trusted shared-office members ────────────────────────────────────────

  /**
   * Add or explicitly update a pinned teammate for one office. The identity
   * keys are parsed and type-checked here; callers must never populate this
   * store from envelope fields. Calling upsert is the trust/pin operation.
   */
  upsertTrustedTeamMember(input: TrustedTeamMemberInput, now = Date.now()): TrustedTeamMember {
    const valid = validateTrustedTeamMember(input);
    if (!this.db) throw new Error('persistence store is not open');
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('invalid member timestamp');
    this.db.prepare(
      `INSERT INTO trusted_team_members (
         office_id, member_id, display_name, signing_public_key, encryption_public_key,
         control_level, direct_endpoint, created_at, updated_at, revoked_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(office_id, member_id) DO UPDATE SET
         display_name = excluded.display_name,
         signing_public_key = excluded.signing_public_key,
         encryption_public_key = excluded.encryption_public_key,
         control_level = excluded.control_level,
         direct_endpoint = excluded.direct_endpoint,
         updated_at = excluded.updated_at,
         revoked_at = NULL`
    ).run(valid.officeId, valid.memberId, valid.displayName, valid.signingPublicKey,
      valid.encryptionPublicKey, valid.controlLevel, valid.directEndpoint ?? null, now, now);
    return this.getTrustedTeamMember(valid.officeId, valid.memberId, true)!;
  }

  /** List pinned members for an office. Revoked members are hidden by default. */
  listTrustedTeamMembers(officeId: string, includeRevoked = false): TrustedTeamMember[] {
    if (!this.db) return [];
    const scope = validateTeamIdentifier(officeId, 'office id');
    const rows = includeRevoked
      ? this.db.prepare(
          `SELECT office_id AS officeId, member_id AS memberId, display_name AS displayName,
                  signing_public_key AS signingPublicKey, encryption_public_key AS encryptionPublicKey,
                  control_level AS controlLevel, direct_endpoint AS directEndpoint,
                  created_at AS createdAt, updated_at AS updatedAt,
                  revoked_at AS revokedAt
             FROM trusted_team_members WHERE office_id = ? ORDER BY member_id`
        ).all(scope)
      : this.db.prepare(
          `SELECT office_id AS officeId, member_id AS memberId, display_name AS displayName,
                  signing_public_key AS signingPublicKey, encryption_public_key AS encryptionPublicKey,
                  control_level AS controlLevel, direct_endpoint AS directEndpoint,
                  created_at AS createdAt, updated_at AS updatedAt,
                  revoked_at AS revokedAt
             FROM trusted_team_members WHERE office_id = ? AND revoked_at IS NULL ORDER BY member_id`
        ).all(scope);
    return rows as TrustedTeamMember[];
  }

  /** Read a member only from the named office; revoked entries are opt-in. */
  getTrustedTeamMember(officeId: string, memberId: string, includeRevoked = false): TrustedTeamMember | undefined {
    if (!this.db) return undefined;
    const office = validateTeamIdentifier(officeId, 'office id');
    const member = validateTeamIdentifier(memberId, 'member id');
    const row = this.db.prepare(
      `SELECT office_id AS officeId, member_id AS memberId, display_name AS displayName,
              signing_public_key AS signingPublicKey, encryption_public_key AS encryptionPublicKey,
              control_level AS controlLevel, direct_endpoint AS directEndpoint,
              created_at AS createdAt, updated_at AS updatedAt,
              revoked_at AS revokedAt
         FROM trusted_team_members WHERE office_id = ? AND member_id = ?
           AND (? = 1 OR revoked_at IS NULL)`
    ).get(office, member, includeRevoked ? 1 : 0) as TrustedTeamMember | undefined;
    return row;
  }

  /** Ingress API: returns the pinned peer's protocol shape, never envelope data. */
  getTrustedMember(officeId: string, memberId: string): TeamMember | undefined {
    const member = this.getTrustedTeamMember(officeId, memberId);
    if (!member) return undefined;
    return {
      id: member.memberId,
      displayName: member.displayName,
      signingPublicKey: member.signingPublicKey,
      encryptionPublicKey: member.encryptionPublicKey,
      controlLevel: member.controlLevel,
      ...(member.directEndpoint ? { directEndpoint: member.directEndpoint } : {})
    };
  }

  /** Revoke trust without destroying the audit record or silently rotating keys. */
  revokeTrustedTeamMember(officeId: string, memberId: string, now = Date.now()): boolean {
    if (!this.db) return false;
    const office = validateTeamIdentifier(officeId, 'office id');
    const member = validateTeamIdentifier(memberId, 'member id');
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('invalid member timestamp');
    const result = this.db.prepare(
      'UPDATE trusted_team_members SET revoked_at = ?, updated_at = ?, direct_endpoint = NULL WHERE office_id = ? AND member_id = ? AND revoked_at IS NULL'
    ).run(now, now, office, member);
    return result.changes === 1;
  }
}

const TEAM_CONTROL_LEVELS: readonly PeerControlLevel[] = ['task-requests', 'delegated', 'full-control'];
const TEAM_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;

function validateTeamIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !TEAM_ID_PATTERN.test(value)) throw new TypeError(`invalid ${label}`);
  return value;
}

function validateTeamPublicKey(value: unknown, expectedType: 'ed25519' | 'x25519', label: string): string {
  // Restrict the accepted encoding to public SPKI PEM. createPublicKey also
  // accepts private-key PEM and derives a public key, which is unsafe here.
  if (typeof value !== 'string' || value.length > 4096
    || !value.startsWith('-----BEGIN PUBLIC KEY-----\n')
    || !value.trimEnd().endsWith('-----END PUBLIC KEY-----')) {
    throw new TypeError(`${label} must be a public SPKI PEM key`);
  }
  try {
    const key = createPublicKey(value);
    if (key.type !== 'public' || key.asymmetricKeyType !== expectedType) {
      throw new TypeError(`${label} must be ${expectedType}`);
    }
    return key.export({ type: 'spki', format: 'pem' }).toString();
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`invalid ${label}`);
  }
}

function validateTrustedTeamMember(input: TrustedTeamMemberInput): TrustedTeamMemberInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('invalid trusted member');
  const officeId = validateTeamIdentifier(input.officeId, 'office id');
  const memberId = validateTeamIdentifier(input.memberId, 'member id');
  if (typeof input.displayName !== 'string') throw new TypeError('invalid member display name');
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new TypeError('invalid member display name');
  }
  if (!TEAM_CONTROL_LEVELS.includes(input.controlLevel)) throw new TypeError('invalid member control level');
  const directEndpoint = input.directEndpoint == null ? undefined : validateTeamEndpoint(input.directEndpoint);
  return {
    officeId,
    memberId,
    displayName,
    signingPublicKey: validateTeamPublicKey(input.signingPublicKey, 'ed25519', 'signing key'),
    encryptionPublicKey: validateTeamPublicKey(input.encryptionPublicKey, 'x25519', 'encryption key'),
    controlLevel: input.controlLevel,
    ...(directEndpoint ? { directEndpoint } : {})
  };
}

function validateTeamEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/')
    || /[\u0000-\u0020\u007f]/.test(value)) throw new TypeError('invalid teammate multiaddr');
  return value;
}

/** Coerce an untrusted limit into [1, 1000] with a sane fallback. */
function clampLimit(n: number, fallback: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(1000, v);
}
