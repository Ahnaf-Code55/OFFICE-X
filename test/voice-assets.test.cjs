'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { installPinnedVoiceFile, onVoiceDownloadProgress } = loadTs('src/main/voice/assets.ts');

test('first-use voice asset download verifies SHA-256 and reports progress', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-asset-test-'));
  const content = Buffer.from('pinned test voice model');
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.setHeader('content-length', content.length);
    res.end(content);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const events = [];
  const unsubscribe = onVoiceDownloadProgress((event) => events.push(event));
  try {
    const url = `http://127.0.0.1:${server.address().port}/model`;
    const asset = {
      name: 'model.bin', url,
      sha256: createHash('sha256').update(content).digest('hex')
    };
    const installed = await installPinnedVoiceFile(root, asset);
    assert.deepEqual(fs.readFileSync(installed), content);
    assert.equal(requests, 1);
    assert.ok(events.some((event) => event.phase === 'downloading'));
    assert.ok(events.some((event) => event.phase === 'ready'));
    await installPinnedVoiceFile(root, asset);
    assert.equal(requests, 1, 'cached verified asset is reused');
    await assert.rejects(installPinnedVoiceFile(root, { ...asset, name: 'bad.bin', sha256: '0'.repeat(64) }), /checksum mismatch/);
    assert.equal(fs.existsSync(path.join(root, 'bad.bin')), false);
  } finally {
    unsubscribe();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
