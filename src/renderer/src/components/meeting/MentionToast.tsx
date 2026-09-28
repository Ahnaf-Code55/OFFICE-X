import { useEffect, useState } from 'react';

type ChatView = Awaited<ReturnType<typeof window.cth.listChat>>[number];

/** Little pop-up when someone @mentions me in team chat. Click or wait to dismiss. */
export function MentionToast() {
  const [toasts, setToasts] = useState<ChatView[]>([]);
  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  useEffect(() => window.cth.onChatMessage?.((message) => {
    if (!message.mentionsMe) return;
    setToasts((prev) => [...prev, message].slice(-3));
    setTimeout(() => dismiss(message.id), 8000);
  }), []);

  if (!toasts.length) return null;
  return <div style={{ position: 'fixed', right: 16, top: 56, zIndex: 70, display: 'grid', gap: 8, width: 300 }}>
    {toasts.map((m) => <button key={m.id} type="button" onClick={() => dismiss(m.id)} style={{
      textAlign: 'left', cursor: 'pointer', border: 0, padding: '8px 10px', font: 'inherit', fontSize: 13,
      background: 'var(--cth-cream-50)', color: 'var(--cth-ink-900)',
      boxShadow: '0 0 0 2px var(--cth-ink-900), 4px 4px 0 var(--cth-sky)'
    }}>
      <div style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: 'var(--cth-ink-500)' }}>
        <strong style={{ color: 'var(--cth-ink-900)' }}>{m.authorName}</strong> mentioned you · #{m.channel}
      </div>
      <div style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{m.text}</div>
    </button>)}
  </div>;
}
