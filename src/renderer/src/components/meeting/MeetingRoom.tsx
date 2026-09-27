import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/store';

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

function Orb({ name, speaking, color }: { name: string; speaking: boolean; color: string }) {
  return <div style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
    <div style={{
      width: 96, height: 96, borderRadius: '50%', background: `radial-gradient(circle at 35% 30%, #fff8, ${color} 45%, #0b1220 100%)`,
      transform: speaking ? 'scale(1.15)' : 'scale(1)', boxShadow: speaking ? `0 0 40px 8px ${color}aa` : `0 0 12px ${color}44`,
      transition: 'transform 150ms, box-shadow 150ms'
    }} />
    <span style={{ fontSize: 12, color: '#dce8fa' }}>{name}</span>
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
  const button = (bg: string): React.CSSProperties => ({ padding: '10px 16px', borderRadius: 22, border: 0, background: bg, color: '#fff', cursor: 'pointer', fontSize: 13 });

  return <section aria-label="Meeting room" style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#0b0f16f5', color: '#dce8fa', display: 'flex', flexDirection: 'column' }}>
    <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
      <strong style={{ flex: 1 }}>Meeting</strong>
      <select value={channel} onChange={(e) => { interrupt(); setChannel(e.target.value as Channel); }} aria-label="Meeting channel"
        style={{ background: '#0e131b', color: '#dce8fa', border: '1px solid #ffffff33', borderRadius: 4, padding: 4 }}>
        <option value="everyone">#Everyone</option><option value="managers">#Managers</option><option value="leadership">#Leadership</option>
      </select>
    </header>
    <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', gap: 36, padding: 16 }}>
      <Orb name={muted ? 'You (muted)' : 'You'} speaking={meSpeaking} color="#3a6fd8" />
      {humans.map((name) => <Orb key={name} name={name} speaking={speaker === name} color="#39b48a" />)}
      {heard.map((a) => <Orb key={a.id} name={a.name} speaking={speaker === a.name} color="#b06ad8" />)}
      {!heard.length && <p style={{ width: '100%', textAlign: 'center', color: '#8998af' }}>No AI can hear #{channel}. Set AI ranks in Team chat.</p>}
    </div>
    <p role="status" style={{ textAlign: 'center', minHeight: 36, margin: '0 16px', color: '#8998af', fontSize: 12 }}>
      {last ? `${last.authorName}: ${last.text.slice(0, 200)}` : ''}<br />{status}
    </p>
    <form onSubmit={(e) => { e.preventDefault(); void send(); }} style={{ display: 'flex', gap: 8, padding: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Type instead of talking"
        style={{ flex: '1 1 200px', maxWidth: 420, padding: '10px 14px', borderRadius: 22, border: '1px solid #ffffff33', background: '#0e131b', color: '#dce8fa' }} />
      <button type="button" onClick={() => setMuted((m) => !m)} aria-pressed={muted} style={button(muted ? '#8a3a3a' : '#2a3547')}>{muted ? 'Unmute' : 'Mute'}</button>
      <button type="button" onClick={onLeave} style={button('#c0392b')}>Leave</button>
    </form>
  </section>;
}

export function MeetingRoom() {
  const [inMeeting, setInMeeting] = useState(false);
  if (inMeeting) return <Room onLeave={() => setInMeeting(false)} />;
  return <button type="button" onClick={() => setInMeeting(true)} aria-label="Join voice meeting"
    style={{ position: 'fixed', right: 16, bottom: 116, zIndex: 50, padding: '8px 12px', borderRadius: 18, border: '1px solid #ffffff33',
      background: '#1d2635', color: '#dce8fa', cursor: 'pointer', fontSize: 12 }}>
    🎙 Meeting
  </button>;
}
