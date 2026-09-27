'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { transcribeWithRuntime } = loadTs('src/main/voice/stt.ts');
const { wavToPcm16kMono } = loadTs('src/main/voice/wav.ts');
const fixture = path.join(__dirname, 'fixtures', 'voice-hello.wav');

function fixturePcm() {
  return wavToPcm16kMono(fs.readFileSync(fixture));
}

test('tiny spoken WAV fixture produces non-empty text through the STT CLI contract', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'officex-stt-test-'));
  try {
    const fake = path.join(work, 'whisper-fake.cjs');
    fs.writeFileSync(fake, `const fs = require('node:fs');
const args = process.argv.slice(2);
const input = fs.readFileSync(args[args.indexOf('-f') + 1]);
if (input.toString('ascii', 0, 4) !== 'RIFF') process.exit(2);
fs.writeFileSync(args[args.indexOf('-of') + 1] + '.txt', 'hello from office x\\n');`);
    const text = await transcribeWithRuntime(fixturePcm(), {
      binary: process.execPath, model: 'fixture-model', prependArgs: [fake]
    });
    assert.ok(text.length > 0);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('real whisper.cpp transcribes the tiny WAV when integration assets are supplied', {
  skip: !(process.env.OFFICEX_TEST_WHISPER_BINARY && process.env.OFFICEX_TEST_WHISPER_MODEL)
}, async () => {
  const text = await transcribeWithRuntime(fixturePcm(), {
    binary: process.env.OFFICEX_TEST_WHISPER_BINARY,
    model: process.env.OFFICEX_TEST_WHISPER_MODEL
  });
  assert.ok(text.length > 0);
});
