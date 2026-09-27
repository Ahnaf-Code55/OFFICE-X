/** PCM used by the local whisper.cpp command-line engine. */
export function pcm16kMonoToWav(pcm: Int16Array): Buffer {
  if (!(pcm instanceof Int16Array) || pcm.length === 0) throw new Error('voice audio is empty');
  if (pcm.length > 16_000 * 120) throw new Error('voice audio exceeds two minutes');
  const dataLength = pcm.length * 2;
  const wav = Buffer.alloc(44 + dataLength);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16); // PCM fmt chunk
  wav.writeUInt16LE(1, 20); // linear PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28); // bytes per second
  wav.writeUInt16LE(2, 32); // block alignment
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < pcm.length; i++) wav.writeInt16LE(pcm[i], 44 + i * 2);
  return wav;
}

export function isPcmWav(wav: Buffer): boolean {
  return locatePcm(wav) !== null;
}

function locatePcm(wav: Buffer): { channels: number; sampleRate: number; dataOffset: number; dataLength: number } | null {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return null;
  let channels = 0;
  let sampleRate = 0;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > wav.length) return null;
    const id = wav.toString('ascii', offset, offset + 4);
    if (id === 'fmt ') {
      if (size < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 14) !== 16) return null;
      channels = wav.readUInt16LE(start + 2);
      sampleRate = wav.readUInt32LE(start + 4);
    } else if (id === 'data') {
      dataOffset = start;
      dataLength = size;
    }
    offset = start + size + (size & 1);
  }
  return channels > 0 && sampleRate > 0 && dataOffset >= 0 && dataLength > 0 && dataLength % 2 === 0
    ? { channels, sampleRate, dataOffset, dataLength } : null;
}

/** Read a real 16 kHz mono PCM fixture, including WAVs with metadata chunks. */
export function wavToPcm16kMono(wav: Buffer): Int16Array {
  const found = locatePcm(wav);
  if (!found || found.channels !== 1 || found.sampleRate !== 16_000) throw new Error('expected 16 kHz mono PCM16 WAV');
  const pcm = new Int16Array(found.dataLength / 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = wav.readInt16LE(found.dataOffset + i * 2);
  return pcm;
}
