import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTeamMembers, type AgentOrganization, type TeamMember, type TeamRole, type TeamSide } from '@shared/agentTeams';
import { AGENT_ROLE_SECTIONS, buildAgentRoleRows, readRoleDockPreferences, type RoleDockPreferences } from '@shared/agentRoleSections';
import { useStore, type Agent } from '@/store/store';
import { getRemotePresence, subscribeRemotePresence, publishRemotePresence } from '@/scene/office/remotePresence';
import { Icon } from './Icon';
import { SpritePortrait } from './SpritePortrait';
import './agentTeamDock.css';

const SearchIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" /><path d="m10 10 4 4" stroke="currentColor" /></svg>;
const sideLabels: Record<TeamSide, string> = { turjo: 'Turjo’s office', ahnaf: 'Ahnaf’s office', unassigned: 'Other agents' };
const statusLabel = (m: TeamMember) => m.status === 'blocked' ? 'Needs you' : m.status === 'working' || m.status === 'thinking' ? 'Working' : m.status === 'idle' ? 'Idle' : m.status === 'ghost' ? 'Offline' : m.status.replace(/^./, s => s.toUpperCase());
const preferenceKey = () => `office-x:team-dock:${window.cth.harnessHomeSync()}`;
function readPreferences(): RoleDockPreferences {
  try { return readRoleDockPreferences(JSON.parse(localStorage.getItem(preferenceKey()) || '{}')); }
  catch { return readRoleDockPreferences(null); }
}
function persistPreferences(prefs: RoleDockPreferences): void {
  try { localStorage.setItem(preferenceKey(), JSON.stringify(prefs)); } catch { /* nonessential UI preference */ }
}

export function AgentTeamDock({ agent, onSelect, restoring, restoreCount, onRestore }:
  { agent: Agent; onSelect: (id: string) => void; restoring: boolean; restoreCount: number; onRestore: () => void }) {
  const agents = useStore(s => s.agents);
  const saved = useStore(s => s.restorableAgents);
  const [presence, setPresence] = useState(getRemotePresence);
  const [prefs, setPrefs] = useState(readPreferences);
  const [query, setQuery] = useState('');
  const [remoteDetail, setRemoteDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = `agent-role-drawer-${agent.id}`;
  const section = AGENT_ROLE_SECTIONS.find(s => s.role === prefs.role)!;

  useEffect(() => {
    const off = subscribeRemotePresence(() => setPresence(getRemotePresence()));
    let receivedLive = false;
    const offIpc = window.cth.onOrgPresence(snapshot => { receivedLive = true; publishRemotePresence(snapshot); });
    let alive = true;
    void window.cth.getOrgPresence().then(snapshot => { if (alive && !receivedLive) publishRemotePresence(snapshot); }).catch(() => {});
    return () => { alive = false; off(); offIpc(); };
  }, []);
  useEffect(() => { persistPreferences(prefs); }, [prefs]);
  useEffect(() => {
    if (!prefs.open) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPrefs(p => ({ ...p, open: false })); setEditing(false); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [prefs.open]);
  useEffect(() => {
    if (!prefs.open) return;
    const frame = requestAnimationFrame(() => panel.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [agent.id, prefs.open, prefs.role]);

  const members = useMemo(() => {
    const liveIds = new Set(agents.map(a => a.id));
    const all = [...agents, ...saved.filter(a => !liveIds.has(a.id)).map(a => ({ ...a, status: 'not started' }))];
    return buildTeamMembers(all, presence).map(m => m.localId && !liveIds.has(m.localId) ? { ...m, localId: undefined } : m);
  }, [agents, saved, presence]);
  const selected = members.find(m => m.localId === agent.id);
  const parents = members.filter(m => selected?.parentKeys.includes(m.key));
  const rows = buildAgentRoleRows(members, prefs.role, prefs.side, query);
  const counts = Object.fromEntries(AGENT_ROLE_SECTIONS.map(s => [s.role, buildAgentRoleRows(members, s.role, prefs.side).length]));
  const openRole = (role: TeamRole) => {
    setQuery(''); setRemoteDetail(null); setEditing(false);
    setPrefs(p => ({ ...p, role, open: p.role === role ? !p.open : true }));
  };
  const pick = (m: TeamMember) => {
    if (m.localId) {
      const next = { ...prefs, role: m.role, open: true };
      persistPreferences(next); setPrefs(next);
      onSelect(m.localId);
    } else setRemoteDetail(m.key);
  };
  const detail = members.find(m => m.key === remoteDetail);
  const reporting = parents.length ? parents.map(m => m.name).join(', ') : selected?.role === 'orchestrator' ? 'Human leadership' : 'Not assigned';

  return <div className="aw-team-dock">
    {prefs.open && <section ref={panel} id={panelId} className="at-panel" aria-label={`${section.label} list`}>
      <header className="at-panel-header"><div><strong>{section.label}</strong><span>{counts[prefs.role]} {counts[prefs.role] === 1 ? section.singular : section.label.toLowerCase()} · {prefs.side === 'all' ? 'Both offices & other agents' : sideLabels[prefs.side]}</span></div>
        <button aria-label={`Close ${section.label.toLowerCase()}`} onClick={() => setPrefs(p => ({ ...p, open: false }))}>×</button></header>
      <label className="at-search"><SearchIcon /><input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${section.label.toLowerCase()}…`} aria-label={`Search ${section.label.toLowerCase()}`} />{query && <button onClick={() => setQuery('')} aria-label="Clear agent search">×</button>}</label>
      <div className="at-scroll">
        <div className="at-columns" aria-hidden="true"><span>{section.singular.toUpperCase()} / MODEL</span><span>REPORTS TO</span><span>STATUS</span></div>
        {(['turjo', 'ahnaf', 'unassigned'] as const).filter(side => prefs.side === 'all' || side === prefs.side).map(side => {
          const listed = rows.filter(row => row.member.side === side);
          if (!listed.length) return null;
          return <section className="at-side" key={side} aria-label={`${sideLabels[side]} ${section.label.toLowerCase()}`}>
            {prefs.side === 'all' && <h3><span>{sideLabels[side]}</span><small>{listed.length}</small></h3>}
            {listed.map(({member: m, reportsTo}) => <div key={m.key} className="at-table-row" data-selected={m.localId === agent.id} data-source={m.source} data-agent-key={m.key}>
              <button className="at-person" onClick={() => pick(m)} aria-pressed={m.localId ? m.localId === agent.id : undefined} title={m.goal || m.title}>
                <span className="at-avatar">{m.character && <SpritePortrait character={m.character} scale={0.5} />}</span>
                <span className="at-person-copy"><strong>{m.name}</strong><span className="at-job">{m.title}</span><span className="at-model" title={m.model || (m.source === 'remote' ? 'Models are not included in shared presence' : 'CLI default model')}>{m.model?.split('/').pop() || (m.source === 'remote' ? `Shared · ${m.peer}` : 'CLI default model')}</span></span>
              </button>
              <div className="at-reporting" aria-label={`${m.name} reports to`}>
                {reportsTo.length ? reportsTo.map(parent => <span className="at-manager-chip" key={parent.key} title={parent.name}>{parent.name}</span>) : <span className="at-unassigned">{m.role === 'orchestrator' ? 'Human leadership' : 'Not assigned'}</span>}
              </div>
              <span className="at-status" data-status={m.status}><i />{statusLabel(m)}</span>
            </div>)}
          </section>;
        })}
        {!rows.length && <p className="at-empty">{query ? 'No matching agents in this section.' : `No connected or saved ${section.label.toLowerCase()}${prefs.side === 'ahnaf' ? ' for Ahnaf yet' : ''}.`}</p>}
        {detail && <div className="at-detail" role="status"><strong>{detail.name} · {statusLabel(detail)}</strong><p>{detail.title}</p><p>{detail.source === 'remote' ? `Shared by ${detail.peer}. Model, goal and terminal access are not shared.` : 'This saved employee has no running session. Use Restore to bring saved agents back.'}</p><button onClick={() => setRemoteDetail(null)}>Close details</button></div>}
        {selected && selected.role === prefs.role && <details className="at-detail"><summary>{agent.name} · Role, goal & assignments</summary><p>{agent.description}</p><p><strong>Model:</strong> {agent.model || 'CLI default'}</p><p><strong>Tags:</strong> {selected.tags.join(', ') || selected.title}</p><p><strong>Reports to:</strong> {reporting}</p><p className="at-goal">{agent.goal || 'No standing goal set.'}</p><button onClick={() => setEditing(!editing)}>{editing ? 'Cancel assignment edit' : 'Edit team assignment'}</button>{editing && <AssignmentEditor key={agent.id} agent={agent} selected={selected} members={members} onDone={() => setEditing(false)} />}</details>}
      </div>
      <footer className="at-panel-footer">Each employee appears once with all assigned managers. {presence.length === 0 && 'Ahnaf’s live status appears when Shared Office connects.'}</footer>
    </section>}
    <div className="at-toolbar" aria-label="Office agents">
      <div className="at-role-tabs" aria-label="Agent role sections">
        {AGENT_ROLE_SECTIONS.map(s => <button key={s.role} aria-controls={panelId} aria-expanded={prefs.open && prefs.role === s.role} className="at-tab" data-active={prefs.open && prefs.role === s.role} onClick={() => openRole(s.role)}>{s.label} <span>{counts[s.role]}</span></button>)}
      </div>
      <div className="at-tools">
        <select aria-label="Filter office side" value={prefs.side} onChange={e => { setQuery(''); setRemoteDetail(null); setPrefs(p => ({ ...p, side: e.target.value as RoleDockPreferences['side'], open: true })); }}><option value="all">Both sides</option><option value="turjo">Turjo</option><option value="ahnaf">Ahnaf</option><option value="unassigned">Other</option></select>
        <button className="at-search-toggle" aria-label="Search office agents" onClick={() => { setPrefs(p => ({ ...p, open: true })); requestAnimationFrame(() => search.current?.focus()); }}><SearchIcon /></button>
        <button className="at-add" onClick={() => useStore.getState().setAddAgentOpen(true)} aria-label="Add agent"><Icon name="plus" /></button>
        {restoreCount > 0 && <button disabled={restoring} onClick={onRestore}>{restoring ? 'Restoring…' : `Restore ${restoreCount}`}</button>}
      </div>
    </div>
    <div className="at-breadcrumb" title={`${agent.name} · Reports to ${reporting}`}><span>Selected</span><strong>{agent.name}</strong><span>· Reports to {reporting}</span></div>
  </div>;
}

function AssignmentEditor({ agent, selected, members, onDone }: { agent: Agent; selected: TeamMember; members: TeamMember[]; onDone: () => void }) {
  const [side, setSide] = useState(selected.side);
  const [role, setRole] = useState(selected.role);
  const [parents, setParents] = useState(selected.parentKeys.filter(k => k.startsWith('local:')).map(k => k.slice(6)));
  const [tags, setTags] = useState((agent.organization?.tags || [selected.title]).join(', '));
  const rank: Record<TeamRole, number> = { orchestrator: 0, manager: 1, worker: 2 };
  const options = members.filter(m => m.localId && m.localId !== agent.id && m.side === side && rank[m.role] < rank[role]);
  const save = () => {
    const organization: AgentOrganization = { side, role, reportsTo: parents.filter(id => options.some(m => m.localId === id)), tags: tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 12) };
    useStore.getState().updateAgent(agent.id, { organization });
    onDone();
  };
  return <form className="at-assignment" onSubmit={e => { e.preventDefault(); save(); }}>
    <label>Office side<select value={side} onChange={e => { setSide(e.target.value as TeamSide); setParents([]); }}><option value="turjo">Turjo</option><option value="ahnaf">Ahnaf</option><option value="unassigned">Other</option></select></label>
    <label>Role<select value={role} onChange={e => { setRole(e.target.value as TeamRole); setParents([]); }}><option value="orchestrator">Orchestrator</option><option value="manager">Manager</option><option value="worker">Worker</option></select></label>
    <label>Tags (comma separated)<input value={tags} onChange={e => setTags(e.target.value)} maxLength={300} /></label>
    <fieldset><legend>Reports to</legend>{options.map(m => <label key={m.key}><input type="checkbox" checked={parents.includes(m.localId!)} onChange={e => setParents(p => e.target.checked ? [...p, m.localId!] : p.filter(id => id !== m.localId))} />{m.name}</label>)}{options.length === 0 && <span>No eligible local managers. This agent stays visible as a team root.</span>}</fieldset>
    <p>These labels organize the team. Engine, goals and permissions stay in the existing agent settings.</p><button type="submit">Save assignment</button>
  </form>;
}
