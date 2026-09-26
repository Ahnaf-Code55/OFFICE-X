import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parse as parseToml } from 'toml';

export const CODEX_REMOTE_SOCKET_RELATIVE =
  'app-server-control/app-server-control.sock';

/** macOS caps a Unix socket path at 104 bytes (`sun_path`), and Codex builds its
 *  control socket as `$CODEX_HOME/app-server-control/app-server-control.sock` —
 *  42 bytes of suffix. So the alias home itself must fit in ~61 bytes.
 *
 *  `$TMPDIR` cannot host it: macOS spells it
 *  `/var/folders/xx/<30-char-hash>/T/` (49 bytes) and the alias came out at 121
 *  — LONGER than the 118-byte real home it was introduced to shorten, so every
 *  daemon start failed with `path must be shorter than SUN_LEN`. Root the alias
 *  at a fixed short prefix instead and keep the digest to 8 hex chars: the whole
 *  socket path then lands at 60 bytes with room to spare. */
export const CODEX_REMOTE_ALIAS_ROOT = '/tmp/mdc';

/** Longest socket path the platform will accept, minus a small safety margin. */
export const CODEX_REMOTE_SOCKET_MAX = 104;

/** Keep the CODEX_HOME spelling short enough for macOS's Unix-socket limit.
 *  `tempRoot` defaults to the short fixed root; callers may override it (tests). */
export function codexRemoteAliasPath(
  realHome: string,
  agentId: string,
  tempRoot: string = CODEX_REMOTE_ALIAS_ROOT
): string {
  const digest = createHash('sha256')
    .update(`${realHome}\0${agentId}`)
    .digest('hex')
    .slice(0, 8);
  return join(tempRoot, digest);
}

/** Whether a candidate home yields a control socket the platform can bind. */
export function codexRemoteSocketFits(shortHome: string): boolean {
  return join(shortHome, CODEX_REMOTE_SOCKET_RELATIVE).length < CODEX_REMOTE_SOCKET_MAX;
}

export function codexRemoteEndpoint(shortHome: string): string {
  return `unix://${join(shortHome, CODEX_REMOTE_SOCKET_RELATIVE)}`;
}

/** `codex --remote` rejects `--add-dir`; those roots must be configured on the
 * app-server daemon instead. Keep the local TUI args intact unless remote setup
 * succeeds so its ordinary `--add-dir` behavior remains the fallback. */
export function moveCodexAddDirArgsToServer(args: string[]): {
  args: string[];
  writableRoots: string[];
} {
  const clientArgs: string[] = [];
  const writableRoots: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--add-dir' && i + 1 < args.length) {
      writableRoots.push(args[++i]);
      continue;
    }
    if (arg.startsWith('--add-dir=') && arg.length > '--add-dir='.length) {
      writableRoots.push(arg.slice('--add-dir='.length));
      continue;
    }
    clientArgs.push(arg);
  }
  return { args: clientArgs, writableRoots: Array.from(new Set(writableRoots)) };
}

/** TOML override consumed by `codex app-server daemon restart --config`.
 * Preserve roots already configured by the user in the per-agent Codex home. */
export function codexRemoteWritableRootsConfig(
  roots: string[],
  existingConfig = ''
): string | undefined {
  let existingRoots: string[] = [];
  if (existingConfig.trim()) {
    try {
      const parsed = parseToml(existingConfig);
      const configured = parsed?.sandbox_workspace_write?.writable_roots;
      if (Array.isArray(configured)) {
        existingRoots = configured.filter((root: unknown): root is string => typeof root === 'string');
      }
    } catch {
      // The Codex home config was already accepted by Codex. If an older or
      // custom file cannot be parsed here, keep the generated hive roots.
    }
  }
  const uniqueRoots = Array.from(new Set([...existingRoots, ...roots].filter((root) => root.length > 0)));
  if (uniqueRoots.length === 0) return undefined;
  return `sandbox_workspace_write.writable_roots=${JSON.stringify(uniqueRoots)}`;
}

/** Global options must precede `resume`, so prepend the endpoint in all cases. */
export function withCodexRemoteArgs(args: string[], endpoint: string): string[] {
  if (args.includes('--remote')) return args;
  return ['--remote', endpoint, ...args];
}
