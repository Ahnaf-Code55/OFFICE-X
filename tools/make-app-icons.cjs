'use strict';

/** Generate Electron platform icons from OFFICE-X's app-owned SVG source. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src/renderer/src/assets/brand/officex-logo.svg');
const buildDir = path.join(root, 'build');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-app-icons-'));
fs.mkdirSync(buildDir, { recursive: true });

function png(size) {
  const output = path.join(tempDir, `icon-${size}.png`);
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), source, '-o', output]);
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
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const directory = [];
  for (const { size, data } of entries) {
    const row = Buffer.alloc(16);
    row[0] = size === 256 ? 0 : size;
    row[1] = row[0];
    row.writeUInt16LE(1, 4);
    row.writeUInt16LE(32, 6);
    row.writeUInt32LE(data.length, 8);
    row.writeUInt32LE(offset, 12);
    directory.push(row);
    offset += data.length;
  }
  return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.data)]);
}

try {
  fs.copyFileSync(source, path.join(buildDir, 'icon.svg'));
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png(1024));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico(
    [16, 32, 48, 64, 128, 256].map((size) => ({ size, data: png(size) }))
  ));

  const icnsMap = [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']];
  const chunks = icnsMap.map(([size, name]) => chunk(name, png(size)));
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((total, item) => total + item.length, 0), 4);
  fs.writeFileSync(path.join(buildDir, 'icon.icns'), Buffer.concat([header, ...chunks]));
  process.stdout.write('Generated OFFICE-X Electron app icons from src/renderer/src/assets/brand/officex-logo.svg.\n');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
