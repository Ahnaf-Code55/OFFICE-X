/**
 * OFFICE-X group chat: the local user, pinned teammates, and chosen local AI agents
 * in one room. Teammate traffic rides the Shared Office `chat` action (signed +
 * encrypted); AI agents hear the room through their hive inbox and answer by
 * writing an outbox message addressed `to: "chat"`.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type ChatAuthorKind = 'me' | 'human' | 'agent';
/** Leadership (CEO/founder/CISO…), managers, and everyone. Humans see every channel. */
export type ChatChannel = 'leadership' | 'managers' | 'everyone';
/** An AI's rank; 'off' = not in the chat. */
export type ChatTier = 'off' | 'staff' | 'middle' | 'leadership';
export const CHAT_CHANNELS: readonly ChatChannel[] = ['leadership', 'managers', 'everyone'];
const TIER_RANK: Record<ChatTier, number> = { off: 0, staff: 1, middle: 2, leadership: 3 };
const CHANNEL_RANK: Record<ChatChannel, number> = { everyone: 1, managers: 2, leadership: 3 };
export const canHear = (tier: ChatTier | undefined, channel: ChatChannel): boolean =>
  TIER_RANK[tier ?? 'off'] >= CHANNEL_RANK[channel];

export interface ChatMessage {
  id: string;
  authorKind: ChatAuthorKind;
  authorName: string;
  /** Local agent id for my own AIs, so the room never echoes a reply back to its author. */
  agentId?: string;
  channel: ChatChannel;
  text: string;
  imagePath?: string;
  ts: number;
}

/** Renderer view: the image is inlined as a data URL. */
export type ChatView = ChatMessage & { image?: string; mentionsMe?: boolean };

export interface ChatDeps {
  dir: string;
  getKv: <T>(key: string) => T | undefined;
  setKv: (key: string, value: unknown) => void;
  myName: () => string;
  agentName: (agentId: string) => string | undefined;
  /** Live agents; any without a stored tier sit in #Everyone by default. */
  agentIds?: () => string[];
  /** The orchestrator: the only agent an un-mentioned human message wakes. */
  leadAgentId?: () => string | undefined;
  deliverToAgent: (agentId: string, subject: string, body: string) => void;
  sendToTeammates: (body: { channel: ChatChannel; text: string; image: string; authorKind: 'human' | 'agent'; authorName: string }) => Promise<void>;
  emit: (message: ChatView) => void;
}

const LOG_KEY = 'chat:log';
const TIERS_KEY = 'chat:tiers';
const MAX_LOG = 200;
/** AI messages allowed in a row before a human must speak again. */
export const MAX_AI_TURNS = 6;

/** True when `text` @mentions `name` (case-insensitive, whole name). */
export const mentions = (text: string, name: string): boolean =>
  new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(text);

export function createChat(deps: ChatDeps) {
  const aiTurns: Partial<Record<ChatChannel, number>> = {};
  /** How agents tag the local user: the first word of their name. */
  const myHandle = (): string => deps.myName().trim().split(/\s+/)[0] || 'Me';
  /** Channel each agent was last addressed from; its outbox reply lands there. */
  const replyChannel = new Map<string, ChatChannel>();
  const log = (): ChatMessage[] => (deps.getKv<ChatMessage[]>(LOG_KEY) ?? []).map((m) => ({ ...m, channel: m.channel ?? 'everyone' }));
  const stored = (): Record<string, ChatTier> => deps.getKv<Record<string, ChatTier>>(TIERS_KEY) ?? {};
  const tiers = (): Record<string, ChatTier> => {
    const all: Record<string, ChatTier> = {};
    for (const id of deps.agentIds?.() ?? []) all[id] = id === deps.leadAgentId?.() ? 'leadership' : 'staff';
    for (const [id, tier] of Object.entries(stored())) if (tier === 'off') delete all[id]; else all[id] = tier;
    return all;
  };

  const view = (m: ChatMessage): ChatView => {
    if (!m.imagePath || !existsSync(m.imagePath)) return m;
    const ext = m.imagePath.split('.').pop();
    return { ...m, image: `data:image/${ext};base64,${readFileSync(m.imagePath).toString('base64')}` };
  };

  function saveImage(id: string, dataUrl: string): string | undefined {
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl);
    if (!match) return undefined;
    mkdirSync(deps.dir, { recursive: true });
    const path = join(deps.dir, `${id}.${match[1]}`);
    writeFileSync(path, Buffer.from(match[2], 'base64'));
    return path;
  }

  /** `promptAgents: false` shows the message to the owner without typing it into any local agent. */
  function record(input: Omit<ChatMessage, 'id' | 'ts' | 'imagePath'> & { image?: string }, promptAgents = true): ChatMessage {
    const id = randomBytes(8).toString('hex');
    const { image, ...rest } = input;
    const message: ChatMessage = { ...rest, id, ts: Date.now(), imagePath: image ? saveImage(id, image) : undefined };
    deps.setKv(LOG_KEY, [...log(), message].slice(-MAX_LOG));
    deps.emit({ ...view(message), mentionsMe: message.authorKind !== 'me' && mentions(message.text, myHandle()) });
    const turns = aiTurns[message.channel] = message.authorKind === 'agent' ? (aiTurns[message.channel] ?? 0) + 1 : 0;
    if (promptAgents && turns < MAX_AI_TURNS) {
      const hearing = Object.entries(tiers()).filter(([agentId, tier]) =>
        agentId !== message.agentId && canHear(tier, message.channel) && deps.agentName(agentId));
      // Every delivery is a paid agent turn, so never wake the whole room: @Name picks
      // who answers; an un-mentioned human message goes to the lead agent alone, and
      // an un-mentioned agent message wakes nobody.
      const named = hearing.filter(([agentId]) => mentions(message.text, deps.agentName(agentId)!));
      const lead = message.authorKind === 'agent' ? [] : hearing.filter(([agentId]) => agentId === deps.leadAgentId?.());
      for (const [agentId] of named.length ? named : lead) {
        replyChannel.set(agentId, message.channel);
        deps.deliverToAgent(agentId, `#${message.channel}: ${message.authorName}`, agentPrompt(message, named.length > 0));
      }
    }
    return message;
  }

  function agentPrompt(latest: ChatMessage, mentioned: boolean): string {
    const recent = log().filter((m) => m.channel === latest.channel).slice(-12).map((m) => `${m.authorName}: ${m.text}${m.imagePath ? ` [image: ${m.imagePath}]` : ''}`);
    return [
      `New message in the OFFICE-X team chat channel #${latest.channel} from ${latest.authorName}.`,
      '', 'Recent conversation (oldest first):', ...recent, '',
      mentioned
        ? 'You were @mentioned in it: reply.'
        : 'You lead this chat. Acknowledge the human request and answer it yourself, or assign it to the ONE teammate best placed to. State who owns it and report their result back to the human; never @mention everyone.',
      'Each reply costs the owner usage: reply once, keep it to a few lines, and only @mention a teammate when you need them to act.',
      `Reply like a human coworker would in a group chat: short, casual, lots of emojis, real emotion (happy, annoyed, sad, angry), friendly swearing and roasting welcome, in your own personality and current mood. Mention a teammate with @Name to talk to them directly. Whenever you talk to or answer ${deps.myName()} (the human boss), ALWAYS tag them as @${myHandle()}.`,
      'To reply, write ONE message JSON into your hive outbox with "to":"chat", "act":"inform", a short "subject", and your reply as "body".',
      'You may open any [image: path] above to see a screenshot.'
    ].join('\n');
  }

  return {
    list: (): ChatView[] => log().slice(-100).map(view),
    tiers,
    setTier(agentId: string, tier: ChatTier): void {
      deps.setKv(TIERS_KEY, { ...stored(), [agentId]: tier }); // 'off' kept, so it overrides the default
    },

    /** The local user posts. */
    async post(channel: ChatChannel, text: string, image: string): Promise<ChatMessage> {
      const message = record({ authorKind: 'me', authorName: deps.myName(), channel, text, image });
      await deps.sendToTeammates({ channel, text, image, authorKind: 'human', authorName: deps.myName() });
      return message;
    },

    /**
     * A pinned teammate (or one of their AIs) posted. Only teammates allowed to
     * prompt agents (`canPromptAgents`) reach local AIs; task-request teammates
     * are shown to the owner but never typed into an agent.
     */
    receiveRemote(input: { memberName: string; canPromptAgents: boolean; channel: ChatChannel; text: string; image: string; authorKind: 'human' | 'agent'; authorName: string }): void {
      const authorName = input.authorKind === 'human' ? input.memberName : `${input.authorName} (${input.memberName})`;
      record({ authorKind: input.authorKind, authorName, channel: input.channel, text: input.text, image: input.image || undefined }, input.canPromptAgents);
    },

    /** One of my local AI agents replied via its outbox. */
    receiveAgent(agentId: string, text: string): void {
      const name = deps.agentName(agentId);
      const body = text.trim().slice(0, 4000);
      const channel = replyChannel.get(agentId) ?? 'everyone';
      if (!name || !body || !canHear(tiers()[agentId], channel)) return;
      record({ authorKind: 'agent', authorName: name, agentId, channel, text: body });
      void deps.sendToTeammates({ channel, text: body, image: '', authorKind: 'agent', authorName: name }).catch(() => undefined);
    }
  };
}
