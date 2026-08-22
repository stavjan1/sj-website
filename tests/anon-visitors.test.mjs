// Counting the people who never sign in — and the one property Stav required
// before agreeing to count them at all:
//
//   "איך תוודא שאם מישהו נכנס אז אחרי חודש פתאום זה לא יציג אותו כאנונימי 3
//    במקום המספר שהוא כבר היה?"
//
// A number taken from a position in a list cannot promise that: anyone new
// sorting earlier pushes everybody along. This number is not a position — it is
// the rank by FIRST SIGHTING, and first sighting is written once and never
// touched again. These tests are that promise, made checkable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { cleanAnonId, listAnonVisitors, noteAnonVisit } from '../functions/api/_anon.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A KV stand-in with the three methods the module uses.
function fakeKV(seed) {
  const store = new Map(Object.entries(seed || {}));
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async list({ prefix, limit }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit || 200);
      return { keys: keys.map((name) => ({ name })), list_complete: true };
    },
  };
}
const seeded = (rows) => fakeKV(Object.fromEntries(rows.map(
  ([id, firstSeen, msgs]) => ['anon:' + id, JSON.stringify({ firstSeen, lastSeen: firstSeen, msgs })])));

const ids = (list) => list.visitors.map((v) => `${v.n}:${v.id}`);

test('a visitor keeps his number when newer ones arrive', async () => {
  // THE question, asked directly. Three visitors, then a month later two more.
  const first = seeded([['aaaaaaaaaaaa', 1000, 4], ['bbbbbbbbbbbb', 2000, 1], ['cccccccccccc', 3000, 9]]);
  const before = await listAnonVisitors({ SJ_DATA: first });
  assert.deepEqual(ids(before), ['1:aaaaaaaaaaaa', '2:bbbbbbbbbbbb', '3:cccccccccccc']);

  const later = seeded([
    ['aaaaaaaaaaaa', 1000, 4], ['bbbbbbbbbbbb', 2000, 1], ['cccccccccccc', 3000, 9],
    ['dddddddddddd', 9000, 2], ['eeeeeeeeeeee', 9500, 1],
  ]);
  const after = await listAnonVisitors({ SJ_DATA: later });
  assert.deepEqual(ids(after).slice(0, 3), ['1:aaaaaaaaaaaa', '2:bbbbbbbbbbbb', '3:cccccccccccc'],
    'an existing visitor was renumbered by someone who arrived later');
  assert.equal(after.visitors[3].label, 'אנונימי 4');
});

test('the number does not depend on how KV happens to list the keys', async () => {
  // KV gives no ordering promise. If the rank came from listing order, the same
  // three people would be numbered differently on different refreshes.
  const forward = seeded([['aaaaaaaaaaaa', 3000, 1], ['bbbbbbbbbbbb', 1000, 1], ['cccccccccccc', 2000, 1]]);
  const shuffled = seeded([['cccccccccccc', 2000, 1], ['aaaaaaaaaaaa', 3000, 1], ['bbbbbbbbbbbb', 1000, 1]]);
  const a = await listAnonVisitors({ SJ_DATA: forward });
  const b = await listAnonVisitors({ SJ_DATA: shuffled });
  assert.deepEqual(ids(a), ids(b), 'the numbering moved when the listing order moved');
  assert.deepEqual(ids(a), ['1:bbbbbbbbbbbb', '2:cccccccccccc', '3:aaaaaaaaaaaa'],
    'the order is not by first sighting');
});

test('two visitors first seen in the same millisecond still get a stable order', async () => {
  // Without a tie-break the two could swap between refreshes — the same
  // instability in miniature.
  const one = seeded([['zzzzzzzzzzzz', 5000, 1], ['kkkkkkkkkkkk', 5000, 1]]);
  const two = seeded([['kkkkkkkkkkkk', 5000, 1], ['zzzzzzzzzzzz', 5000, 1]]);
  assert.deepEqual(ids(await listAnonVisitors({ SJ_DATA: one })),
                   ids(await listAnonVisitors({ SJ_DATA: two })));
});

test('coming back does not reset who you are', async () => {
  // firstSeen is written once. If a return visit refreshed it, a returning
  // visitor would sort to the end and be handed a brand new number — exactly
  // the failure this design exists to prevent.
  const env = { SJ_DATA: fakeKV() };
  await noteAnonVisit(env, 'aaaaaaaaaaaa');
  const after1 = JSON.parse(env.SJ_DATA.store.get('anon:aaaaaaaaaaaa'));
  await new Promise((r) => setTimeout(r, 5));
  await noteAnonVisit(env, 'aaaaaaaaaaaa');
  const after2 = JSON.parse(env.SJ_DATA.store.get('anon:aaaaaaaaaaaa'));

  assert.equal(after2.firstSeen, after1.firstSeen, 'a return visit rewrote firstSeen');
  assert.equal(after2.msgs, 2, 'the second question was not counted');
  assert.ok(after2.lastSeen >= after1.lastSeen);
});

test('the id is validated before it becomes a storage key', () => {
  // It arrives in a header from an unauthenticated caller. An unbounded string
  // here is an unbounded KV key, and a path-shaped one is worse.
  assert.equal(cleanAnonId('a1b2c3d4e5f6'), 'a1b2c3d4e5f6');
  for (const bad of ['', null, undefined, 'short', 'A1B2C3D4E5F6', 'a'.repeat(64),
                     '../../system:catalog', 'a1b2 c3d4e5f6', 'a1b2-c3d4-e5f6']) {
    assert.equal(cleanAnonId(bad), '', `accepted a bad id: ${JSON.stringify(bad)}`);
  }
});

test('nothing identifying is stored, and the policy says the id exists', () => {
  const src = readFileSync(join(ROOT, 'functions', 'api', '_anon.js'), 'utf8');
  for (const forbidden of ['CF-Connecting-IP', 'User-Agent', 'user-agent', 'referer']) {
    assert.ok(!src.includes(forbidden), `the visitor record reaches for ${forbidden}`);
  }
  // Stav agreed to this on the understanding it is declared, not hidden.
  const privacy = readFileSync(join(ROOT, 'privacy.html'), 'utf8');
  assert.match(privacy, /מזהה אורח אקראי/, 'the id is stored but never disclosed');
  assert.match(privacy, /אינו מכיל שם, אימייל, כתובת IP/, 'the policy does not say what it excludes');
});

test('a signed-in visitor is never counted as an anonymous one', () => {
  // Two identities for one person would double-count him and put a stranger's
  // number on a man who has a name.
  const ask = readFileSync(join(ROOT, 'ask', 'index.html'), 'utf8');
  assert.match(ask, /if \(authToken\) headers\['Authorization'\][\s\S]{0,260}else \{ const a = anonId\(\)/,
    'the guest id is sent alongside a real account');
  const chat = readFileSync(join(ROOT, 'functions', 'api', 'chat.js'), 'utf8');
  assert.match(chat, /if \(!email\) \{[\s\S]{0,200}noteAnonVisit/,
    'the server records a visit for signed-in users too');
});

test('counting a visitor can never fail his question', () => {
  // It is bookkeeping attached to somebody trying to price a job.
  const src = readFileSync(join(ROOT, 'functions', 'api', '_anon.js'), 'utf8');
  const fn = src.slice(src.indexOf('export async function noteAnonVisit'));
  assert.match(fn.slice(0, fn.indexOf('\n}')), /catch \{/, 'a KV failure would escape into the request');
  const chat = readFileSync(join(ROOT, 'functions', 'api', 'chat.js'), 'utf8');
  assert.match(chat, /waitUntil\(noteAnonVisit/, 'the write sits on the critical path of the answer');
});
