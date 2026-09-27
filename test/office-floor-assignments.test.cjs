'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { floorForAgent, isOfficeFloorNumber } = loadTs('src/shared/officeFloors.ts');

test('legacy agents get a stable department floor and explicit moves win', () => {
  assert.equal(floorForAgent({ isGod: true }), 2);
  assert.equal(floorForAgent({ description: 'Chief Information Security Officer (CISO)' }), 2);
  assert.equal(floorForAgent({ description: 'Product designer' }), 3);
  assert.equal(floorForAgent({ description: 'Backend engineer' }), 1);
  assert.equal(floorForAgent({ isGod: true, floor: 3 }), 3);
  assert.equal(floorForAgent({ description: 'CISO', floor: 1 }), 1);
  assert.equal(isOfficeFloorNumber(4), false);
});
