/** Main-process shared-office ingress gate used by every transport adapter. */
import {
  acceptTeamEnvelope,
  type TeamEnvelope,
  type TeamIdentity,
  type TeamMember,
  type TeamMessage,
  type TeamReplayStore
} from '../shared/teamProtocol';

export interface TeamIngressStore extends TeamReplayStore {
  /** Reads the locally pinned membership record; transport data is never a source of trust. */
  getTrustedMember(officeId: string, memberId: string): TeamMember | undefined;
}

/**
 * Verify, decrypt, authorize, and deduplicate one inbound message before a
 * transport adapter can hand it to any OFFICE-X action dispatcher.
 */
export function acceptIncomingTeamEnvelope(input: {
  envelope: TeamEnvelope;
  identity: Pick<TeamIdentity, 'deviceId' | 'encryptionPrivateKey'>;
  officeId: string;
  store: TeamIngressStore;
  now?: number;
}): TeamMessage {
  const senderId = input.envelope?.senderId;
  if (typeof senderId !== 'string') throw new Error('invalid team envelope sender');
  const peer = input.store.getTrustedMember(input.officeId, senderId);
  if (!peer) throw new Error('sender is not a trusted member of this office');
  if (peer.id !== senderId) throw new Error('trusted member identity mismatch');
  return acceptTeamEnvelope({
    envelope: input.envelope,
    recipient: input.identity,
    officeId: input.officeId,
    expectedPeer: peer,
    replayStore: input.store,
    now: input.now
  });
}
