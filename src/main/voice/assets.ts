import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runVoiceCommand } from './process';

type Platform = 'linux' | 'win32';
type Asset = { name: string; url: string; sha256: string };

export interface VoiceDownloadProgress {
  asset: string;
  phase: 'downloading' | 'verifying' | 'extracting' | 'ready';
  receivedBytes: number;
  totalBytes: number | null;
}

// Official versioned artifacts. Model URLs use immutable Hugging Face revisions;
// every downloaded byte is checked against a pinned SHA-256 before use.
const WHISPER_MODEL: Asset = {
  name: 'ggml-base.en.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin',
  sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002'
};
const PIPER_MODEL: Asset = {
  name: 'en_US-ljspeech-medium.onnx',
  url: 'https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx',
  sha256: '6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22'
};
const PIPER_CONFIG: Asset = {
  name: 'en_US-ljspeech-medium.onnx.json',
  url: `${PIPER_MODEL.url}.json`,
  sha256: '141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860'
};
const ARCHIVES: Record<Platform, { whisper: Asset; piper: Asset; whisperBinary: string; piperBinary: string }> = {
  linux: {
    whisper: { name: 'whisper-bin-ubuntu-x64.tar.gz', url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-ubuntu-x64.tar.gz', sha256: '46811a3ecf584307480a220b9ef5ff81b7b22dc41577cbc274ce3afc61f753b1' },
    piper: { name: 'piper_linux_x86_64.tar.gz', url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz', sha256: 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992' },
    whisperBinary: 'whisper-bin-ubuntu-x64/whisper-cli',
    piperBinary: 'piper/piper'
  },
  win32: {
    whisper: { name: 'whisper-bin-x64.zip', url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip', sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a' },
    piper: { name: 'piper_windows_amd64.zip', url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip', sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea' },
    whisperBinary: 'Release/whisper-cli.exe',
    piperBinary: 'piper/piper.exe'
  }
};

const listeners = new Set<(progress: VoiceDownloadProgress) => void>();
const lastDownloadNotice = new Map<string, number>();

/** The main process forwards this event over IPC as `voice:download-progress`. */
export function onVoiceDownloadProgress(listener: (progress: VoiceDownloadProgress) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function progress(event: VoiceDownloadProgress): void {
  if (event.phase === 'downloading') {
    const now = Date.now();
    if (now - (lastDownloadNotice.get(event.asset) ?? 0) < 100) return;
    lastDownloadNotice.set(event.asset, now);
  } else {
    lastDownloadNotice.delete(event.asset);
  }
  // The main process forwards these to app windows as `voice:download-progress`.
  for (const listener of listeners) {
    try { listener(event); } catch { /* UI observers cannot fail an asset install */ }
  }
}

async function voiceRoot(): Promise<string> {
  const { app } = await import('electron');
  if (!app.isReady()) throw new Error('voice engines require a ready Electron app');
  return join(app.getPath('userData'), 'voice');
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  const file = await open(path, 'r');
  try {
    for await (const chunk of file.createReadStream()) hash.update(chunk);
  } finally {
    await file.close().catch(() => {});
  }
  return hash.digest('hex');
}

/** Download to userData once, rejecting changed bytes before installation. */
export async function installPinnedVoiceFile(root: string, asset: Asset): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/.test(asset.name) || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error('invalid pinned voice asset');
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const destination = join(root, asset.name);
  try {
    if ((await hashFile(destination)) === asset.sha256) return destination;
  } catch { /* absent or damaged cached file */ }

  const partial = `${destination}.${randomUUID()}.partial`;
  let downloaded = 0;
  let total: number | null = null;
  try {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`voice download failed: ${asset.name} HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length'));
    if (Number.isSafeInteger(length) && length > 0) total = length;
    const file = await open(partial, 'wx', 0o600);
    const hash = createHash('sha256');
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        for (let offset = 0; offset < chunk.length;) {
          const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset);
          if (bytesWritten === 0) throw new Error(`voice download stopped writing: ${asset.name}`);
          offset += bytesWritten;
        }
        hash.update(chunk);
        downloaded += chunk.length;
        progress({ asset: asset.name, phase: 'downloading', receivedBytes: downloaded, totalBytes: total });
      }
    } finally {
      await file.close();
    }
    progress({ asset: asset.name, phase: 'verifying', receivedBytes: downloaded, totalBytes: total });
    if (hash.digest('hex') !== asset.sha256) throw new Error(`voice download checksum mismatch: ${asset.name}`);
    await rm(destination, { force: true }); // Windows rename does not replace an old damaged file.
    await rename(partial, destination);
    progress({ asset: asset.name, phase: 'ready', receivedBytes: downloaded, totalBytes: total });
    return destination;
  } finally {
    await rm(partial, { force: true }).catch(() => {});
  }
}

async function ensureArchive(root: string, asset: Asset, binaryRel: string): Promise<string> {
  const destination = join(root, asset.name.replace(/\.(tar\.gz|zip)$/, ''));
  const binary = join(destination, binaryRel);
  const marker = join(destination, '.archive-sha256');
  try {
    if ((await readFile(marker, 'utf8')).trim() === asset.sha256 && (await stat(binary)).isFile()) return binary;
  } catch { /* first use or interrupted extraction */ }
  const archive = await installPinnedVoiceFile(root, asset);
  const staging = await mkdtemp(join(root, 'extract-'));
  try {
    progress({ asset: asset.name, phase: 'extracting', receivedBytes: 0, totalBytes: null });
    await runVoiceCommand('tar', ['-xf', archive, '-C', staging], { timeoutMs: 120_000 });
    if (!(await stat(join(staging, binaryRel))).isFile()) throw new Error(`voice archive lacks ${binaryRel}`);
    await writeFile(join(staging, '.archive-sha256'), `${asset.sha256}\n`, { mode: 0o600 });
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    if (process.platform !== 'win32') await chmod(binary, 0o700);
    progress({ asset: asset.name, phase: 'ready', receivedBytes: 0, totalBytes: null });
    return binary;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

const pending = new Map<string, Promise<unknown>>();
function once<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const next = task().finally(() => pending.delete(key));
  pending.set(key, next);
  return next;
}

function platformAssets(): typeof ARCHIVES[Platform] {
  if (process.arch !== 'x64' || (process.platform !== 'linux' && process.platform !== 'win32')) {
    throw new Error('local voice engines currently support Linux and Windows x64 only');
  }
  return ARCHIVES[process.platform];
}

export function ensureWhisper(): Promise<{ binary: string; model: string }> {
  return once('whisper', async () => {
    const root = await voiceRoot();
    const assets = platformAssets();
    const binary = await ensureArchive(root, assets.whisper, assets.whisperBinary);
    const model = await installPinnedVoiceFile(root, WHISPER_MODEL);
    return { binary, model };
  });
}

export const PIPER_VOICE = 'en_US-ljspeech-medium';
export function ensurePiper(): Promise<{ binary: string; model: string; config: string }> {
  return once('piper', async () => {
    const root = await voiceRoot();
    const assets = platformAssets();
    const binary = await ensureArchive(root, assets.piper, assets.piperBinary);
    const model = await installPinnedVoiceFile(root, PIPER_MODEL);
    const config = await installPinnedVoiceFile(root, PIPER_CONFIG);
    return { binary, model, config };
  });
}
