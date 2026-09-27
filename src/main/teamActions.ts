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
  | { type: 'chat'; channel: 'leadership' | 'managers' | 'everyone'; text: string; image: string; authorKind: 'human' | 'agent'; authorName: string };

/** Base64 image budget: keeps a sealed chat envelope under MAX_TEAM_MESSAGE_BYTES. */
export const MAX_CHAT_IMAGE_CHARS = 150_000;
export const MAX_CHAT_TEXT = 4000;
const CHAT_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

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
    if (!exactKeys(body, ['channel', 'text', 'image', 'authorKind', 'authorName'])
      || (body.channel !== 'leadership' && body.channel !== 'managers' && body.channel !== 'everyone')
      || typeof body.text !== 'string' || body.text.length > MAX_CHAT_TEXT
      || typeof body.image !== 'string' || body.image.length > MAX_CHAT_IMAGE_CHARS
      || (body.image !== '' && !CHAT_IMAGE.test(body.image))
      || (body.authorKind !== 'human' && body.authorKind !== 'agent')
      || (!body.text.trim() && !body.image)) {
      throw new Error('invalid teammate chat message');
    }
    return { type: 'chat', channel: body.channel, text: body.text.trim(), image: body.image, authorKind: body.authorKind,
      authorName: text(body.authorName, 1, 60, 'chat author') };
  }
  throw new Error(`unsupported teammate action: ${message.action}`);
}
