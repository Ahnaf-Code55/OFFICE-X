import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/store';
import { PixelButton } from '../PixelButton';
import { RoomTabs, RoomControls, RoomParticipants, useOfficeRooms } from './OfficeRooms';
import { isRoomRequestPending } from '../../../../shared/officeRooms';

type ChatView = Awaited<ReturnType<typeof window.cth.listChat>>[number];
type Channel = ChatView['channel'];

/** Must stay under MAX_CHAT_IMAGE_CHARS in src/main/teamActions.ts. */
const MAX_IMAGE_CHARS = 150_000;

/** Shrink a screenshot to a JPEG data URL that fits the encrypted chat envelope. */
async function toChatImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  for (let width = Math.min(bitmap.width, 1600); width >= 200; width = Math.floor(width * 0.75)) {
    canvas.width = width;
    canvas.height = Math.round(bitmap.height * (width / bitmap.width));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.6, 0.45]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= MAX_IMAGE_CHARS) return url;
    }
  }
  throw new Error('image is too large to send');
}

/** Route team-chat prompts into agent queues. Mounted once at App level so AIs
 *  hear the room even while the chat tab is closed. */
export function useChatAgentPrompts(): void {
  useEffect(() => {
    const reconcile = (rooms: Awaited<ReturnType<typeof window.cth.getChatRooms>>) => {
      const s=useStore.getState();
      for(const [agentId,queue] of Object.entries(s.messageQueues)) for(const message of queue){
        const request=message.chatRequest;if(!request)continue;
        if (!isRoomRequestPending(rooms, agentId, request)) s.removeQueuedMessage(agentId,message.id);
      }
    };
    let alive=true;void window.cth.getChatRooms().then(rooms=>{if(alive)reconcile(rooms)});
    const offRooms=window.cth.onChatRooms(reconcile);
    const offPrompts=window.cth.onChatAgentPrompt(({agentId,text,instruction,request})=>useStore.getState().enqueueMessage(agentId,text,{instruction,chatRequest:request}));
    return()=>{alive=false;offRooms();offPrompts()};
  }, []);
}

const field: React.CSSProperties = {
  background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', border: '1px solid var(--cth-ink-300)',
  borderRadius: 0, fontFamily: 'var(--cth-font-ui)', fontSize: 13
};

/** Command Center tab: #Leadership / #Managers / #Everyone with teammates and AIs. */
export function TeamChat() {
  const agents = useStore((state) => state.agents);
  const [messages, setMessages] = useState<ChatView[]>([]);
  const [channel, setChannel] = useState<Channel>('everyone');
  const office = useOfficeRooms();
  const participants = office.participants(channel);
  const room = office.rooms.find(r=>r.channel===channel);
  const [text, setText] = useState('');
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void window.cth.listChat().then(setMessages);
    return window.cth.onChatMessage((message) => setMessages((prev) => [...prev, message].slice(-100)));
  }, []);

  // Follow new messages only while I'm at the bottom; scrolling up to read stays put.
  const atBottom = useRef(true);
  useEffect(() => { atBottom.current = true; }, [channel]);
  useEffect(() => { if (atBottom.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, channel]);

  const attach = async (file: Blob | null | undefined) => {
    if (!file) return;
    try { setImage(await toChatImage(file)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const send = async () => {
    if (!text.trim() && !image) return;
    const result = await window.cth.sendChat(channel, text, image);
    if (result.ok) { setText(''); setImage(''); setError(''); } else setError(result.error ?? 'could not send');
  };

  const byName = new Map(agents.map((a) => [a.name, a]));
  // @mention picker: my agents plus teammates' agents, filtered by what follows the '@'.
  const partial = /@([\w-]*)$/.exec(text)?.[1];
  const mentionable = [...new Set(participants.map(p=>p.name))];
  const suggestions = partial === undefined ? [] : mentionable.filter((n) => n.toLowerCase().startsWith(partial.toLowerCase())).slice(0, 6);
  const pickMention = (name: string) => setText(text.replace(/@[\w-]*$/, `@${name} `));

  return <section aria-label="Team chat" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-cream-50)', color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)', fontSize: 13 }}>
    <RoomTabs channel={channel} onChange={setChannel} />
    <RoomControls channel={channel} state={room} topic={text} image={image} onPosted={intent=>{if(intent==='report'){setText('');setImage('')}}} onError={setError} />
    <RoomParticipants people={participants} />
    <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }} style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'grid', gap: 10, alignContent: 'start' }}>
      {messages.filter((m) => m.channel === channel).map((m) => {
        const agent = m.authorKind === 'agent' ? byName.get(m.authorName) : undefined;
        return <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ width: 24, height: 24, flexShrink: 0, background: `var(--cth-${agent?.accent ?? (m.authorKind === 'me' ? 'sky' : 'mint')}-light)`, boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', display: 'grid', placeItems: 'center', fontFamily: 'var(--cth-font-mono)', fontSize: 11 }}>
            {m.authorName.slice(0, 1).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)' }}>
              <strong style={{ color: 'var(--cth-ink-900)' }}>{m.authorKind === 'me' ? 'You' : m.authorName}</strong>
              {m.authorKind === 'agent' && ' · AI'} · {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text.split(/(@[\w-]+)/).map((part, i) =>
              i % 2 ? <strong key={i} style={{ color: 'var(--cth-sky)', background: 'var(--cth-sky-light)' }}>{part}</strong> : part)}</div>
            {m.image && <img src={m.image} alt="Shared screenshot" style={{ display: 'block', maxWidth: '100%', marginTop: 4, boxShadow: '0 0 0 1px var(--cth-ink-300)' }} />}
          </div>
        </div>;
      })}
    </div>
    {image && <div style={{ padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
      <img src={image} alt="Screenshot to send" style={{ height: 40 }} />
      <button type="button" onClick={() => setImage('')} style={{ background: 'none', border: 0, color: 'var(--cth-coral)', cursor: 'pointer' }}>remove</button>
    </div>}
    {suggestions.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 8px' }}>
      {suggestions.map((name) => <PixelButton key={name} size="sm" variant="secondary" onClick={() => pickMention(name)}>@{name}</PixelButton>)}
    </div>}
    {error && <div role="alert" style={{ padding: '4px 10px', color: 'var(--cth-coral)' }}>{error}</div>}
    <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '2px solid var(--cth-ink-100)' }}>
      <PixelButton variant="secondary" size="sm" onClick={() => fileRef.current?.click()} title="Attach screenshot">+</PixelButton>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
        onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ''; }} />
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder={`Message #${channel}`}
        onKeyDown={(e) => {
          if ((e.key === 'Tab' || e.key === 'Enter') && suggestions.length) { e.preventDefault(); pickMention(suggestions[0]); }
          else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
        }}
        onPaste={(e) => { const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/')); if (file) { e.preventDefault(); void attach(file); } }}
        style={{ ...field, flex: 1, minWidth: 0, padding: '6px 8px' }} />
      <PixelButton size="sm" onClick={() => void send()}>send</PixelButton>
    </div>
  </section>;
}
