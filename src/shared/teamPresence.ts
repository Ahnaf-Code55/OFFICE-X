/** Small display-only presence payload exchanged between invited OFFICE-X peers.
 *  It intentionally cannot carry prompts, paths, terminal bytes, secrets, or
 *  local PTY identifiers. Main and renderer both validate this boundary. */
export const TEAM_PRESENCE_CHARACTERS = [
  'michael', 'jim', 'pam', 'dwight', 'kevin', 'angela', 'oscar', 'stanley',
  'phyllis', 'andy', 'kelly', 'ryan', 'toby', 'creed', 'meredith'
] as const;

export type TeamPresenceCharacter = typeof TEAM_PRESENCE_CHARACTERS[number];
export type TeamPresenceStatus = 'idle' | 'working' | 'waiting' | 'offline';

export interface TeamPresenceAgent {
  id: string;
  name: string;
  character: TeamPresenceCharacter;
  status: TeamPresenceStatus;
}

export interface TeamPresencePeer {
  id: string;
  name: string;
  agents: TeamPresenceAgent[];
}

export type TeamPresenceSnapshot = TeamPresencePeer[];

const MAX_PEERS = 8;
const MAX_AGENTS_PER_PEER = 32;
const PEER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const NAME_RE = /^[^\u0000-\u001f\u007f/\\]{1,32}$/;
const STATUSES = new Set<TeamPresenceStatus>(['idle', 'working', 'waiting', 'offline']);
const CHARACTERS: ReadonlySet<string> = new Set(TEAM_PRESENCE_CHARACTERS);
const PEER_KEYS = new Set(['id', 'name', 'agents']);
const AGENT_KEYS = new Set(['id', 'name', 'character', 'status']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && NAME_RE.test(value);
}

/** Reject extra or unbounded data and return a fresh canonical presence DTO. */
export function parseTeamPresence(input: unknown): TeamPresenceSnapshot {
  if (!Array.isArray(input) || input.length > MAX_PEERS) throw new Error('invalid team presence peers');
  const peerIds = new Set<string>();
  return input.map((rawPeer) => {
    if (!isRecord(rawPeer) || !exactKeys(rawPeer, PEER_KEYS)
      || typeof rawPeer.id !== 'string' || !PEER_ID_RE.test(rawPeer.id)
      || !validName(rawPeer.name) || !Array.isArray(rawPeer.agents)
      || rawPeer.agents.length > MAX_AGENTS_PER_PEER) throw new Error('invalid team presence peer');
    if (peerIds.has(rawPeer.id)) throw new Error('duplicate team presence peer');
    peerIds.add(rawPeer.id);
    const agentIds = new Set<string>();
    const agents = rawPeer.agents.map((rawAgent) => {
      if (!isRecord(rawAgent) || !exactKeys(rawAgent, AGENT_KEYS)
        || typeof rawAgent.id !== 'string' || !AGENT_ID_RE.test(rawAgent.id)
        || !validName(rawAgent.name)
        || typeof rawAgent.character !== 'string' || !CHARACTERS.has(rawAgent.character)
        || typeof rawAgent.status !== 'string' || !STATUSES.has(rawAgent.status as TeamPresenceStatus)) {
        throw new Error('invalid team presence agent');
      }
      if (agentIds.has(rawAgent.id)) throw new Error('duplicate team presence agent');
      agentIds.add(rawAgent.id);
      return {
        id: rawAgent.id,
        name: rawAgent.name,
        character: rawAgent.character as TeamPresenceCharacter,
        status: rawAgent.status as TeamPresenceStatus
      };
    });
    return { id: rawPeer.id, name: rawPeer.name, agents };
  });
}
