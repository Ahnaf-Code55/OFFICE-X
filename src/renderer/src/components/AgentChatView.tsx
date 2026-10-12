import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Agent } from '@/store/store';
import { SpritePortrait } from './SpritePortrait';

type Turn = NonNullable<Awaited<ReturnType<typeof window.cth.agentChat>>>[number];
type Row = Turn | { role: 'tools'; id: string; items: Turn[] };

/** Per-engine look, on the office's cream palette: Claude Code app vs Codex app. */
const THEMES = {
  claude: {
    font: 'var(--cth-font-ui)', userBubble: { background: 'var(--cth-cream-200)', border: '1px solid var(--cth-cream-300)', borderRadius: 10 },
    busy: <><span style={{ color: '#d97757' }}>✻</span> Working…</>, ran: (n: number) => `Ran ${n} command${n > 1 ? 's' : ''}`
  },
  codex: {
    font: 'ui-sans-serif, system-ui, sans-serif', userBubble: { background: 'var(--cth-paper-200)', border: 0, borderRadius: 18 },
    busy: <><span style={{ opacity: 0.6 }}>●</span> Thinking</>, ran: (n: number) => `Ran ${n} command${n > 1 ? 's' : ''}`
  }
} as const;
export type ChatTheme = keyof typeof THEMES;

/** Fold consecutive tool calls into one collapsible "Ran N commands" row. */
function group(turns: Turn[]): Row[] {
  const rows: Row[] = [];
  for (const t of turns) {
    const last = rows.at(-1);
    if (t.role !== 'tool') rows.push(t);
    else if (last?.role === 'tools') last.items.push(t);
    else rows.push({ role: 'tools', id: t.id, items: [t] });
  }
  return rows;
}

function ToolGroup({ items, ran }: { items: Turn[]; ran: (n: number) => string }) {
  const [open, setOpen] = useState(false);
  const label = items.every((i) => i.text.startsWith('Bash')) ? ran(items.length) : `Used ${items.length} tool${items.length > 1 ? 's' : ''}`;
  return <div>
    <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
      style={{ background: 'none', border: 0, padding: 0, color: 'var(--cth-ink-500)', cursor: 'pointer', font: 'inherit' }}>
      {label} {open ? '⌄' : '›'}
    </button>
    {open && <div style={{ marginTop: 4, paddingLeft: 10, borderLeft: '2px solid var(--cth-cream-300)', display: 'grid', gap: 2 }}>
      {items.map((i) => <div key={i.id} style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.text}</div>)}
    </div>}
  </div>;
}

/** App-style view of an agent's conversation, read from its session transcript.
 *  The real TUI keeps running underneath; this only renders it. */
export function AgentChatView({ agentId, busy, theme, agent, onOpenTerminal }: { agentId: string; busy: boolean; theme: ChatTheme; agent?: Agent; onOpenTerminal?: () => void }) {
  const look = THEMES[theme];
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    // ponytail: 1.5 s poll of the transcript tail; push from the hook server if it ever lags.
    const load = () => void window.cth.agentChat(agentId).then((t) => {
      if (alive) { setTurns(t); setError(false); }
    }).catch(() => { if (alive) setError(true); });
    load();
    const timer = setInterval(load, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [agentId]);

  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const shell: React.CSSProperties = { flex: 1, minHeight: 0, background: 'var(--cth-cream-50)', color: 'var(--cth-ink-900)', fontFamily: look.font, fontSize: 14, lineHeight: 1.55 };

  if (!turns?.length) {
    return <div className="aw-chat-empty" style={shell}>
      {agent && <SpritePortrait character={agent.character} scale={1.3} />}
      <h2>{error ? 'Conversation unavailable' : 'What should we work on?'}</h2>
      <p>{error ? 'Open Terminal to view this session while the conversation reconnects.' : agent?.isGod
        ? 'Coordinate tasks across your OQVIAN team.'
        : agent ? `${agent.name}’s conversation will appear here.` : 'Start a conversation with this agent.'}</p>
      {agent && agent.provider !== 'codex' && agent.provider !== 'claude' && <p>This engine’s live output is available in Terminal.</p>}
      {error && onOpenTerminal && <button onClick={onOpenTerminal}>Open terminal</button>}
    </div>;
  }

  return <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
    style={{ ...shell, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
    {group(turns).map((r) => r.role === 'tools'
      ? <ToolGroup key={r.id} items={r.items} ran={look.ran} />
      : r.role === 'user'
        ? <div key={r.id} style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: '8px 14px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...look.userBubble }}>{r.text}</div>
        : <div key={r.id} className="agent-chat-md" style={{ overflowWrap: 'anywhere' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.text}</ReactMarkdown></div>)}
    {busy && <div style={{ color: 'var(--cth-ink-500)', fontSize: 12 }}>{look.busy}</div>}
  </div>;
}
