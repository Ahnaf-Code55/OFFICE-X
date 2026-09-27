'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { listVoices, synthesizeWithRuntime } = loadTs('src/main/voice/tts.ts');
const fixture = path.join(__dirname, 'fixtures', 'voice-hello.wav');

test('text produces a valid WAV through the TTS CLI contract', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-tts-test-'));
  try {
    const fake = path.join(work, 'piper-fake.cjs');
    fs.writeFileSync(fake, `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.copyFileSync(${JSON.stringify(fixture)}, args[args.indexOf('--output_file') + 1]);`);
    const { wav } = await synthesizeWithRuntime('Hello from OFFICE-X.', undefined, {
      binary: process.execPath, model: 'fixture-model', config: 'fixture-config', prependArgs: [fake]
    });
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.deepEqual(listVoices(), ['en_US-ljspeech-medium']);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('real Piper produces a valid WAV when integration assets are supplied', {
  skip: !(process.env.OFFICEX_TEST_PIPER_BINARY && process.env.OFFICEX_TEST_PIPER_MODEL && process.env.OFFICEX_TEST_PIPER_CONFIG)
}, async () => {
  const { wav } = await synthesizeWithRuntime('Hello from OFFICE-X.', undefined, {
    binary: process.env.OFFICEX_TEST_PIPER_BINARY,
    model: process.env.OFFICEX_TEST_PIPER_MODEL,
    config: process.env.OFFICEX_TEST_PIPER_CONFIG
  });
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
});
