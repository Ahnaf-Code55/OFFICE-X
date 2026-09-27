import { useEffect, useRef, useState } from 'react';
import { useStore, type Agent } from '@/store/store';
import { PixelButton } from '../PixelButton';
import { SpritePortrait } from '../SpritePortrait';

type ChatView = Awaited<ReturnType<typeof window.cth.listChat>>[number];
type Channel = ChatView['channel'];
type Tier = Parameters<typeof window.cth.setChatTier>[1];

// Mirrors canHear() in src/main/chat.ts (main module can't be imported here).
const RANK: Record<Tier, number> = { off: 0, staff: 1, middle: 2, leadership: 3 };
const CHANNEL_RANK: Record<Channel, number> = { everyone: 1, managers: 2, leadership: 3 };

// Energy VAD: frames above the threshold count as speech. Raised while an AI talks so
// speaker bleed doesn't trigger, but a real voice still interrupts it.
const VAD_RMS = 0.02;
const VAD_RMS_WHILE_AI = 0.06;
const END_SILENCE_MS = 700;
const MIN_SPEECH_MS = 400;
const MAX_SPEECH_MS = 25_000;

/** One seat at the table: the office sprite (or an initial for humans), ringed while speaking. */
function Seat({ name, speaking, accent, character }: { name: string; speaking: boolean; accent: string; character?: Agent['character'] }) {
  return <div style={{ display: 'grid', justifyItems: 'center', gap: 6, width: 88 }}>
    <div style={{
      width: 64, height: 64, display: 'grid', placeItems: 'center', background: `var(--cth-${accent}-light)`,
      boxShadow: speaking ? `0 0 0 3px var(--cth-${accent}), 0 0 0 5px var(--cth-ink-900)` : 'inset 0 0 0 1px var(--cth-ink-300)',
      transform: speaking ? 'translateY(-3px)' : 'none', transition: 'transform 120ms, box-shadow 120ms'
    }}>
      {character ? <SpritePortrait character={character} scale={2} /> : <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 22 }}>{name.slice(0, 1).toUpperCase()}</span>}
    </div>
    <span style={{ fontFamily: 'var(--cth-font-mono)', fontSize: 11, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{name}</span>
  </div>;
}

/** Voice meeting on top of the team chat: my speech is transcribed (Whisper) and posted
 *  to the channel; AI and teammate messages in that channel are spoken aloud (Piper). */
function Room({ onLeave }: { onLeave: () => void }) {
  const agents = useStore((state) => state.agents);
  const [channel, setChannel] = useState<Channel>('everyone');
  const [tiers, setTiers] = useState<Record<string, Tier>>({});
  const [messages, setMessages] = useState<ChatView[]>([]);
  const [muted, setMuted] = useState(false);
  const [meSpeaking, setMeSpeaking] = useState(false);
  const [speaker, setSpeaker] = useState('');
  const [status, setStatus] = useState('Starting microphone…');
  const [text, setText] = useState('');
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const playback = useRef<{ ctx: AudioContext; queue: ChatView[]; source: AudioBufferSourceNode | null; busy: boolean } | null>(null);

  const interrupt = () => {
    const p = playback.current;
    if (!p) return;
    p.queue.length = 0;
    p.source?.stop();
  };

  const speakNext = async () => {
    const p = playback.current;
    if (!p || p.busy || !p.queue.length) return;
    p.busy = true;
    const message = p.queue.shift()!;
    try {
      const wav = await window.cth.synthesizeVoice(message.text);
      if (wav && playback.current === p) {
        const buffer = await p.ctx.decodeAudioData(wav.slice().buffer);
        const source = p.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(p.ctx.destination);
        p.source = source;
        setSpeaker(message.authorName);
        await new Promise<void>((resolve) => { source.onended = () => resolve(); source.start(); });
      }
    } catch (e) {
      setStatus(`Voice output failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      p.source = null;
      p.busy = false;
      setSpeaker('');
      void speakNext();
    }
  };

  useEffect(() => {
    playback.current = { ctx: new AudioContext(), queue: [], source: null, busy: false };
    void window.cth.listChat().then(setMessages);
    void window.cth.getChatTiers().then(setTiers);
    const offMessage = window.cth.onChatMessage((message) => {
      setMessages((prev) => [...prev, message].slice(-100));
      if (message.authorKind !== 'me' && message.channel === channelRef.current && message.text && playback.current) {
        playback.current.queue.push(message);
        void speakNext();
      }
    });
    const offProgress = window.cth.onVoiceDownloadProgress((p) => {
      setStatus(p.phase === 'ready' ? 'Listening' : `Downloading ${p.asset}${p.totalBytes ? ` ${Math.round((p.receivedBytes / p.totalBytes) * 100)}%` : ''}…`);
    });

    // Mic → 16 kHz mono → VAD → Whisper → chat.
    let stream: MediaStream | null = null;
    let mic: AudioContext | null = null;
    let stopped = false;
    void (async () => {
      await window.cth.setMeetingMic(true);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      } catch (e) {
        setStatus(`Microphone unavailable: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      mic = new AudioContext({ sampleRate: 16_000 });
      const source = mic.createMediaStreamSource(stream);
      // ponytail: ScriptProcessor is deprecated but needs no worklet file; move to AudioWorklet if it glitches.
      const node = mic.createScriptProcessor(2048, 1, 1);
      const sink = mic.createGain();
      sink.gain.value = 0;
      source.connect(node).connect(sink).connect(mic.destination);
      const frameMs = (2048 / 16_000) * 1000;
      let chunks: Float32Array[] = [];
      let speechMs = 0;
      let silenceMs = 0;
      const finish = async (audio: Float32Array[]) => {
        const pcm = new Int16Array(audio.reduce((n, c) => n + c.length, 0));
        let i = 0;
        for (const c of audio) for (const v of c) pcm[i++] = Math.max(-1, Math.min(1, v)) * 0x7fff;
        setStatus('Transcribing…');
        try {
          const said = await window.cth.transcribeVoice(pcm);
          if (said) await window.cth.sendChat(channelRef.current, said);
          setStatus('Listening');
        } catch (e) { setStatus(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`); }
      };
      node.onaudioprocess = (event) => {
        if (mutedRef.current) return;
        const frame = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (const v of frame) sum += v * v;
        const aiTalking = !!playback.current?.source;
        const loud = Math.sqrt(sum / frame.length) > (aiTalking ? VAD_RMS_WHILE_AI : VAD_RMS);
        if (!chunks.length && !loud) return;
        chunks.push(frame.slice());
        if (loud) { speechMs += frameMs; silenceMs = 0; setMeSpeaking(true); if (aiTalking) interrupt(); } else silenceMs += frameMs;
        if (silenceMs >= END_SILENCE_MS || speechMs >= MAX_SPEECH_MS) {
          const audio = chunks;
          const enough = speechMs >= MIN_SPEECH_MS;
          chunks = []; speechMs = 0; silenceMs = 0;
          setMeSpeaking(false);
          if (enough) void finish(audio);
        }
      };
      setStatus('Listening');
    })();

    return () => {
      stopped = true;
      offMessage(); offProgress();
      interrupt();
      void playback.current?.ctx.close();
      playback.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      void mic?.close();
      void window.cth.setMeetingMic(false);
    };
  }, []);

  const heard = agents.filter((a) => RANK[tiers[a.id] ?? 'off'] >= CHANNEL_RANK[channel]);
  const humans = [...new Set(messages.filter((m) => m.authorKind === 'human' && m.channel === channel && Date.now() - m.ts < 30 * 60_000).map((m) => m.authorName))];
  const last = messages.filter((m) => m.channel === channel).at(-1);

  const send = async () => {
    if (!text.trim()) return;
    const result = await window.cth.sendChat(channel, text);
    if (result.ok) setText(''); else setStatus(result.error ?? 'could not send');
  };
  const field: React.CSSProperties = { background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)', border: '1px solid var(--cth-ink-300)', fontFamily: 'var(--cth-font-ui)', fontSize: 13 };

  return <section aria-label="Meeting room" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--cth-cream-50)', color: 'var(--cth-ink-900)', fontFamily: 'var(--cth-font-ui)', fontSize: 13 }}>
    <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '2px solid var(--cth-ink-100)' }}>
      <span style={{ flex: 1, fontFamily: 'var(--cth-font-mono)', fontSize: 12, color: 'var(--cth-ink-500)' }}>● live · {status}</span>
      <select value={channel} onChange={(e) => { interrupt(); setChannel(e.target.value as Channel); }} aria-label="Meeting channel" style={{ ...field, padding: '2px 4px' }}>
        <option value="everyone">#Everyone</option><option value="managers">#Managers</option><option value="leadership">#Leadership</option>
      </select>
    </header>
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', gap: 16, padding: 16 }}>
      <Seat name={muted ? 'You (muted)' : 'You'} speaking={meSpeaking} accent="sky" />
      {humans.map((name) => <Seat key={name} name={name} speaking={speaker === name} accent="mint" />)}
      {heard.map((a) => <Seat key={a.id} name={a.name} speaking={speaker === a.name} accent={a.accent} character={a.character} />)}
      {!heard.length && <p style={{ width: '100%', textAlign: 'center', color: 'var(--cth-ink-500)' }}>No AI can hear #{channel}. Add them in the team chat tab under "who's in chat".</p>}
    </div>
    {last && <p style={{ margin: '0 8px 6px', padding: '6px 8px', background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
      <strong>{last.authorKind === 'me' ? 'You' : last.authorName}:</strong> {last.text.slice(0, 200)}
    </p>}
    <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '2px solid var(--cth-ink-100)' }}>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Type instead of talking"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }} style={{ ...field, flex: 1, minWidth: 0, padding: '6px 8px' }} />
      <PixelButton size="sm" variant="secondary" onClick={() => setMuted((m) => !m)}>{muted ? 'unmute' : 'mute'}</PixelButton>
      <PixelButton size="sm" variant="destructive" onClick={onLeave}>leave</PixelButton>
    </div>
  </section>;
}

/** Command Center tab: join screen, then the room. */
export function MeetingRoom() {
  const [inMeeting, setInMeeting] = useState(false);
  if (inMeeting) return <Room onLeave={() => setInMeeting(false)} />;
  return <div style={{ flex: 1, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 10, background: 'var(--cth-cream-50)', color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-ui)', fontSize: 13, textAlign: 'center', padding: 16 }}>
    <span>Talk with your teammates and AIs. Your speech is transcribed locally and replies are read aloud.</span>
    <PixelButton onClick={() => setInMeeting(true)}>join meeting</PixelButton>
  </div>;
}
