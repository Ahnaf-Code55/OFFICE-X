import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Turn = NonNullable<Awaited<ReturnType<typeof window.cth.agentChat>>>[number];
type Row = Turn | { role: 'tools'; id: string; items: Turn[] };

const INK = '#e8e6e3';
const MUTED = '#9a9893';

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

function ToolGroup({ items }: { items: Turn[] }) {
  const [open, setOpen] = useState(false);
  const allBash = items.every((i) => i.text.startsWith('Bash'));
  const label = allBash ? `Ran ${items.length} command${items.length > 1 ? 's' : ''}` : `Used ${items.length} tool${items.length > 1 ? 's' : ''}`;
  return <div>
    <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
      style={{ background: 'none', border: 0, padding: 0, color: MUTED, cursor: 'pointer', font: 'inherit' }}>
      {label} {open ? '⌄' : '›'}
    </button>
    {open && <div style={{ marginTop: 4, paddingLeft: 10, borderLeft: '1px solid #3a3a38', display: 'grid', gap: 2 }}>
      {items.map((i) => <div key={i.id} style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.text}</div>)}
    </div>}
  </div>;
}

/** Claude-Code-app-style view of an agent's conversation, read from its session
 *  transcript. The real TUI keeps running underneath; this only renders it. */
export function AgentChatView({ agentId, busy }: { agentId: string; busy: boolean }) {
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    let alive = true;
    // ponytail: 1.5 s poll of the transcript tail; push from the hook server if it ever lags.
    const load = () => void window.cth.agentChat(agentId).then((t) => { if (alive) setTurns(t); });
    load();
    const timer = setInterval(load, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [agentId]);

  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const shell: React.CSSProperties = { flex: 1, minHeight: 0, background: '#1f1f1e', color: INK, fontFamily: 'system-ui, sans-serif', fontSize: 14, lineHeight: 1.55 };

  if (!turns) {
    return <div style={{ ...shell, display: 'grid', placeItems: 'center', color: MUTED, fontSize: 12, padding: 16, textAlign: 'center' }}>
      Chat view appears once this Claude agent has run a turn. Other engines: use Terminal.
    </div>;
  }

  return <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
    style={{ ...shell, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
    {group(turns).map((r) => r.role === 'tools'
      ? <ToolGroup key={r.id} items={r.items} />
      : r.role === 'user'
        ? <div key={r.id} style={{ alignSelf: 'flex-end', maxWidth: '85%', background: '#2c2c2a', border: '1px solid #3a3a38', borderRadius: 10, padding: '8px 12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.text}</div>
        : <div key={r.id} className="agent-chat-md" style={{ overflowWrap: 'anywhere' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.text}</ReactMarkdown></div>)}
    {busy && <div style={{ color: MUTED, fontSize: 12 }}><span style={{ color: '#d97757' }}>✻</span> Working…</div>}
  </div>;
}
