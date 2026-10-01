/**
 * How fast the orchestrator may add workers. Every worker is a fresh spend, and a
 * god that drops five or eight spawn-requests at once used to get them all in one
 * tick, so the floor lit up and drained the owner's usage. Now at most
 * MAX_ORCHESTRATOR_WORKERS run at once, and they start one at a time, at least
 * WORKER_SPAWN_GAP_MS apart; the rest wait in spawn-requests/ (never dropped).
 */
export const MAX_ORCHESTRATOR_WORKERS = 3;
export const WORKER_SPAWN_GAP_MS = 60_000;

/** The effective concurrency cap: the configured value, clamped to 1..MAX. */
export function workerCap(configured: number | undefined): number {
  const n = Number.isFinite(configured) ? Math.floor(configured as number) : MAX_ORCHESTRATOR_WORKERS;
  return Math.min(MAX_ORCHESTRATOR_WORKERS, Math.max(1, n));
}

/** True when one more queued spawn-request may start now. */
export function maySpawnWorker(input: { live: number; cap: number; lastSpawnAt: number | null; now: number; gapMs?: number }): boolean {
  const gap = input.gapMs ?? WORKER_SPAWN_GAP_MS;
  return input.live < input.cap && (input.lastSpawnAt === null || input.now - input.lastSpawnAt >= gap);
}
