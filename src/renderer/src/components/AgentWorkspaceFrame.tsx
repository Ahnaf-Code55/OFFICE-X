import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, type Agent } from '@/store/store';
import { toggleAppTheme, useAppTheme } from '@/design/theme';
import { Icon, type IconName } from './Icon';
import { SpritePortrait } from './SpritePortrait';
import { PixelBadge } from './PixelBadge';
import { EditAgentModal } from './EditAgentModal';
import { notifyThemeChangeAll } from './terminalPool';
import { useRestoreTeam } from '@/hooks/useRestoreTeam';
import type { HarnessConfig } from '@/store/config';
import './agentWorkspace.css';

export interface WorkspaceDestination {
  key: string;
  label: string;
  icon: IconName;
  group: 'agent' | 'office' | 'more';
}

/** Shared chrome only: destinations keep their existing data and actions. */
export function AgentWorkspaceFrame({ agent, destinations, current, onNavigate, children, fullscreen = false }:
  { agent: Agent; destinations: WorkspaceDestination[]; current: string; onNavigate: (key: string) => void; children: ReactNode; fullscreen?: boolean }) {
  const { t } = useTranslation();
  const agents = useStore(s => s.agents);
  const select = useStore(s => s.select);
  const selectAgent = (id: string) => {
    select(id);
    if (fullscreen) useStore.getState().refocusFullscreen(id);
  };
  const enqueueMessage = useStore(s => s.enqueueMessage);
  const theme = useAppTheme();
  const [editOpen, setEditOpen] = useState(false);
  const [config, setConfig] = useState<HarnessConfig | null>(null);
  const { restoring, restoreTeam, restoreNote } = useRestoreTeam(config);
  const restorable = useStore(s => s.restorableAgents);
  useEffect(() => {
    let alive = true;
    void window.cth.getConfig().then(c => { if (alive) setConfig(c); }).catch(() => {});
    const off = window.cth.onConfigChanged(setConfig);
    return () => { alive = false; off(); };
  }, []);
  const role = agent.isGod ? 'Office coordinator' : agent.description.split(':')[0].replace(/ owner$/, '');
  const freshCommand = agent.provider === 'codex' ? '/new' : (agent.provider ?? 'claude') === 'claude' ? '/clear' : null;
  const newChat = () => {
    if (!freshCommand || !agent.ptyId) return;
    if (!confirm(`Start a new conversation with ${agent.name}? This queues ${freshCommand} after any pending messages. Your unsent draft stays here.`)) return;
    enqueueMessage(agent.id, freshCommand);
    onNavigate('conversation');
  };
  const changeTheme = () => {
    const next = toggleAppTheme();
    void window.cth.updateConfig({ terminalTheme: next });
    notifyThemeChangeAll(next);
  };

  return <section className="agent-workspace" aria-label={`${agent.name} workspace`}>
    <aside className="aw-sidebar" aria-label="Agent features">
      <div className="aw-identity">
        <div className="aw-portrait"><SpritePortrait character={agent.character} scale={1} /></div>
        <div><strong title={agent.name}>{agent.name}</strong><span title={role}>{role}</span></div>
      </div>
      <button className="aw-new-chat" onClick={newChat} disabled={!freshCommand || !agent.ptyId}
        title={freshCommand ? 'Start a fresh CLI conversation through the normal message queue' : 'This engine starts fresh conversations in its terminal'}>
        <Icon name="plus" /> New chat
      </button>
      <nav className="aw-navigation">
        {(['agent', 'office', 'more'] as const).map(group => <div className="aw-nav-group" key={group}>
          {group === 'more' ? <details open={destinations.some(d => d.group === 'more' && d.key === current)}>
            <summary>More tools</summary>
            {destinations.filter(d => d.group === group).map(d => <button key={d.key} aria-current={current === d.key ? 'page' : undefined}
              onClick={() => onNavigate(d.key)}><Icon name={d.icon} /><span>{d.label}</span></button>)}
          </details> : <>
            <h2>{group === 'agent' ? 'Agent' : 'Office'}</h2>
            {destinations.filter(d => d.group === group).map(d => <button key={d.key} aria-current={current === d.key ? 'page' : undefined}
              onClick={() => onNavigate(d.key)}><Icon name={d.icon} /><span>{d.label}</span></button>)}
          </>}
        </div>)}
      </nav>
      <label className="aw-agent-select">Selected agent
        <select aria-label="Selected agent" value={agent.id} onChange={e => selectAgent(e.target.value)}>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
    </aside>
    <div className="aw-main">
      <header className="aw-header">
        <div className="aw-header-identity"><SpritePortrait character={agent.character} scale={0.75} />
          <div><strong>{agent.name}</strong><span title={role}>{role}</span></div>
        </div>
        <span className="aw-status" data-status={agent.status}><PixelBadge status={agent.status} /></span>
        <div className="aw-header-actions">
          <button onClick={() => onNavigate(current === 'terminal' ? 'conversation' : 'terminal')}>
            <Icon name="terminal" />{current === 'terminal' ? 'Open chat' : 'Open terminal'}
          </button>
          <button className="aw-icon-button" onClick={changeTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title="Switch theme">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button className="aw-icon-button" onClick={() => setEditOpen(true)} aria-label={`Edit ${agent.name}`} title="Edit agent, model and goals"><Icon name="gear" /></button>
        </div>
      </header>
      {agent.status === 'blocked' && <div className="aw-permission" role="status">
        <Icon name="bell" /><div><strong>{agent.action?.includes('permission') ? 'Permission required in terminal' : agent.blockReason?.summary || 'Needs your decision'}</strong>
          <span>{agent.blockReason?.detail || 'Review the request in Terminal.'}</span></div>
        <button onClick={() => onNavigate('terminal')}>Review</button>
      </div>}
      <div className="aw-content">{children}</div>
      <div className="aw-agent-dock" aria-label="Office agents">
        {agents.map(a => <button key={a.id} onClick={() => selectAgent(a.id)} aria-pressed={a.id === agent.id} title={`${a.name} · ${a.status}`}>
          <SpritePortrait character={a.character} scale={0.55} /><span>{a.name}</span>
        </button>)}
        <button onClick={() => useStore.getState().setAddAgentOpen(true)} aria-label="Add agent" title="Add agent"><Icon name="plus" /></button>
        {restorable.length > 0 && <button disabled={restoring} onClick={() => { void restoreTeam(); }} title={restoreNote || 'Restore the previous team'}>
          {restoring ? 'Restoring…' : `Restore ${restorable.length}`}
        </button>}
      </div>
      <div className="aw-utility" aria-label="Agent utilities">
        <button onClick={() => useStore.getState().setIdeOpen(true, agent.id)}><Icon name="code" />{t('agentDetail.ide')}</button>
        <button onClick={() => useStore.getState().setFullscreen(fullscreen ? null : agent.id)} title="Focus mode"><Icon name="expand" /></button>
        {restoreNote && <span role="status">{restoreNote}</span>}
      </div>
      {editOpen && <EditAgentModal agent={agent} onClose={() => setEditOpen(false)} />}
    </div>
  </section>;
}
