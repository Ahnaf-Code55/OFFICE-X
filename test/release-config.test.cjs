'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { parseReleaseRepository } = loadTs('src/main/releaseConfig.ts');

test('accepts only an explicit GitHub owner/repository setting', () => {
  assert.equal(parseReleaseRepository('OQVIAN/OFFICE-X'), 'OQVIAN/OFFICE-X');
  assert.equal(parseReleaseRepository(' team-name/project.name '), 'team-name/project.name');
  for (const value of [undefined, '', 'owner', '/repo', 'owner/', 'https://github.com/owner/repo', 'owner/repo/releases']) {
    assert.equal(parseReleaseRepository(value), undefined, String(value));
  }
});

test('injects the optional managed relay multiaddr into official main-process builds', async () => {
  const key = 'OFFICE_X_MANAGED_RELAY_MULTIADDR';
  const previous = process.env[key];
  const endpoint = '/dns4/relay.example.com/tcp/443/wss/p2p/12D3KooWReleaseTest';
  process.env[key] = endpoint;
  try {
    const { loadConfigFromFile } = await import('vite');
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      path.resolve(__dirname, '../electron.vite.config.ts')
    );
    assert.equal(loaded?.config.main.define.__OFFICE_X_MANAGED_RELAY_MULTIADDR__, JSON.stringify(endpoint));
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});
