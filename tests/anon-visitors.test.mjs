// Counting the people who never sign in — and the one property Stav asked for
// before agreeing to count them at all:
//
//   "איך תוודא שאם מישהו נכנס אז אחרי חודש פתאום זה לא יציג אותו כאנונימי 3
//    במקום המספר שהוא כבר היה?"
//
// A number taken from a position in a list cannot promise that. This one is not
// a position — it is the rank by first sighting, and first sighting is written
// once and never touched. These tests are that promise, made checkable.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { cleanAnonId, listAnonVisitors, noteAnonVisit } from '../functions/api/_anon.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A KV stand-in with the two methods the module uses.
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
const seeded = (rows) => fakeKV(Object.fromEntries(
  rows.map(([id, firstSeen, msgs]) => ['anon:' + id, JSON.stringify({ firstSeen, lastSeen: firstSeen, msgs })])));

test('a visitor keeps his number when newer visitors arrive', () => {
  // THE question. Three visitors, then a month later two more — and the first
  // three must still be 1, 2 and 3.
  const env = { SJ_DATA: seeded([
    ['aaaaaaaaaaaa', 1000, 4], ['bbbbbbbbbbbb', 2000, 1], ['cccccccccccc', 3000, 9),
  ]) };
});
