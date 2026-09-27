'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const maps = path.join(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'maps');
const filenames = ['office.tmj', 'floor-2.tmj', 'floor-3.tmj'];

test('each floor has its own wall and furniture layout', () => {
  const floorLayers = filenames.map((filename) => {
    const map = JSON.parse(fs.readFileSync(path.join(maps, filename), 'utf8'));
    return Object.fromEntries(map.layers.map((layer) => [layer.name, layer]));
  });
  for (let a = 0; a < filenames.length; a++) {
    for (let b = a + 1; b < filenames.length; b++) {
      for (const name of ['walls', 'furniture-below']) {
        assert.notDeepEqual(floorLayers[a][name].data, floorLayers[b][name].data,
          `${filenames[a]} and ${filenames[b]} share the same ${name} layer`);
      }
    }
  }
});

for (const [filename, requiredZones] of [
  ['office.tmj', ['lobby', 'reception', 'cafeteria', 'engineering']],
  ['floor-2.tmj', ['ceo-founder', 'boardroom', 'ciso-security', 'human-resources', 'finance', 'operations']],
  ['floor-3.tmj', ['product-design', 'data-ai-lab', 'meeting-room-a', 'meeting-room-b']]
]) {
  test(`${filename} has walkable desks and its department zones`, () => {
    const map = JSON.parse(fs.readFileSync(path.join(maps, filename), 'utf8'));
    assert.equal(map.width, 48);
    assert.equal(map.height, 30);
    assert.deepEqual(map.tilesets.map((tileset) => tileset.firstgid), [1, 513, 1025]);
    const layers = Object.fromEntries(map.layers.map((layer) => [layer.name, layer]));
    for (const name of ['floor', 'walls', 'furniture-below', 'furniture-above', 'collision']) {
      assert.equal(layers[name].data.length, map.width * map.height, `${name} dimensions`);
    }
    for (const name of requiredZones) assert.ok(layers.zones.objects.some((zone) => zone.name === name), name);
    const points = Object.fromEntries(layers['spawn-points'].objects.map((o) => [o.name, [Math.round(o.x / 16), Math.round(o.y / 16)]]));
    assert.ok(points.entrance);
    const reached = new Set([points.entrance.join(',')]);
    const queue = [points.entrance];
    for (const [x, y] of queue) {
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const key = `${nx},${ny}`;
        if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height
          && layers.collision.data[ny * map.width + nx] === 0 && !reached.has(key)) {
          reached.add(key);
          queue.push([nx, ny]);
        }
      }
    }
    for (const [name, [x, y]] of Object.entries(points)) {
      assert.ok(x >= 0 && x < map.width && y >= 0 && y < map.height, `${name} is inside the map`);
      assert.equal(layers.collision.data[y * map.width + x], 0, `${name} is on a walkable tile`);
      assert.ok(reached.has(`${x},${y}`), `${name} is unreachable from entrance`);
      if (name.startsWith('pc-') || name.startsWith('desk-')) {
        const deskAdjacent = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
          .some(([dx, dy]) => dx >= 0 && dx < map.width && dy >= 0 && dy < map.height
            && layers.collision.data[dy * map.width + dx] !== 0
            && (layers['furniture-below'].data[dy * map.width + dx] !== 0
              || layers['furniture-above'].data[dy * map.width + dx] !== 0));
        assert.ok(deskAdjacent, `${name} has no adjacent desk furniture`);
      }
    }
    for (const zone of layers.zones.objects) {
      const x0 = zone.x / map.tilewidth;
      const y0 = zone.y / map.tileheight;
      const x1 = x0 + zone.width / map.tilewidth;
      const y1 = y0 + zone.height / map.tileheight;
      assert.ok([x0, y0, x1, y1].every(Number.isInteger), `${zone.name} uses whole tiles`);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          assert.equal(layers.walls.data[y * map.width + x], 0,
            `${zone.name} contains a wall at ${x},${y}`);
        }
      }
      for (const edge of [
        Array.from({ length: x1 - x0 }, (_, i) => [x0 + i, y0 - 1]),
        Array.from({ length: x1 - x0 }, (_, i) => [x0 + i, y1]),
        Array.from({ length: y1 - y0 }, (_, i) => [x0 - 1, y0 + i]),
        Array.from({ length: y1 - y0 }, (_, i) => [x1, y0 + i])
      ]) {
        let wallTiles = 0;
        let opening = 0;
        for (const [x, y] of edge) {
          const isWall = x >= 0 && x < map.width && y >= 0 && y < map.height
            && layers.walls.data[y * map.width + x] !== 0;
          if (isWall) { wallTiles++; opening = 0; }
          else opening++;
          assert.ok(opening <= 2, `${zone.name} has an opening wider than a door`);
        }
        assert.ok(wallTiles >= Math.ceil(edge.length * 0.6),
          `${zone.name} has an open boundary instead of walls and doors`);
      }
    }
  });
}
