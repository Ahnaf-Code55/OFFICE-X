'use strict';

/** Generate OFFICE-X/OQVIAN app, site and platform icons from the SVG source. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" shape-rendering="crispEdges">
  <title>OFFICE-X by OQVIAN</title>
  <rect x="20" y="20" width="984" height="984" rx="168" fill="#6E1423" stroke="#3C0B16" stroke-width="28"/>
  <path fill="#F4F1EA" d="M240 880V340h544v540H240zm72-472v88h112v-88H312zm0 160v88h112v-88H312zm0 160v80h112v-80H312zm176-320v88h112v-88H488zm0 160v88h112v-88H488zm0 160v80h112v-80H488zm176-320v88h112v-88H664zm0 160v88h112v-88H664zm0 160v80h112v-80H664z"/>
  <path fill="#E7B95C" d="M416 880V728h192v152H416zm40-448h48v48h-48zm128 160h48v48h-48z"/>
  <path fill="#32101A" d="M456 772h48v108h-48zm64 0h48v108h-48z"/>
  <rect x="208" y="304" width="608" height="36" fill="#E7B95C"/>
  <path fill="#F4F1EA" d="M448 236h128v68H448z"/>
</svg>`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-brand-'));
const svgPath = path.join(root, 'docs/logo.svg');
fs.writeFileSync(svgPath, svg);
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build/icon.svg'), svg);

function png(size) {
  const output = path.join(tempDir, `icon-${size}.png`);
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), svgPath, '-o', output]);
  return fs.readFileSync(output);
}
function chunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
}
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const directory = [];
  for (const { size, data } of entries) {
    const row = Buffer.alloc(16);
    row[0] = size === 256 ? 0 : size; row[1] = row[0];
    row.writeUInt16LE(1, 4); row.writeUInt16LE(32, 6);
    row.writeUInt32LE(data.length, 8); row.writeUInt32LE(offset, 12);
    directory.push(row); offset += data.length;
  }
  return Buffer.concat([header, ...directory, ...entries.map((item) => item.data)]);
}

const outputs = [
  ['docs/logo.png', png(512)], ['docs/logo-light.png', png(512)],
  ['docs/favicon-32.png', png(32)], ['docs/apple-touch-icon.png', png(180)],
  ['build/icon.png', png(1024)],
  ['build/icon.ico', ico([16, 32, 48, 64, 128, 256].map((size) => ({ size, data: png(size) })))]
];
const icnsMap = [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']];
const chunks = icnsMap.map(([size, name]) => chunk(name, png(size)));
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 4, 'ascii');
icnsHead.writeUInt32BE(8 + chunks.reduce((total, item) => total + item.length, 0), 4);
outputs.push(['build/icon.icns', Buffer.concat([icnsHead, ...chunks])]);

for (const [relative, bytes] of outputs) fs.writeFileSync(path.join(root, relative), bytes);
fs.rmSync(tempDir, { recursive: true, force: true });
process.stdout.write(`Generated OFFICE-X brand assets (${outputs.length + 2} files).\n`);
