import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Agent } from '@/store/store';
import type { ChatChannel } from '@shared/officeRooms';
import { PixelButton } from '../PixelButton';
import { SpritePortrait } from '../SpritePortrait';
import { useTeammateCall } from './useTeammateCall';
import { RoomTabs, RoomControls, RoomParticipants, useOfficeRooms } from './OfficeRooms';
type ChatView = Awaited<ReturnType<typeof window.cth.listChat>>[number];
const VAD_RMS = .02,
  VAD_RMS_WHILE_AI = .06,
  END_SILENCE_MS = 700,
  MIN_SPEECH_MS = 400,
  MAX_SPEECH_MS = 25_000;
const field: React.CSSProperties = {
  background: 'var(--cth-paper-100)',
  color: 'var(--cth-ink-900)',
  border: '1px solid var(--cth-ink-300)',
  fontFamily: 'var(--cth-font-ui)',
  fontSize: 13
};
function Seat({
  name,
  role,
  speaking,
  accent,
  character,
  children
}: {
  name: string;
  role: string;
  speaking: boolean;
  accent: string;
  character?: Agent['character'];
  children?: ReactNode;
}) {
  return <div style={{
    display: 'grid',
    justifyItems: 'center',
    alignContent: 'start',
    gap: 6,
    width: 98
  }}>
  <div style={{
      width: 64,
      height: 64,
      display: 'grid',
      placeItems: 'center',
      background: `var(--cth-${accent}-light)`,
      boxShadow: speaking ? `0 0 0 3px var(--cth-${accent})` : 'inset 0 0 0 1px var(--cth-ink-300)'
    }}>{character ? <SpritePortrait character={character} scale={2} /> : <span style={{
        fontFamily: 'var(--cth-font-display)',
        fontSize: 22
      }}>{name.slice(0, 1).toUpperCase()}</span>}</div>
  <span style={{
      fontFamily: 'var(--cth-font-mono)',
      fontSize: 11,
      textAlign: 'center',
      maxWidth: '100%',
      overflowWrap: 'anywhere'
    }}>{name}</span><small style={{
      fontSize: 10,
      color: 'var(--cth-ink-500)',
      textAlign: 'center'
    }}>{role}</small>{children}
 </div>;
}
function Room({
  office,
  channel,
  onChannel,
  onLeave
}: {
  office: ReturnType<typeof useOfficeRooms>;
  channel: ChatChannel;
  onChannel: (c: ChatChannel) => void;
  onLeave: () => void;
}) {
  const [messages, setMessages] = useState<ChatView[]>([]),
    [text, setText] = useState(''),
    [error, setError] = useState('');
  const [voice, setVoice] = useState(false),
    [muted, setMuted] = useState(false),
    [meSpeaking, setMeSpeaking] = useState(false),
    [speaker, setSpeaker] = useState(''),
    [status, setStatus] = useState('Voice off');
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followTranscript = useRef(true);
  useEffect(() => { followTranscript.current = true; }, [channel]);
  useEffect(() => {
    if (followTranscript.current) transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages, channel]);
  const room = office.rooms.find(r => r.channel === channel);
  const channelRef = useRef(channel),
    activeRef = useRef(!!room?.active),
    mutedRef = useRef(muted),
    voiceRef = useRef(voice);
  channelRef.current = channel;
  activeRef.current = !!room?.active;
  mutedRef.current = muted;
  voiceRef.current = voice;
  const teammateCall = useTeammateCall(!voice || muted),
    {
      call
    } = teammateCall;
  const inCallRef = useRef(false);
  inCallRef.current = !!call && call.state !== 'ringing';
  const epoch = useRef(0);
  const playback = useRef<{
    ctx: AudioContext;
    queue: ChatView[];
    source: AudioBufferSourceNode | null;
    busy: boolean;
  } | null>(null);
  const interrupt = () => {
    epoch.current++;
    const p = playback.current;
    if (p) {
      p.queue.length = 0;
      try {
        p.source?.stop();
      } catch {}
    }
  };
  const speakNext = async () => {
    const p = playback.current;
    if (!p || p.busy || !p.queue.length || !voiceRef.current) return;
    p.busy = true;
    const generation = epoch.current,
      message = p.queue.shift()!;
    try {
      if (p.ctx.state === 'suspended') await p.ctx.resume();
      const wav = await window.cth.synthesizeVoice(message.text.slice(0, 1000));
      if (wav && playback.current === p && generation === epoch.current && voiceRef.current) {
        const buffer = await p.ctx.decodeAudioData(wav.slice().buffer);
        if (generation !== epoch.current) return;
        const source = p.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(p.ctx.destination);
        p.source = source;
        setSpeaker(message.authorName);
        await new Promise<void>(resolve => {
          source.onended = () => resolve();
          source.start();
        });
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
    playback.current = {
      ctx: new AudioContext(),
      queue: [],
      source: null,
      busy: false
    };
    let alive = true;
    void window.cth.listChat().then(v => {
      if (alive) setMessages(v);
    });
    const off = window.cth.onChatMessage(m => {
      setMessages(prev => [...prev, m].slice(-100));
      if (voiceRef.current && !inCallRef.current && m.authorKind === 'agent' && m.channel === channelRef.current && m.requestId && playback.current) {
        playback.current.queue.push(m);
        void speakNext();
      }
    });
    return () => {
      alive = false;
      off();
      interrupt();
      void playback.current?.ctx.close();
      playback.current = null;
    };
  }, []);
  // No microphone request, transcription, or voice download until explicitly enabled.
  useEffect(() => {
    if (!voice) {
      interrupt();
      setStatus('Voice off');
      return;
    }
    let stream: MediaStream | null = null,
      mic: AudioContext | null = null,
      stopped = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1
          }
        });
      } catch (e) {
        setStatus(`Microphone unavailable: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (stopped) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      await window.cth.setMeetingMic(true);
      mic = new AudioContext({
        sampleRate: 16_000
      });
      const source = mic.createMediaStreamSource(stream),
        node = mic.createScriptProcessor(2048, 1, 1),
        sink = mic.createGain();
      sink.gain.value = 0;
      source.connect(node).connect(sink).connect(mic.destination);
      const frameMs = 2048 / 16_000 * 1000;
      let chunks: Float32Array[] = [],
        utteranceEpoch = epoch.current,
        speechMs = 0,
        silenceMs = 0;
      const finish = async (audio: Float32Array[], utteranceChannel: ChatChannel) => {
        const pcm = new Int16Array(audio.reduce((n, c) => n + c.length, 0));
        let i = 0;
        for (const c of audio) for (const v of c) pcm[i++] = Math.max(-1, Math.min(1, v)) * 0x7fff;
        const generation = epoch.current;
        setStatus('Transcribing…');
        try {
          const said = await window.cth.transcribeVoice(pcm);
          if (said && !stopped && generation === epoch.current && activeRef.current && utteranceChannel === channelRef.current) {
            const result = await window.cth.sendChat(utteranceChannel, said);
            if (!result.ok) setError(result.error ?? 'Could not send transcription');
          }
          setStatus('Microphone ready');
        } catch (e) {
          setStatus(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      };
      node.onaudioprocess = event => {
        if (utteranceEpoch !== epoch.current) {
          chunks = [];
          speechMs = 0;
          silenceMs = 0;
          utteranceEpoch = epoch.current;
        }
        if (mutedRef.current || inCallRef.current || !activeRef.current) {
          chunks = [];
          speechMs = 0;
          silenceMs = 0;
          setMeSpeaking(false);
          return;
        }
        const frame = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (const v of frame) sum += v * v;
        const aiTalking = !!playback.current?.source,
          loud = Math.sqrt(sum / frame.length) > (aiTalking ? VAD_RMS_WHILE_AI : VAD_RMS);
        if (!chunks.length && !loud) return;
        chunks.push(frame.slice());
        if (loud) {
          speechMs += frameMs;
          silenceMs = 0;
          setMeSpeaking(true);
          if (aiTalking) interrupt();
        } else silenceMs += frameMs;
        if (silenceMs >= END_SILENCE_MS || speechMs >= MAX_SPEECH_MS) {
          const audio = chunks,
            duration = speechMs;
          chunks = [];
          speechMs = 0;
          silenceMs = 0;
          setMeSpeaking(false);
          if (duration >= MIN_SPEECH_MS) void finish(audio, channelRef.current);
        }
      };
      setStatus('Microphone ready');
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach(t => t.stop());
      void mic?.close();
      void window.cth.setMeetingMic(false);
      interrupt();
    };
  }, [voice]);
  useEffect(() => {
    interrupt();
  }, [channel, room?.active, muted, call?.state]);
  const send = async () => {
    if (!text.trim()) return;
    const result = await window.cth.sendChat(channel, text);
    if (result.ok) {
      setText('');
      setError('');
    } else setError(result.error ?? 'Could not send');
  };
  const transcript = messages.filter(m => m.channel === channel),
    people = office.participants(channel);
  return <section aria-label="Meeting room" style={{
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--cth-cream-50)',
    color: 'var(--cth-ink-900)',
    fontFamily: 'var(--cth-font-ui)',
    fontSize: 13
  }}>
  <RoomTabs channel={channel} onChange={c => {
      interrupt();
      onChannel(c);
    }} />
  <RoomControls channel={channel} state={room} topic={text} onPosted={intent => {
      if (intent === 'report') setText('');
    }} onError={setError} />
  <header style={{
      padding: '6px 10px',
      display: 'flex',
      gap: 6,
      alignItems: 'center'
    }}><span style={{
        flex: 1,
        fontSize: 12,
        color: 'var(--cth-ink-500)'
      }}>{call?.state === 'live' ? `On a call with ${call.memberName}` : status}</span><PixelButton size="sm" variant="secondary" onClick={() => setVoice(v => !v)}>{voice ? 'Disable voice' : 'Enable voice'}</PixelButton>{voice && <PixelButton size="sm" variant="secondary" onClick={() => setMuted(m => !m)}>{muted ? 'Unmute' : 'Mute'}</PixelButton>}</header>
  <div aria-label="Meeting participants" style={{
      flex: 1,
      overflowY: 'auto',
      display: 'flex',
      flexWrap: 'wrap',
      alignContent: 'start',
      justifyContent: 'center',
      gap: 16,
      padding: 16
    }}>
   {people.map(p => {
        const peer = p.key.startsWith('human:') ? office.presence.find(peer => `human:${peer.id}` === p.key) : undefined,
          mine = peer && call?.memberId === peer.id;
        return <Seat key={p.key} name={p.key === 'me' ? `${p.name} (you)` : p.name} role={`${p.role}${p.peer ? ` · ${p.peer}` : ''}${!p.online ? ' · not connected / not started' : ''}`} speaking={p.key === 'me' ? meSpeaking : speaker === p.name || !!(mine && call?.state === 'live' && teammateCall.remoteSpeaking)} accent={p.accent} character={p.character}>{peer && (mine ? call?.state !== 'ringing' && <PixelButton size="sm" variant="destructive" onClick={teammateCall.hangup}>{call?.state === 'live' ? 'Hang up' : 'Cancel'}</PixelButton> : <PixelButton size="sm" variant="secondary" disabled={!!call} onClick={() => teammateCall.start(peer.id, peer.name)}>Call</PixelButton>)}</Seat>;
      })}
  </div>
  {call?.state === 'ringing' && <div role="alertdialog" aria-label="Incoming call" style={{
      padding: 8,
      display: 'flex',
      gap: 6
    }}><strong style={{
        flex: 1
      }}>{call.memberName} is calling you</strong><PixelButton size="sm" onClick={teammateCall.accept}>Accept</PixelButton><PixelButton size="sm" variant="destructive" onClick={teammateCall.hangup}>Decline</PixelButton></div>}
  <audio ref={teammateCall.audioRef} autoPlay />
  {transcript.length > 0 && <details open className="or-transcript"><summary>Discussion · {transcript.length} messages</summary><div ref={transcriptRef} onScroll={event => {
    const el = event.currentTarget;
    followTranscript.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }}>{transcript.slice(-20).map(m => <p key={m.id}><strong>{m.authorKind === 'me' ? 'You' : m.authorName}:</strong> {m.text}</p>)}</div></details>}
  {error && <p role="alert" style={{
      margin: 8,
      color: 'var(--cth-coral)'
    }}>{error}</p>}
  <div style={{
      display: 'flex',
      gap: 6,
      padding: 8,
      borderTop: '1px solid var(--cth-ink-100)'
    }}><input aria-label="Meeting message" value={text} onChange={e => setText(e.target.value)} maxLength={4000} placeholder="Report request or meeting topic" onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void send();
        }
      }} style={{
        ...field,
        flex: 1,
        minWidth: 0,
        padding: '6px 8px'
      }} /><PixelButton size="sm" onClick={() => void send()}>Send</PixelButton><PixelButton size="sm" variant="secondary" onClick={onLeave}>Leave room</PixelButton></div>
 </section>;
}
export function MeetingRoom() {
  const [joined, setJoined] = useState(false),
    [channel, setChannel] = useState<ChatChannel>('everyone');
  const office = useOfficeRooms();
  if (joined) return <Room office={office} channel={channel} onChannel={setChannel} onLeave={() => setJoined(false)} />;
  return <section aria-label="Meeting rooms" style={{
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--cth-cream-50)',
    color: 'var(--cth-ink-900)',
    fontFamily: 'var(--cth-font-ui)',
    fontSize: 13
  }}><RoomTabs channel={channel} onChange={setChannel} /><RoomParticipants people={office.participants(channel)} /><div style={{
      flex: 1,
      display: 'grid',
      placeContent: 'center',
      textAlign: 'center',
      gap: 12,
      padding: 20
    }}><strong>#{channel.slice(0, 1).toUpperCase() + channel.slice(1)} meeting</strong><p>Same people and discussion as the team chat room.</p><p>Opening the room is silent. Start the meeting or request a report when you are ready. Voice stays off until you enable it.</p><PixelButton onClick={() => setJoined(true)}>Open meeting room</PixelButton></div></section>;
}
