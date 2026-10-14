import type { TeamMember, TeamRole, TeamSide } from './agentTeams';

export const AGENT_ROLE_SECTIONS: readonly { role: TeamRole; label: string; singular: string }[] = [
  { role: 'orchestrator', label: 'Orchestrators', singular: 'orchestrator' },
  { role: 'manager', label: 'Managers', singular: 'manager' },
  { role: 'worker', label: 'Employees', singular: 'employee' }
];

export interface RoleDockPreferences { open: boolean; role: TeamRole; side: TeamSide | 'all' }
/** Old Teams/All agents preferences migrate without touching roster metadata. */
export function readRoleDockPreferences(input: unknown): RoleDockPreferences {
  const saved = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return {
    open: saved.open === true,
    role: AGENT_ROLE_SECTIONS.some(section => section.role === saved.role) ? saved.role as TeamRole : 'worker',
    side: ['turjo', 'ahnaf', 'unassigned'].includes(String(saved.side)) ? saved.side as TeamSide : 'all'
  };
}

export interface AgentRoleRow { member: TeamMember; reportsTo: TeamMember[] }
/** One row per identity, with every assigned parent in a separate column. */
export function buildAgentRoleRows(members: readonly TeamMember[], role: TeamRole, side: TeamSide | 'all', query = ''): AgentRoleRow[] {
  const byKey = new Map(members.map(member => [member.key, member]));
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  return members.flatMap(member => {
    if (seen.has(member.key) || member.source === 'planned' || member.role !== role || (side !== 'all' && member.side !== side)) return [];
    seen.add(member.key);
    const reportsTo = [...new Set(member.parentKeys)].flatMap(key => byKey.has(key) ? [byKey.get(key)!] : []);
    const searchable = [member.name, member.title, member.model, member.peer, ...member.tags, ...reportsTo.map(parent => parent.name)].join(' ').toLowerCase();
    return !q || searchable.includes(q) ? [{ member, reportsTo }] : [];
  });
}
