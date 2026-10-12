import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Codex requires a private control-socket parent. NTFS/FUSE mounts may ignore
 * chmod; detect that before waiting for a daemon that cannot start. */
export function prepareCodexRemoteHome(home: string): boolean {
  const control = join(home, 'app-server-control');
  try {
    mkdirSync(control, { recursive: true, mode: 0o700 });
    const before = lstatSync(control);
    if (!before.isDirectory() || before.isSymbolicLink()) return false;
    if (process.getuid && before.uid !== process.getuid()) return false;
    if (before.mode & 0o077) chmodSync(control, 0o700);
    return (lstatSync(control).mode & 0o077) === 0;
  } catch { return false; }
}
