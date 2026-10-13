'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { planFurniture } = loadTs('src/renderer/src/scene/office3d/FurniturePlanner.ts');

const ID_MASK = 0x1fffffff;
const MAP_DIR = path.resolve(__dirname, '../src/renderer/src/assets/maps');

function loadPlan(filename) {
  const map = JSON.parse(fs.readFileSync(path.join(MAP_DIR, filename), 'utf8'));
  const collision = map.layers.find((layer) => layer.name === 'collision' && layer.type === 'tilelayer');
  assert.ok(collision?.data, `${filename} has a collision tile layer`);
  const isWalkable = (x, y) => (((collision.data[y * map.width + x] ?? 0) >>> 0) & ID_MASK) === 0;
  // A stable wood swatch makes this a planner/geometry test rather than an
  // image decoding test. Production supplies the real per-gid average.
  const items = planFurniture(map, isWalkable, () => [0.62, 0.43, 0.25]);
  return { map, items };
}

for (const filename of ['office.tmj', 'floor-2.tmj', 'floor-3.tmj']) {
  test(`plans non-overlapping furniture from ${filename}`, () => {
    const { map, items } = loadPlan(filename);
    assert.ok(items.length > 0, 'the plan is non-empty');

    const occupied = new Set();
    for (const item of items) {
      assert.ok(Number.isInteger(item.x) && Number.isInteger(item.z), 'item origin is tile-aligned');
      assert.ok(Number.isInteger(item.w) && Number.isInteger(item.d) && item.w > 0 && item.d > 0,
        'item footprint is a positive whole number of tiles');
      assert.ok(item.tiles.length > 0, 'every item replaces at least one source tile');
      for (const tile of item.tiles) {
        assert.equal(tile.length, 2);
        const [x, y] = tile;
        assert.ok(Number.isInteger(x) && Number.isInteger(y), 'tile coordinates are integers');
        assert.ok(x >= 0 && x < map.width && y >= 0 && y < map.height, 'tile is inside the map');
        assert.ok(x >= item.x && x < item.x + item.w && y >= item.z && y < item.z + item.d,
          'tile is inside its item footprint');
        const key = `${x},${y}`;
        assert.equal(occupied.has(key), false, `tile ${key} appears in only one item`);
        occupied.add(key);
      }
    }

    const boxes = items.filter((item) => item.kind === 'box').length;
    assert.ok(boxes / items.length < 0.4, `box fallback ratio is below 40% (${boxes}/${items.length})`);
  });
}

test('the main office contains desks and walkable chairs', () => {
  const { items } = loadPlan('office.tmj');
  assert.ok(items.some((item) => item.kind === 'desk'), 'at least one desk is classified');
  assert.ok(items.some((item) => item.kind === 'chair'), 'at least one chair is classified');
});

test('a large wide boardroom block is a table, not a sofa', () => {
  const width = 12, height = 10;
  const below = new Array(width * height).fill(0);
  // Solid 6x4 block: boardroom-table-sized.
  for (let y = 2; y < 6; y++) for (let x = 2; x < 8; x++) below[y * width + x] = 5;
  // Long narrow 4x1 run in the same purple colour: a sofa.
  for (let x = 2; x < 6; x++) below[8 * width + x] = 7;
  const map = { width, height, layers: [{ name: 'furniture-below', type: 'tilelayer', data: below }] };
  const purple = [0.52, 0.3, 0.62];
  const items = planFurniture(map, () => false, () => purple);
  const block = items.find((item) => item.w === 6 && item.d === 4);
  assert.equal(block?.kind, 'table', 'large wide block classifies as table');
  const run = items.find((item) => item.w === 4 && item.d === 1);
  assert.equal(run?.kind, 'sofa', 'long narrow purple run still classifies as sofa');
});
