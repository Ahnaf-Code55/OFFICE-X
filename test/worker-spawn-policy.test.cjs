'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { workerCap, maySpawnWorker, MAX_ORCHESTRATOR_WORKERS, WORKER_SPAWN_GAP_MS } = loadTs('src/shared/workerSpawnPolicy.ts');

test('at most 3 orchestrator workers run at once, whatever is configured', () => {
  assert.equal(MAX_ORCHESTRATOR_WORKERS, 3);
  assert.equal(workerCap(undefined), 3);
  assert.equal(workerCap(8), 3, 'an old config of 4-16 is clamped');
  assert.equal(workerCap(2), 2);
  assert.equal(workerCap(0), 1);
});

test('a burst of spawn-requests starts one by one, a gap apart, up to the cap', () => {
  const cap = workerCap(undefined);
  let live = 0;
  let lastSpawnAt = null;
  const started = [];
  // Eight requests dropped at once; tick every 1.5 s for 4 minutes.
  for (let now = 0; now <= 4 * 60_000; now += 1500) {
    if (maySpawnWorker({ live, cap, lastSpawnAt, now })) { live++; lastSpawnAt = now; started.push(now); }
  }
  assert.deepEqual(started, [0, WORKER_SPAWN_GAP_MS, 2 * WORKER_SPAWN_GAP_MS], 'three workers, a minute apart, then the queue waits');
  assert.equal(maySpawnWorker({ live: 3, cap, lastSpawnAt: 0, now: 10 * 60_000 }), false, 'full floor never spawns');
  assert.equal(maySpawnWorker({ live: 2, cap, lastSpawnAt: 0, now: 10 * 60_000 }), true, 'a slot frees up after a worker ends');
});
