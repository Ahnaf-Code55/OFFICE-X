import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/store';

type ChatView = Awaited<ReturnType<typeof window.cth.listChat>>[number];
type Channel = ChatView['channel'];
type Tier = Parameters<typeof window.cth.setChatTier>[1];

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'leadership', label: 'Leadership' },
  { key: 'managers', label: 'Managers' },
  { key: 'everyone', label: 'Everyone' }
];
const TIERS: { key: Tier; label: string }[] = [
  { key: 'off', label: 'Not in chat' },
  { key: 'staff', label: 'Employee' },
  { key: 'middle', label: 'Manager' },
  { key: 'leadership', label: 'Leadership' }
];

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

const panel: React.CSSProperties = {
  position: 'fixed', right: 16, bottom: 72, zIndex: 50, width: 'min(380px, calc(100vw - 32px))', height: 'min(520px, 70vh)',
  display: 'flex', flexDirection: 'column', background: '#141a24f2', border: '1px solid #ffffff22', borderRadius: 10,
  color: '#dce8fa', fontSize: 12, boxShadow: '0 8px 30px #0008'
};

export function TeamChat() {
  const agents = useStore((state) => state.agents);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatView[]>([]);
  const [channel, setChannel] = useState<Channel>('everyone');
  const [tiers, setTiers] = useState<Record<string, Tier>>({});
  const [showRanks, setShowRanks] = useState(false);
  const [text, setText] = useState('');
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    void window.cth.listChat().then(setMessages);
    void window.cth.getChatTiers().then(setTiers);
    return window.cth.onChatMessage((message) => {
      setMessages((prev) => [...prev, message].slice(-100));
      if (!openRef.current) setUnread((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    if (open) setUnread(0);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, messages]);

  const attach = async (file: Blob | null | undefined) => {
    if (!file) return;
    try { setImage(await toChatImage(file)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const send = async () => {
    if (!text.trim() && !image) return;
    const result = await window.cth.sendChat(channel, text, image);
    if (result.ok) { setText(''); setImage(''); setError(''); } else setError(result.error ?? 'could not send');
  };

  const setTier = (id: string, tier: Tier) => {
    setTiers((prev) => ({ ...prev, [id]: tier }));
    void window.cth.setChatTier(id, tier);
  };
  const tab = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '6px 0', border: 0, borderBottom: `2px solid ${active ? '#3a6fd8' : 'transparent'}`,
    background: 'none', color: active ? '#dce8fa' : '#8998af', cursor: 'pointer', fontSize: 12
  });

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} aria-label="Open team chat"
      style={{ position: 'fixed', right: 16, bottom: 72, zIndex: 50, padding: '8px 12px', borderRadius: 18, border: '1px solid #ffffff33',
        background: '#1d2635', color: '#dce8fa', cursor: 'pointer', fontSize: 12 }}>
      💬 Team chat{unread ? ` (${unread})` : ''}
    </button>;
  }

  return <section style={panel} aria-label="Team chat">
    <header style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid #ffffff18' }}>
      <strong style={{ flex: 1 }}>Team chat</strong>
      <button type="button" onClick={() => setOpen(false)} aria-label="Close team chat"
        style={{ background: 'none', border: 0, color: '#dce8fa', cursor: 'pointer', fontSize: 14 }}>✕</button>
    </header>
    <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid #ffffff18' }}>
      {CHANNELS.map((c) => <button key={c.key} type="button" role="tab" aria-selected={channel === c.key}
        onClick={() => setChannel(c.key)} style={tab(channel === c.key)}>#{c.label}</button>)}
    </div>
    <div style={{ padding: '4px 10px', borderBottom: '1px solid #ffffff18' }}>
      <button type="button" onClick={() => setShowRanks((v) => !v)} aria-expanded={showRanks}
        style={{ background: 'none', border: 0, padding: 0, color: '#8998af', cursor: 'pointer', fontSize: 11 }}>
        {showRanks ? '▾' : '▸'} AI ranks ({agents.filter((a) => (tiers[a.id] ?? 'off') !== 'off').length} in chat)
      </button>
      {showRanks && <div style={{ display: 'grid', gap: 4, padding: '4px 0' }}>
        {agents.length ? agents.map((agent) => <label key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
          <select value={tiers[agent.id] ?? 'off'} onChange={(e) => setTier(agent.id, e.target.value as Tier)}
            style={{ background: '#0e131b', color: '#dce8fa', border: '1px solid #ffffff33', borderRadius: 4 }}>
            {TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>) : <span style={{ color: '#8998af' }}>no agents yet</span>}
        <span style={{ color: '#8998af', fontSize: 10 }}>Leadership hears every channel, managers hear #Managers and #Everyone, employees hear #Everyone.</span>
      </div>}
    </div>
    <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'grid', gap: 8, alignContent: 'start' }}>
      {messages.filter((m) => m.channel === channel).map((m) => <div key={m.id} style={{ justifySelf: m.authorKind === 'me' ? 'end' : 'start', maxWidth: '85%' }}>
        <div style={{ color: m.authorKind === 'agent' ? '#9fd3ff' : '#8998af', fontSize: 10 }}>{m.authorName}</div>
        <div style={{ background: m.authorKind === 'me' ? '#2a4a7a' : '#232c3b', borderRadius: 8, padding: '6px 8px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {m.text}
          {m.image && <img src={m.image} alt="Shared screenshot" style={{ display: 'block', maxWidth: '100%', marginTop: m.text ? 6 : 0, borderRadius: 4 }} />}
        </div>
      </div>)}
    </div>
    {image && <div style={{ padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
      <img src={image} alt="Screenshot to send" style={{ height: 40, borderRadius: 4 }} />
      <button type="button" onClick={() => setImage('')} style={{ background: 'none', border: 0, color: '#f4a3a3', cursor: 'pointer' }}>remove</button>
    </div>}
    {error && <div role="alert" style={{ padding: '4px 10px', color: '#f4a3a3' }}>{error}</div>}
    <form onSubmit={(e) => { e.preventDefault(); void send(); }} style={{ display: 'flex', gap: 6, padding: 10 }}>
      <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach screenshot"
        style={{ width: 32, borderRadius: 16, border: '1px solid #ffffff33', background: '#1d2635', color: '#dce8fa', cursor: 'pointer' }}>+</button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
        onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ''; }} />
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder={`Message #${channel} (paste screenshots)`}
        onPaste={(e) => { const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/')); if (file) { e.preventDefault(); void attach(file); } }}
        style={{ flex: 1, minWidth: 0, padding: '6px 10px', borderRadius: 16, border: '1px solid #ffffff33', background: '#0e131b', color: '#dce8fa' }} />
      <button type="submit" style={{ padding: '0 12px', borderRadius: 16, border: 0, background: '#3a6fd8', color: '#fff', cursor: 'pointer' }}>Send</button>
    </form>
  </section>;
}
