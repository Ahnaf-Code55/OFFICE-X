export type OfficeFloorNumber = 1 | 2 | 3;

export function isOfficeFloorNumber(value: unknown): value is OfficeFloorNumber {
  return value === 1 || value === 2 || value === 3;
}

/** An explicit assignment wins; older roster entries get a role-based floor. */
export function floorForAgent(agent: { floor?: unknown; isGod?: boolean; description?: string }): OfficeFloorNumber {
  if (isOfficeFloorNumber(agent.floor)) return agent.floor;
  if (agent.isGod) return 2;
  const role = agent.description ?? '';
  if (/\b(ceo|founder|ciso|security|human resources|hr|finance|cfo|operations)\b/i.test(role)) return 2;
  if (/\b(product|design|data|ai lab|machine learning|research)\b/i.test(role)) return 3;
  return 1;
}
