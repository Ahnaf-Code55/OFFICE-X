import type { ChatWireBody } from '../shared/officeRooms';
import { isPeerActionAllowed, type TeamMessage } from '../shared/teamProtocol';
import type { PeerControlLevel, TriggerMode } from '../shared/triggers';

export interface TeamActionMember {
  memberId: string;
  displayName: string;
  controlLevel: PeerControlLevel;
}

export interface TeamActionTarget {
  id: string;
  name: string;
  isGod?: boolean;
  isAssistant?: boolean;
  archived?: boolean;
  onHold?: boolean;
}

export type ParsedTeamAction =
  | { type: 'task-request'; title: string; message: string }
  | { type: 'agent-prompt'; agentId: string; prompt: string }
  | { type: 'terminal-input'; agentId: string; input: string }
  | { type: 'terminal-stream'; agentId: string; output: string; sequence: number; streamId: string; gap: boolean }
  | ({ type: 'chat' } & ChatWireBody)
  | ({ type: 'rtc-signal' } & RtcSignal);

/**
 * WebRTC signalling for a human-to-human voice call. One fixed shape for every
 * kind so the parser stays an exact-key check:
 * - offer/answer: `sdp` is the full session description (ICE candidates
 *   gathered so far are embedded), the candidate fields are empty/-1.
 * - candidate: a late trickled ICE candidate; `sdp` is empty. `sdpMid` '' and
 *   `sdpMLineIndex` -1 stand for null.
 * - hangup: ends, declines, or refuses (busy) the call; everything else empty.
 * Media never crosses this channel, only the setup needed to open a direct
 * peer connection.
 */
export interface RtcSignal {
  callId: string;
  kind: 'offer' | 'answer' | 'candidate' | 'hangup';
  sdp: string;
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}

/** Base64 image budget: keeps a sealed chat envelope under MAX_TEAM_MESSAGE_BYTES. */
export const MAX_CHAT_IMAGE_CHARS = 150_000;
export const MAX_CHAT_TEXT = 4000;
const CHAT_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_RTC_SDP = 16_000;
export const MAX_RTC_CANDIDATE = 2000;
const RTC_CALL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RTC_KEYS = ['callId', 'kind', 'sdp', 'candidate', 'sdpMid', 'sdpMLineIndex'] as const;

export function teamTaskRequestRequiresApproval(access: PeerControlLevel, mode: TriggerMode): boolean {
  return access === 'task-requests' || mode !== 'allow-all';
}

function exactKeys(body: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(body).length === keys.length && keys.every((key) => Object.hasOwn(body, key));
}

function text(value: unknown, min: number, max: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`invalid teammate ${field}`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error(`invalid teammate ${field} size`);
  return normalized;
}

/** Strict RTC signal check, shared by teammate ingress and the renderer's send IPC. */
export function parseRtcSignal(raw: unknown): RtcSignal {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid rtc signal');
  const body = raw as Record<string, unknown>;
  const { callId, kind, sdp, candidate, sdpMid, sdpMLineIndex } = body;
  if (!exactKeys(body, RTC_KEYS)
    || typeof callId !== 'string' || !RTC_CALL_ID.test(callId)
    || (kind !== 'offer' && kind !== 'answer' && kind !== 'candidate' && kind !== 'hangup')
    || typeof sdp !== 'string' || sdp.length > MAX_RTC_SDP
    || typeof candidate !== 'string' || candidate.length > MAX_RTC_CANDIDATE
    || typeof sdpMid !== 'string' || sdpMid.length > 64
    || typeof sdpMLineIndex !== 'number' || !Number.isInteger(sdpMLineIndex) || sdpMLineIndex < -1 || sdpMLineIndex > 64) {
    throw new Error('invalid rtc signal');
  }
  const description = kind === 'offer' || kind === 'answer';
  if (description ? !sdp.startsWith('v=0') : sdp !== '') throw new Error('invalid rtc signal sdp');
  if (kind === 'candidate' ? !candidate.startsWith('candidate:') : (candidate !== '' || sdpMid !== '' || sdpMLineIndex !== -1)) {
    throw new Error('invalid rtc signal candidate');
  }
  return { callId, kind, sdp, candidate, sdpMid, sdpMLineIndex };
}

/** Parse action bodies and re-apply the current local permission at dispatch time. */
export function parseTeamAction(input: {
  message: TeamMessage;
  member: TeamActionMember;
  targets: readonly TeamActionTarget[];
  hasTerminal: (agentId: string) => boolean;
}): ParsedTeamAction {
  const { message, member } = input;
  if (message.senderId !== member.memberId) throw new Error('teammate identity changed before dispatch');
  if (!isPeerActionAllowed(member.controlLevel, message.action)) throw new Error('teammate access changed before dispatch');
  const body = message.body;
  if (message.action === 'task-request') {
    if (!exactKeys(body, ['title', 'message'])) throw new Error('invalid teammate task request');
    return {
      type: 'task-request',
      title: text(body.title, 1, 120, 'task title'),
      message: text(body.message, 1, 8000, 'task request')
    };
  }
  if (message.action === 'agent-prompt') {
    if (!exactKeys(body, ['agentId', 'prompt']) || typeof body.agentId !== 'string') throw new Error('invalid teammate agent prompt');
    const prompt = text(body.prompt, 1, 8000, 'agent prompt');
    const target = input.targets.find((agent) => agent.id === body.agentId);
    if (!target || target.archived || target.isGod || target.isAssistant || target.onHold) {
      throw new Error('teammate target agent is unavailable');
    }
    return { type: 'agent-prompt', agentId: target.id, prompt };
  }
  if (message.action === 'terminal-input') {
    if (member.controlLevel !== 'full-control' || !exactKeys(body, ['agentId', 'input']) || typeof body.agentId !== 'string') {
      throw new Error('invalid full-control terminal input');
    }
    if (typeof body.input !== 'string' || !body.input.trim() || body.input.length > 4096) {
      throw new Error('invalid teammate terminal input size');
    }
    const target = input.targets.find((agent) => agent.id === body.agentId);
    if (!target || target.archived || target.isGod || target.isAssistant || target.onHold || !input.hasTerminal(target.id)) {
      throw new Error('teammate target terminal is unavailable');
    }
    return { type: 'terminal-input', agentId: target.id, input: body.input };
  }
  if (message.action === 'terminal-stream') {
    if (member.controlLevel !== 'full-control' || !exactKeys(body, ['agentId', 'output', 'sequence', 'streamId', 'gap'])
      || typeof body.agentId !== 'string' || typeof body.output !== 'string'
      || body.output.length < 1 || body.output.length > 4096
      || !Number.isSafeInteger(body.sequence) || (body.sequence as number) < 1
      || typeof body.streamId !== 'string' || !/^[A-Fa-f0-9]{16}$/.test(body.streamId)
      || typeof body.gap !== 'boolean') {
      throw new Error('invalid full-control terminal stream');
    }
    return { type: 'terminal-stream', agentId: body.agentId, output: body.output,
      sequence: body.sequence as number, streamId: body.streamId, gap: body.gap };
  }
  if (message.action === 'chat') {
    const baseKeys = ['channel', 'text', 'image', 'authorKind', 'authorName'];
    const optionalKeys = ['requestId', 'intent'].filter(k => Object.hasOwn(body,k));
    if (!exactKeys(body, [...baseKeys, ...optionalKeys])
      || (body.requestId !== undefined && (typeof body.requestId !== 'string' || !/^[a-f0-9]{16}$/.test(body.requestId)))
      || (body.intent !== undefined && (!['report','start','stop','continue'].includes(String(body.intent)) || body.authorKind !== 'human'))
      || (body.channel !== 'leadership' && body.channel !== 'managers' && body.channel !== 'everyone')
      || typeof body.text !== 'string' || body.text.length > MAX_CHAT_TEXT
      || typeof body.image !== 'string' || body.image.length > MAX_CHAT_IMAGE_CHARS
      || (body.image !== '' && !CHAT_IMAGE.test(body.image))
      || (body.authorKind !== 'human' && body.authorKind !== 'agent')
      || (!body.text.trim() && !body.image)) {
      throw new Error('invalid teammate chat message');
    }
    return { type: 'chat', channel: body.channel, text: body.text.trim(), image: body.image, authorKind: body.authorKind,
      authorName: text(body.authorName, 1, 60, 'chat author'),
      ...(body.requestId !== undefined ? {requestId: body.requestId as string} : {}),
      ...(body.intent !== undefined ? {intent: body.intent as ChatWireBody['intent']} : {}) };
  }
  if (message.action === 'rtc-signal') return { type: 'rtc-signal', ...parseRtcSignal(body) };
  throw new Error(`unsupported teammate action: ${message.action}`);
}
