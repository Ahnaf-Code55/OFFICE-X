import { createPrivateKey, createPublicKey } from 'node:crypto';
import type { TeamIdentity } from '../shared/teamProtocol';
import type { TeamEnvelope } from '../shared/teamProtocol';
import { parseTeamPresence, type TeamPresenceSnapshot } from '../shared/teamPresence';

export const TEAM_PRESENCE_PROTOCOL = '/officex/presence/1.0.0';
export const TEAM_MESSAGE_PROTOCOL = '/officex/message/1.0.0';
export const TEAM_PRESENCE_MAX_FRAME_BYTES = 16 * 1024;
export const TEAM_MESSAGE_MAX_FRAME_BYTES = 64 * 1024;
const FRAME_HEADER_BYTES = 4;
const FRAME_TIMEOUT_MS = 15_000;
const FRAME_VERSION = 1;

interface PresenceWireFrame {
  version: 1;
  type: 'presence';
  officeId: string;
  senderId: string;
  snapshot: TeamPresenceSnapshot;
}

interface PresenceAckWireFrame {
  version: 1;
  type: 'ack';
  officeId: string;
  senderId: string;
}

interface MessageWireFrame {
  version: 1;
  type: 'message';
  officeId: string;
  senderId: string;
  /** Public scheduling hint only. The decrypted action must match this value in the main ingress. */
  trafficClass: TeamMessageTrafficClass;
  envelope: TeamEnvelope;
}

export type TeamMessageTrafficClass = 'control' | 'terminal-stream';

export const TEAM_CONTROL_MESSAGES_PER_MINUTE = 30;
export const TEAM_CONTROL_BYTES_PER_MINUTE = 1024 * 1024;
export const TEAM_PRESENCE_MESSAGES_PER_MINUTE = 30;
export const TEAM_PRESENCE_BYTES_PER_MINUTE = 256 * 1024;
export const TEAM_TERMINAL_BATCH_INTERVAL_MS = 250;
export const TEAM_TERMINAL_MAX_STREAMS_PER_PEER = 4;
export const TEAM_TERMINAL_MAX_BATCH_CHARS = 4096;
export const TEAM_TERMINAL_MESSAGES_PER_SECOND = 20;
export const TEAM_TERMINAL_MESSAGES_PER_MINUTE = TEAM_TERMINAL_MESSAGES_PER_SECOND * 60;
export const TEAM_TERMINAL_BYTES_PER_MINUTE = 8 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_PEER_LIMIT = 1024;

interface RateWindow { startedAt: number; count: number; bytes: number }

/** Per-peer frame and byte budgets. The caller authenticates peers before consumption. */
export class TeamMessageRateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  consume(peerId: string, trafficClass: TeamMessageTrafficClass, frameBytes: number, now = Date.now()): boolean {
    if (typeof peerId !== 'string' || !peerId || !Number.isSafeInteger(frameBytes) || frameBytes < 1) return false;
    if (trafficClass !== 'control' && trafficClass !== 'terminal-stream') return false;
    const key = `${peerId}\u0000${trafficClass}`;
    let window = this.windows.get(key);
    if (!window || now - window.startedAt >= RATE_WINDOW_MS || now < window.startedAt) {
      if (this.windows.size >= RATE_PEER_LIMIT * 2) {
        for (const [candidate, value] of this.windows) {
          if (now - value.startedAt >= RATE_WINDOW_MS || now < value.startedAt) this.windows.delete(candidate);
        }
      }
      if (this.windows.size >= RATE_PEER_LIMIT * 2) return false;
      window = { startedAt: now, count: 0, bytes: 0 };
      this.windows.set(key, window);
    }
    const maxMessages = trafficClass === 'terminal-stream' ? TEAM_TERMINAL_MESSAGES_PER_MINUTE : TEAM_CONTROL_MESSAGES_PER_MINUTE;
    const maxBytes = trafficClass === 'terminal-stream' ? TEAM_TERMINAL_BYTES_PER_MINUTE : TEAM_CONTROL_BYTES_PER_MINUTE;
    if (window.count + 1 > maxMessages || window.bytes + frameBytes > maxBytes) return false;
    window.count++;
    window.bytes += frameBytes;
    return true;
  }
}

/** Keep authenticated presence updates from a trusted device from flooding the renderer. */
export class TeamPresenceRateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  consume(peerId: string, frameBytes: number, now = Date.now()): boolean {
    if (typeof peerId !== 'string' || !peerId || !Number.isSafeInteger(frameBytes)
      || frameBytes < 1 || frameBytes > FRAME_HEADER_BYTES + TEAM_PRESENCE_MAX_FRAME_BYTES) return false;
    let window = this.windows.get(peerId);
    if (!window || now - window.startedAt >= RATE_WINDOW_MS || now < window.startedAt) {
      if (this.windows.size >= RATE_PEER_LIMIT) {
        for (const [candidate, value] of this.windows) {
          if (now - value.startedAt >= RATE_WINDOW_MS || now < value.startedAt) this.windows.delete(candidate);
        }
      }
      if (this.windows.size >= RATE_PEER_LIMIT) return false;
      window = { startedAt: now, count: 0, bytes: 0 };
      this.windows.set(peerId, window);
    }
    if (window.count + 1 > TEAM_PRESENCE_MESSAGES_PER_MINUTE
      || window.bytes + frameBytes > TEAM_PRESENCE_BYTES_PER_MINUTE) return false;
    window.count++;
    window.bytes += frameBytes;
    return true;
  }
}

interface MessageAckWireFrame {
  version: 1;
  type: 'message-ack';
  officeId: string;
  senderId: string;
  messageId: string;
  status: 'accepted' | 'rejected';
}

export interface TeamPresenceTarget {
  /** The libp2p Peer ID derived from the teammate's pinned Ed25519 key. */
  peerId: string;
  /** The locally pinned OFFICE-X device/member ID for that Peer ID. */
  memberId: string;
  /** Optional concrete direct or circuit-relay multiaddr. */
  multiaddr?: string;
}

/** Try a pinned direct route first, then the configured relay route(s). */
export async function sendTeamPresenceWithRouteFallback(
  sendPresence: (target: TeamPresenceTarget, snapshot: TeamPresenceSnapshot) => Promise<void>,
  target: Omit<TeamPresenceTarget, 'multiaddr'>,
  routes: readonly (string | undefined)[],
  snapshot: TeamPresenceSnapshot
): Promise<void> {
  const candidates = [...new Set(routes.map((route) => route || undefined))];
  if (candidates.length === 0) candidates.push(undefined);
  let lastError: unknown;
  for (const multiaddr of candidates) {
    try {
      await sendPresence({ ...target, ...(multiaddr ? { multiaddr } : {}) }, snapshot);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('could not send team presence');
}

export interface TeamTransportOptions {
  identity: Pick<TeamIdentity, 'deviceId' | 'signingPublicKey' | 'signingPrivateKey'>;
  officeId: string;
  /** Defaults to a wildcard TCP listener. Supply `/ws` addresses for WebSocket listeners. */
  listenAddresses?: readonly string[];
  /** If set, connect to and reserve a slot on this libp2p Circuit Relay v2 peer. */
  relayAddress?: string;
  /** Enable the libp2p Circuit Relay v2 HOP service for self-hosted deployments. */
  enableRelayServer?: boolean;
  /** Must match an owner-pinned Peer ID to its member ID; default-deny is intentional. */
  isPeerAuthorized(peerId: string, memberId: string, officeId: string): boolean | Promise<boolean>;
  /** Receives validated display-only snapshots. Never called for untrusted peers. */
  onPresence(input: {
    peerId: string;
    memberId: string;
    officeId: string;
    snapshot: TeamPresenceSnapshot;
  }): void | Promise<void>;
  onMessage?(input: { peerId: string; memberId: string; officeId: string; trafficClass: TeamMessageTrafficClass; envelope: TeamEnvelope }):
    void | { status: 'accepted' | 'rejected' } | Promise<void | { status: 'accepted' | 'rejected' }>;
  /** Dependency injection seam for tests and controlled runtime loading. */
  loadRuntime?: () => Promise<TeamTransportRuntime>;
  frameTimeoutMs?: number;
}

export interface TeamTransportRuntime {
  createLibp2p(config: Record<string, unknown>): Promise<TeamLibp2pNode>;
  noise(): unknown;
  yamux(): unknown;
  tcp(): unknown;
  webSockets(): unknown;
  circuitRelayTransport(): unknown;
  circuitRelayServer(): unknown;
  identify(): unknown;
  multiaddr(value: string): unknown;
  peerIdFromString(value: string): unknown;
  publicKeyFromRaw(value: Uint8Array): unknown;
  peerIdFromPublicKey(value: unknown): { toString(): string };
  generateKeyPairFromSeed(type: 'Ed25519', seed: Uint8Array): Promise<{
    publicKey: { raw: Uint8Array };
    [key: string]: unknown;
  }>;
}

interface TeamLibp2pStream extends AsyncIterable<Uint8Array | { subarray(): Uint8Array }> {
  send(data: Uint8Array): boolean;
  close(options?: { signal?: AbortSignal }): Promise<void>;
  abort(error: Error): void;
  onDrain(options?: { signal?: AbortSignal }): Promise<void>;
}

export interface TeamLibp2pNode {
  peerId: { toString(): string };
  getMultiaddrs(): Array<{ toString(): string }>;
  handle(
    protocol: string,
    handler: (stream: TeamLibp2pStream, connection: { remotePeer: { toString(): string } }) => void | Promise<void>,
    options?: { runOnLimitedConnection?: boolean }
  ): Promise<void>;
  unhandle(protocol: string): Promise<void> | void;
  start(): Promise<void>;
  stop(): Promise<void>;
  dial(target: unknown, options?: { signal?: AbortSignal }): Promise<{ remotePeer: { toString(): string } }>;
  dialProtocol(
    target: unknown,
    protocol: string,
    options?: { runOnLimitedConnection?: boolean; signal?: AbortSignal }
  ): Promise<TeamLibp2pStream>;
}

export interface TeamTransport {
  readonly peerId: string;
  getAddresses(): string[];
  sendPresence(target: TeamPresenceTarget, snapshot: unknown): Promise<void>;
  sendMessage(target: TeamPresenceTarget, envelope: TeamEnvelope, trafficClass?: TeamMessageTrafficClass,
    canWrite?: () => boolean): Promise<void>;
  close(): Promise<void>;
}

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const OFFICE_ID_RE = /^[A-Za-z0-9_.:-]{1,160}$/;

/** Keep ESM-only libp2p imports native when this file is bundled into CJS. */
async function loadLibp2pRuntime(): Promise<TeamTransportRuntime> {
  const [libp2p, cryptoKeys, noiseModule, yamuxModule, tcpModule, wsModule,
    relayModule, identifyModule, multiaddrModule, peerIdModule] = await Promise.all([
    import('libp2p'),
    import('@libp2p/crypto/keys'),
    import('@chainsafe/libp2p-noise'),
    import('@chainsafe/libp2p-yamux'),
    import('@libp2p/tcp'),
    import('@libp2p/websockets'),
    import('@libp2p/circuit-relay-v2'),
    import('@libp2p/identify'),
    import('@multiformats/multiaddr'),
    import('@libp2p/peer-id')
  ]);
  return {
    createLibp2p: libp2p.createLibp2p as TeamTransportRuntime['createLibp2p'],
    noise: noiseModule.noise,
    yamux: yamuxModule.yamux,
    tcp: tcpModule.tcp,
    webSockets: wsModule.webSockets,
    circuitRelayTransport: relayModule.circuitRelayTransport,
    circuitRelayServer: relayModule.circuitRelayServer,
    identify: identifyModule.identify,
    multiaddr: multiaddrModule.multiaddr,
    peerIdFromString: peerIdModule.peerIdFromString,
    publicKeyFromRaw: cryptoKeys.publicKeyFromRaw,
    peerIdFromPublicKey: peerIdModule.peerIdFromPublicKey,
    generateKeyPairFromSeed: cryptoKeys.generateKeyPairFromSeed
  };
}

function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new Error(`invalid team ${label}`);
}

function assertOfficeId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !OFFICE_ID_RE.test(value)) throw new Error('invalid team office id');
}

function toEd25519Seed(identity: TeamTransportOptions['identity']): { seed: Buffer; publicKey: Buffer } {
  if (typeof identity.signingPrivateKey !== 'string' || typeof identity.signingPublicKey !== 'string') {
    throw new Error('team signing keys are required');
  }
  const privateKey = createPrivateKey(identity.signingPrivateKey);
  const publicKey = createPublicKey(identity.signingPublicKey);
  if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('team transport requires Ed25519 signing keys');
  }
  const der = privateKey.export({ type: 'pkcs8', format: 'der' });
  if (der.length !== ED25519_PKCS8_PREFIX.length + 32 || !der.subarray(0, ED25519_PKCS8_PREFIX.length).equals(ED25519_PKCS8_PREFIX)) {
    throw new Error('team Ed25519 private key is not in the supported PKCS#8 format');
  }
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  if (publicDer.length < 32) throw new Error('invalid team Ed25519 public key');
  return { seed: der.subarray(-32), publicKey: publicDer.subarray(-32) };
}

/** Derive the stable libp2p Peer ID corresponding to an invited Ed25519 key. */
export async function teamPeerIdFromSigningPublicKey(
  pem: string,
  loadRuntime: () => Promise<TeamTransportRuntime> = loadLibp2pRuntime
): Promise<string> {
  if (typeof pem !== 'string' || pem.length === 0 || pem.length > 16_384) {
    throw new Error('invalid team signing public key');
  }
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey(pem);
  } catch {
    throw new Error('invalid team signing public key');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('team Peer ID requires an Ed25519 public key');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  if (der.length !== ED25519_SPKI_PREFIX.length + 32 || !der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new Error('team Ed25519 public key is not in the supported SPKI format');
  }
  const runtime = await loadRuntime();
  const libp2pKey = runtime.publicKeyFromRaw(der.subarray(-32));
  return runtime.peerIdFromPublicKey(libp2pKey).toString();
}

function bytesOf(chunk: Uint8Array | { subarray(): Uint8Array }): Uint8Array {
  return chunk instanceof Uint8Array ? chunk : chunk.subarray();
}

function encodeFrame(value: PresenceWireFrame | PresenceAckWireFrame | MessageWireFrame | MessageAckWireFrame, maxBytes = TEAM_PRESENCE_MAX_FRAME_BYTES): Uint8Array {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length === 0 || payload.length > maxBytes) {
    throw new Error('team frame exceeds the size limit');
  }
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, FRAME_HEADER_BYTES);
  return frame;
}

const ENVELOPE_KEYS = ['version', 'messageId', 'officeId', 'senderId', 'recipientId', 'issuedAt', 'expiresAt',
  'ephemeralPublicKey', 'iv', 'ciphertext', 'authTag', 'signature'] as const;

function validateTeamEnvelope(value: unknown): TeamEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid team envelope');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== ENVELOPE_KEYS.length || !ENVELOPE_KEYS.every((key) => Object.hasOwn(raw, key))
    || raw.version !== 1 || typeof raw.messageId !== 'string' || !ID_RE.test(raw.messageId)
    || typeof raw.officeId !== 'string' || !OFFICE_ID_RE.test(raw.officeId)
    || typeof raw.senderId !== 'string' || !ID_RE.test(raw.senderId)
    || typeof raw.recipientId !== 'string' || !ID_RE.test(raw.recipientId)
    || !Number.isSafeInteger(raw.issuedAt) || !Number.isSafeInteger(raw.expiresAt)
    || typeof raw.ephemeralPublicKey !== 'string' || raw.ephemeralPublicKey.length > 1024
    || typeof raw.iv !== 'string' || raw.iv.length > 32
    || typeof raw.ciphertext !== 'string' || raw.ciphertext.length > 44_000
    || typeof raw.authTag !== 'string' || raw.authTag.length > 32
    || typeof raw.signature !== 'string' || raw.signature.length > 128) {
    throw new Error('invalid team envelope');
  }
  return raw as unknown as TeamEnvelope;
}

export function encodeTeamMessageFrame(input: { officeId: string; senderId: string; envelope: TeamEnvelope; trafficClass?: TeamMessageTrafficClass }): Uint8Array {
  assertOfficeId(input.officeId);
  assertSafeIdentifier(input.senderId, 'device id');
  const trafficClass = input.trafficClass ?? 'control';
  if (trafficClass !== 'control' && trafficClass !== 'terminal-stream') throw new Error('invalid team message traffic class');
  const envelope = validateTeamEnvelope(input.envelope);
  if (envelope.officeId !== input.officeId || envelope.senderId !== input.senderId) throw new Error('team envelope sender mismatch');
  return encodeFrame({ version: FRAME_VERSION, type: 'message', officeId: input.officeId, senderId: input.senderId, trafficClass, envelope }, TEAM_MESSAGE_MAX_FRAME_BYTES);
}

export function decodeTeamMessageFrame(frame: Uint8Array): MessageWireFrame {
  const raw = decodeJsonFrame(frame, TEAM_MESSAGE_MAX_FRAME_BYTES, 'team message');
  const keys = Object.keys(raw);
  if (keys.length !== 6 || !['version', 'type', 'officeId', 'senderId', 'trafficClass', 'envelope'].every((key) => keys.includes(key))
    || raw.version !== FRAME_VERSION || raw.type !== 'message') throw new Error('invalid team message frame');
  if (raw.trafficClass !== 'control' && raw.trafficClass !== 'terminal-stream') throw new Error('invalid team message traffic class');
  assertOfficeId(raw.officeId);
  assertSafeIdentifier(raw.senderId, 'device id');
  const envelope = validateTeamEnvelope(raw.envelope);
  if (envelope.officeId !== raw.officeId || envelope.senderId !== raw.senderId) throw new Error('team message identity mismatch');
  return { version: FRAME_VERSION, type: 'message', officeId: raw.officeId, senderId: raw.senderId,
    trafficClass: raw.trafficClass, envelope };
}

function decodeJsonFrame(frame: Uint8Array, maxBytes: number, label: string): Record<string, unknown> {
  if (!(frame instanceof Uint8Array) || frame.byteLength < FRAME_HEADER_BYTES + 2 || frame.byteLength > FRAME_HEADER_BYTES + maxBytes) {
    throw new Error(`invalid ${label} frame size`);
  }
  const view = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  const size = view.readUInt32BE(0);
  if (size === 0 || size > maxBytes || size !== view.length - FRAME_HEADER_BYTES) throw new Error(`invalid ${label} frame length`);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(view.subarray(FRAME_HEADER_BYTES))); }
  catch { throw new Error(`invalid ${label} frame JSON`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid ${label} frame`);
  return value as Record<string, unknown>;
}

function encodeMessageAck(input: MessageAckWireFrame): Uint8Array {
  return encodeFrame(input, TEAM_MESSAGE_MAX_FRAME_BYTES);
}

function decodeMessageAck(frame: Uint8Array): MessageAckWireFrame {
  const raw = decodeJsonFrame(frame, TEAM_MESSAGE_MAX_FRAME_BYTES, 'team message acknowledgement');
  const keys = Object.keys(raw);
  if (keys.length !== 6 || !['version', 'type', 'officeId', 'senderId', 'messageId', 'status'].every((key) => keys.includes(key))
    || raw.version !== FRAME_VERSION || raw.type !== 'message-ack'
    || typeof raw.officeId !== 'string' || typeof raw.senderId !== 'string' || typeof raw.messageId !== 'string'
    || (raw.status !== 'accepted' && raw.status !== 'rejected')) {
    throw new Error('invalid team message acknowledgement');
  }
  return raw as unknown as MessageAckWireFrame;
}

export function encodeTeamPresenceFrame(input: {
  officeId: string;
  senderId: string;
  snapshot: unknown;
}): Uint8Array {
  assertOfficeId(input.officeId);
  assertSafeIdentifier(input.senderId, 'device id');
  return encodeFrame({
    version: FRAME_VERSION,
    type: 'presence',
    officeId: input.officeId,
    senderId: input.senderId,
    snapshot: parseTeamPresence(input.snapshot)
  });
}

export function decodeTeamPresenceFrame(frame: Uint8Array): PresenceWireFrame {
  if (!(frame instanceof Uint8Array) || frame.byteLength < FRAME_HEADER_BYTES + 2
    || frame.byteLength > FRAME_HEADER_BYTES + TEAM_PRESENCE_MAX_FRAME_BYTES) {
    throw new Error('invalid team presence frame size');
  }
  const view = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  const size = view.readUInt32BE(0);
  if (size === 0 || size > TEAM_PRESENCE_MAX_FRAME_BYTES || size !== view.length - FRAME_HEADER_BYTES) {
    throw new Error('invalid team presence frame length');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(view.subarray(FRAME_HEADER_BYTES)));
  } catch {
    throw new Error('invalid team presence JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid team presence message');
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length !== 5 || !['version', 'type', 'officeId', 'senderId', 'snapshot'].every((key) => keys.includes(key))
    || raw.version !== FRAME_VERSION || raw.type !== 'presence') {
    throw new Error('invalid team presence message');
  }
  assertOfficeId(raw.officeId);
  assertSafeIdentifier(raw.senderId, 'device id');
  return {
    version: FRAME_VERSION,
    type: 'presence',
    officeId: raw.officeId,
    senderId: raw.senderId,
    snapshot: parseTeamPresence(raw.snapshot)
  };
}

function decodeAckFrame(frame: Uint8Array): PresenceAckWireFrame {
  if (frame.byteLength < FRAME_HEADER_BYTES + 2 || frame.byteLength > FRAME_HEADER_BYTES + TEAM_PRESENCE_MAX_FRAME_BYTES) {
    throw new Error('invalid team presence acknowledgement size');
  }
  const view = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  const size = view.readUInt32BE(0);
  if (size === 0 || size > TEAM_PRESENCE_MAX_FRAME_BYTES || size !== view.length - FRAME_HEADER_BYTES) {
    throw new Error('invalid team presence acknowledgement length');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(view.subarray(FRAME_HEADER_BYTES)));
  } catch {
    throw new Error('invalid team presence acknowledgement JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid team presence acknowledgement');
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw);
  if (keys.length !== 4 || !['version', 'type', 'officeId', 'senderId'].every((key) => keys.includes(key))
    || raw.version !== FRAME_VERSION || raw.type !== 'ack' || typeof raw.officeId !== 'string' || typeof raw.senderId !== 'string') {
    throw new Error('invalid team presence acknowledgement');
  }
  return { version: FRAME_VERSION, type: 'ack', officeId: raw.officeId, senderId: raw.senderId };
}

async function sendFrame(stream: TeamLibp2pStream, frame: Uint8Array, signal: AbortSignal): Promise<void> {
  if (!stream.send(frame)) await stream.onDrain({ signal });
  await stream.close({ signal });
}

async function readSingleFrame(stream: TeamLibp2pStream, timeoutMs: number, maxBytes = TEAM_PRESENCE_MAX_FRAME_BYTES): Promise<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator]();
  const deadline = Date.now() + timeoutMs;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('team presence stream timed out');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('team presence stream timed out')), remaining);
          timer.unref?.();
        })
      ]).finally(() => { if (timer) clearTimeout(timer); });
      if (next.done) break;
      const bytes = bytesOf(next.value);
      total += bytes.byteLength;
      if (total > FRAME_HEADER_BYTES + maxBytes) throw new Error('team stream exceeds the size limit');
      chunks.push(Uint8Array.from(bytes));
    }
  } finally {
    // Do not await return after a timeout: a pending iterator.next() is only
    // guaranteed to unblock after the caller aborts the stream.
    if (iterator.return) void iterator.return().catch(() => undefined);
  }
  const frame = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { frame.set(chunk, offset); offset += chunk.byteLength; }
  return frame;
}

/** Create the authenticated presence and encrypted action transport for one office. */
export async function createTeamTransport(options: TeamTransportOptions): Promise<TeamTransport> {
  assertSafeIdentifier(options.identity?.deviceId, 'device id');
  assertOfficeId(options.officeId);
  if (typeof options.isPeerAuthorized !== 'function') throw new Error('team peer authorization callback is required');
  if (typeof options.onPresence !== 'function') throw new Error('team presence callback is required');
  if (options.relayAddress !== undefined && (typeof options.relayAddress !== 'string' || options.relayAddress.length > 1024)) {
    throw new Error('invalid Circuit Relay address');
  }
  const frameTimeoutMs = options.frameTimeoutMs ?? FRAME_TIMEOUT_MS;
  if (!Number.isInteger(frameTimeoutMs) || frameTimeoutMs < 1000 || frameTimeoutMs > 60_000) {
    throw new Error('invalid team presence frame timeout');
  }

  const key = toEd25519Seed(options.identity);
  const runtime = await (options.loadRuntime ?? loadLibp2pRuntime)();
  const privateKey = await runtime.generateKeyPairFromSeed('Ed25519', key.seed);
  if (!Buffer.from(privateKey.publicKey.raw).equals(key.publicKey)) {
    throw new Error('libp2p signing key does not match the pinned OFFICE-X device key');
  }

  const relayClient = Boolean(options.relayAddress);
  const listenAddresses = [...(options.listenAddresses ?? (options.enableRelayServer
    ? ['/ip4/0.0.0.0/tcp/0/ws']
    : ['/ip4/0.0.0.0/tcp/0']))];
  if (listenAddresses.length === 0 || listenAddresses.length > 8
    || listenAddresses.some((address) => typeof address !== 'string' || address.length > 512)) {
    throw new Error('invalid team transport listen addresses');
  }
  if (relayClient && !listenAddresses.includes('/p2p-circuit')) listenAddresses.push('/p2p-circuit');

  const transports = [runtime.tcp(), runtime.webSockets()];
  if (relayClient) transports.push(runtime.circuitRelayTransport());
  const services: Record<string, unknown> = { identify: runtime.identify() };
  if (options.enableRelayServer) services.relay = runtime.circuitRelayServer();

  const node = await runtime.createLibp2p({
    privateKey,
    start: false,
    addresses: { listen: listenAddresses },
    transports,
    connectionEncrypters: [runtime.noise()],
    streamMuxers: [runtime.yamux()],
    services
  });

  let closed = false;
  let handlerInstalled = false;
  let messageHandlerInstalled = false;
  const inboundMessageRateLimiter = new TeamMessageRateLimiter();
  const inboundPresenceRateLimiter = new TeamPresenceRateLimiter();
  const officeId = options.officeId;
  const failStream = (stream: TeamLibp2pStream, error: unknown) => {
    const message = error instanceof Error ? error : new Error('team presence stream rejected');
    try { stream.abort(message); } catch { /* Stream may already be closed. */ }
  };
  const handler = async (stream: TeamLibp2pStream, connection: { remotePeer: { toString(): string } }) => {
    try {
      const frameBytes = await readSingleFrame(stream, frameTimeoutMs);
      const frame = decodeTeamPresenceFrame(frameBytes);
      const peerId = connection.remotePeer.toString();
      if (frame.officeId !== officeId) throw new Error('presence belongs to another office');
      if (!await options.isPeerAuthorized(peerId, frame.senderId, officeId)) throw new Error('untrusted team peer');
      if (!inboundPresenceRateLimiter.consume(peerId, frameBytes.byteLength)) throw new Error('team presence rate limit exceeded');
      await options.onPresence({ peerId, memberId: frame.senderId, officeId, snapshot: frame.snapshot });
      const ack = encodeFrame({ version: FRAME_VERSION, type: 'ack', officeId, senderId: options.identity.deviceId });
      const signal = AbortSignal.timeout(frameTimeoutMs);
      await sendFrame(stream, ack, signal);
    } catch (error) {
      failStream(stream, error);
    }
  };

  const messageHandler = async (stream: TeamLibp2pStream, connection: { remotePeer: { toString(): string } }) => {
    try {
      const peerId = connection.remotePeer.toString();
      const frameBytes = await readSingleFrame(stream, frameTimeoutMs, TEAM_MESSAGE_MAX_FRAME_BYTES);
      const frame = decodeTeamMessageFrame(frameBytes);
      if (frame.officeId !== officeId || !await options.isPeerAuthorized(peerId, frame.senderId, officeId)) {
        throw new Error('untrusted team message peer');
      }
      if (!inboundMessageRateLimiter.consume(peerId, frame.trafficClass, frameBytes.byteLength)) {
        throw new Error(`team ${frame.trafficClass} message rate limit exceeded`);
      }
      if (!options.onMessage) throw new Error('team messages are not enabled on this node');
      const disposition = await options.onMessage({ peerId, memberId: frame.senderId, officeId,
        trafficClass: frame.trafficClass, envelope: frame.envelope });
      await sendFrame(stream, encodeMessageAck({
        version: FRAME_VERSION, type: 'message-ack', officeId, senderId: options.identity.deviceId,
        messageId: frame.envelope.messageId, status: disposition?.status === 'rejected' ? 'rejected' : 'accepted'
      }), AbortSignal.timeout(frameTimeoutMs));
    } catch (error) {
      failStream(stream, error);
    }
  };

  try {
    await node.handle(TEAM_PRESENCE_PROTOCOL, handler, { runOnLimitedConnection: true });
    handlerInstalled = true;
    await node.handle(TEAM_MESSAGE_PROTOCOL, messageHandler, { runOnLimitedConnection: true });
    messageHandlerInstalled = true;
    await node.start();
    if (relayClient) await node.dial(runtime.multiaddr(options.relayAddress!));
  } catch (error) {
    if (handlerInstalled) await Promise.resolve(node.unhandle(TEAM_PRESENCE_PROTOCOL)).catch(() => undefined);
    if (messageHandlerInstalled) await Promise.resolve(node.unhandle(TEAM_MESSAGE_PROTOCOL)).catch(() => undefined);
    await node.stop().catch(() => undefined);
    throw error;
  }

  return {
    peerId: node.peerId.toString(),
    getAddresses: () => node.getMultiaddrs().map((address) => address.toString()),
    async sendPresence(target, snapshot) {
      if (closed) throw new Error('team transport is closed');
      assertSafeIdentifier(target?.memberId, 'member id');
      if (!target || typeof target.peerId !== 'string' || target.peerId.length > 128) throw new Error('invalid team presence target');
      const authorized = await options.isPeerAuthorized(target.peerId, target.memberId, officeId);
      if (!authorized) throw new Error('team presence target is not trusted');
      const signal = AbortSignal.timeout(frameTimeoutMs);
      const peerId = runtime.peerIdFromString(target.peerId);
      if (target.multiaddr) {
        const connection = await node.dial(runtime.multiaddr(target.multiaddr), { signal });
        if (connection.remotePeer.toString() !== target.peerId) {
          throw new Error('team presence address resolved to a different Peer ID');
        }
      }
      const stream = await node.dialProtocol(peerId, TEAM_PRESENCE_PROTOCOL, { runOnLimitedConnection: true, signal });
      try {
        await sendFrame(stream, encodeTeamPresenceFrame({
          officeId,
          senderId: options.identity.deviceId,
          snapshot
        }), signal);
        const ack = decodeAckFrame(await readSingleFrame(stream, frameTimeoutMs));
        if (ack.officeId !== officeId || ack.senderId !== target.memberId) {
          throw new Error('presence acknowledgement identity mismatch');
        }
      } catch (error) {
        failStream(stream, error);
        throw error;
      }
    },
    async sendMessage(target, envelopeInput, trafficClass = 'control', canWrite) {
      if (closed) throw new Error('team transport is closed');
      assertSafeIdentifier(target?.memberId, 'member id');
      const envelope = validateTeamEnvelope(envelopeInput);
      if (envelope.officeId !== officeId || envelope.senderId !== options.identity.deviceId
        || envelope.recipientId !== target.memberId || typeof target.peerId !== 'string' || target.peerId.length > 128) {
        throw new Error('team message recipient identity mismatch');
      }
      if (!await options.isPeerAuthorized(target.peerId, target.memberId, officeId)) throw new Error('team message target is not trusted');
      const signal = AbortSignal.timeout(frameTimeoutMs);
      const peerId = runtime.peerIdFromString(target.peerId);
      if (target.multiaddr) {
        const connection = await node.dial(runtime.multiaddr(target.multiaddr), { signal });
        if (connection.remotePeer.toString() !== target.peerId) throw new Error('team message address resolved to a different Peer ID');
      }
      const stream = await node.dialProtocol(peerId, TEAM_MESSAGE_PROTOCOL, { runOnLimitedConnection: true, signal });
      try {
        // Re-check policy after all dialing awaits and immediately before the
        // first stream write. This closes the window where a terminal share is
        // revoked while route establishment is in progress.
        if (canWrite && !canWrite()) throw new Error('team message authorization changed before write');
        await sendFrame(stream, encodeTeamMessageFrame({ officeId, senderId: options.identity.deviceId, envelope, trafficClass }), signal);
        const ack = decodeMessageAck(await readSingleFrame(stream, frameTimeoutMs, TEAM_MESSAGE_MAX_FRAME_BYTES));
        if (ack.officeId !== officeId || ack.senderId !== target.memberId || ack.messageId !== envelope.messageId) {
          throw new Error('team message acknowledgement identity mismatch');
        }
        if (ack.status !== 'accepted') throw new Error('teammate rejected the team message');
      } catch (error) {
        failStream(stream, error);
        throw error;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (handlerInstalled) {
        handlerInstalled = false;
        await Promise.resolve(node.unhandle(TEAM_PRESENCE_PROTOCOL)).catch(() => undefined);
      }
      if (messageHandlerInstalled) {
        messageHandlerInstalled = false;
        await Promise.resolve(node.unhandle(TEAM_MESSAGE_PROTOCOL)).catch(() => undefined);
      }
      await node.stop();
    }
  };
}
