import type { TeamPresenceSnapshot, TeamPresenceCharacter } from './teamPresence';

export type TeamSide = 'turjo' | 'ahnaf' | 'unassigned';
export type TeamRole = 'orchestrator' | 'manager' | 'worker';
/** Display/routing metadata only. Never grants permission or changes a CLI. */
export interface AgentOrganization {
  side: TeamSide;
  role: TeamRole;
  /** Local agent IDs. A specialist can report to more than one manager. */
  reportsTo: string[];
  tags: string[];
}
interface ChartEntry { name: string; side: TeamSide; role: TeamRole; title: string; parents: string[] }
const manager = (side: TeamSide, name: string, title: string, parent: string): ChartEntry => ({ side, name, title, role: 'manager', parents: [parent] });
const worker = (side: TeamSide, name: string, title: string, parents: string[]): ChartEntry => ({ side, name, title, role: 'worker', parents });
export const COMPANY_TEAM_CHART: readonly ChartEntry[] = [
  { side: 'turjo', name: 'Michael-B', title: 'Office coordination', role: 'orchestrator', parents: [] },
  manager('turjo', 'Atlas', 'Cloud & DevOps', 'Michael-B'),
  manager('turjo', 'Sentinel', 'Security', 'Michael-B'),
  manager('turjo', 'Forge', 'Digital engineering', 'Michael-B'),
  manager('turjo', 'Narrative', 'Content & documentation', 'Michael-B'),
  manager('turjo', 'Lighthouse', 'Quality engineering', 'Michael-B'),
  manager('turjo', 'Gatekeeper', 'Release & compliance', 'Michael-B'),
  worker('turjo', 'Orbit', 'Cloud / DevOps', ['Atlas']),
  worker('turjo', 'Watchtower', 'Monitoring & observability', ['Atlas']),
  worker('turjo', 'Bastion', 'Security hardening', ['Sentinel', 'Gatekeeper']),
  worker('turjo', 'Auditor', 'Security verification & QA', ['Sentinel', 'Lighthouse', 'Gatekeeper']),
  worker('turjo', 'Core', 'Backend / API', ['Forge']),
  worker('turjo', 'Patch', 'Fixes & maintenance', ['Forge', 'Lighthouse']),
  worker('turjo', 'Chronicle', 'Documentation', ['Narrative']),
  { side: 'ahnaf', name: 'Michael-A', title: 'Office coordination', role: 'orchestrator', parents: [] },
  manager('ahnaf', 'Vanguard', 'Brand & design', 'Michael-A'),
  manager('ahnaf', 'Aurora', 'Web experience', 'Michael-A'),
  manager('ahnaf', 'Synapse', 'AI products', 'Michael-A'),
  manager('ahnaf', 'Pulse', 'Automation', 'Michael-A'),
  manager('ahnaf', 'Flux', 'UX & interaction', 'Michael-A'),
  manager('ahnaf', 'Nexus', 'Integration & release', 'Michael-A'),
  worker('ahnaf', 'Scribe', 'Docs & brand copy', ['Vanguard']),
  worker('ahnaf', 'Pixel', 'Frontend & UI', ['Vanguard', 'Aurora', 'Flux']),
  worker('ahnaf', 'Stitch', 'Refactors & integrations', ['Aurora', 'Pulse', 'Flux']),
  worker('ahnaf', 'Runner', 'Fixes & maintenance', ['Aurora', 'Nexus']),
  worker('ahnaf', 'Neuron', 'AI engineering', ['Synapse']),
  worker('ahnaf', 'Probe', 'Testing & validation', ['Synapse', 'Nexus']),
  worker('ahnaf', 'Relay', 'Automation implementation', ['Pulse'])
];
export interface LocalTeamAgent {
  id: string; name: string; description: string; status: string; model?: string;
  character?: TeamPresenceCharacter; goal?: string; organization?: AgentOrganization; isGod?: boolean; archived?: boolean;
}
export interface TeamMember {
  key: string; localId?: string; name: string; side: TeamSide; role: TeamRole;
  title: string; tags: string[]; parentKeys: string[]; model?: string; status: string;
  source: 'local' | 'remote' | 'planned'; peer?: string; goal?: string; character?: TeamPresenceCharacter;
}
function validOrganization(input: unknown): AgentOrganization | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  if (!['turjo', 'ahnaf', 'unassigned'].includes(String(o.side))
    || !['orchestrator', 'manager', 'worker'].includes(String(o.role))
    || !Array.isArray(o.reportsTo) || o.reportsTo.length > 32 || !o.reportsTo.every(p => typeof p === 'string')
    || !Array.isArray(o.tags) || o.tags.length > 12 || !o.tags.every(t => typeof t === 'string' && t.length <= 300)) return undefined;
  return o as unknown as AgentOrganization;
}
const chartFor = (name: string) => COMPANY_TEAM_CHART.find(c => c.name.toLowerCase() === name.toLowerCase());
const label = (description: string) => description.split(':')[0].replace(/ owner$/, '');

/** Keep authenticated remote presence separate from local, actionable agents. */
export function buildTeamMembers(agents: readonly LocalTeamAgent[], peers: TeamPresenceSnapshot): TeamMember[] {
  const members: TeamMember[] = [];
  const pending: { member: TeamMember; parents: string[]; cohort: string; explicit: boolean }[] = [];
  for (const a of agents.filter(a => !a.archived)) {
    const chart = chartFor(a.name);
    const org = validOrganization(a.organization);
    const member: TeamMember = {
      key: `local:${a.id}`, localId: a.id, name: a.name,
      side: org?.side ?? chart?.side ?? 'unassigned',
      role: org?.role ?? chart?.role ?? (a.isGod ? 'orchestrator' : 'worker'),
      title: a.isGod ? 'Office coordination' : (org?.tags[0] || label(a.description) || chart?.title || 'Role not assigned'),
      tags: org?.tags ?? [], parentKeys: [], model: a.model, status: a.status,
      source: 'local', goal: a.goal, character: a.character
    };
    members.push(member);
    pending.push({ member, parents: org?.reportsTo ?? chart?.parents ?? [], cohort: 'local', explicit: !!org });
  }
  for (const peer of peers) {
    const knownSides = new Set(peer.agents.flatMap(a => chartFor(a.name) ? [chartFor(a.name)!.side] : []));
    const peerSide = knownSides.size === 1 ? [...knownSides][0] : 'unassigned';
    for (const a of peer.agents) {
      const chart = chartFor(a.name);
      const tier = (a as { chatTier?: string }).chatTier;
      const sharedRole = tier === 'leadership' ? 'orchestrator' : tier === 'middle' ? 'manager' : tier === 'staff' ? 'worker' : undefined;
      const member: TeamMember = {
        key: `remote:${peer.id}:${a.id}`, name: a.name, side: chart?.side ?? peerSide,
        role: sharedRole ?? chart?.role ?? 'worker', title: chart?.title ?? (sharedRole === 'orchestrator' ? 'Office coordination' : 'Role not shared'), tags: [], parentKeys: [],
        status: a.status, source: 'remote', peer: peer.name, character: a.character
      };
      members.push(member);
      pending.push({ member, parents: chart?.parents ?? [], cohort: `remote:${peer.id}`, explicit: false });
    }
  }
  // The company preset is activated by a known coordinator, not by every generic office.
  if (members.some(m => m.name === 'Michael-A' || m.name === 'Michael-B')) {
    for (const c of COMPANY_TEAM_CHART) {
      if (members.some(m => m.side === c.side && m.name.toLowerCase() === c.name.toLowerCase())) continue;
      const member: TeamMember = {
        key: `planned:${c.side}:${c.name}`, name: c.name, side: c.side, role: c.role,
        title: c.title, tags: [], parentKeys: [], source: 'planned',
        status: c.side === 'ahnaf' ? 'not connected' : 'not hired'
      };
      members.push(member);
      pending.push({ member, parents: c.parents, cohort: 'planned', explicit: false });
    }
  }
  const rank = { orchestrator: 0, manager: 1, worker: 2 };
  for (const { member, parents, cohort, explicit } of pending) {
    for (const parent of parents) {
      const match = explicit
        ? members.find(m => m.key === `local:${parent}`)
        : members.find(m => m.side === member.side && m.name.toLowerCase() === parent.toLowerCase()
          && (cohort === 'local' ? m.source === 'local' : cohort === 'planned' ? true : m.key.startsWith(`${cohort}:`)))
          ?? (cohort.startsWith('remote:') && chartFor(parent)?.role === 'orchestrator'
            ? members.find(m => m.side === member.side && m.role === 'orchestrator' && m.key.startsWith(`${cohort}:`)) : undefined)
          ?? members.find(m => m.side === member.side && m.name.toLowerCase() === parent.toLowerCase() && m.source === 'planned');
      // Strict levels make malformed saved relationships cycle-free. Orphans remain visible.
      if (match && match.side === member.side && rank[match.role] < rank[member.role] && !member.parentKeys.includes(match.key)) member.parentKeys.push(match.key);
    }
  }
  return members;
}

/** Search keeps the complete manager path to every matching employee. */
export function matchingTeamKeys(members: readonly TeamMember[], query: string, includeAncestors = true): Set<string> {
  const q = query.trim().toLowerCase();
  const keys = new Set(members.filter(m => !q || [m.name, m.title, m.role, m.model, m.peer, ...m.tags].join(' ').toLowerCase().includes(q)).map(m => m.key));
  if (!includeAncestors) return keys;
  const byKey = new Map(members.map(m => [m.key, m]));
  const visit = (key: string) => { for (const parent of byKey.get(key)?.parentKeys ?? []) if (!keys.has(parent)) { keys.add(parent); visit(parent); } };
  for (const key of [...keys]) visit(key);
  return keys;
}

export interface TeamBranch { member: TeamMember; children: TeamBranch[] }

/** Both drawer views retain reporting paths. All agents hides unfilled chart
 * positions, but keeps any placeholder needed to identify an employee's manager. */
export function buildTeamTree(members: readonly TeamMember[], query: string, includePlanned = true): TeamBranch[] {
  const candidates = includePlanned ? members : members.filter(m => m.source !== 'planned');
  const matches = matchingTeamKeys(candidates, query);
  const visible = new Set(matches);
  const byKey = new Map(members.map(m => [m.key, m]));
  const includeParents = (key: string) => {
    for (const parent of byKey.get(key)?.parentKeys ?? []) if (!visible.has(parent)) {
      visible.add(parent);
      includeParents(parent);
    }
  };
  for (const key of matches) includeParents(key);
  const shown = members.filter(m => visible.has(m.key));
  const branch = (member: TeamMember): TeamBranch => ({
    member,
    children: shown.filter(child => child.parentKeys.includes(member.key)).map(branch)
  });
  return shown.filter(m => !m.parentKeys.some(key => visible.has(key) && byKey.has(key))).map(branch);
}
