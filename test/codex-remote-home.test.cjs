const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareCodexRemoteHome } = require('./load-ts.cjs')('src/main/codexRemoteHome.ts');

test('remote socket setup creates a private parent and repairs existing broad permissions', { skip: process.platform === 'win32' }, t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-socket-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.equal(prepareCodexRemoteHome(home), true);
  const control = path.join(home, 'app-server-control');
  fs.chmodSync(control, 0o777);
  assert.equal(prepareCodexRemoteHome(home), true);
  assert.equal(fs.statSync(control).mode & 0o077, 0);
});

test('remote setup refuses occupied files and symlinks without changing their targets', { skip: process.platform === 'win32' }, t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-socket-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const control = path.join(home, 'app-server-control');
  fs.writeFileSync(control, 'occupied');
  assert.equal(prepareCodexRemoteHome(home), false);
  assert.equal(fs.readFileSync(control, 'utf8'), 'occupied');
  fs.unlinkSync(control);
  const target = path.join(home, 'target'); fs.mkdirSync(target); fs.chmodSync(target, 0o755);
  fs.symlinkSync(target, control);
  assert.equal(prepareCodexRemoteHome(home), false);
  assert.equal(fs.statSync(target).mode & 0o777, 0o755);
});
