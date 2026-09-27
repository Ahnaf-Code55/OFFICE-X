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

export interface ChatMessage {
  id: string;
  authorKind: ChatAuthorKind;
  authorName: string;
  /** Local agent id for my own AIs, so the room never echoes a reply back to its author. */
  agentId?: string;
  text: string;
  imagePath?: string;
  ts: number;
}

/** Renderer view: the image is inlined as a data URL. */
export type ChatView = ChatMessage & { image?: string };

export interface ChatDeps {
  dir: string;
  getKv: <T>(key: string) => T | undefined;
  setKv: (key: string, value: unknown) => void;
  myName: () => string;
  agentName: (agentId: string) => string | undefined;
  deliverToAgent: (agentId: string, subject: string, body: string) => void;
  sendToTeammates: (body: { text: string; image: string; authorKind: 'human' | 'agent'; authorName: string }) => Promise<void>;
  emit: (message: ChatView) => void;
}

const LOG_KEY = 'chat:log';
const AGENTS_KEY = 'chat:agents';
const MAX_LOG = 200;
/** AI messages allowed in a row before a human must speak again. */
export const MAX_AI_TURNS = 6;

export function createChat(deps: ChatDeps) {
  let aiTurns = 0;
  const log = (): ChatMessage[] => deps.getKv<ChatMessage[]>(LOG_KEY) ?? [];
  const participants = (): string[] => deps.getKv<string[]>(AGENTS_KEY) ?? [];

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

  function record(input: Omit<ChatMessage, 'id' | 'ts' | 'imagePath'> & { image?: string }): ChatMessage {
    const id = randomBytes(8).toString('hex');
    const { image, ...rest } = input;
    const message: ChatMessage = { ...rest, id, ts: Date.now(), imagePath: image ? saveImage(id, image) : undefined };
    deps.setKv(LOG_KEY, [...log(), message].slice(-MAX_LOG));
    deps.emit(view(message));
    aiTurns = message.authorKind === 'agent' ? aiTurns + 1 : 0;
    if (aiTurns < MAX_AI_TURNS) {
      for (const agentId of participants()) {
        if (agentId !== message.agentId && deps.agentName(agentId)) {
          deps.deliverToAgent(agentId, `Group chat: ${message.authorName}`, agentPrompt(message));
        }
      }
    }
    return message;
  }

  function agentPrompt(latest: ChatMessage): string {
    const recent = log().slice(-12).map((m) => `${m.authorName}: ${m.text}${m.imagePath ? ` [image: ${m.imagePath}]` : ''}`);
    return [
      `New message in the OFFICE-X team group chat from ${latest.authorName}.`,
      '', 'Recent conversation (oldest first):', ...recent, '',
      'Reply only if you have something useful to add. To reply, write ONE message JSON into your outbox with',
      '"to":"chat", "act":"inform", a short "subject", and your reply as "body". Keep it short and conversational.',
      'You may open any [image: path] above to see a screenshot.'
    ].join('\n');
  }

  return {
    list: (): ChatView[] => log().slice(-100).map(view),
    participants,
    setParticipants: (ids: string[]) => deps.setKv(AGENTS_KEY, [...new Set(ids)]),

    /** The local user posts. */
    async post(text: string, image: string): Promise<ChatMessage> {
      const message = record({ authorKind: 'me', authorName: deps.myName(), text, image });
      await deps.sendToTeammates({ text, image, authorKind: 'human', authorName: deps.myName() });
      return message;
    },

    /** A pinned teammate (or one of their AIs) posted. */
    receiveRemote(input: { memberName: string; text: string; image: string; authorKind: 'human' | 'agent'; authorName: string }): void {
      const authorName = input.authorKind === 'human' ? input.memberName : `${input.authorName} (${input.memberName})`;
      record({ authorKind: input.authorKind, authorName, text: input.text, image: input.image || undefined });
    },

    /** One of my local AI agents replied via its outbox. */
    receiveAgent(agentId: string, text: string): void {
      const name = deps.agentName(agentId);
      const body = text.trim().slice(0, 4000);
      if (!name || !body || !participants().includes(agentId)) return;
      record({ authorKind: 'agent', authorName: name, agentId, text: body });
      void deps.sendToTeammates({ text: body, image: '', authorKind: 'agent', authorName: name }).catch(() => undefined);
    }
  };
}
