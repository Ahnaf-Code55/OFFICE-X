import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureWhisper } from './assets';
import { runVoiceCommand } from './process';
import { pcm16kMonoToWav } from './wav';

/** Transcribe 16 kHz, mono, signed 16-bit PCM using local whisper.cpp. */
export async function transcribe(pcm16kMono: Int16Array): Promise<string> {
  return transcribeWithRuntime(pcm16kMono, await ensureWhisper());
}

/** Isolated process seam used by the small CLI-contract test. */
export async function transcribeWithRuntime(
  pcm16kMono: Int16Array,
  runtime: { binary: string; model: string; prependArgs?: string[] }
): Promise<string> {
  const wav = pcm16kMonoToWav(pcm16kMono);
  const work = await mkdtemp(join(tmpdir(), 'officex-stt-'));
  try {
    const input = join(work, 'speech.wav');
    const output = join(work, 'transcript');
    await writeFile(input, wav, { mode: 0o600 });
    await runVoiceCommand(runtime.binary, [
      ...(runtime.prependArgs ?? []), '-m', runtime.model, '-f', input,
      '-otxt', '-of', output, '-nt'
    ], { timeoutMs: 120_000 });
    return (await readFile(`${output}.txt`, 'utf8')).trim();
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
