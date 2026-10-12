/** A renderer-independent description of one piece of office furniture. */
export interface FurnitureItem {
  kind: 'desk' | 'chair' | 'monitor' | 'shelf' | 'cabinet' | 'table' | 'sofa' | 'plant' | 'counter' | 'appliance' | 'box';
  x: number;
  z: number;
  w: number;
  d: number;
  rot: 0 | 90 | 180 | 270;
  color: [number, number, number];
  tiles: Array<[number, number]>;
}

export interface PlannerMap {
  width: number;
  height: number;
  layers: Array<{ name: string; type: string; data?: number[] }>;
}

const ID_MASK = 0x1fffffff;
const FALLBACK_COLOR: [number, number, number] = [0.48, 0.38, 0.29];

type RGB = [number, number, number];
type Bounds = { x: number; y: number; w: number; d: number };
type Family = 'green' | 'purple' | 'wood' | 'neutral' | 'other';

function tileId(raw: number | undefined): number {
  return ((raw ?? 0) >>> 0) & ID_MASK;
}

function boundsOf(tiles: Array<[number, number]>): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of tiles) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX + 1, d: maxY - minY + 1 };
}

function normalise(c: RGB): RGB {
  const scale = Math.max(...c) > 1 ? 1 / 255 : 1;
  return [
    Math.max(0, Math.min(1, c[0] * scale)),
    Math.max(0, Math.min(1, c[1] * scale)),
    Math.max(0, Math.min(1, c[2] * scale)),
  ];
}

function componentColor(
  tiles: Array<[number, number]>,
  width: number,
  below: number[],
  avgColor: (gid: number) => RGB | undefined,
): RGB {
  let r = 0, g = 0, b = 0, n = 0;
  for (const [x, y] of tiles) {
    const c = avgColor(tileId(below[y * width + x]));
    if (!c) continue;
    const rgb = normalise(c);
    r += rgb[0]; g += rgb[1]; b += rgb[2]; n++;
  }
  return n ? [r / n, g / n, b / n] : [...FALLBACK_COLOR];
}

function colourFamily([r, g, b]: RGB): Family {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (g > r * 1.12 && g > b * 1.08) return 'green';
  if (r > g * 1.16 && b > g * 1.05) return 'purple';
  if (r > g * 1.08 && g >= b * 0.92 && r - b > 0.08) return 'wood';
  if (max - min < 0.16 || (r + g + b) / 3 > 0.7) return 'neutral';
  return 'other';
}

function familyCounts(
  tiles: Array<[number, number]>,
  width: number,
  below: number[],
  avgColor: (gid: number) => RGB | undefined,
): Record<Family, number> {
  const counts: Record<Family, number> = { green: 0, purple: 0, wood: 0, neutral: 0, other: 0 };
  for (const [x, y] of tiles) {
    const c = avgColor(tileId(below[y * width + x]));
    if (c) counts[colourFamily(normalise(c))]++;
  }
  return counts;
}

function connectedComponents(
  width: number,
  height: number,
  include: (x: number, y: number) => boolean,
): Array<Array<[number, number]>> {
  const seen = new Uint8Array(width * height);
  const result: Array<Array<[number, number]>> = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const start = y * width + x;
    if (seen[start] || !include(x, y)) continue;
    seen[start] = 1;
    const pending: Array<[number, number]> = [[x, y]];
    const tiles: Array<[number, number]> = [];
    while (pending.length) {
      const [cx, cy] = pending.pop()!;
      tiles.push([cx, cy]);
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as Array<[number, number]>) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const i = ny * width + nx;
        if (!seen[i] && include(nx, ny)) { seen[i] = 1; pending.push([nx, ny]); }
      }
    }
    tiles.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    result.push(tiles);
  }
  return result;
}

function hasAbove(tiles: Array<[number, number]>, width: number, above: number[]): boolean {
  return tiles.some(([x, y]) => tileId(above[y * width + x]) !== 0);
}

function classify(
  tiles: Array<[number, number]>,
  box: Bounds,
  color: RGB,
  decorated: boolean,
  families: Record<Family, number>,
): FurnitureItem['kind'] {
  const family = colourFamily(color);
  const n = tiles.length;
  const long = Math.max(box.w, box.d), short = Math.min(box.w, box.d);

  if (families.green > 0 && n <= 4 && long <= 2) return 'plant';

  // A solid block that is large and wide in both directions is a conference/
  // boardroom table, however it is coloured; sofas are long but narrow.
  if (long >= 4 && short >= 3 && n >= 8) return 'table';

  if ((family === 'purple' || families.purple >= 2) && long >= 3 && n >= 4) return 'sofa';
  if (n === 1) {
    if (family === 'neutral') return 'appliance';
    return 'box';
  }

  // The maps' workstation art is normally three tiles wide, with screen and
  // keyboard pixels in furniture-above. A monitor item models the whole desk
  // station, so its tiles never overlap a second desk item.
  if (decorated && box.w >= 3 && box.d === 1) return 'monitor';
  if (decorated && long <= 3 && short <= 2) return 'desk';

  // Tall green runs in the interiors tileset are lockers/filing units, not
  // foliage; requiring a small footprint above keeps that distinction.
  if (family === 'green') return box.d >= 3 ? 'cabinet' : 'shelf';

  if (family === 'neutral') {
    if (long >= 4 && short <= 2) return 'shelf';
    if (box.d >= 3 && box.w <= 3) return 'cabinet';
    return n >= 6 ? 'appliance' : 'cabinet';
  }

  if (long >= 6 && short <= 2) return family === 'wood' ? 'counter' : 'shelf';
  // Large wide blocks are tables regardless of colour (caught above when
  // solid; sparse shapes reach here).
  if (box.w >= 4 && box.d >= 3) return 'table';
  if (long >= 4 && short <= 2) return family === 'purple' ? 'sofa' : 'counter';
  if (box.w >= 3 && box.d >= 2) return 'table';
  if (long >= 2) return family === 'wood' ? 'desk' : 'cabinet';
  return 'box';
}

function rotationFor(box: Bounds): 0 | 90 | 180 | 270 {
  return box.d > box.w ? 90 : 0;
}

/**
 * Convert the blocking furniture art in a Tiled map into compact 3D props.
 * Only structural map data and caller-provided colours are used, keeping this
 * function deterministic and usable from node tests.
 */
export function planFurniture(
  map: PlannerMap,
  isWalkable: (x: number, y: number) => boolean,
  avgColor: (gid: number) => RGB | undefined,
): FurnitureItem[] {
  const below = map.layers.find((l) => l.name === 'furniture-below' && l.type === 'tilelayer')?.data ?? [];
  const above = map.layers.find((l) => l.name === 'furniture-above' && l.type === 'tilelayer')?.data ?? [];
  const present = (x: number, y: number) => tileId(below[y * map.width + x]) !== 0;
  const items: FurnitureItem[] = [];

  const blocking = connectedComponents(map.width, map.height, (x, y) => present(x, y) && !isWalkable(x, y));
  for (const tiles of blocking) {
    const box = boundsOf(tiles);
    const color = componentColor(tiles, map.width, below, avgColor);
    items.push({
      kind: classify(tiles, box, color, hasAbove(tiles, map.width, above), familyCounts(tiles, map.width, below, avgColor)),
      x: box.x, z: box.y, w: box.w, d: box.d, rot: rotationFor(box), color, tiles,
    });
  }

  // Chairs deliberately remain walkable in the simulation. In the LimeZu
  // maps their top and base pixels are adjacent, so component grouping keeps
  // a two-tile chair together while retaining isolated one-tile stools.
  const walkable = connectedComponents(map.width, map.height, (x, y) => present(x, y) && isWalkable(x, y));
  for (const tiles of walkable) {
    const box = boundsOf(tiles);
    const color = componentColor(tiles, map.width, below, avgColor);
    const family = colourFamily(color);
    if (tiles.length > 3 || box.w > 2 || box.d > 2 || (family !== 'wood' && family !== 'other')) continue;
    items.push({ kind: 'chair', x: box.x, z: box.y, w: box.w, d: box.d, rot: rotationFor(box), color, tiles });
  }

  return items.sort((a, b) => a.z - b.z || a.x - b.x || a.kind.localeCompare(b.kind));
}
