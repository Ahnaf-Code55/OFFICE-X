import { createPrivateKey, createPublicKey } from 'node:crypto';
import { createTeamIdentity, isTeamDeviceId, type TeamIdentity } from '../shared/teamProtocol';

export const TEAM_IDENTITY_SECRET_REF = 'officex.team.device-identity.v1';

export interface TeamSecretStore {
  getSecret(ref: string): string | undefined;
  hasSecret(ref: string): boolean;
  setSecret(ref: string, value: string): { ok: boolean; error?: string };
}

export type EnsureTeamIdentityResult =
  | { ok: true; identity: TeamIdentity; created: boolean }
  | { ok: false; error: string };

function isPem(value: unknown, kind: 'public' | 'private'): value is string {
  if (typeof value !== 'string' || value.length > 16_384) return false;
  try {
    if (kind === 'public') createPublicKey(value);
    else createPrivateKey(value);
    return true;
  } catch {
    return false;
  }
}

function parseStoredIdentity(raw: string): TeamIdentity | null {
  try {
    const value = JSON.parse(raw) as Partial<TeamIdentity>;
    if (!value || !isTeamDeviceId(value.deviceId)) return null;
    if (!isPem(value.signingPublicKey, 'public') || !isPem(value.signingPrivateKey, 'private')
      || !isPem(value.encryptionPublicKey, 'public') || !isPem(value.encryptionPrivateKey, 'private')) {
      return null;
    }
    const signingPublic = createPublicKey(value.signingPublicKey);
    const signingPrivatePublic = createPublicKey(createPrivateKey(value.signingPrivateKey));
    const encryptionPublic = createPublicKey(value.encryptionPublicKey);
    const encryptionPrivatePublic = createPublicKey(createPrivateKey(value.encryptionPrivateKey));
    if (signingPublic.asymmetricKeyType !== 'ed25519' || encryptionPublic.asymmetricKeyType !== 'x25519'
      || !signingPublic.export({ type: 'spki', format: 'der' }).equals(signingPrivatePublic.export({ type: 'spki', format: 'der' }))
      || !encryptionPublic.export({ type: 'spki', format: 'der' }).equals(encryptionPrivatePublic.export({ type: 'spki', format: 'der' }))) {
      return null;
    }
    return value as TeamIdentity;
  } catch {
    return null;
  }
}

/**
 * Load this device's long-lived trust identity, creating it once when absent.
 * The caller supplies the OS-encrypted store; there is intentionally no
 * plaintext fallback and corrupt keys are never rotated silently.
 */
export function ensureTeamIdentity(store: TeamSecretStore, preferredDeviceId: string): EnsureTeamIdentityResult {
  const stored = store.getSecret(TEAM_IDENTITY_SECRET_REF);
  if (stored === undefined && store.hasSecret(TEAM_IDENTITY_SECRET_REF)) {
    return { ok: false, error: 'stored team identity is unavailable; refusing to rotate trust keys silently' };
  }
  if (stored !== undefined) {
    const identity = parseStoredIdentity(stored);
    return identity
      ? { ok: true, identity, created: false }
      : { ok: false, error: 'invalid stored team identity; restore or explicitly reset this device identity' };
  }

  let identity: TeamIdentity;
  try {
    identity = createTeamIdentity(preferredDeviceId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const saved = store.setSecret(TEAM_IDENTITY_SECRET_REF, JSON.stringify(identity));
  if (!saved.ok) return { ok: false, error: saved.error ?? 'could not store encrypted team identity' };
  return { ok: true, identity, created: true };
}
