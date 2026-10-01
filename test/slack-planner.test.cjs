'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const loadTs = require('./load-ts.cjs');

const {
  buildPlannerProtocol,
  parseSlackUserName,
  fetchSlackUserName,
  createSlackUserNameResolver,
  SLACK_NAME_MISS_TTL_MS
} = loadTs('src/main/slackPlanner.ts');
const { SlackWebhookServer } = loadTs('src/main/slack.ts');

const REPLY = '"/opt/node" "/res/md-slack-reply.cjs" --channel C1 --thread 1700.0001';
const BOARD = '/home/u/.office-x/hive/prompt-board.md';

const base = { channel: 'C1', threadTs: '1700.0001', replyCommand: REPLY, boardPath: BOARD };

test('planner protocol names the sender and mentions them in the reply', () => {
  const p = buildPlannerProtocol({ ...base, senderId: 'U0AHMED', senderName: 'Ahmed' });
  assert.match(p, /This message is from Ahmed \(Slack <@U0AHMED>\)/);
  assert.match(p, /start the reply with <@U0AHMED>/);
  assert.match(p, /ONLY for the person who asked/);
  assert.ok(p.endsWith('The message starts now: '), 'preamble ends with the hand-off line');
});

test('planner protocol carries the exact reply command and the board path', () => {
  const p = buildPlannerProtocol({ ...base, senderId: 'U0AHMED' });
  assert.ok(p.includes(`run exactly: ${REPLY} --text "<reply>"`), 'verbatim reply command');
  assert.ok(p.includes(BOARD), 'board path');
  assert.ok(p.includes('git log --since=30.days --name-only --format= | sort | uniq -c | sort -rn | head -15'), 'hot-files command');
  // Without a resolved name, the mention stands in for it.
  assert.match(p, /This message is from <@U0AHMED> \(Slack <@U0AHMED>\)/);
});

test('planner protocol forbids implementing anything', () => {
  const p = buildPlannerProtocol({ ...base, senderId: 'U1' });
  assert.match(p, /DO NOT IMPLEMENT/);
  assert.match(p, /no code edits, no git commands that change state, no spawning/);
  assert.match(p, /only output is a Slack reply/);
});

test('planner protocol with no sender id asks who it is for first', () => {
  const p = buildPlannerProtocol({ ...base });
  assert.match(p, /sender of this message is UNKNOWN/);
  assert.match(p, /asking who it is for/);
  assert.doesNotMatch(p, /<@/, 'no mention without an id');
});

test('users.info name: display_name, then real_name, then name', () => {
  const user = (profile, extra = {}) => ({ ok: true, user: { name: 'ahmed.h', real_name: 'Ahmed Hossain', profile, ...extra } });
  assert.equal(parseSlackUserName(user({ display_name: 'Ahnaf', real_name: 'Ahmed Hossain' })), 'Ahnaf');
  assert.equal(parseSlackUserName(user({ display_name: '', real_name: 'Ahmed Hossain' })), 'Ahmed Hossain');
  assert.equal(parseSlackUserName({ ok: true, user: { name: 'ahmed.h', profile: { display_name: '  ' } } }), 'ahmed.h');
  assert.equal(parseSlackUserName({ ok: true, user: { profile: {} } }), undefined);
  assert.equal(parseSlackUserName({ ok: false, error: 'missing_scope' }), undefined);
  assert.equal(parseSlackUserName(null), undefined);
  // Flattened to one line — it is pasted into a prompt.
  assert.equal(parseSlackUserName(user({ display_name: 'Ah\nmed' })), 'Ah med');
});

test('fetchSlackUserName sends the bot token and parses the reply', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, auth: init.headers.authorization };
    return { json: async () => ({ ok: true, user: { name: 'n', profile: { display_name: 'Ahnaf' } } }) };
  };
  assert.equal(await fetchSlackUserName('U0AHMED', 'xoxb-1', fetchImpl), 'Ahnaf');
  assert.equal(seen.url, 'https://slack.com/api/users.info?user=U0AHMED');
  assert.equal(seen.auth, 'Bearer xoxb-1');
});

test('fetchSlackUserName resolves undefined on errors, ok:false, no token, and timeout', async () => {
  const reject = async () => { throw new Error('network down'); };
  const notOk = async () => ({ json: async () => ({ ok: false, error: 'missing_scope' }) });
  const badJson = async () => ({ json: async () => { throw new SyntaxError('bad'); } });
  const hang = (_url, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  assert.equal(await fetchSlackUserName('U1', 'xoxb-1', reject), undefined);
  assert.equal(await fetchSlackUserName('U1', 'xoxb-1', notOk), undefined);
  assert.equal(await fetchSlackUserName('U1', 'xoxb-1', badJson), undefined);
  assert.equal(await fetchSlackUserName('U1', undefined, notOk), undefined);
  assert.equal(await fetchSlackUserName('U1', 'xoxb-1', hang, 20), undefined);
});

test('name resolver caches successes and briefly remembers misses', async () => {
  let calls = 0;
  let answer;
  let clock = 0;
  const resolve = createSlackUserNameResolver(async () => { calls++; return answer; }, () => clock);
  assert.equal(await resolve('U1', 't'), undefined);
  answer = 'Ahnaf';
  assert.equal(await resolve('U1', 't'), undefined, 'a failure is remembered briefly (no 3s wait per message)');
  assert.equal(calls, 1);
  clock = SLACK_NAME_MISS_TTL_MS;
  assert.equal(await resolve('U1', 't'), 'Ahnaf', 'then retried, so a newly granted scope takes effect');
  answer = 'changed';
  assert.equal(await resolve('U1', 't'), 'Ahnaf', 'a success is cached');
  assert.equal(calls, 2);
  assert.equal(await resolve(undefined, 't'), undefined);
  assert.equal(calls, 2, 'no lookup without an id');
});

// ─── slack.ts: the sender's user id reaches onMessage ─────────────────────────

const SECRET = 'test-signing-secret';

/** Feed one signed event_callback through the server's real verify + dispatch. */
function deliver(event) {
  const got = [];
  const server = new SlackWebhookServer({ port: 0, signingSecret: SECRET, onMessage: (m) => { got.push(m); } });
  const body = JSON.stringify({ type: 'event_callback', authorizations: [{ user_id: 'UBOT' }], event });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v0=' + createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex');
  const req = { headers: { 'x-slack-signature': sig, 'x-slack-request-timestamp': ts } };
  let status = 0;
  const res = { writeHead: (s) => { status = s; }, end: () => {} };
  server.handleBody(req, res, body);
  assert.equal(status, 200);
  return got;
}

test('slack server forwards a well-formed sender id as `user`', () => {
  const got = deliver({ type: 'app_mention', channel: 'C1', ts: '1.1', user: 'U0AHMED', text: '<@UBOT> plan the login page' });
  assert.equal(got.length, 1);
  assert.equal(got[0].user, 'U0AHMED');
  assert.equal(got[0].text, 'plan the login page');
});

test('slack server drops a missing or malformed sender id', () => {
  const none = deliver({ type: 'app_mention', channel: 'C1', ts: '2.1', text: '<@UBOT> hi' });
  assert.equal(none.length, 1);
  assert.equal('user' in none[0], false);
  const bad = deliver({ type: 'app_mention', channel: 'C1', ts: '3.1', user: 'u0ahmed; rm -rf', text: '<@UBOT> hi' });
  assert.equal(bad.length, 1);
  assert.equal('user' in bad[0], false);
});
