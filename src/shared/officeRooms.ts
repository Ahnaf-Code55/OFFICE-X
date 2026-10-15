import { COMPANY_TEAM_CHART, type TeamRole } from './agentTeams';
export type ChatChannel = 'leadership' | 'managers' | 'everyone';
export type ChatTier = 'off' | 'staff' | 'middle' | 'leadership';
export type ChatIntent = 'report' | 'start' | 'stop' | 'continue';
export const CHAT_CHANNELS: readonly ChatChannel[] = ['leadership', 'managers', 'everyone'];
export const ROOM_LABELS: Record<ChatChannel, string> = {
  leadership: 'Leadership',
  managers: 'Managers',
  everyone: 'Everyone'
};
const RANK: Record<ChatTier, number> = {
  off: 0,
  staff: 1,
  middle: 2,
  leadership: 3
};
export const canHear = (tier: ChatTier | undefined, channel: ChatChannel): boolean => RANK[tier ?? 'off'] >= {
  everyone: 1,
  managers: 2,
  leadership: 3
}[channel];
export function roleTier(role: unknown, isLead = false): Exclude<ChatTier, 'off'> {
  return isLead || role === 'orchestrator' ? 'leadership' : role === 'manager' ? 'middle' : 'staff';
}
export function namedRole(name: string): TeamRole | undefined {
  return COMPANY_TEAM_CHART.find(m => m.name.toLowerCase() === name.toLowerCase())?.role;
}
export function requestIntent(text: string): ChatIntent | undefined {
  if (/\b(?:don't|do not|no need|no|without)\b.{0,35}\b(?:report|meeting|discussion|join)\b/i.test(text)) return undefined;
  if (/\b(?:end|stop|close|cancel)\b.{0,25}\b(?:meeting|discussion)\b/i.test(text)) return 'stop';
  if (/\b(?:start(?:ing)?|begin(?:ning)?|open)\b.{0,30}\b(?:meeting|discussion)\b|\beveryone\s+join\b/i.test(text)) return 'start';
  if (/\b(?:report|status update|progress update)\b/i.test(text)
    && (/\?|\b(?:give|send|show|share|request|please|need|want|what|how)\b/i.test(text)
      || /^\s*(?:@[^\s]+\s+)?report(?:\s+(?:on|your|our|the|progress|status|blockers|again)\b|[.!?]*\s*$)/i.test(text))
    && !/\b(?:wrote|saved|uploaded|attached|filed)\b/i.test(text)) return 'report';
  return undefined;
}
export interface ChatWireBody {
  channel: ChatChannel;
  text: string;
  image: string;
  authorKind: 'human' | 'agent';
  authorName: string;
  /** Optional for older peers; human requests identify bounded discussion rounds. */
  requestId?: string;
  intent?: ChatIntent;
}
export interface RoomTurn {
  agentId: string;
  name: string;
  state: 'waiting' | 'speaking' | 'answered' | 'skipped';
}
export interface RoomState {
  channel: ChatChannel;
  active: boolean;
  round?: {
    id: string;
    kind: 'report' | 'discussion';
    status: 'collecting' | 'complete' | 'cancelled' | 'expired';
    turns: RoomTurn[];
  };
}
export const MAX_ROOM_TURNS = 3;
export const MAX_AGENT_REPLY_CHARS = 1000;
export const MAX_ROOM_CONTEXT_CHARS = 2200;

export interface RoomRequest { channel: ChatChannel; id: string; expiresAt: number }

/** Only the currently invited speaker may consume a discussion turn. */
export function isRoomRequestPending(rooms: RoomState[], agentId: string, request: RoomRequest, now = Date.now()): boolean {
  const round = rooms.find(room => room.channel === request.channel)?.round;
  return now < request.expiresAt && round?.id === request.id && round.status === 'collecting'
    && round.turns.some(turn => turn.agentId === agentId && turn.state === 'speaking');
}
