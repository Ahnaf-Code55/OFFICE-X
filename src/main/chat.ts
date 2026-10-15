/** Shared office rooms: quiet until a human requests a report or starts a meeting. */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHAT_CHANNELS, canHear, requestIntent, MAX_ROOM_TURNS, MAX_AGENT_REPLY_CHARS, MAX_ROOM_CONTEXT_CHARS, type ChatChannel, type ChatTier, type ChatIntent, type ChatWireBody, type RoomState, type RoomRequest } from '../shared/officeRooms';
export { CHAT_CHANNELS, canHear };
export type { ChatChannel, ChatTier, ChatIntent, RoomState };
export type ChatAuthorKind = 'me' | 'human' | 'agent';
export interface ChatMessage {
  id: string;
  authorKind: ChatAuthorKind;
  authorName: string;
  agentId?: string;
  channel: ChatChannel;
  text: string;
  imagePath?: string;
  ts: number;
  requestId?: string;
}
export type ChatView = ChatMessage & {
  image?: string;
  mentionsMe?: boolean;
};
export interface ChatDeps {
  dir: string;
  getKv: <T>(key: string) => T | undefined;
  setKv: (key: string, value: unknown) => void;
  myName: () => string;
  agentName: (agentId: string) => string | undefined;
  agentIds?: () => string[];
  leadAgentId?: () => string | undefined;
  agentTier?: (agentId: string) => ChatTier | undefined;
  agentWork?: (agentId: string) => string;
  deliverToAgent: (agentId: string, subject: string, body: string, request?: RoomRequest) => void;
  sendToTeammates: (body: ChatWireBody) => Promise<void>;
  emit: (message: ChatView) => void;
  emitRooms?: (rooms: RoomState[]) => void;
  now?: () => number;
}
const LOG_KEY = 'chat:log',
  TIERS_KEY = 'chat:tiers',
  MAX_LOG = 200;
export const MAX_AI_TURNS = MAX_ROOM_TURNS;
export const ROUND_LIFETIME_MS = 180_000;
export const mentions = (text: string, name: string): boolean => new RegExp(`(?:^|\\s)@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(text);
interface Round {
  view: NonNullable<RoomState['round']>;
  message: ChatMessage;
  expires: number;
  cursor: number;
}
export function createChat(deps: ChatDeps) {
  const now = deps.now ?? Date.now;
  const active = new Set<ChatChannel>();
  const rounds = new Map<ChatChannel, Round>();
  const topics = new Map<ChatChannel, ChatMessage>();
  const spoke = new Map<string, number>();
  const remoteSeen = new Map<string, number>();
  const log = (): ChatMessage[] => (deps.getKv<ChatMessage[]>(LOG_KEY) ?? []).map(m => ({
    ...m,
    channel: m.channel ?? 'everyone'
  }));
  const stored = (): Record<string, ChatTier> => deps.getKv<Record<string, ChatTier>>(TIERS_KEY) ?? {};
  const tiers = (): Record<string, ChatTier> => {
    const saved = stored(),
      all: Record<string, ChatTier> = {};
    for (const id of deps.agentIds?.() ?? Object.keys(saved)) {
      const inferred = deps.agentTier?.(id);
      all[id] = saved[id] === 'off' ? 'off' : inferred ?? saved[id] ?? (id === deps.leadAgentId?.() ? 'leadership' : 'staff');
    }
    return all;
  };
  const view = (m: ChatMessage): ChatView => {
    if (!m.imagePath || !existsSync(m.imagePath)) return m;
    return {
      ...m,
      image: `data:image/${m.imagePath.split('.').pop()};base64,${readFileSync(m.imagePath).toString('base64')}`
    };
  };
  function record(input: Omit<ChatMessage, 'id' | 'ts' | 'imagePath'> & {
    image?: string;
  }): ChatMessage {
    const id = randomBytes(8).toString('hex'),
      {
        image,
        ...rest
      } = input;
    let imagePath: string | undefined;
    const match = image && /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(image);
    if (match) {
      mkdirSync(deps.dir, {
        recursive: true
      });
      imagePath = join(deps.dir, `${id}.${match[1]}`);
      writeFileSync(imagePath, Buffer.from(match[2], 'base64'));
    }
    const m: ChatMessage = {
      ...rest,
      id,
      ts: now(),
      imagePath
    };
    deps.setKv(LOG_KEY, [...log(), m].slice(-MAX_LOG));
    const handle = deps.myName().trim().split(/\s+/)[0] || 'Me';
    deps.emit({
      ...view(m),
      mentionsMe: m.authorKind !== 'me' && mentions(m.text, handle)
    });
    return m;
  }
  function states(): RoomState[] {
    for (const r of rounds.values()) if (r.view.status === 'collecting' && now() >= r.expires) r.view.status = 'expired';
    return CHAT_CHANNELS.map(channel => ({
      channel,
      active: active.has(channel),
      round: rounds.get(channel)?.view
    }));
  }
  const changed = () => deps.emitRooms?.(states());
  function cancel(channel: ChatChannel): void {
    const r = rounds.get(channel);
    if (r) r.view.status = 'cancelled';
  }
  function speakers(m: ChatMessage): string[] {
    const all = tiers();
    const eligible = Object.keys(all).filter(id => canHear(all[id], m.channel) && deps.agentName(id));
    const named = eligible.filter(id => mentions(m.text, deps.agentName(id)!));
    if (named.length) return named.slice(0, MAX_ROOM_TURNS);
    // A direct address to a human, remote employee or out-of-room role must
    // not bill unrelated local agents. Group addresses still select a small round.
    if (/(?:^|[^\w@])@(?!everyone\b|managers\b|leadership\b)[\p{L}\p{N}_-]+/iu.test(m.text)) return [];
    const lead = eligible.find(id => id === deps.leadAgentId?.()) ?? eligible.find(id => all[id] === 'leadership');
    const query: string[] = m.text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const domains = [['cloud', 'deploy', 'infrastructure', 'devops', 'monitoring', 'atlas', 'orbit'], ['security', 'secure', 'audit', 'compliance', 'sentinel', 'bastion', 'auditor'], ['backend', 'api', 'code', 'engineering', 'forge', 'core', 'patch'], ['content', 'copy', 'documentation', 'narrative', 'chronicle'], ['quality', 'test', 'tests', 'qa', 'lighthouse']];
    const wanted = domains.filter(words => words.some(word => query.includes(word))).flat();
    const score = (id: string) => {
      const work = `${deps.agentName(id)} ${deps.agentWork?.(id) ?? ''}`.toLowerCase();
      return [...query, ...wanted].reduce((n, word) => n + (work.includes(word) ? 1 : 0), 0);
    };
    const candidates = eligible.filter(id => id !== lead).sort((a, b) => score(b) - score(a) || (spoke.get(`${m.channel}:${a}`) ?? 0) - (spoke.get(`${m.channel}:${b}`) ?? 0));
    const picked: string[] = [];
    if (candidates[0]) picked.push(candidates[0]);
    if (m.channel === 'everyone' && picked.length) {
      const other = candidates.find(id => id !== picked[0] && all[id] !== all[picked[0]]);
      if (other) picked.push(other);
    }
    for (const id of candidates) if (picked.length < MAX_ROOM_TURNS - (lead ? 1 : 0) && !picked.includes(id)) picked.push(id);
    if (lead) picked.push(lead); // short wrap-up after the independent voices
    return picked.slice(0, MAX_ROOM_TURNS);
  }
  function prompt(r: Round, agentId: string): string {
    let context = '';
    for (const m of log().filter(m => m.channel === r.message.channel && m.requestId === r.view.id).slice(-6).reverse()) {
      const line = `${m.authorName}: ${m.text.slice(0, 900)}${m.imagePath ? ` [image: ${m.imagePath}]` : ''}\n`;
      if (context.length + line.length > MAX_ROOM_CONTEXT_CHARS) break;
      context = line + context;
    }
    const lead = agentId === deps.leadAgentId?.() && r.cursor === r.view.turns.length - 1 && r.cursor > 0;
    return [`OFFICE-X #${r.message.channel} — ${r.view.kind}; your one invited turn.`, `Your job: ${(deps.agentWork?.(agentId) ?? 'Your saved office role').slice(0, 180)}.`, `Human topic: ${r.message.text.slice(0, 1600)}${r.message.imagePath ? ` [image: ${r.message.imagePath}]` : ''}`, `Recent room context:\n${context}`, lead ? 'Wrap up the actual views above: agreement, unresolved disagreement, owner/next step. Do not invent completed work or speak for absent people.' : 'Give your own assessment, not automatic agreement. For a report: completed work/evidence, blocker, next step. For an idea: your recommendation, reason, and a concrete flaw/risk or uncertainty if one exists. Challenge weak assumptions respectfully; offer a better option. Do not invent disagreement.', 'Keep one natural reply, at most 3 short sentences / 80 words. No acknowledgments, repeated updates, emoji floods or insults. You may write the ONE reply JSON to your own outbox; that is the only file change this discussion authorizes. A discussion is not authorization to start work, change project files, hire agents or spend money. Ask the human when approval is needed; do not bypass terminal permissions.', `Speak only as ${deps.agentName(agentId)}. Do not @mention agents to wake them: the room schedules turns.`, `Reply with ONE outbox JSON: {"to":"chat","act":"inform","conversation":"chat-${r.view.id}","in_reply_to":"${r.message.id}","subject":"Office discussion","body":"your short reply"}. Copy the conversation value exactly; do not post a second reply.`].join('\n');
  }
  function pump(r: Round): void {
    if (r.view.status !== 'collecting') return;
    const membership = tiers();
    while (r.cursor < r.view.turns.length) {
      const turn = r.view.turns[r.cursor];
      if (!deps.agentName(turn.agentId) || !canHear(membership[turn.agentId], r.message.channel)) {
        turn.state = 'skipped';
        r.cursor++;
        continue;
      }
      turn.state = 'speaking';
      deps.deliverToAgent(turn.agentId, `#${r.message.channel}: ${r.message.authorName}`, prompt(r, turn.agentId), {channel:r.message.channel,id:r.view.id,expiresAt:r.expires});
      changed();
      return;
    }
    r.view.status = 'complete';
    changed();
  }
  function startRound(m: ChatMessage, id: string, kind: 'report' | 'discussion'): void {
    cancel(m.channel);
    topics.set(m.channel, m);
    const r: Round = {
      view: {
        id,
        kind,
        status: 'collecting',
        turns: speakers(m).map(agentId => ({
          agentId,
          name: deps.agentName(agentId)!,
          state: 'waiting'
        }))
      },
      message: m,
      expires: now() + ROUND_LIFETIME_MS,
      cursor: 0
    };
    rounds.set(m.channel, r);
    pump(r);
  }
  function activate(m: ChatMessage, id: string, explicit?: ChatIntent): void {
    const intent = explicit ?? requestIntent(m.text);
    if (intent === 'stop') {
      active.delete(m.channel);
      cancel(m.channel);
      changed();
      return;
    }
    if (intent === 'start') {
      cancel(m.channel);
      rounds.delete(m.channel);
      topics.delete(m.channel);
      active.add(m.channel);
      changed();
      return;
    } // no paid join acknowledgments
    if (intent === 'continue' && topics.has(m.channel)) startRound({
      ...m,
      text: topics.get(m.channel)!.text
    }, id, rounds.get(m.channel)?.view.kind ?? 'report');else if (intent === 'report' || active.has(m.channel)) startRound(m, id, intent === 'report' ? 'report' : 'discussion');
  }
  return {
    list: (): ChatView[] => log().slice(-100).map(view),
    tiers,
    rooms: states,
    canDeliver(agentId: string, requestId: string, channel: ChatChannel): boolean {
      states();const r=rounds.get(channel);return !!r&&r.view.status==='collecting'&&r.view.id===requestId&&r.view.turns[r.cursor]?.agentId===agentId&&canHear(tiers()[agentId],channel);
    },
    setTier(agentId: string, tier: ChatTier): void {
      deps.setKv(TIERS_KEY, {
        ...stored(),
        [agentId]: tier
      });
      changed();
    },
    async post(channel: ChatChannel, text: string, image: string, intent?: ChatIntent): Promise<ChatMessage> {
      const m = record({
        authorKind: 'me',
        authorName: deps.myName(),
        channel,
        text,
        image
      });
      // Both offices use the same request identity. Participating peers need the
      // updated room protocol; legacy incoming messages are still accepted.
      const action = intent ?? requestIntent(text);
      activate(m, m.id, action);
      await deps.sendToTeammates({
        channel,
        text,
        image,
        authorKind: 'human',
        authorName: deps.myName(),
        requestId: m.id,
        ...(action ? {
          intent: action
        } : {})
      });
      return m;
    },
    receiveRemote(input: {
      memberId?: string;
      memberName: string;
      canPromptAgents: boolean;
    } & ChatWireBody): void {
      const authorName = input.authorKind === 'human' ? input.memberName : `${input.authorName} (${input.memberName})`;
      if (input.authorKind === 'agent') {
        const r = rounds.get(input.channel);
        if (!input.requestId || !r || r.view.id !== input.requestId || now() >= r.expires || r.view.status === 'cancelled') return;
        const key = `${input.requestId}:${input.memberId ?? input.memberName}:${input.authorName}`;
        const prefix = `${input.requestId}:${input.memberId ?? input.memberName}:`;
        if (remoteSeen.has(key) || [...remoteSeen.keys()].filter(k => k.startsWith(prefix)).length >= MAX_ROOM_TURNS) return;
        remoteSeen.set(key, now());
        if (remoteSeen.size > 200) remoteSeen.delete(remoteSeen.keys().next().value!);
        record({
          authorKind: 'agent',
          authorName,
          channel: input.channel,
          text: input.text.slice(0, MAX_AGENT_REPLY_CHARS),
          requestId: input.requestId
        });
        return;
      }
      const m = record({
        authorKind: 'human',
        authorName,
        channel: input.channel,
        text: input.text,
        image: input.image || undefined
      });
      if (input.canPromptAgents) activate(m, input.requestId ?? m.id, input.intent);
    },
    receiveAgent(agentId: string, text: string, conversation?: string): void {
      if(typeof text!=='string')return;
      states();
      const pending = [...rounds.values()].filter(r => r.view.status === 'collecting' && r.view.turns[r.cursor]?.agentId === agentId);
      // No uncorrelated replies: an old queued response must never leak into a new room/topic.
      const r = pending.find(r => `chat-${r.view.id}` === conversation);
      const name = deps.agentName(agentId),
        body = text.trim().slice(0, MAX_AGENT_REPLY_CHARS);
      if (!r || !name || !body || !canHear(tiers()[agentId], r.message.channel)) return;
      r.view.turns[r.cursor].state = 'answered';
      spoke.set(`${r.message.channel}:${agentId}`, (spoke.get(`${r.message.channel}:${agentId}`) ?? 0) + 1);
      record({
        authorKind: 'agent',
        authorName: name,
        agentId,
        channel: r.message.channel,
        text: body,
        requestId: r.view.id
      });
      void deps.sendToTeammates({
        channel: r.message.channel,
        text: body,
        image: '',
        authorKind: 'agent',
        authorName: name,
        requestId: r.view.id
      }).catch(() => undefined);
      r.cursor++;
      pump(r);
    }
  };
}
