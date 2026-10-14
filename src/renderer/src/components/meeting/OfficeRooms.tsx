import { useEffect, useMemo, useState } from 'react';
import { useStore, type Agent } from '@/store/store';
import { CHAT_CHANNELS, ROOM_LABELS, canHear, namedRole, roleTier, type ChatChannel, type ChatIntent, type ChatTier, type RoomState } from '@shared/officeRooms';
import './officeRooms.css';
type Presence = Awaited<ReturnType<typeof window.cth.getOrgPresence>>;
type Trusted = Awaited<ReturnType<typeof window.cth.listOrgMembers>>;
export interface RoomPerson {
  key: string;
  name: string;
  kind: 'human' | 'agent';
  tier?: ChatTier;
  localId?: string;
  online: boolean;
  role: string;
  character?: Agent['character'];
  accent: string;
  peer?: string;
}
const tierName = (tier: ChatTier) => tier === 'leadership' ? 'Orchestrator' : tier === 'middle' ? 'Manager' : 'Employee';
export function useOfficeRooms() {
  const agents = useStore(s => s.agents),
    saved = useStore(s => s.restorableAgents);
  const [tiers, setTiers] = useState<Record<string, ChatTier>>({});
  const [rooms, setRooms] = useState<RoomState[]>(CHAT_CHANNELS.map(channel => ({
    channel,
    active: false
  })));
  const [presence, setPresence] = useState<Presence>([]),
    [trusted, setTrusted] = useState<Trusted>([]),
    [myName, setMyName] = useState('You');
  const signature = agents.map(a => `${a.id}:${a.name}:${a.organization?.role}:${a.isGod}`).join('|');
  useEffect(() => {
    let alive = true;
    void window.cth.getChatTiers().then(v => {
      if (alive) setTiers(v);
    });
    return () => {
      alive = false;
    };
  }, [signature]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void window.cth.getChatRooms().then(v => {
        if (alive) setRooms(v);
      }).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    const offRooms = window.cth.onChatRooms(setRooms),
      offPresence = window.cth.onOrgPresence(setPresence);
    void window.cth.getOrgPresence().then(v => {
      if (alive) setPresence(v);
    });
    void window.cth.listOrgMembers().then(v => {
      if (alive) setTrusted(v);
    });
    void window.cth.getOrgTrigger().then(c => {
      if (alive) setMyName(c.displayName?.trim() || 'You');
    });
    return () => {
      alive = false;
      clearInterval(timer);
      offRooms();
      offPresence();
    };
  }, []);
  const people = useMemo(() => {
    const members: RoomPerson[] = [{
      key: 'me',
      name: myName,
      kind: 'human',
      online: true,
      role: 'Human',
      accent: 'sky'
    }];
    for (const person of trusted) members.push({
      key: `human:${person.memberId}`,
      name: person.displayName,
      kind: 'human',
      online: presence.some(p => p.id === person.memberId),
      role: 'Human',
      accent: 'mint'
    });
    for (const peer of presence) {
      if (!members.some(m => m.key === `human:${peer.id}`)) members.push({
        key: `human:${peer.id}`,
        name: peer.name,
        kind: 'human',
        online: true,
        role: 'Human',
        accent: 'mint'
      });
      for (const a of peer.agents) {
        const role = namedRole(a.name),
          tier = a.chatTier ?? roleTier(role);
        if (tier === 'off') continue;
        members.push({
          key: `remote:${peer.id}:${a.id}`,
          name: a.name,
          kind: 'agent',
          tier,
          online: a.status !== 'offline',
          role: a.chatTier || role ? tierName(tier) : 'Role not shared',
          character: a.character,
          accent: 'mint',
          peer: peer.name
        });
      }
    }
    for (const a of [...agents, ...saved]) {
      const tier = tiers[a.id] === 'off' ? 'off' : a.organization?.role || a.isGod ? roleTier(a.organization?.role, !!a.isGod) : tiers[a.id] ?? roleTier(namedRole(a.name));
      if (tier === 'off') continue;
      members.push({
        key: `local:${a.id}`,
        name: a.name,
        kind: 'agent',
        tier,
        localId: a.id,
        online: agents.some(l => l.id === a.id),
        role: tierName(tier),
        character: a.character,
        accent: a.accent
      });
    }
    return members;
  }, [agents, saved, tiers, presence, trusted, myName]);
  return {
    tiers,
    rooms,
    presence,
    people,
    myName,
    participants: (channel: ChatChannel) => people.filter(p => p.kind === 'human' || canHear(p.tier, channel))
  };
}
export function RoomTabs({
  channel,
  onChange
}: {
  channel: ChatChannel;
  onChange: (channel: ChatChannel) => void;
}) {
  return <div role="tablist" aria-label="Office rooms" className="or-tabs">{CHAT_CHANNELS.map(key => <button type="button" role="tab" aria-selected={channel === key} key={key} onClick={() => onChange(key)}>#{ROOM_LABELS[key]}</button>)}</div>;
}
export function RoomControls({
  channel,
  state,
  topic = '',
  image = '',
  onPosted,
  onError
}: {
  channel: ChatChannel;
  state?: RoomState;
  topic?: string;
  image?: string;
  onPosted?: (intent: ChatIntent) => void;
  onError: (error: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const act = async (intent: ChatIntent) => {
    setBusy(true);
    try {
      const message = (intent === 'report' ? topic.trim() : '') || (intent === 'report' ? 'Please give a brief work report: completed work with evidence, blockers, and next step.' : intent === 'start' ? 'Starting the meeting, everyone join.' : intent === 'stop' ? 'End the meeting.' : 'Another independent opinion on this topic, please.');
      const result = await window.cth.sendChat(channel, message, intent === 'report' ? image : '', intent);
      if (!result.ok) onError(result.error ?? 'Room request failed');else {
        onError('');
        onPosted?.(intent);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const waiting = state?.round?.status === 'collecting' ? state.round.turns.find(t => t.state === 'speaking') : undefined;
  const canStop = state?.active || !!waiting;
  return <div className="or-controls">
  <div className="or-actions"><button disabled={busy} onClick={() => void act('report')}>Ask for report</button><button disabled={busy} onClick={() => void act(canStop ? 'stop' : 'start')}>{state?.active ? 'End meeting' : waiting ? 'Stop replies' : 'Start meeting'}</button>{state?.round && state.round.status !== 'collecting' && <button disabled={busy} onClick={() => void act('continue')}>Next voices</button>}</div>
  <p role="status">{waiting ? `Waiting for ${waiting.name} · ${state?.round?.turns.filter(t => t.state === 'answered').length}/${state?.round?.turns.length} replies` : state?.round?.status === 'expired' ? 'Reply window expired. Check agent approvals, then request a new round.' : state?.active ? 'Meeting open · send a topic to invite relevant opinions' : 'Quiet · AIs speak only when you request a report or start a meeting'}</p>
  <small>Up to 3 short AI turns per office. Joining is silent; agents do not trigger one another.</small>
 </div>;
}
export function RoomParticipants({
  people
}: {
  people: RoomPerson[];
}) {
  return <details className="or-participants"><summary>Who’s here · {people.filter(p => p.kind === 'human').length} {people.filter(p => p.kind === 'human').length === 1 ? 'human' : 'humans'} · {people.filter(p => p.kind === 'agent').length} {people.filter(p => p.kind === 'agent').length === 1 ? 'AI' : 'AIs'}</summary>
  <div>{(['Human', 'Orchestrator', 'Manager', 'Employee', 'Role not shared'] as const).map(role => {
        const group = people.filter(p => p.role === role);
        return group.length > 0 && <section key={role}><strong>{role}</strong>{group.map(p => <span key={p.key}>{p.name}{p.key === 'me' ? ' (you)' : p.peer ? ` · ${p.peer}` : ''}<small>{p.online ? 'Present' : 'Not connected / not started'}</small></span>)}</section>;
      })}</div>
 </details>;
}
