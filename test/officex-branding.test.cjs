const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const readBytes = (file) => fs.readFileSync(file);

test('Electron package identity and renderer title use OFFICE-X', () => {
  const pkg = JSON.parse(read('package.json'));
  const builder = read('electron-builder.yml');
  const html = read('src/renderer/index.html');
  const main = read('src/main/index.ts');
  assert.equal(pkg.name, 'office-x');
  assert.match(builder, /^appId: com\.oqvian\.officex$/m);
  assert.match(builder, /^productName: OFFICE-X$/m);
  assert.match(html, /<title>OFFICE-X<\/title>/);
  assert.match(html, /<div class="title">OFFICE-X<\/div>/);
  assert.match(main, /title: isFloor \? 'OFFICE-X — Floor' : 'OFFICE-X'/);
  assert.equal(fs.existsSync('docs/CNAME'), false, 'the fork must not claim Munder Difflin\'s domain');
});

test('renderer uses app-owned OFFICE-X logo and OQVIAN remains a separate credit', () => {
  const logo = read('src/renderer/src/assets/brand/officex-logo.svg');
  const app = read('src/renderer/src/App.tsx');
  const renderer = read('src/renderer/src/main.tsx');
  const settings = read('src/renderer/src/components/SettingsHeroCard.tsx');
  assert.match(logo, /<title>OFFICE-X<\/title>/);
  assert.doesNotMatch(logo, /Munder|OQVIAN/i);
  assert.match(app, /from '\.\/assets\/brand\/officex-logo\.svg\?url'/);
  assert.match(renderer, /from '\.\/assets\/brand\/officex-logo\.svg\?url'/);
  assert.doesNotMatch(`${app}\n${renderer}`, /@brand\/logo\.png/);
  assert.match(settings, /oqvian-wordmark\.jpg/);
  assert.match(settings, /alt="OQVIAN — AI \/ Security \/ IT"/);
});

test('platform icons are configured from OFFICE-X build assets and generated from app-owned art', () => {
  const builder = read('electron-builder.yml');
  const generator = read('tools/make-app-icons.cjs');
  const sourceSvg = read('src/renderer/src/assets/brand/officex-logo.svg');
  const generatedSvg = read('build/icon.svg');
  assert.match(builder, /icon: build\/icon\.icns/);
  assert.match(builder, /icon: build\/icon\.ico/);
  assert.match(builder, /icon: build\/icon\.png/);
  assert.match(generator, /src\/renderer\/src\/assets\/brand\/officex-logo\.svg/);
  assert.doesNotMatch(generator, /docs\//);
  assert.equal(generatedSvg, sourceSvg);
  assert.match(generatedSvg, /<title>OFFICE-X<\/title>/);
  assert.doesNotMatch(generatedSvg, /Munder|OQVIAN/i);

  const png = readBytes('build/icon.png');
  const ico = readBytes('build/icon.ico');
  const icns = readBytes('build/icon.icns');
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
});
