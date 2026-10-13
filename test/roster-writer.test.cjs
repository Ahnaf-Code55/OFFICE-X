const test = require('node:test');
const assert = require('node:assert/strict');
const {claimRosterWriter} = require('./load-ts.cjs')('src/renderer/src/store/rosterWriter.ts');
test('a stale renderer store cannot overwrite a replacement store’s new hires', () => {
  const owners=new Map();const old=claimRosterWriter('/hive',owners);let disk=['manager'];
  assert.equal(old(),true);
  const current=claimRosterWriter('/hive',owners);
  if(current())disk=['manager','worker'];
  if(old())disk=['manager'];
  assert.deepEqual(disk,['manager','worker']);
  assert.equal(old(),false);assert.equal(current(),true);
});
test('separate hive leases do not invalidate each other', () => {
  const owners=new Map();const a=claimRosterWriter('/one',owners);const b=claimRosterWriter('/two',owners);
  claimRosterWriter('/one',owners);
  assert.equal(a(),false);assert.equal(b(),true);
});
