import { useEffect, useState } from 'react';
import type { UsageLimits, UsageWindow } from '../../../shared/usageLimits';

type Limits = { claude?: UsageLimits; codex?: UsageLimits };

const until = (sec: number): string => {
  const m = Math.max(0, Math.round((sec * 1000 - Date.now()) / 60000));
  return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

function Bar({ label, w }: { label: string; w?: UsageWindow }) {
  if (!w) return null;
  const pct = Math.round(w.percent);
  const color = pct >= 90 ? 'var(--cth-rose-500, #d9534f)' : pct >= 70 ? 'var(--cth-amber-500, #e0a030)' : 'var(--cth-mint-500, #3fae7a)';
  return <div title={`resets in ${until(w.resetsAt)}`}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{label}</span><span>{pct}% · {until(w.resetsAt)}</span></div>
    <div style={{ height: 4, background: 'var(--cth-ink-200, #ddd)' }}><div style={{ height: 4, width: `${Math.min(100, pct)}%`, background: color }} /></div>
  </div>;
}

/** Floating Claude / Codex plan usage (5h + weekly), always on top of the office. Click the title to fold it. */
export function UsageFloat() {
  const [limits, setLimits] = useState<Limits>({});
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // Optional call: a renderer hot-reloaded over an older preload has no usageLimits yet.
    const poll = () => { window.cth.usageLimits?.().then(setLimits).catch(() => undefined); };
    poll();
    const iv = setInterval(poll, 30_000);
    return () => clearInterval(iv);
  }, []);
  const rows = ([['Claude', limits.claude], ['Codex', limits.codex]] as const).filter(([, l]) => l);
  return <div style={{
    position: 'fixed', left: 12, bottom: 12, zIndex: 60, width: 210, padding: '6px 8px', display: 'grid', gap: 6,
    fontFamily: 'var(--cth-font-mono)', fontSize: 11, background: 'var(--cth-cream-50)', color: 'var(--cth-ink-900)',
    boxShadow: '0 0 0 2px var(--cth-ink-900), 3px 3px 0 var(--cth-ink-900)', opacity: 0.92
  }}>
    <button onClick={() => setOpen(!open)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700 }}>{open ? '▾' : '▸'} Plan usage</button>
    {open && (rows.length ? rows.map(([name, l]) => <div key={name} style={{ display: 'grid', gap: 3 }}>
      <strong>{name}</strong>
      <Bar label="5-hour" w={l!.fiveHour} />
      <Bar label="Weekly" w={l!.weekly} />
    </div>) : <span>Waiting for an agent to reply…</span>)}
  </div>;
}
