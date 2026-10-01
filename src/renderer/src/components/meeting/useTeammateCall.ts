import { useEffect, useRef, useState } from 'react';

type Signal = Parameters<typeof window.cth.sendRtcSignal>[1];

// STUN only discovers public addresses. Two peers behind symmetric NAT, or a
// LAN/relay-only setup with no route to Google, need a TURN server we don't ship.
const RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
// Candidates found within this window ride inside the offer/answer SDP; later ones
// trickle one message each. Keeps a call to a handful of messages under the
// shared-office control rate limit (30/min per teammate, shared with chat).
const GATHER_MS = 1500;
const RING_TIMEOUT_MS = 45_000;
const REMOTE_VOICE_RMS = 0.02;

export type CallState = 'calling' | 'ringing' | 'connecting' | 'live';
export interface Call { memberId: string; memberName: string; callId: string; state: CallState }

interface Live {
  call: Call;
  pc: RTCPeerConnection | null;
  mic: MediaStream | null;
  offerSdp: string;
  pendingCandidates: RTCIceCandidateInit[];
  trickle: boolean;
  sendChain: Promise<unknown>;
  stop: Array<() => void>;
}

const signal = (callId: string, kind: Signal['kind'], extra: Partial<Signal> = {}): Signal =>
  ({ callId, kind, sdp: '', candidate: '', sdpMid: '', sdpMLineIndex: -1, ...extra });

function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(timer); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** One human-to-human voice call at a time, signalled through the encrypted
 *  shared-office channel. Audio itself flows peer to peer over WebRTC. */
export function useTeammateCall(muted: boolean) {
  const [call, setCall] = useState<Call | null>(null);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);
  const [notice, setNotice] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const live = useRef<Live | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const update = (state: CallState) => {
    if (!live.current) return;
    live.current.call = { ...live.current.call, state };
    setCall(live.current.call);
  };

  // Signals go out strictly in order so a trickled candidate never beats its offer.
  // A failed send rejects only its own caller; the next signal (e.g. hangup) still goes.
  const send = (l: Live, s: Signal) => {
    const next = l.sendChain.catch(() => {}).then(async () => {
      const result = await window.cth.sendRtcSignal(l.call.memberId, s);
      if (!result.ok) throw new Error(result.error ?? 'could not reach teammate');
    });
    l.sendChain = next;
    return next;
  };

  const end = (message = '', notify = true) => {
    const l = live.current;
    if (!l) return;
    live.current = null;
    if (notify) void send(l, signal(l.call.callId, 'hangup')).catch(() => {});
    l.stop.forEach((fn) => fn());
    l.pc?.close();
    l.mic?.getTracks().forEach((t) => t.stop());
    if (audioRef.current) audioRef.current.srcObject = null;
    setCall(null);
    setRemoteSpeaking(false);
    setNotice(message);
  };

  const fail = (e: unknown) => end(`Call failed: ${e instanceof Error ? e.message : String(e)}`);

  /** Mic in, remote audio out to the <audio> element, plus a level meter for the seat glow. */
  const connect = async (l: Live) => {
    l.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (live.current !== l) { l.mic.getTracks().forEach((t) => t.stop()); throw new Error('call ended'); }
    l.mic.getAudioTracks().forEach((t) => { t.enabled = !mutedRef.current; });
    const pc = new RTCPeerConnection(RTC_CONFIG);
    l.pc = pc;
    l.mic.getTracks().forEach((t) => pc.addTrack(t, l.mic!));
    pc.onicecandidate = (e) => {
      if (!l.trickle || !e.candidate?.candidate || live.current !== l) return;
      void send(l, signal(l.call.callId, 'candidate', {
        candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid ?? '', sdpMLineIndex: e.candidate.sdpMLineIndex ?? -1
      })).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (live.current !== l) return;
      if (pc.connectionState === 'connected') update('live');
      else if (pc.connectionState === 'failed') end('Could not connect the call (the network may need a TURN relay).');
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      if (audioRef.current) audioRef.current.srcObject = stream;
      const ctx = new AudioContext();
      void ctx.resume();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      const frame = new Float32Array(analyser.fftSize);
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(frame);
        let sum = 0;
        for (const v of frame) sum += v * v;
        setRemoteSpeaking(Math.sqrt(sum / frame.length) > REMOTE_VOICE_RMS);
      }, 120);
      l.stop.push(() => { clearInterval(timer); void ctx.close(); });
    };
    return pc;
  };

  /** Set our description, wait briefly for candidates, send it, then trickle the rest. */
  const sendDescription = async (l: Live, pc: RTCPeerConnection, kind: 'offer' | 'answer') => {
    await pc.setLocalDescription(kind === 'offer' ? await pc.createOffer() : await pc.createAnswer());
    await gathered(pc);
    if (live.current !== l) return;
    l.trickle = true;
    await send(l, signal(l.call.callId, kind, { sdp: pc.localDescription?.sdp ?? '' }));
  };

  const addCandidates = async (l: Live) => {
    for (const c of l.pendingCandidates.splice(0)) await l.pc?.addIceCandidate(c).catch(() => {});
  };

  const begin = (memberId: string, memberName: string, callId: string, state: CallState, offerSdp = ''): Live => {
    const l: Live = { call: { memberId, memberName, callId, state }, pc: null, mic: null, offerSdp, pendingCandidates: [],
      trickle: false, sendChain: Promise.resolve(), stop: [] };
    live.current = l;
    setCall(l.call);
    setNotice('');
    // Unanswered either way (or the other side's hangup got lost): give up.
    const timer = setTimeout(() => {
      if (live.current === l && (l.call.state === 'calling' || l.call.state === 'ringing')) {
        end(state === 'calling' ? `${memberName} didn't answer.` : `Missed call from ${memberName}.`);
      }
    }, RING_TIMEOUT_MS);
    l.stop.push(() => clearTimeout(timer));
    return l;
  };

  const start = async (memberId: string, memberName: string) => {
    if (live.current) return;
    const l = begin(memberId, memberName, crypto.randomUUID().replace(/-/g, ''), 'calling');
    try { await sendDescription(l, await connect(l), 'offer'); } catch (e) { if (live.current === l) fail(e); }
  };

  const accept = async () => {
    const l = live.current;
    if (!l || l.call.state !== 'ringing') return;
    update('connecting');
    try {
      const pc = await connect(l);
      await pc.setRemoteDescription({ type: 'offer', sdp: l.offerSdp });
      await addCandidates(l);
      await sendDescription(l, pc, 'answer');
    } catch (e) { if (live.current === l) fail(e); }
  };

  useEffect(() => {
    const off = window.cth.onRtcSignal(({ memberId, memberName, signal: s }) => {
      const l = live.current;
      const ours = l && l.call.memberId === memberId && l.call.callId === s.callId;
      if (s.kind === 'offer') {
        // Busy with someone else: refuse instead of silently dropping the ring.
        if (l && !ours) void window.cth.sendRtcSignal(memberId, signal(s.callId, 'hangup'));
        else if (!l) begin(memberId, memberName, s.callId, 'ringing', s.sdp);
        return;
      }
      if (!l || !ours) return;
      if (s.kind === 'hangup') end(l.call.state === 'calling' ? `${memberName} declined.` : `${memberName} hung up.`, false);
      else if (s.kind === 'answer' && l.call.state === 'calling' && l.pc) {
        update('connecting');
        void l.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp }).then(() => addCandidates(l))
          .catch((e) => { if (live.current === l) fail(e); });
      } else if (s.kind === 'candidate') {
        l.pendingCandidates.push({ candidate: s.candidate, sdpMid: s.sdpMid || null, sdpMLineIndex: s.sdpMLineIndex < 0 ? null : s.sdpMLineIndex });
        if (l.pc?.remoteDescription) void addCandidates(l);
      }
    });
    return () => { off(); end(); };
  }, []);

  useEffect(() => { live.current?.mic?.getAudioTracks().forEach((t) => { t.enabled = !muted; }); }, [muted]);

  return {
    call, remoteSpeaking, notice, audioRef,
    start: (memberId: string, memberName: string) => void start(memberId, memberName),
    accept: () => void accept(),
    hangup: () => end()
  };
}
