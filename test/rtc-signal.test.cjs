'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { parseTeamAction, MAX_RTC_SDP, MAX_RTC_CANDIDATE } = loadTs('src/main/teamActions.ts');
const { dispatchTeamAction } = loadTs('src/main/teamDispatch.ts');
const { isPeerActionAllowed, createTeamIdentity, sealTeamMessage, MAX_TEAM_MESSAGE_BYTES } = loadTs('src/shared/teamProtocol.ts');

const member = { memberId: 'device-friend', displayName: 'Friend', controlLevel: 'task-requests' };
const rtcMessage = (body) => ({ id: 'm1', officeId: 'o', senderId: 'device-friend', recipientId: 'me', action: 'rtc-signal', body, issuedAt: 1, expiresAt: 2 });
const parse = (body) => parseTeamAction({ message: rtcMessage(body), member, targets: [], hasTerminal: () => false });
const empty = { callId: 'call_1-a', sdp: '', candidate: '', sdpMid: '', sdpMLineIndex: -1 };
const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const CANDIDATE = 'candidate:1 1 udp 2122260223 192.168.1.2 54321 typ host';

test('rtc-signal is allowed at every access level', () => {
  for (const level of ['task-requests', 'delegated', 'full-control']) assert.equal(isPeerActionAllowed(level, 'rtc-signal'), true);
});

test('offer, answer, candidate and hangup parse to the fixed shape', () => {
  assert.deepEqual(parse({ ...empty, kind: 'offer', sdp: SDP }), { type: 'rtc-signal', ...empty, kind: 'offer', sdp: SDP });
  assert.deepEqual(parse({ ...empty, kind: 'answer', sdp: SDP }), { type: 'rtc-signal', ...empty, kind: 'answer', sdp: SDP });
  assert.deepEqual(parse({ ...empty, kind: 'candidate', candidate: CANDIDATE, sdpMid: '0', sdpMLineIndex: 0 }),
    { type: 'rtc-signal', ...empty, kind: 'candidate', candidate: CANDIDATE, sdpMid: '0', sdpMLineIndex: 0 });
  assert.deepEqual(parse({ ...empty, kind: 'hangup' }), { type: 'rtc-signal', ...empty, kind: 'hangup' });
});

test('rtc-signal rejects extra keys, oversize payloads, bad ids, bad kinds and mixed fields', () => {
  assert.throws(() => parse({ ...empty, kind: 'hangup', extra: 1 }));
  const { sdpMid: _omit, ...missing } = empty;
  assert.throws(() => parse({ ...missing, kind: 'hangup' }));
  assert.throws(() => parse({ ...empty, kind: 'offer', sdp: `v=0${'x'.repeat(MAX_RTC_SDP)}` }));
  assert.throws(() => parse({ ...empty, kind: 'candidate', candidate: `candidate:${'x'.repeat(MAX_RTC_CANDIDATE)}` }));
  assert.throws(() => parse({ ...empty, callId: 'bad id!', kind: 'hangup' }));
  assert.throws(() => parse({ ...empty, callId: 'x'.repeat(65), kind: 'hangup' }));
  assert.throws(() => parse({ ...empty, callId: '', kind: 'hangup' }));
  assert.throws(() => parse({ ...empty, kind: 'renegotiate' }));
  assert.throws(() => parse({ ...empty, kind: 'offer', sdp: SDP, candidate: CANDIDATE }), 'candidate on an offer');
  assert.throws(() => parse({ ...empty, kind: 'offer', sdp: '' }), 'offer without sdp');
  assert.throws(() => parse({ ...empty, kind: 'hangup', sdp: SDP }), 'sdp on a hangup');
  assert.throws(() => parse({ ...empty, kind: 'candidate', candidate: CANDIDATE, sdp: SDP }));
  assert.throws(() => parse({ ...empty, kind: 'candidate', candidate: CANDIDATE, sdpMLineIndex: 65 }));
  assert.throws(() => parse({ ...empty, kind: 'candidate', candidate: CANDIDATE, sdpMLineIndex: 0.5 }));
  assert.throws(() => parse({ ...empty, kind: 'candidate', candidate: CANDIDATE, sdpMid: 'x'.repeat(65) }));
});

test('rtc-signal reaches the receive callback and nothing else', () => {
  const received = [];
  const outcome = dispatchTeamAction({
    message: rtcMessage({ ...empty, kind: 'hangup' }), member, triggerMode: 'allow-all', targets: [], hasTerminal: () => false,
    dispatchTaskRequest: () => assert.fail('no task'), steerAgent: () => assert.fail('no steer'),
    writeTerminal: () => assert.fail('no terminal'), receiveTerminalStream: () => assert.fail('no stream'),
    receiveChat: () => assert.fail('no chat'), receiveRtcSignal: (signal) => received.push(signal)
  });
  assert.equal(outcome.type, 'rtc-signal');
  assert.deepEqual(received, [{ ...empty, kind: 'hangup' }]);
});

test('a max-size offer still fits the sealed envelope limit', () => {
  const a = createTeamIdentity('device-a');
  const b = createTeamIdentity('device-b');
  const sdp = `v=0${'\r\n'.repeat((MAX_RTC_SDP - 3) / 2)}`.padEnd(MAX_RTC_SDP, 'a');
  assert.equal(sdp.length, MAX_RTC_SDP);
  const body = { ...empty, callId: 'c'.repeat(64), kind: 'offer', sdp };
  assert.ok(parse(body));
  const envelope = sealTeamMessage({
    message: { id: 'x', officeId: 'o', senderId: a.deviceId, recipientId: b.deviceId, action: 'rtc-signal', body, issuedAt: 1, expiresAt: 2 },
    sender: a, recipientEncryptionPublicKey: b.encryptionPublicKey
  });
  assert.ok(Buffer.byteLength(JSON.stringify(envelope)) < MAX_TEAM_MESSAGE_BYTES);
});
