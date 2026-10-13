import { COMPANY_TEAM_CHART, type TeamMember, type TeamSide } from '@shared/agentTeams';
import type { Communication, Participant } from './communication';

export interface BlockNode { id: string; key: string; label: string; member?: TeamMember; x: number; y: number; w: number; h: number; parentKey?: string }
export interface WorkerBox { id: string; x: number; y: number; w: number; h: number; caption: string }
export interface BlockGroup { side: TeamSide; x: number; y: number; w: number; h: number; nodes: BlockNode[]; workerBoxes: WorkerBox[]; reporting: string[]; count: number }
export interface BlockLayout { groups: BlockGroup[]; participants: BlockNode[]; nodes: BlockNode[]; width: number; height: number }
const CARD_W = 128, GAP = 14, PAD = 18;
const order = (m: TeamMember) => { const index = COMPANY_TEAM_CHART.findIndex(c => c.name.toLowerCase() === m.name.toLowerCase()); return index === -1 ? 1000 : index; };

/** Deterministic top-down blocks. Shared workers have several occurrences of
 * the SAME member key; missing/invalid parents produce a visible independent lane. */
export function blockLayout(members: readonly TeamMember[], participants: readonly Participant[]): BlockLayout {
  const groups: BlockGroup[] = [];
  let offset = 0;
  const top = participants.length ? 104 : 12;
  for (const side of ['ahnaf', 'turjo', 'unassigned'] as const) {
    const sideMembers = members.filter(m => m.side === side).sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
    if (!sideMembers.length) continue;
    const roots = sideMembers.filter(m => m.role === 'orchestrator');
    const managers = sideMembers.filter(m => m.role === 'manager');
    const workers = sideMembers.filter(m => m.role === 'worker');
    const loose = workers.filter(m => !m.parentKeys.some(k => managers.some(p => p.key === k)));
    const columns = [...managers.map(m => ({ manager: m, workers: workers.filter(w => w.parentKeys.includes(m.key)) })), ...(loose.length ? [{ manager: undefined, workers: loose }] : [])];
    const colCount = Math.max(columns.length, roots.length, 1);
    const width = Math.max(360, colCount * (CARD_W + GAP) - GAP + PAD * 2);
    const nodes: BlockNode[] = [], workerBoxes: WorkerBox[] = [], reporting: string[] = [];
    const place = (m: TeamMember, x: number, y: number, w: number, h: number, parentKey?: string): BlockNode => {
      const node = { id: `${side}:${m.key}:${parentKey ?? 'root'}`, key: m.key, label: m.name, member: m, x: offset + x, y: top + y, w, h, parentKey };
      nodes.push(node); return node;
    };
    const rootNodes = roots.map((root, i) => {
      const children = managers.map((m, index) => ({ m, index })).filter(({m}) => m.parentKeys.includes(root.key));
      const center = children.length ? (children[0].index + children[children.length - 1].index) / 2 * (CARD_W + GAP) + PAD + CARD_W / 2 : width * (i + 1) / (roots.length + 1);
      return place(root, Math.max(PAD, Math.min(width - 220 - PAD, center - 110)), 66, Math.min(220, width - PAD * 2), 74);
    });
    const columnY = roots.length ? 206 : 76;
    let bottom = roots.length ? 156 : 60;
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i], x = PAD + i * (CARD_W + GAP);
      const managerNode = column.manager ? place(column.manager, x, columnY, CARD_W, 86) : undefined;
      const boxY = columnY + (managerNode ? 126 : 0);
      const boxH = 30 + Math.max(1, column.workers.length) * 62 + 8;
      workerBoxes.push({ id: `${side}:workers:${i}`, x: offset + x, y: top + boxY, w: CARD_W, h: boxH, caption: column.manager ? 'Workers' : 'Independent / direct reports' });
      for (let j = 0; j < column.workers.length; j++) {
        const worker = column.workers[j];
        const workerNode = place(worker, x + 6, boxY + 28 + j * 62, CARD_W - 12, 56, column.manager?.key);
        if (!managerNode) for (const root of rootNodes.filter(r => worker.parentKeys.includes(r.key))) reporting.push(`M ${root.x + root.w/2} ${root.y + root.h} V ${top + columnY - 26} H ${workerNode.x + workerNode.w/2} V ${workerNode.y}`);
      }
      if (managerNode) {
        for (const root of rootNodes.filter(r => column.manager!.parentKeys.includes(r.key))) reporting.push(`M ${root.x + root.w/2} ${root.y + root.h} V ${top + columnY - 26} H ${managerNode.x + managerNode.w/2} V ${managerNode.y}`);
        if (column.workers.length) reporting.push(`M ${managerNode.x + managerNode.w/2} ${managerNode.y + managerNode.h} V ${top + boxY}`);
      }
      bottom = Math.max(bottom, boxY + boxH);
    }
    groups.push({side, x:offset, y:top, w:width, h:bottom + 20, nodes, workerBoxes, reporting, count:sideMembers.filter(m => m.source !== 'planned').length});
    offset += width + 22;
  }
  const external = participants.map((p, i) => ({id:p.key,key:p.key,label:p.label,x:i * 204 + 20,y:16,w:184,h:62}));
  return {groups, participants:external, nodes:[...external,...groups.flatMap(g => g.nodes)], width:Math.max(360,offset ? offset - 22 : 0, external.length * 204 + 20), height:Math.max(240,...groups.map(g => g.y + g.h + 12))};
}
export interface MessageRoute { from: BlockNode; to: BlockNode; path: string; labelX: number; labelY: number }
export function messageRoute(layout: BlockLayout, edge: Communication): MessageRoute | null {
  const sources = layout.nodes.filter(n => n.key === edge.source), targets = layout.nodes.filter(n => n.key === edge.target);
  let best: { from: BlockNode; to: BlockNode; score: number } | undefined;
  for (const from of sources) for (const to of targets) {
    const direct = from.parentKey === to.key || to.parentKey === from.key;
    const score = Math.abs(from.x-to.x) + Math.abs(from.y-to.y) - (direct ? 10000 : 0);
    if (!best || score < best.score) best = {from,to,score};
  }
  if (!best) return null;
  const {from,to} = best;
  const sx = from.x + from.w/2, tx = to.x + to.w/2;
  if (Math.abs(sx-tx) < 40 && from.y < to.y) {
    return {from,to,path:`M ${sx} ${from.y+from.h+2} V ${to.y-3}`,labelX:sx,labelY:(from.y+from.h+to.y)/2-5};
  }
  if (Math.abs(sx-tx) < 40 && from.y > to.y) {
    const channel=Math.max(from.x+from.w,to.x+to.w)+12;
    return {from,to,path:`M ${from.x+from.w+2} ${from.y+from.h/2} H ${channel} V ${to.y+to.h/2} H ${to.x+to.w+3}`,labelX:channel+6,labelY:(from.y+to.y)/2+20};
  }
  if (from.y+from.h < to.y && to.member?.role === 'worker' && from.member?.role === 'orchestrator') {
    const parent=layout.nodes.find(n=>n.key===to.parentKey);
    const channel=(parent ? parent.x+parent.w : to.x+to.w)+4;
    const turn=from.y+from.h+18;
    return {from,to,path:`M ${sx} ${from.y+from.h+2} V ${turn} H ${channel} V ${to.y+to.h/2} H ${to.x+to.w+3}`,labelX:(sx+channel)/2,labelY:turn-10};
  }
  if (from.y > to.y) {
    const parent=layout.nodes.find(n=>n.key===from.parentKey);
    const channel=(parent ? parent.x+parent.w : from.x+from.w)+10;
    const turn=to.y+to.h+18;
    return {from,to,path:`M ${from.x+from.w+2} ${from.y+from.h/2} H ${channel} V ${turn} H ${tx} V ${to.y+to.h+3}`,labelX:(tx+channel)/2,labelY:turn+14};
  }
  if (from.y+from.h < to.y) {
    const mid=(from.y+from.h+to.y)/2;
    return {from,to,path:`M ${sx} ${from.y+from.h+2} V ${mid} H ${tx} V ${to.y-3}`,labelX:(sx+tx)/2,labelY:mid-10};
  }
  const channel=Math.min(from.y,to.y)-(from.member?.role==='worker' ? (from.x<to.x ? 40 : 54) : (from.x<to.x ? 18 : 34));
  return {from,to,path:`M ${sx} ${from.y-2} V ${channel} H ${tx} V ${to.y-3}`,labelX:(sx+tx)/2,labelY:channel-8};
}
