import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePiper, PIPER_VOICE } from './assets';
import { runVoiceCommand } from './process';
import { isPcmWav } from './wav';

export function listVoices(): string[] {
  return [PIPER_VOICE];
}

/** Speak through local Piper; callers play the returned WAV on their own output. */
export async function synthesize(text: string, voice?: string): Promise<{ wav: Buffer }> {
  return synthesizeWithRuntime(text, voice, await ensurePiper());
}

/** Isolated process seam used by the small CLI-contract test. */
export async function synthesizeWithRuntime(
  text: string,
  voice: string | undefined,
  runtime: { binary: string; model: string; config: string; prependArgs?: string[] }
): Promise<{ wav: Buffer }> {
  if (voice !== undefined && voice !== PIPER_VOICE) throw new Error(`unknown local voice: ${voice}`);
  if (typeof text !== 'string') throw new Error('voice text must be a string');
  const spoken = text.replace(/\s+/g, ' ').trim();
  if (!spoken || spoken.length > 2_000) throw new Error('voice text must contain 1 to 2000 characters');
  const work = await mkdtemp(join(tmpdir(), 'officex-tts-'));
  try {
    const output = join(work, 'speech.wav');
    await runVoiceCommand(runtime.binary, [
      ...(runtime.prependArgs ?? []), '--model', runtime.model,
      '--config', runtime.config, '--output_file', output
    ], { stdin: `${spoken}\n`, timeoutMs: 120_000 });
    if ((await stat(output)).size > 20 * 1024 * 1024) throw new Error('voice output is too large');
    const wav = await readFile(output);
    if (!isPcmWav(wav)) throw new Error('Piper returned an invalid PCM WAV');
    return { wav };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
