'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { DEFAULT_HERO } = loadTs('src/shared/heroPayload.ts');
const { loadHero } = loadTs('src/main/hero.ts');
const { loadModelCatalog } = loadTs('src/main/modelCatalog.ts');

test('settings hero stays on neutral bundled defaults without network or stale cache data', async () => {
  const result = await loadHero('/tmp/officex-stale-hero.json', { force: true });
  assert.deepEqual(result.hero, DEFAULT_HERO);
  assert.equal(result.fetchedAt, 0);
  assert.equal(result.stale, true);
});

test('model catalog defers to the renderer bundled catalog instead of remote overlays', async () => {
  const result = await loadModelCatalog('/tmp/officex-stale-models.json', { force: true });
  assert.equal(result.catalog, null);
  assert.equal(result.fetchedAt, 0);
  assert.equal(result.stale, true);
});

test('the settings hero card contains no Munder Difflin-owned marketing destinations', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync('src/renderer/src/components/SettingsHeroCard.tsx', 'utf8');
  assert.doesNotMatch(source, /chaitanyagiri|munder-difflin|munderdiffl\.in|discord\.gg/i);
  assert.doesNotMatch(source, /foundersWall|starOnGitHub|joinDiscord|reportProblem|fullChangelog/);
});
