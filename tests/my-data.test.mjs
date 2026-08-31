// "Get a copy of my data" and "delete my data" — the two things zerem/terms.html
// promises, and which were kept until now by emailing one person who then edited
// a Cloudflare dashboard by hand.
//
// The erasure is the only irreversible action in the product, so the tests here
// are less about whether it works and more about the two ways it can look like
// it worked when it did not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const APP = readApp();
const HTML = read('sale/index.html');
const DATA = read('functions/api/data.js');
const ADMIN_USERS = read('functions/api/admin-users.js');

test('the pending save is cancelled before anything is deleted', () => {
    // THE failure mode. A cloud save is debounced by 1500ms, so a save armed by
    // the last thing the user touched is still in flight when they press delete.
    // Delete the cloud with that timer live and the browser — which still holds
    // a full copy — uploads the whole record back. The user is shown a success
    // toast and nothing has been erased.
    const fn = APP.slice(APP.indexOf('async function _reallyEraseMyData'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    const cancel = body.indexOf('clearTimeout(_cloudSaveTimer)');
    const call = body.indexOf("method: 'DELETE'");
    const local = body.indexOf('localStorage.removeItem');
    assert.ok(cancel > -1, 'the pending cloud save is no longer cancelled');
    assert.ok(cancel < call, 'the cloud is deleted while a save is still armed to re-upload it');
    assert.ok(call < local, 'local storage is cleared before the cloud call — a failure there leaves a half-erasure');
});

test('a failed cloud delete leaves the device alone', () => {
    // Half-erased is worse than not erased: the cloud still has everything and
    // the person believes it is gone.
    const fn = APP.slice(APP.indexOf('async function _reallyEraseMyData'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    const fail = body.indexOf('המחיקה מהענן נכשלה');
    const local = body.indexOf('localStorage.removeItem');
    assert.ok(fail > -1 && fail < local, 'the cloud failure path no longer stops before touching the device');
    assert.equal((body.match(/return;/g) || []).length >= 2, true,
        'the failure branches must return, not fall through into deleting the local copy');
});

test('erasing takes the local backups too', () => {
    // backupLocalSnapshot writes restorable snapshots into sj_local_backups. A
    // "delete everything" that leaves one behind has not deleted everything —
    // and the recovery panel would happily offer it back.
    const fn = APP.slice(APP.indexOf('async function _reallyEraseMyData'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /startsWith\('sj_user_' \+ user \+ '_'\)/,
        'the sweep no longer matches this user\'s namespaced keys, which is where the backups live');
    // Verified in a browser: two keys for a@b.com removed including the backups,
    // a second account's keys on the same browser untouched, unrelated keys untouched.
    assert.ok(!/localStorage\.clear\(\)/.test(body),
        'localStorage.clear() would take a second signed-in account on the same browser with it');
});

test('deleting needs a deliberate act, not a tap', () => {
    const fn = APP.slice(APP.indexOf('async function eraseMyData'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /danger: true/, 'the first confirmation is no longer marked destructive');
    // The second gate: the only place in this product that asks you to type a
    // word, because it is the only action with no undo.
    assert.match(body, /openNamePrompt\(/, 'the type-to-confirm step is gone');
    assert.match(body, /!== 'מחק'/, 'anything typed now passes as confirmation');
});

test('the server erases only the caller, and the admin route only a named address', () => {
    // The user's own DELETE derives the key from the VERIFIED email, so there is
    // no parameter that could point it at somebody else.
    assert.match(DATA, /if \(method === 'DELETE'\)[\s\S]{0,200}SJ_DATA\.delete\(key\)/,
        'the erasure branch no longer deletes the key derived from the verified email');
    assert.ok(!/DELETE[\s\S]{0,400}searchParams/.test(DATA),
        'the user-facing erasure started reading a target from the query string');

    // The admin route CAN name someone else, which is why it is fenced.
    assert.match(ADMIN_USERS, /export async function onRequestDelete/, 'the admin erasure route is gone');
    const fn = ADMIN_USERS.slice(ADMIN_USERS.indexOf('export async function onRequestDelete'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.match(body, /adminGate/, 'the admin erasure route is not gated');
    assert.match(body, /@[^\s@]/, 'the target is no longer required to be a whole email address');
    assert.match(body, /ADMIN_EMAIL/, 'the admin can now delete their own account through this route');
});

test('both promises have a button', () => {
    assert.match(HTML, /id="mydata-card"/, 'the data card is gone from settings');
    assert.match(HTML, /onclick="exportMyData\(\)"/, 'there is no way to get a copy of your data');
    assert.match(HTML, /onclick="eraseMyData\(\)"/, 'there is no way to delete your data');
    // And the terms must keep saying it, or the buttons are the only record.
    assert.match(read('zerem/terms.html'), /לבקשת עיון או מחיקה/,
        'the terms no longer mention the access and erasure rights these buttons implement');
});
