import type { TeamMember } from '@shared/agentTeams';
import type { MessageLogEntry } from './buildGraph';

export interface Communication {
  key: string; source: string; target: string; messageId?: string;
  act: string; ts: number; count: number;
}
export interface Participant { key: string; label: string }
export interface CommunicationData { edges: Communication[]; participants: Participant[] }
const ACTS = new Set(['request', 'query', 'inform', 'propose', 'agree', 'done', 'refuse']);

/** One edge per direction: a reply cannot inherit the request's arrowhead.
 * Raw log subjects/bodies are deliberately omitted; previews use the existing
 * redacted hiveMessages API. `delivered` expands successful fan-out recipients. */
export function buildCommunication(members: readonly TeamMember[], log: readonly MessageLogEntry[], now: number, minutes: number | null): CommunicationData {
  const local = new Map(members.filter(m => m.localId).map(m => [m.localId!, m.key]));
  const participants = new Map<string, Participant>();
  const resolve = (id: unknown): string | null => {
    if (typeof id !== 'string' || !id || id.length > 160) return null;
    if (local.has(id)) return local.get(id)!;
    const key = `participant:${id}`;
    const label = id === 'human' ? 'Human' : id === 'broadcast' ? 'Broadcast' : id === 'breaker' ? 'Safety monitor' : id;
    participants.set(key, { key, label });
    return key;
  };
  const edges = new Map<string, Communication>();
  const seen = new Set<string>();
  for (const entry of log) {
    if (entry.kind !== 'message' || typeof entry.ts !== 'number' || !Number.isFinite(entry.ts)
      || entry.ts > now + 1000 || (minutes !== null && entry.ts < now - minutes * 60_000)) continue;
    const from = typeof entry.from === 'string' ? entry.from : null;
    if (!from) continue;
    const targets = entry.to === 'human' && (!Array.isArray(entry.delivered) || entry.delivered.length > 0)
      ? ['human'] : Array.isArray(entry.delivered) ? entry.delivered : [entry.to];
    for (const target of targets) {
      if (target === from) continue;
      const source = resolve(from), to = resolve(target);
      if (!source || !to) continue;
      const messageId = typeof entry.id === 'string' ? entry.id : undefined;
      const unique = JSON.stringify([messageId ?? entry.ts, source, to]);
      if (seen.has(unique)) continue;
      seen.add(unique);
      const key = JSON.stringify([source, to]);
      const previous = edges.get(key);
      const act = typeof entry.act === 'string' && ACTS.has(entry.act) ? entry.act : 'inform';
      edges.set(key, previous && previous.ts > entry.ts
        ? { ...previous, count: previous.count + 1 }
        : { key, source, target: to, messageId, act, ts: entry.ts, count: (previous?.count ?? 0) + 1 });
    }
  }
  const ordered = [...edges.values()].sort((a, b) => b.ts - a.ts);
  const used = new Set(ordered.flatMap(e => [e.source, e.target]));
  return { edges: ordered, participants: [...participants.values()].filter(p => used.has(p.key)) };
}
export function messageAge(ts: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  return seconds < 5 ? 'now' : seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;
}
export const messageActLabel = (act: string): string => ({ request: 'Request', query: 'Question', inform: 'Update', propose: 'Proposal', agree: 'Agreement', done: 'Done', refuse: 'Declined' }[act] ?? 'Message');
export const graphStatusLabel = (status: string): string => ({ blocked: 'Needs you', ghost: 'Offline', thinking: 'Thinking', working: 'Working', idle: 'Idle', waiting: 'Waiting', compacting: 'Compacting', looping: 'Looping', typing: 'Typing', success: 'Done' }[status] ?? status.replace(/^./, s => s.toUpperCase()));
