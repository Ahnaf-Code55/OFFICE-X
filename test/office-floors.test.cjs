'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const maps = path.join(__dirname, '..', 'src', 'renderer', 'src', 'assets', 'maps');

for (const [filename, requiredZones] of [
  ['office.tmj', ['lobby', 'reception', 'cafeteria', 'engineering']],
  ['floor-2.tmj', ['ceo-founder', 'boardroom', 'ciso-security', 'human-resources', 'finance']],
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
      if (name.startsWith('pc-') || name.startsWith('desk-')) {
        assert.ok(reached.has(`${x},${y}`), `${name} is unreachable from entrance`);
      }
    }
  });
}
