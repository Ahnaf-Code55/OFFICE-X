import { parseTeamPresence, type TeamPresenceAgent, type TeamPresencePeer, type TeamPresenceSnapshot } from '@shared/teamPresence';

/** Renderer-only presence projection. This is deliberately not an `Agent`: it
 *  has no prompt, cwd, PTY, terminal, key, or task fields and is never persisted.
 *  The authenticated main-process transport publishes only this small projection.
 */
export type RemotePresenceStatus = TeamPresenceAgent['status'];
export type RemotePresenceAgent = TeamPresenceAgent;
export type RemotePresencePeer = TeamPresencePeer;
export type RemotePresenceSnapshot = TeamPresenceSnapshot;
export const parseRemotePresence = parseTeamPresence;

// Volatile renderer store, intentionally independent from useStore/local agents.
let snapshot: RemotePresenceSnapshot = [];
const listeners = new Set<() => void>();

export function getRemotePresence(): RemotePresenceSnapshot {
  // Never expose the private snapshot by reference: external renderer code may
  // inspect it, but only publishRemotePresence can replace validated state.
  return parseRemotePresence(snapshot);
}

export function subscribeRemotePresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replace the volatile remote projection. This does not write local storage,
 *  the durable roster, or the main-process PTY registry. */
export function publishRemotePresence(input: unknown): void {
  const next = parseRemotePresence(input);
  snapshot = next;
  for (const listener of [...listeners]) listener();
}
