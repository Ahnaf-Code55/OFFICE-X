'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { claudeLimits, codexLimits } = loadTs('src/shared/usageLimits.ts');

test('Claude status-line rate_limits parse into 5h and weekly windows', () => {
  const l = claudeLimits({ five_hour: { used_percentage: 37, resets_at: 100 }, seven_day: { used_percentage: 38, resets_at: 200 } });
  assert.deepEqual([l.fiveHour, l.weekly], [{ percent: 37, resetsAt: 100 }, { percent: 38, resetsAt: 200 }]);
  assert.equal(claudeLimits(undefined), undefined);
});

test('Codex rollout: the LAST rate_limits line wins, primary = 5h, secondary = weekly', () => {
  const row = (p) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: {
    primary: { used_percent: p, window_minutes: 300, resets_at: 1 }, secondary: { used_percent: 30, window_minutes: 10080, resets_at: 2 } } } });
  const l = codexLimits([row(5), '{"type":"other"}', row(12)].join('\n'));
  assert.equal(l.fiveHour.percent, 12);
  assert.equal(l.weekly.percent, 30);
  assert.equal(codexLimits('{"no":"limits"}'), undefined);
});
