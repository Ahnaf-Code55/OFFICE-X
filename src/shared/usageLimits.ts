/** Plan usage windows shown in the floating usage box. Percent is 0-100, resetsAt is epoch seconds. */
export interface UsageWindow { percent: number; resetsAt: number }
export interface UsageLimits { fiveHour?: UsageWindow; weekly?: UsageWindow; seenAt: number }

const win = (w: unknown, pct: string): UsageWindow | undefined => {
  const o = w as Record<string, unknown> | undefined;
  return o && typeof o[pct] === 'number' && typeof o.resets_at === 'number'
    ? { percent: o[pct] as number, resetsAt: o.resets_at as number } : undefined;
};

/** Claude statusLine `rate_limits` → windows. */
export function claudeLimits(r: unknown): UsageLimits | undefined {
  const o = r as Record<string, unknown> | undefined;
  if (!o) return undefined;
  const fiveHour = win(o.five_hour, 'used_percentage'), weekly = win(o.seven_day, 'used_percentage');
  return fiveHour || weekly ? { fiveHour, weekly, seenAt: Date.now() } : undefined;
}

/** Last `"rate_limits":{...}` in a Codex rollout log → windows (primary = 5h, secondary = weekly). */
export function codexLimits(rolloutTail: string): UsageLimits | undefined {
  const at = rolloutTail.lastIndexOf('"rate_limits":');
  if (at < 0) return undefined;
  const line = rolloutTail.slice(rolloutTail.lastIndexOf('\n', at) + 1).split('\n')[0];
  try {
    const find = (v: unknown): unknown => {
      if (!v || typeof v !== 'object') return undefined;
      const o = v as Record<string, unknown>;
      return 'rate_limits' in o ? o.rate_limits : Object.values(o).map(find).find(Boolean);
    };
    const r = find(JSON.parse(line)) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    const fiveHour = win(r.primary, 'used_percent'), weekly = win(r.secondary, 'used_percent');
    return fiveHour || weekly ? { fiveHour, weekly, seenAt: Date.now() } : undefined;
  } catch { return undefined; }
}

/** OpenCode Go usage API payload (`rolling`, `weekly`, `monthly`) → panel windows. */
export function openCodeGoLimits(payload: unknown): UsageLimits | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const windows = usage as Record<string, unknown>;
  const parseWindow = (value: unknown): UsageWindow | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const w = value as Record<string, unknown>;
    if (w.status && w.status !== 'ok') return undefined;
    if (typeof w.percent !== 'number' || !Number.isFinite(w.percent)) return undefined;
    const resetMs = typeof w.resetsAt === 'string'
      ? Date.parse(w.resetsAt)
      : typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : NaN;
    if (!Number.isFinite(resetMs)) return undefined;
    return { percent: Math.max(0, Math.min(100, w.percent)), resetsAt: Math.floor(resetMs / 1000) };
  };
  const fiveHour = parseWindow(windows.rolling), weekly = parseWindow(windows.weekly);
  return fiveHour || weekly ? { fiveHour, weekly, seenAt: Date.now() } : undefined;
}
