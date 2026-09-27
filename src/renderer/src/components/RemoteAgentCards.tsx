import { useEffect, useState } from 'react';
import { AgentCard } from './AgentCard';
import { PixelButton } from './PixelButton';
import { SharedTerminalOutput } from './triggers/SharedTerminalOutput';
import { getRemotePresence, subscribeRemotePresence, type RemotePresencePeer } from '@/scene/office/remotePresence';

/** Teammates' agents in the strip beside mine. Click one to prompt it; its terminal
 *  shows when the teammate granted full control. Prompts go through the same
 *  signed team channel as Settings → Shared Office, so their access level still rules. */
export function RemoteAgentCards() {
  const [peers, setPeers] = useState<RemotePresencePeer[]>(getRemotePresence);
  const [open, setOpen] = useState<{ memberId: string; agentId: string; name: string } | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => subscribeRemotePresence(() => setPeers(getRemotePresence())), []);

  const send = async () => {
    if (!open || !text.trim()) return;
    const result = await window.cth.sendOrgAgentPrompt(open.memberId, open.agentId, text.trim());
    if (result.ok) { setText(''); setNote('sent'); } else setNote(result.error ?? 'could not send');
  };

  return <>
    {peers.flatMap((peer) => peer.agents.map((agent) => (
      <div key={`${peer.id}:${agent.id}`} style={{ flexShrink: 0 }}>
        <AgentCard
          name={agent.name}
          character={agent.character}
          accent="mint"
          status={agent.status === 'offline' ? 'ghost' : agent.status}
          project={peer.name}
          selected={open?.memberId === peer.id && open.agentId === agent.id}
          onClick={() => { setNote(''); setOpen(open?.agentId === agent.id && open.memberId === peer.id ? null : { memberId: peer.id, agentId: agent.id, name: `${agent.name} · ${peer.name}` }); }}
        />
      </div>
    )))}
    {open && <div role="dialog" aria-label={`Prompt ${open.name}`} style={{
      position: 'fixed', right: 16, bottom: 120, width: 420, zIndex: 50, display: 'grid', gap: 6, padding: 10,
      background: 'var(--cth-cream-50)', color: 'var(--cth-ink-900)', boxShadow: '0 0 0 2px var(--cth-ink-900), 4px 4px 0 var(--cth-ink-900)'
    }}>
      <strong style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 12 }}>{open.name}</strong>
      <SharedTerminalOutput memberId={open.memberId} agentId={open.agentId} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={8000} rows={3} placeholder="Tell this agent what to do"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--cth-ink-500)' }}>{note}</span>
        <PixelButton size="sm" variant="ghost" onClick={() => setOpen(null)}>close</PixelButton>
        <PixelButton size="sm" onClick={() => { void send(); }} disabled={!text.trim()}>send</PixelButton>
      </div>
    </div>}
  </>;
}
