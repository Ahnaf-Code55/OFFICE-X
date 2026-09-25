'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath() { throw new Error('test supplies dbPath'); } } };
  return originalLoad.call(this, request, parent, isMain);
};
const loadTs = require('./load-ts.cjs');
const { PersistStore } = loadTs('src/main/db.ts');
Module._load = originalLoad;

test('replay store prunes expired IDs and inserts atomically through SQLite', () => {
  const store = new PersistStore('unused-in-unit-test');
  const rows = new Map();
  const sql = [];
  store.db = {
    prepare(query) {
      sql.push(query);
      if (query.startsWith('DELETE')) {
        return { run(now) { for (const [key, expires] of rows) if (expires < now) rows.delete(key); } };
      }
      return { run(officeId, senderId, messageId, expiresAt) {
        const key = `${officeId}/${senderId}/${messageId}`;
        if (rows.has(key)) return { changes: 0 };
        rows.set(key, expiresAt);
        return { changes: 1 };
      } };
    },
    transaction(fn) { return () => fn(); }
  };

  assert.equal(store.consumeTeamMessageReplay('office-1', 'alice', 'msg-1', 5_000, 1_000), true);
  assert.equal(store.consumeTeamMessageReplay('office-1', 'alice', 'msg-1', 5_000, 2_000), false);
  assert.equal(store.consumeTeamMessageReplay('office-2', 'alice', 'msg-1', 5_000, 2_000), true);
  assert.equal(store.consumeTeamMessageReplay('office-1', 'alice', 'msg-2', 5_000, 6_000), false);
  assert.equal(store.consumeTeamMessageReplay('office-1', 'alice', 'msg-1', 7_000, 6_000), true);
  assert.equal(sql.length, 8);
  assert.match(sql[1], /ON CONFLICT\(office_id, sender_id, message_id\) DO NOTHING/);
});
