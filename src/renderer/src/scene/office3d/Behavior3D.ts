import type { Pose3D } from './Person3D';

type Dir = 'down' | 'up' | 'left' | 'right';

/** What the director needs to know about one person each frame. */
export interface BehaviorInput {
  id: string;
  x: number; y: number;                 // feet, in tiles
  anim: 'idle' | 'walk' | 'type' | 'read';
  sitting: boolean;
  status?: string;                       // agent status ('waiting' = asking for approval)
  carrying?: string;                     // tool the agent is hauling (ToolKind)
}

export interface BehaviorOut { pose: Pose3D; dir?: Dir }

interface Act { pose: Pose3D; until: number; dir?: Dir }

const PAPER_TOOLS = /^(Read|Edit|Write|WebFetch|WebSearch|TodoWrite)$/;
const FIGHT_RANGE = 2.2;      // tiles
const QUIRK_GAP: [number, number] = [18, 55];   // seconds between random quirks
const FIGHT_GAP: [number, number] = [45, 120];  // seconds between brawls

function faceTo(dx: number, dy: number): Dir {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

/**
 * Decides, per person, which extra "human" pose to show: hauling boxes or paper,
 * asking for approval, nose picking, freaking out, and the odd brawl between two
 * colleagues who happen to stand close. Pure bookkeeping in two small Maps: no
 * allocation per frame beyond the returned Map, which is reused.
 */
export class Behavior3D {
  private acts = new Map<string, Act>();
  private nextQuirk = new Map<string, number>();
  private nextFight = 20 + Math.random() * 40;
  private clock = 0;
  private out = new Map<string, BehaviorOut>();
  private blows: Array<{ a: string; b: string; at: number; dx: number; dy: number }> = [];

  update(dt: number, people: BehaviorInput[]): Map<string, BehaviorOut> {
    this.clock += Math.min(dt, 0.1);
    const now = this.clock;
    this.out.clear();

    // drop finished acts and people who left
    for (const [id, a] of this.acts) if (a.until <= now) this.acts.delete(id);

    // the glare is over: throw the punches and kicks
    this.blows = this.blows.filter((w) => {
      if (w.at > now) return true;
      this.startBlows(w.a, w.b, w.at, w.dx, w.dy);
      return false;
    });

    // brawl: two standing people close together square up, trade blows, then glare
    if (now >= this.nextFight) {
      this.nextFight = now + FIGHT_GAP[0] + Math.random() * (FIGHT_GAP[1] - FIGHT_GAP[0]);
      const free = people.filter((p) => !p.sitting && p.anim !== 'walk' && !this.acts.has(p.id));
      outer: for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
        const a = free[i], b = free[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) > FIGHT_RANGE) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        this.acts.set(a.id, { pose: 'angry', until: now + 1.8, dir: faceTo(dx, dy) });
        this.acts.set(b.id, { pose: 'angry', until: now + 1.8, dir: faceTo(-dx, -dy) });
        // after the glare, the fists (one boxer, one kickboxer)
        this.blows.push({ a: a.id, b: b.id, at: now + 1.8, dx, dy });
        break outer;
      }
    }

    for (const p of people) {
      const act = this.acts.get(p.id);
      if (act) { this.out.set(p.id, { pose: act.pose, dir: act.dir }); continue; }

      if (p.anim === 'walk' && p.carrying) {
        this.out.set(p.id, { pose: PAPER_TOOLS.test(p.carrying) ? 'carryPaper' : 'carryBox' });
        continue;
      }
      if (p.status === 'waiting' && p.anim !== 'walk') {
        this.out.set(p.id, { pose: 'askApproval' });
        continue;
      }
      if (p.anim === 'idle' || p.anim === 'read') {
        const due = this.nextQuirk.get(p.id) ?? now + QUIRK_GAP[0] + Math.random() * (QUIRK_GAP[1] - QUIRK_GAP[0]);
        if (!this.nextQuirk.has(p.id)) this.nextQuirk.set(p.id, due);
        if (now >= due) {
          this.nextQuirk.set(p.id, now + QUIRK_GAP[0] + Math.random() * (QUIRK_GAP[1] - QUIRK_GAP[0]));
          // seated people can only do the arm/head quirks
          const pool: Pose3D[] = p.sitting ? ['pickNose', 'angry'] : ['pickNose', 'crazy', 'angry'];
          this.acts.set(p.id, { pose: pool[Math.floor(Math.random() * pool.length)], until: now + 3 + Math.random() * 2 });
        }
      }
    }
    // forget quirk timers of people who are gone
    if (this.nextQuirk.size > people.length + 8) {
      const ids = new Set(people.map((p) => p.id));
      for (const id of this.nextQuirk.keys()) if (!ids.has(id)) this.nextQuirk.delete(id);
    }
    return this.out;
  }

  private startBlows(a: string, b: string, at: number, dx: number, dy: number): void {
    this.acts.set(a, { pose: 'punch', until: at + 4, dir: faceTo(dx, dy) });
    this.acts.set(b, { pose: 'kick', until: at + 4, dir: faceTo(-dx, -dy) });
  }
}

