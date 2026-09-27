'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { pcm16kMonoToWav, isPcmWav } = loadTs('src/main/voice/wav.ts');

test('encodes a tiny 16 kHz mono PCM fixture as a valid WAV', () => {
  const wav = pcm16kMonoToWav(Int16Array.from([0, 1234, -1234, 0]));
  assert.equal(isPcmWav(wav), true);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt32LE(40), 8);
  assert.equal(wav.readInt16LE(46), 1234);
  assert.equal(wav.readInt16LE(48), -1234);
  assert.throws(() => pcm16kMonoToWav(new Int16Array()), /empty/);
});
