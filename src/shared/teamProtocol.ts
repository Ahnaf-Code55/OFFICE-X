/**
 * OFFICE-X shared-office wire contract.
 *
 * Transport is deliberately absent from this module. Relay, direct peer and
 * self-hosted connections all carry the same signed, end-to-end encrypted
 * envelope and pass through the same permission evaluator.
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify
} from 'node:crypto';
import type { PeerControlLevel } from './triggers';

export const TEAM_PROTOCOL_VERSION = 1 as const;
export const MAX_TEAM_MESSAGE_BYTES = 256 * 1024;
export const MAX_TEAM_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MAX_TEAM_MESSAGE_TTL_MS = 10 * 60 * 1000;

export type TeamAction =
  | 'presence'
  | 'task-request'
  | 'agent-status'
  | 'agent-prompt'
  | 'terminal-stream'
  | 'terminal-input'
  | 'chat';

export interface TeamIdentity {
  deviceId: string;
  signingPublicKey: string;
  signingPrivateKey: string;
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
}

/** Public information an office keeps for one invited teammate/device. */
export interface TeamMember {
  id: string;
  displayName: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  controlLevel: PeerControlLevel;
  directEndpoint?: string;
}

/** Renderer-safe teammate roster row. Public keys are represented by a fingerprint. */
export interface TeamMemberSummary {
  memberId: string;
  displayName: string;
  controlLevel: PeerControlLevel;
  fingerprint: string;
  createdAt: number;
}

/** Copyable public invitation payload. It is not proof of identity by itself. */
export interface TeamMemberInvite {
  version: 1;
  officeId: string;
  memberId: string;
  displayName: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  fingerprint: string;
  /** Optional direct or Circuit Relay route; public routing metadata only. */
  directEndpoint?: string;
}

/** Public identity imported from another device after out-of-band fingerprint verification. */
export interface TeamMemberPinInput {
  officeId: string;
  memberId: string;
  displayName: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
  controlLevel: PeerControlLevel;
  fingerprintConfirmation: string;
  directEndpoint?: string;
}

export interface TeamMessage {
  id: string;
  officeId: string;
  senderId: string;
  recipientId: string;
  action: TeamAction;
  body: Record<string, unknown>;
  issuedAt: number;
  expiresAt: number;
}

export interface TeamEnvelope {
  version: typeof TEAM_PROTOCOL_VERSION;
  messageId: string;
  officeId: string;
  senderId: string;
  recipientId: string;
  issuedAt: number;
  expiresAt: number;
  ephemeralPublicKey: string;
  iv: string;
  ciphertext: string;
  authTag: string;
  signature: string;
}

const ACTIONS: readonly TeamAction[] = [
  'presence', 'task-request', 'agent-status', 'agent-prompt', 'terminal-stream', 'terminal-input', 'chat'
];

const ALLOWED_ACTIONS: Record<PeerControlLevel, ReadonlySet<TeamAction>> = {
  'task-requests': new Set(['presence', 'task-request', 'agent-status', 'chat']),
  delegated: new Set(['presence', 'task-request', 'agent-status', 'agent-prompt', 'chat']),
  'full-control': new Set(ACTIONS)
};

export function isPeerActionAllowed(level: PeerControlLevel, action: TeamAction): boolean {
  return ALLOWED_ACTIONS[level]?.has(action) === true;
}

/** Durable replay ledger. Implementations must make the insert atomic. */
export interface TeamReplayStore {
  /** Return false when this office/sender/message id has already been accepted. */
  consume(officeId: string, senderId: string, messageId: string, expiresAt: number, now: number): boolean;
}

function exportPem(key: ReturnType<typeof generateKeyPairSync>['publicKey'], type: 'spki' | 'pkcs8'): string {
  return key.export({ type, format: 'pem' } as never).toString();
}

export function isTeamDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function createTeamIdentity(deviceId: string): TeamIdentity {
  if (!isTeamDeviceId(deviceId)) throw new Error('invalid device id');
  const signing = generateKeyPairSync('ed25519');
  const encryption = generateKeyPairSync('x25519');
  return {
    deviceId,
    signingPublicKey: exportPem(signing.publicKey, 'spki'),
    signingPrivateKey: exportPem(signing.privateKey, 'pkcs8'),
    encryptionPublicKey: exportPem(encryption.publicKey, 'spki'),
    encryptionPrivateKey: exportPem(encryption.privateKey, 'pkcs8')
  };
}

function headerOf(envelope: Omit<TeamEnvelope, 'signature'>): string {
  return JSON.stringify({
    version: envelope.version,
    messageId: envelope.messageId,
    officeId: envelope.officeId,
    senderId: envelope.senderId,
    recipientId: envelope.recipientId,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
    ephemeralPublicKey: envelope.ephemeralPublicKey,
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
    authTag: envelope.authTag
  });
}

function aadFor(message: Pick<TeamMessage, 'id' | 'officeId' | 'senderId' | 'recipientId' | 'issuedAt' | 'expiresAt'>): Buffer {
  return Buffer.from(JSON.stringify({
    version: TEAM_PROTOCOL_VERSION,
    messageId: message.id,
    officeId: message.officeId,
    senderId: message.senderId,
    recipientId: message.recipientId,
    issuedAt: message.issuedAt,
    expiresAt: message.expiresAt
  }), 'utf8');
}

function deriveKey(sharedSecret: Buffer, aad: Buffer): Buffer {
  return Buffer.from(hkdfSync(
    'sha256', sharedSecret, Buffer.from('office-x-team-v1', 'utf8'), aad, 32
  ));
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
}

function assertMessage(message: TeamMessage): void {
  if (!validId(message.id) || !validId(message.officeId)
    || !validId(message.senderId) || !validId(message.recipientId)) {
    throw new Error('invalid team message identity');
  }
  if (!ACTIONS.includes(message.action)) throw new Error('invalid team action');
  if (!Number.isSafeInteger(message.issuedAt) || !Number.isSafeInteger(message.expiresAt)
    || message.expiresAt <= message.issuedAt
    || message.expiresAt - message.issuedAt > MAX_TEAM_MESSAGE_TTL_MS) {
    throw new Error('invalid team message lifetime');
  }
  if (!message.body || typeof message.body !== 'object' || Array.isArray(message.body)) {
    throw new Error('invalid team message body');
  }
}

export function sealTeamMessage(input: {
  message: TeamMessage;
  sender: Pick<TeamIdentity, 'deviceId' | 'signingPrivateKey'>;
  recipientEncryptionPublicKey: string;
}): TeamEnvelope {
  assertMessage(input.message);
  if (input.sender.deviceId !== input.message.senderId) throw new Error('sender identity mismatch');
  const plaintext = Buffer.from(JSON.stringify(input.message), 'utf8');
  if (plaintext.length > MAX_TEAM_MESSAGE_BYTES) throw new Error('team message too large');

  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralPublicKey = exportPem(ephemeral.publicKey, 'spki');
  const recipientKey = createPublicKey(input.recipientEncryptionPublicKey);
  if (recipientKey.asymmetricKeyType !== 'x25519') throw new Error('recipient encryption key must be X25519');
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipientKey
  });
  const aad = aadFor(input.message);
  const key = deriveKey(shared, aad);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const unsigned: Omit<TeamEnvelope, 'signature'> = {
    version: TEAM_PROTOCOL_VERSION,
    messageId: input.message.id,
    officeId: input.message.officeId,
    senderId: input.message.senderId,
    recipientId: input.message.recipientId,
    issuedAt: input.message.issuedAt,
    expiresAt: input.message.expiresAt,
    ephemeralPublicKey,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64')
  };
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(headerOf(unsigned)), createPrivateKey(input.sender.signingPrivateKey)).toString('base64')
  };
}

export function openTeamEnvelope(input: {
  envelope: TeamEnvelope;
  recipientId: string;
  officeId: string;
  recipientEncryptionPrivateKey: string;
  /** Trusted, locally pinned membership record. Never populate from the envelope. */
  expectedPeer: Pick<TeamMember, 'id' | 'signingPublicKey'>;
  now?: number;
}): TeamMessage {
  const envelope = input.envelope;
  if (!envelope || envelope.version !== TEAM_PROTOCOL_VERSION) throw new Error('unsupported team protocol');
  if (envelope.recipientId !== input.recipientId) throw new Error('wrong team message recipient');
  if (envelope.officeId !== input.officeId) throw new Error('wrong team office');
  if (envelope.senderId !== input.expectedPeer.id) throw new Error('sender does not match trusted team member');
  if (![envelope.messageId, envelope.officeId, envelope.senderId, envelope.recipientId].every(validId)) {
    throw new Error('invalid team envelope identity');
  }
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(envelope.issuedAt) || !Number.isSafeInteger(envelope.expiresAt)) {
    throw new Error('invalid team envelope lifetime');
  }
  if (envelope.expiresAt <= envelope.issuedAt
    || envelope.expiresAt - envelope.issuedAt > MAX_TEAM_MESSAGE_TTL_MS) {
    throw new Error('invalid team envelope lifetime');
  }
  if (envelope.expiresAt < now) throw new Error('team message expired');
  if (envelope.issuedAt > now + MAX_TEAM_CLOCK_SKEW_MS) throw new Error('team message is from the future');

  const maxCiphertextChars = Math.ceil(MAX_TEAM_MESSAGE_BYTES / 3) * 4 + 8;
  if (typeof envelope.ephemeralPublicKey !== 'string' || envelope.ephemeralPublicKey.length > 1024
    || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > maxCiphertextChars
    || typeof envelope.iv !== 'string' || envelope.iv.length > 32
    || typeof envelope.authTag !== 'string' || envelope.authTag.length > 32
    || typeof envelope.signature !== 'string' || envelope.signature.length > 128) {
    throw new Error('invalid team envelope size');
  }
  const strictBase64 = (value: string, expectedBytes?: number): Buffer => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
      throw new Error('invalid team envelope encoding');
    }
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value || (expectedBytes !== undefined && decoded.length !== expectedBytes)) {
      throw new Error('invalid team envelope encoding');
    }
    return decoded;
  };
  const iv = strictBase64(envelope.iv, 12);
  const authTag = strictBase64(envelope.authTag, 16);
  const signatureBytes = strictBase64(envelope.signature, 64);
  const ciphertextBytes = strictBase64(envelope.ciphertext);
  if (ciphertextBytes.length > MAX_TEAM_MESSAGE_BYTES) throw new Error('team message too large');

  const { signature, ...unsigned } = envelope;
  const senderSigningKey = createPublicKey(input.expectedPeer.signingPublicKey);
  if (senderSigningKey.asymmetricKeyType !== 'ed25519') throw new Error('sender signing key must be Ed25519');
  const authentic = verify(
    null,
    Buffer.from(headerOf(unsigned)),
    senderSigningKey,
    signatureBytes
  );
  if (!authentic) throw new Error('invalid team message signature');

  const aad = aadFor({
    id: envelope.messageId,
    officeId: envelope.officeId,
    senderId: envelope.senderId,
    recipientId: envelope.recipientId,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt
  });
  const recipientPrivateKey = createPrivateKey(input.recipientEncryptionPrivateKey);
  const ephemeralPublicKey = createPublicKey(envelope.ephemeralPublicKey);
  if (recipientPrivateKey.asymmetricKeyType !== 'x25519' || ephemeralPublicKey.asymmetricKeyType !== 'x25519') {
    throw new Error('team encryption keys must be X25519');
  }
  const shared = diffieHellman({
    privateKey: recipientPrivateKey,
    publicKey: ephemeralPublicKey
  });
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(shared, aad), iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertextBytes),
    decipher.final()
  ]);
  if (plaintext.length > MAX_TEAM_MESSAGE_BYTES) throw new Error('team message too large');

  const message = JSON.parse(plaintext.toString('utf8')) as TeamMessage;
  assertMessage(message);
  if (message.id !== envelope.messageId || message.officeId !== envelope.officeId
    || message.senderId !== envelope.senderId || message.recipientId !== envelope.recipientId
    || message.issuedAt !== envelope.issuedAt || message.expiresAt !== envelope.expiresAt) {
    throw new Error('team envelope does not match payload');
  }
  return message;
}

/**
 * Single acceptance path for every transport. Callers must provide a locally
 * pinned member record; transport supplied keys or permissions are never
 * authoritative. Replay IDs are consumed only after signature, decryption,
 * identity, and permission checks have passed.
 */
export function acceptTeamEnvelope(input: {
  envelope: TeamEnvelope;
  recipient: Pick<TeamIdentity, 'deviceId' | 'encryptionPrivateKey'>;
  officeId: string;
  expectedPeer: Pick<TeamMember, 'id' | 'signingPublicKey' | 'controlLevel'>;
  replayStore: TeamReplayStore;
  now?: number;
}): TeamMessage {
  const now = input.now ?? Date.now();
  const message = openTeamEnvelope({
    envelope: input.envelope,
    recipientId: input.recipient.deviceId,
    officeId: input.officeId,
    recipientEncryptionPrivateKey: input.recipient.encryptionPrivateKey,
    expectedPeer: input.expectedPeer,
    now
  });
  if (!isPeerActionAllowed(input.expectedPeer.controlLevel, message.action)) {
    throw new Error('team action is not allowed for this member');
  }
  if (!input.replayStore.consume(message.officeId, message.senderId, message.id, message.expiresAt, now)) {
    throw new Error('team message replay detected');
  }
  return message;
}
