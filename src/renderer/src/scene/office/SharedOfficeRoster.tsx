import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store/store';
import { getRemotePresence, subscribeRemotePresence, type RemotePresenceAgent, type RemotePresencePeer } from './remotePresence';

function localStatus(status: string): RemotePresenceAgent['status'] {
  if (status === 'working' || status === 'thinking' || status === 'compacting' || status === 'looping') return 'working';
  if (status === 'waiting' || status === 'blocked') return 'waiting';
  return 'idle';
}

type StatusLabels = Record<RemotePresenceAgent['status'], string>;

function StatusDot({ status, labels }: { status: RemotePresenceAgent['status']; labels: StatusLabels }) {
  const color = status === 'working' ? '#7de3aa' : status === 'waiting' ? '#f4c96b' : '#9aa9bf';
  return <span role="img" aria-label={labels[status]} style={{
    display: 'inline-block', width: 7, height: 7, flex: '0 0 7px', borderRadius: '50%',
    background: color, boxShadow: `0 0 5px ${color}66`
  }} />;
}

function Section({ title, agents, statusLabels, empty }: {
  title: string;
  agents: Array<{ id: string; name: string; status: RemotePresenceAgent['status'] }>;
  statusLabels: StatusLabels;
  empty?: string;
}) {
  return <section style={{ padding: '8px 9px 7px', borderTop: '1px solid #ffffff18' }}>
    <h3 style={{ margin: '0 0 5px', color: '#dce8fa', fontSize: 11, fontWeight: 700, letterSpacing: '.04em' }}>{title}</h3>
    {agents.length ? <ul style={{ display: 'grid', gap: 4, listStyle: 'none', padding: 0, margin: 0 }}>
      {agents.map((agent) => <li key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <StatusDot status={agent.status} labels={statusLabels} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#bdc9dc', fontSize: 11 }}>{agent.name}</span>
      </li>)}
    </ul> : <p style={{ margin: 0, color: '#8998af', fontSize: 10 }}>{empty}</p>}
  </section>;
}

/** A view-only set of teammate sections. Control actions remain in Shared Office settings. */
export function SharedOfficeRoster() {
  const { t } = useTranslation();
  const localAgents = useStore((state) => state.agents);
  const [peers, setPeers] = useState<RemotePresencePeer[]>(getRemotePresence);
  const [expanded, setExpanded] = useState(false);
  const statusLabels: StatusLabels = {
    idle: t('office.sharedOffice.status.idle'),
    working: t('office.sharedOffice.status.working'),
    waiting: t('office.sharedOffice.status.waiting'),
    offline: t('office.sharedOffice.status.offline')
  };

  useEffect(() => {
    const sync = () => setPeers(getRemotePresence());
    sync();
    const unsubscribe = subscribeRemotePresence(sync);
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    if (peers.length > 0) setExpanded(true);
  }, [peers.length]);

  const remoteAgentCount = peers.reduce((total, peer) => total + peer.agents.length, 0);
  const localRows = localAgents.slice(0, 32).map((agent) => ({
    id: agent.id,
    name: agent.name,
    status: localStatus(agent.status)
  }));

  return <aside aria-label={t('office.sharedOffice.title')} style={{
    position: 'absolute', zIndex: 20, top: 10, right: 10, width: 'min(238px, calc(100% - 20px))',
    maxHeight: 'min(64%, 440px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', color: '#f2f5fb',
    border: '1px solid #91a8c466', borderRadius: 3, background: '#101a29ee',
    boxShadow: '0 4px 18px #0008', fontFamily: 'monospace', pointerEvents: 'auto'
  }}>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} style={{
      display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 34, padding: '7px 9px',
      border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit'
    }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: remoteAgentCount ? '#7de3aa' : '#718097' }} />
      <span style={{ flex: 1, fontSize: 10, fontWeight: 700, letterSpacing: '.09em' }}>{t('office.sharedOffice.title')}</span>
      <span style={{ color: '#9fb0c8', fontSize: 10 }}>{t('office.sharedOffice.count', { count: peers.length })}</span>
      <span aria-hidden="true" style={{ color: '#9fb0c8', fontSize: 11 }}>{expanded ? '−' : '+'}</span>
    </button>
    {expanded && <div style={{ minHeight: 0, flex: '1 1 auto', overflowY: 'auto' }}>
      <Section title={t('office.sharedOffice.yourSection')} agents={localRows} statusLabels={statusLabels} empty={t('office.sharedOffice.noAgents')} />
      {peers.map((peer) => <Section key={peer.id} title={t('office.sharedOffice.teammateSection', { name: peer.name })}
        agents={peer.agents.map((agent) => ({ id: agent.id, name: agent.name, status: agent.status }))}
        statusLabels={statusLabels}
        empty={t('office.sharedOffice.noAgents')} />)}
      {peers.length === 0 && <p style={{ margin: '0 9px 9px', color: '#a9b6c9', fontSize: 10, lineHeight: 1.5 }}>
        {t('office.sharedOffice.inviteHint')}
      </p>}
    </div>}
  </aside>;
}
