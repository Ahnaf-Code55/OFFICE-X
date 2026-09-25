#!/usr/bin/env node

/**
 * tunnelmole 2.4.0 lists itself as a dependency. npm tolerates that metadata,
 * but electron-builder's npm dependency collector follows the self-edge forever
 * while building its package graph. Removing the invalid edge leaves the
 * published module code and its real dependencies untouched.
 */
const fs = require('node:fs');
const path = require('node:path');

const packagePath = path.resolve(__dirname, '../node_modules/tunnelmole/package.json');
if (!fs.existsSync(packagePath)) {
  throw new Error('Expected the tunnelmole dependency to be installed before normalization.');
}

const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (manifest.name !== 'tunnelmole') {
  throw new Error(`Refusing to edit unexpected package at ${packagePath}.`);
}

if (manifest.dependencies?.tunnelmole) {
  delete manifest.dependencies.tunnelmole;
  fs.writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Removed tunnelmole@${manifest.version}'s self-dependency for Electron packaging.\n`);
}
