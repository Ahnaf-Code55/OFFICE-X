import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TeamMember, TeamSide } from '@shared/agentTeams';
import { matchingTeamKeys } from '@shared/agentTeams';
import { SpritePortrait } from '../SpritePortrait';
import { Icon } from '../Icon';
import { blockLayout, messageRoute, type BlockNode } from './blockLayout';
import { buildCommunication, graphStatusLabel, messageActLabel, messageAge, type Communication } from './communication';
import type { MessageLogEntry } from './buildGraph';
import type { TopicResult } from './extractTopics';
import './blockGraph.css';

export interface MessagePreview { id: string; subject: string; body: string }
interface Props {
  members: TeamMember[]; log: MessageLogEntry[]; now: number; initialKey: string;
  loading: boolean; error?: string; onRefresh: () => void;
  onOpenChat: (id: string) => void; onOpenMemory: (id: string) => void;
  onExpand: () => void; expanded: boolean;
  preview?: MessagePreview; previewLoading: boolean; previewError?: string;
  onMessage: (id: string | undefined) => void;
  topics: TopicResult; topicsOn: boolean; topicsLoading: boolean; onToggleTopics: () => void;
}
const sideNames = { ahnaf: 'AHNAF SIDE', turjo: 'TURJO SIDE', unassigned: 'OTHER AGENTS' };
const sideRoles = { ahnaf: 'Product / AI / Automation', turjo: 'Security / Cloud / Digital', unassigned: 'Independent employees & guests' };

/** The canvas is display-only. Clicking a block selects graph detail, while
 * explicit Open chat / Memory actions retain the existing workspace behavior. */
export function BlockGraphView(props: Props) {
  const [side, setSide] = useState<TeamSide | 'all'>('all');
  const [minutes, setMinutes] = useState('15');
  const [query, setQuery] = useState('');
  const [messagesOn, setMessagesOn] = useState(true);
  const [selectedKey, setSelectedKey] = useState(props.initialKey);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const [messageOpen, setMessageOpen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const prefix = useId().replace(/:/g, '');
  const matches = useMemo(() => matchingTeamKeys(props.members, query), [props.members, query]);
  const members = useMemo(() => props.members.filter(m => (side === 'all' || m.side === side) && matches.has(m.key)), [props.members, matches, side]);
  const communication = useMemo(() => buildCommunication(props.members, props.log, props.now, minutes === 'all' ? null : Number(minutes)), [props.members,props.log,props.now,minutes]);
  // A filtered-out local sender/recipient is not an external participant.
  const visibleKeys = new Set(members.map(m => m.key));
  const allKeys = new Set(props.members.map(m => m.key));
  const edges = communication.edges.filter(e => (!allKeys.has(e.source) || visibleKeys.has(e.source)) && (!allKeys.has(e.target) || visibleKeys.has(e.target)));
  const used = new Set(edges.flatMap(e => [e.source,e.target]));
  const participants = communication.participants.filter(p => used.has(p.key));
  const layout = useMemo(() => blockLayout(members, participants), [members, JSON.stringify(participants)]);
  const selected = props.members.find(m => m.key === selectedKey);
  const selectedNode = layout.nodes.find(n => n.key === selectedKey);
  const touching = edges.filter(e => e.source === selectedKey || e.target === selectedKey);
  const edge = edges.find(e => e.key === selectedEdgeKey) ?? touching[0];
  const currentPreview = props.preview?.id === edge?.messageId ? props.preview : undefined;
  const name = (key: string) => props.members.find(m => m.key === key)?.name ?? participants.find(p => p.key === key)?.label ?? key;
  const localCount = props.members.filter(m => m.source === 'local').length;
  const sharedCount = props.members.filter(m => m.source === 'remote').length;
  const working = props.members.filter(m => m.source !== 'planned' && ['working','thinking'].includes(m.status)).length;
  const needsYou = props.members.filter(m => m.source !== 'planned' && m.status === 'blocked').length;
  useEffect(() => { props.onMessage(edge?.messageId); setMessageOpen(false); }, [edge?.messageId]);
  const focusNode = () => {
    const node = layout.nodes.find(n => n.key === selectedKey);
    const el = viewport.current;
    if (node && el) { el.scrollLeft = Math.max(0,(node.x+node.w/2)*zoom-el.clientWidth/2); el.scrollTop = Math.max(0,node.y*zoom-70); }
  };
  useEffect(() => { const frame = requestAnimationFrame(focusNode); return () => cancelAnimationFrame(frame); }, [selectedKey,side]);
  const fit = () => { if(viewport.current) { setZoom(Math.max(.2,Math.min(1,Math.min((viewport.current.clientWidth-24)/layout.width,(viewport.current.clientHeight-16)/layout.height)))); viewport.current.scrollTo(0,0); } };
  useEffect(() => { if(props.expanded){const frame=requestAnimationFrame(fit);return()=>cancelAnimationFrame(frame);} }, [props.expanded]);
  const pick = (node: BlockNode) => { setSelectedKey(node.key); setSelectedEdgeKey(undefined); };
  const chooseEdge = (message: Communication) => { setSelectedEdgeKey(message.key); if (message.source !== selectedKey && message.target !== selectedKey) setSelectedKey(message.source); };
  const renderNode = (node: BlockNode) => {
    const m = node.member;
    const status = m?.status ?? 'participant';
    return <button key={node.id} className="bg-node" data-side={m?.side} data-role={m?.role ?? 'participant'} data-source={m?.source ?? 'participant'} data-selected={node.key===selectedKey}
      style={{left:node.x,top:node.y,width:node.w,height:node.h}} onClick={() => pick(node)} aria-pressed={node.key===selectedKey}
      aria-label={`${node.label}, ${m?.role ?? 'participant'}, ${graphStatusLabel(status)}`} title={m ? `${m.title}${m.peer ? ` · Shared by ${m.peer}` : ''}` : node.label}>
      {m?.character ? <SpritePortrait character={m.character} scale={.9} /> : <span className="bg-monogram">{node.label.slice(0,1)}</span>}
      <span className="bg-node-copy"><strong>{node.label}</strong>{m?.role!=='worker' && <span className="bg-node-role">{m?.role==='orchestrator' ? 'Orchestrator' : m?.role==='manager' ? m.title : 'Message participant'}</span>}
        <span className="bg-node-status" data-status={status}><i />{graphStatusLabel(status)}</span>
        {m && m.parentKeys.length>1 && <span className="bg-shared" title="One employee shared by several managers">shared</span>}
      </span>
    </button>;
  };
  const fitSummary = `${localCount} local · ${sharedCount} shared · ${working} working${needsYou ? ` · ${needsYou} needs you` : ''}`;
  return <section className="block-graph" aria-label="Organization and communication graph">
    <header className="bg-header"><div><h2>Organization & communication</h2><p aria-live="polite">{fitSummary}</p></div><button onClick={props.onExpand}><Icon name="expand" />{props.expanded ? 'Return to office' : 'Expand graph'}</button></header>
    <div className="bg-toolbar">
      <select aria-label="Graph office side" value={side} onChange={e=>setSide(e.target.value as TeamSide|'all')}><option value="all">Both sides</option><option value="ahnaf">Ahnaf</option><option value="turjo">Turjo</option><option value="unassigned">Other agents</option></select>
      <select aria-label="Graph message time range" value={minutes} onChange={e=>{setMinutes(e.target.value);setSelectedEdgeKey(undefined);}}><option value="15">Last 15 min</option><option value="60">Last hour</option><option value="1440">Last 24 hours</option><option value="all">All recorded (latest 200)</option></select>
      <input aria-label="Search graph agents" placeholder="Search agents or roles…" value={query} onChange={e=>setQuery(e.target.value)} />
      <button aria-pressed={messagesOn} onClick={()=>setMessagesOn(!messagesOn)}>Messages {messagesOn ? 'on' : 'off'}</button>
      <button onClick={fit}>Fit view</button><button disabled={props.loading} onClick={props.onRefresh} aria-label="Refresh graph">{props.loading ? 'Loading…' : 'Refresh'}</button>
    </div>
    {props.error && <div className="bg-alert" role="status">{props.error}</div>}
    <div className="bg-viewport" ref={viewport} tabIndex={0} aria-label="Graph canvas. Scroll to pan, or use Fit view and zoom controls.">
      <div className="bg-extent" style={{width:layout.width*zoom,height:layout.height*zoom}}>
        <div className="bg-canvas" style={{width:layout.width,height:layout.height,transform:`scale(${zoom})`}}>
          {layout.groups.map(group => <section key={group.side} className="bg-side" data-side={group.side} style={{left:group.x,top:group.y,width:group.w,height:group.h}} aria-label={sideNames[group.side]}>
            <header><strong>{sideNames[group.side]}</strong><span>{sideRoles[group.side]}</span><small>{group.count ? `${group.count} agents` : group.side==='ahnaf' ? 'Not connected' : 'No hired agents'}</small></header>
          </section>)}
          {layout.groups.flatMap(group=>group.workerBoxes).map(box => <div className="bg-worker-box" key={box.id} style={{left:box.x,top:box.y,width:box.w,height:box.h}}><span>{box.caption}</span>{!layout.nodes.some(n=>n.x>=box.x && n.x<box.x+box.w && n.y>=box.y && n.y<box.y+box.h) && <small>No assigned workers</small>}</div>)}
          <svg className="bg-reporting" width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={`${prefix}-report`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="currentColor" /></marker></defs>
            {layout.groups.map(g=><g key={g.side} data-side={g.side}>{g.reporting.map((path,i)=><path key={i} d={path} fill="none" stroke="currentColor" markerEnd={`url(#${prefix}-report)`} />)}</g>)}
          </svg>
          {layout.nodes.map(renderNode)}
          {messagesOn && <svg className="bg-messages" width={layout.width} height={layout.height} aria-label="Recent directed messages">
            <defs>{['request','query','inform','propose','agree','done','refuse'].map(act=><marker key={act} id={`${prefix}-${act}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path data-act={act} d="M0 0 L8 4 L0 8 Z" className="bg-arrow-head" /></marker>)}</defs>
            {edges.map(message=>{
              const route=messageRoute(layout,message);if(!route)return null;
              const connected=message.source===selectedKey||message.target===selectedKey;
              const label=`${messageActLabel(message.act)} · ${messageAge(message.ts,props.now)}`;
              return <g key={message.key} data-act={message.act} className="bg-message-route" data-dim={selectedNode && !connected} data-selected={edge?.key===message.key}>
                <path d={route.path} className="bg-message-hit" role="button" tabIndex={0} aria-label={`${name(message.source)} to ${name(message.target)}, ${label}, ${message.count} messages`} onClick={()=>chooseEdge(message)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseEdge(message);}}}><title>{name(message.source)} → {name(message.target)} · {message.count} messages</title></path>
                <path className="bg-message-line" d={route.path} fill="none" markerEnd={`url(#${prefix}-${message.act})`} />
                <rect x={route.labelX-51} y={route.labelY-12} width={102} height={18} rx={3} className="bg-message-label-bg" onClick={()=>chooseEdge(message)} />
                <text x={route.labelX} y={route.labelY} textAnchor="middle" className="bg-message-label">{label}</text>
              </g>;
            })}
          </svg>}
          {!members.length && <div className="bg-canvas-empty">No agents match this view.</div>}
        </div>
      </div>
    </div>
    <div className="bg-canvas-controls"><span>{!edges.length ? 'No communication in this time range.' : `${edges.length} directed connections · latest 200 log entries`}</span><button aria-label="Zoom graph out" onClick={()=>setZoom(z=>Math.max(.2,z-.1))}>−</button><button onClick={()=>setZoom(1)} aria-label="Reset graph zoom">{Math.round(zoom*100)}%</button><button aria-label="Zoom graph in" onClick={()=>setZoom(z=>Math.min(1.6,z+.1))}>+</button></div>
    <footer className="bg-detail">
      <div className="bg-detail-agent"><strong>{selected?.name ?? selectedNode?.label ?? 'Select an agent'}</strong><span>{selected ? `${selected.role} · ${graphStatusLabel(selected.status)}` : 'Message participant'}</span><span>{selected?.model ?? (selected?.source==='remote' ? 'Model not shared' : selected?.source==='planned' ? 'No running session' : '')}</span></div>
      <div className="bg-detail-message"><strong>Latest communication</strong>{edge ? <><span>{name(edge.source)} → {name(edge.target)} · {messageActLabel(edge.act)} · {messageAge(edge.ts,props.now)}</span><span title={currentPreview?.subject}>{props.previewLoading ? 'Loading message…' : props.previewError || currentPreview?.subject || 'Message preview unavailable'}</span>{edge.messageId && <button disabled={props.previewLoading||!currentPreview} onClick={()=>setMessageOpen(!messageOpen)}>{messageOpen ? 'Close message' : 'View message'}</button>}</> : <span>{selected?.source==='remote' ? 'Shared presence includes status; messages are not shared.' : 'No logged messages for this selection in this range.'}</span>}</div>
      {selected?.localId && <div className="bg-detail-actions"><button onClick={()=>props.onOpenChat(selected.localId!)}>Open chat</button><button onClick={()=>props.onOpenMemory(selected.localId!)}>Memory</button></div>}
      {messageOpen && currentPreview && <div className="bg-message-body"><strong>{currentPreview.subject}</strong><pre>{currentPreview.body || 'No message body.'}</pre></div>}
    </footer>
    <div className="bg-legend"><span><i className="bg-report-key" />Reporting line</span><span><i className="bg-message-key" />Message →</span><span><i className="bg-working-key" />Working</span><span><i className="bg-blocked-key" />Needs you</span><small>Shared specialists are one agent, shown under each manager.</small><button aria-pressed={props.topicsOn} onClick={props.onToggleTopics}>Shared topics</button></div>
    {props.topicsOn && <section className="bg-topics" aria-label="Shared memory topics">{props.topicsLoading ? 'Reading shared topics…' : props.topics.topics.length ? props.topics.topics.map(topic=><button key={topic.id} onClick={()=>{const key=props.members.find(m=>m.localId===topic.agentIds[0])?.key;if(key)setSelectedKey(key);}} title={topic.agentIds.map(id=>props.members.find(m=>m.localId===id)?.name??id).join(', ')}>{topic.label} · {topic.weight} agents</button>) : 'No shared topics found.'}</section>}
  </section>;
}
