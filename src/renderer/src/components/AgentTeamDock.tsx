import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTeamMembers, buildTeamTree, type AgentOrganization, type TeamBranch, type TeamMember, type TeamRole, type TeamSide } from '@shared/agentTeams';
import { useStore, type Agent } from '@/store/store';
import { getRemotePresence, subscribeRemotePresence, publishRemotePresence } from '@/scene/office/remotePresence';
import { Icon } from './Icon';
import { SpritePortrait } from './SpritePortrait';
import './agentTeamDock.css';

const SearchIcon = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" /><path d="m10 10 4 4" stroke="currentColor" /></svg>;

const sideLabels: Record<TeamSide, string> = { turjo: 'Turjo’s team', ahnaf: 'Ahnaf’s team', unassigned: 'Other agents' };
const statusLabel = (m: TeamMember) => m.status === 'blocked' ? 'Needs you' : m.status === 'working' || m.status === 'thinking' ? 'Working' : m.status === 'idle' ? 'Idle' : m.status === 'ghost' ? 'Offline' : m.status.replace(/^./, s => s.toUpperCase());
const preferenceKey = () => `office-x:team-dock:${window.cth.harnessHomeSync()}`;
interface DockPreferences { open: boolean; mode: 'teams' | 'all'; side: TeamSide | 'all'; expanded: string[] }
function readPreferences(): DockPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey()) || '{}');
    return { open: saved.open === true, mode: saved.mode === 'all' ? 'all' : 'teams', side: ['turjo', 'ahnaf', 'unassigned'].includes(saved.side) ? saved.side : 'all', expanded: Array.isArray(saved.expanded) ? saved.expanded.filter((s: unknown) => typeof s === 'string') : [] };
  } catch { return { open: false, mode: 'teams', side: 'all', expanded: [] }; }
}

export function AgentTeamDock({ agent, onSelect, restoring, restoreCount, onRestore }:
  { agent: Agent; onSelect: (id: string) => void; restoring: boolean; restoreCount: number; onRestore: () => void }) {
  const agents = useStore(s => s.agents);
  const [presence, setPresence] = useState(getRemotePresence);
  const [prefs, setPrefs] = useState(readPreferences);
  const [query, setQuery] = useState('');
  const [remoteDetail, setRemoteDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const panelId = `team-drawer-${agent.id}`;
  useEffect(() => {
    const off = subscribeRemotePresence(() => setPresence(getRemotePresence()));
    let receivedLive = false;
    const offIpc = window.cth.onOrgPresence(snapshot => { receivedLive = true; publishRemotePresence(snapshot); });
    let alive = true;
    void window.cth.getOrgPresence().then(snapshot => { if (alive && !receivedLive) publishRemotePresence(snapshot); }).catch(() => {});
    return () => { alive = false; off(); offIpc(); };
  }, []);
  useEffect(() => { try { localStorage.setItem(preferenceKey(), JSON.stringify(prefs)); } catch { /* nonessential UI preference */ } }, [prefs]);
  useEffect(() => {
    if (!prefs.open) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPrefs(p => ({ ...p, open: false })); setEditing(false); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [prefs.open]);
  useEffect(() => {
    if (!prefs.open) return;
    const frame = requestAnimationFrame(() => document.getElementById(panelId)?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [agent.id, prefs.open, prefs.mode, panelId]);
  const members = useMemo(() => buildTeamMembers(agents, presence), [agents, presence]);
  const selected = members.find(m => m.localId === agent.id);
  const parents = members.filter(m => selected?.parentKeys.includes(m.key));
  const tree = buildTeamTree(members, query, prefs.mode === 'teams');
  const active = members.filter(m => m.source !== 'planned');
  const children = (key: string) => members.filter(m => m.parentKeys.includes(key));
  const isExpanded = (m: TeamMember) => m.role === 'orchestrator' || !!query.trim() || prefs.expanded.includes(m.key);
  const toggle = (key: string) => setPrefs(p => ({ ...p, expanded: p.expanded.includes(key) ? p.expanded.filter(k => k !== key) : [...p.expanded, key] }));
  const openMode = (mode: 'teams' | 'all') => setPrefs(p => ({ ...p, mode, open: p.mode === mode ? !p.open : true }));
  const pick = (m: TeamMember) => {
    if (m.localId) {
      // Selecting a search result must keep its manager path open after the
      // workspace remounts. Persist before onSelect unmounts this frame.
      const next = { ...prefs, expanded: [...new Set([...prefs.expanded, ...m.parentKeys])] };
      try { localStorage.setItem(preferenceKey(), JSON.stringify(next)); } catch { /* nonessential preference */ }
      setPrefs(next);
      onSelect(m.localId);
    } else setRemoteDetail(m.key);
  };
  const row = ({ member: m, children: branches }: TeamBranch, depth = 0): JSX.Element => {
    const kids = children(m.key);
    const expanded = isExpanded(m);
    return <div className="at-branch" key={m.key}>
      <div className="at-row" data-selected={m.localId === agent.id} data-source={m.source} style={{ '--at-depth': depth } as React.CSSProperties}>
        {kids.length > 0 ? <button className="at-expand" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${m.name} team`} aria-expanded={expanded} onClick={() => toggle(m.key)} disabled={m.role === 'orchestrator'}>{expanded ? '⌄' : '›'}</button> : <span className="at-leaf" />}
        <button className="at-person" onClick={() => pick(m)} aria-pressed={m.localId ? m.localId === agent.id : undefined} title={m.goal || m.title}>
          <span className="at-person-title">{m.character && <SpritePortrait character={m.character} scale={0.4} />}<strong>{m.name}</strong><span className="at-role">{m.role}</span></span>
          <span className="at-job">{m.title}</span>
          <span className="at-model" title={m.model || (m.source === 'remote' ? 'Models are not included in shared presence' : 'Agent has not joined this office')}>
            {m.model?.split('/').pop() || (m.source === 'remote' ? `Shared · ${m.peer}` : m.source === 'planned' ? 'Awaiting agent' : 'CLI default model')}
            {kids.length > 0 && <span> · {kids.length} {m.role === 'orchestrator' ? 'managers' : 'workers'}</span>}
          </span>
        </button>
        <span className="at-status" data-status={m.status}><i />{statusLabel(m)}</span>
      </div>
      {expanded && branches.length > 0 && <div className="at-children">{branches.map(child => row(child, depth + 1))}</div>}
    </div>;
  };
  const detail = members.find(m => m.key === remoteDetail);
  return <div className="aw-team-dock">
    {prefs.open && <section id={panelId} className="at-panel" aria-label="Agent teams">
      <header className="at-panel-header"><div><strong>{prefs.mode === 'teams' ? 'Your teams' : 'All agents'}</strong><span>{agents.filter(a => !a.archived).length} local · {presence.reduce((n, p) => n + p.agents.length, 0)} shared</span></div>
        <button aria-label="Close teams" onClick={() => setPrefs(p => ({ ...p, open: false }))}>×</button></header>
      <label className="at-search"><SearchIcon /><input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search agents, roles or models…" aria-label="Search agents, roles or models" />{query && <button onClick={() => setQuery('')} aria-label="Clear agent search">×</button>}</label>
      <div className="at-scroll">
        {(['turjo', 'ahnaf', 'unassigned'] as const).filter(side => prefs.side === 'all' || side === prefs.side).map(side => {
          const listed = tree.filter(branch => branch.member.side === side);
          if (!listed.length) return null;
          return <section className="at-side" key={side} aria-label={sideLabels[side]}><h3><span>{sideLabels[side]}</span><small>{members.filter(m => m.side === side && m.source !== 'planned').length} agents</small></h3>{listed.map(m => row(m))}</section>;
        })}
        {!tree.some(branch => prefs.side === 'all' || branch.member.side === prefs.side) && <p className="at-empty">No agents match this view.</p>}
        {detail && <div className="at-detail" role="status"><strong>{detail.name} · {statusLabel(detail)}</strong><p>{detail.title}</p><p>{detail.source === 'remote' ? `Shared by ${detail.peer}. Model, goal and terminal access are not shared.` : 'This is a company chart position. It has no running session yet.'}</p><button onClick={() => setRemoteDetail(null)}>Close details</button></div>}
        {selected && <details className="at-detail"><summary>{agent.name} · Role, goal & assignments</summary><p>{agent.description}</p><p><strong>Model:</strong> {agent.model || 'CLI default'}</p><p><strong>Tags:</strong> {selected.tags.join(', ') || selected.title}</p><p><strong>Reports to:</strong> {parents.map(m => m.name).join(', ') || 'Human leadership'}</p><p className="at-goal">{agent.goal || 'No standing goal set.'}</p><button onClick={() => setEditing(!editing)}>{editing ? 'Cancel assignment edit' : 'Edit team assignment'}</button>{editing && <AssignmentEditor key={agent.id} agent={agent} selected={selected} members={members} onDone={() => setEditing(false)} />}</details>}
      </div>
      <footer className="at-panel-footer">Shared specialists appear under each manager. {presence.length === 0 && 'Ahnaf’s live status is available when Shared Office connects.'}</footer>
    </section>}
    <div className="at-toolbar" aria-label="Office agents">
      <button aria-controls={panelId} aria-expanded={prefs.open && prefs.mode === 'teams'} className="at-tab" data-active={prefs.open && prefs.mode === 'teams'} onClick={() => openMode('teams')}><Icon name="git" /> Teams</button>
      <button aria-controls={panelId} aria-expanded={prefs.open && prefs.mode === 'all'} className="at-tab" data-active={prefs.open && prefs.mode === 'all'} onClick={() => openMode('all')}>All agents <span>{active.length}</span></button>
      <select aria-label="Filter office side" value={prefs.side} onChange={e => setPrefs(p => ({ ...p, side: e.target.value as DockPreferences['side'], open: true }))}><option value="all">All sides</option><option value="turjo">Turjo</option><option value="ahnaf">Ahnaf</option><option value="unassigned">Other</option></select>
      <button className="at-search-toggle" aria-label="Search office agents" onClick={() => { setPrefs(p => ({ ...p, open: true })); requestAnimationFrame(() => search.current?.focus()); }}><SearchIcon /></button>
      <button className="at-add" onClick={() => useStore.getState().setAddAgentOpen(true)} aria-label="Add agent"><Icon name="plus" /></button>
      {restoreCount > 0 && <button disabled={restoring} onClick={onRestore}>{restoring ? 'Restoring…' : `Restore ${restoreCount}`}</button>}
    </div>
    <div className="at-breadcrumb" title={[...parents.map(m => m.name), agent.name].join(' › ')}><span>Selected</span> {parents.map(m => m.name).join(' / ')}{parents.length > 0 && ' › '}<strong>{agent.name}</strong><span className="at-role">{selected?.role || 'agent'}</span></div>
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
