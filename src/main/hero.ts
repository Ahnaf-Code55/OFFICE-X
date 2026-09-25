/**
 * The Settings hero is intentionally local in OFFICE-X. The upstream project
 * supplies marketing copy and external founder/sponsor links; this fork keeps
 * the neutral built-in plan and lets the app render normally offline.
 */
import { DEFAULT_HERO, type HeroPayload } from '../shared/heroPayload';

export async function loadHero(
  _cachePath: string,
  _opts: { force?: boolean } = {}
): Promise<{ hero: HeroPayload; fetchedAt: number; stale: boolean }> {
  return { hero: DEFAULT_HERO, fetchedAt: 0, stale: true };
}
