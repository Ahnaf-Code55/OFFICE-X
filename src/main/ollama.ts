import { totalmem } from 'node:os';
import { ollamaTagFor } from '../shared/ossModels';

const OLLAMA = 'http://127.0.0.1:11434';

/** What this device can run locally: installed Ollama models + total RAM. */
export async function localModels(): Promise<{ running: boolean; ramGb: number; models: { name: string; sizeGb: number }[] }> {
  const ramGb = Math.round(totalmem() / 1024 ** 3);
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json() as { models?: { name: string; size: number }[] };
    return { running: true, ramGb, models: (body.models ?? []).map((m) => ({ name: m.name, sizeGb: Math.round(m.size / 1024 ** 3 * 10) / 10 })) };
  } catch {
    return { running: false, ramGb, models: [] };
  }
}

/** Pull a model (Ollama tag or Hugging Face repo) through the local Ollama. */
export async function pullModel(input: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const name = ollamaTagFor(input);
  if (!name) return { ok: false, error: 'not an Ollama tag or Hugging Face repo' };
  try {
    // ponytail: no progress stream; a 5 GB pull just shows "pulling…" until done.
    const res = await fetch(`${OLLAMA}/api/pull`, { method: 'POST', body: JSON.stringify({ model: name, stream: false }), signal: AbortSignal.timeout(60 * 60_000) });
    const body = await res.json() as { status?: string; error?: string };
    return body.error ? { ok: false, error: body.error } : { ok: true, name };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name !== 'TimeoutError' ? 'Ollama is not running (start it with `ollama serve`)' : String(e) };
  }
}

export const LOCAL_CTX = 32768;

/**
 * Ollama's OpenAI endpoint runs every model at its small default context (2-4k) and
 * silently truncates, so agent CLIs (OpenCode's prompt alone is ~10k) hit "session too
 * large". Derive `<name>:ctx32k` with num_ctx raised (no weight copy); on failure use the original.
 */
export async function withBigContext(tag: string): Promise<string> {
  if (tag.endsWith(':ctx32k')) return tag;
  const derived = `${tag.split(':')[0]}:ctx32k`;
  try {
    const res = await fetch(`${OLLAMA}/api/create`, { method: 'POST', body: JSON.stringify({ model: derived, from: tag, parameters: { num_ctx: LOCAL_CTX }, stream: false }), signal: AbortSignal.timeout(30_000) });
    const body = await res.json() as { error?: string };
    return body.error ? tag : derived;
  } catch {
    return tag;
  }
}
