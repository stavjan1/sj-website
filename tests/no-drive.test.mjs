// Google Drive is out of this product, and the two things that look like Drive
// and are not must survive that.
//
// Stav, 29/08: "לא צריך את הדרייב, תמחק." Everything that talked to Drive is
// gone — the connect flow, the folder resolver, the scanner, the folder picker
// in settings, the sync cluster, and the sentence in the assistant's prompt
// that told customers their data was "backed up in the cloud with a Drive
// connection", which had not been true for two months.
//
// What did NOT go is the part this whole sweep nearly got wrong. Two storage
// keys are named for Drive and are actually the Google sign-in:
//   sj_drive_access_token — the identity token, and the password the server
//     checks; read from sale/finance.js and ask/index.html as well as here.
//   sj_drive_token_exp    — its expiry, which is how a stale session is caught.
// They cannot be renamed, because the value is already sitting in real users'
// browsers and a new name signs every one of them out. So they keep a
// misleading name forever, and this test is what stops the next person acting
// on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { APP_FILES, readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => (existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '');
const APP = readApp();
const HTML = read('sale/index.html');

test('nothing in the app talks to Drive any more', () => {
    // Named functions, so a partial revert is caught rather than a stray word.
    const GONE = [
        'connectGoogleDrive', 'resolveSjDriveFolders', 'findOrCreateFolder',
        'autoDetectQuoteNumber', 'loadDriveFoldersList', 'handleDriveFolderChange',
        'updateDriveStatus', 'clearDriveSession', 'syncDatabaseFromDrive',
        'syncDatabaseToDrive', 'smartSyncFromDrive', 'uploadPDFToDrive',
        'openDrivePicker', 'recoverDriveBackup',
    ];
    const back = GONE.filter((n) => new RegExp('function\\s+' + n + '\\s*\\(').test(APP));
    assert.deepEqual(back, [], 'these Drive functions are back');

    // And no request may be made to the Drive API from anywhere in the app.
    const calls = [];
    for (const rel of APP_FILES) {
        const src = read(rel);
        src.split('\n').forEach((l, n) => {
            if (l.trim().startsWith('//') || l.trim().startsWith('*')) return;
            if (/googleapis\.com\/(?:drive|upload\/drive)/.test(l)) calls.push(`${rel}:${n + 1}`);
        });
    }
    assert.deepEqual(calls, [], 'something is calling the Drive API again');

    // The scopes the app asks Google for must stay identity-only. Calendar is a
    // separate, deliberate consent for the reminder feature and is allowed.
    const scopes = [...APP.matchAll(/scope:\s*'([^']+)'/g)].map((m) => m[1]);
    const drive = scopes.filter((s) => s.includes('/auth/drive'));
    assert.deepEqual(drive, [], 'the app is asking for Drive permission again');
});

test('the assistant does not promise a feature that is gone', () => {
    // This prompt is what the in-app helper says to a paying electrician. It
    // described a Drive connection in Settings, and a "save to Drive" button on
    // the quote editor, for two months after both were removed.
    const prompt = read('functions/api/assistant.js');
    assert.ok(prompt, 'the assistant prompt moved — this check needs repointing');
    assert.ok(!/[Dd]rive|דרייב/.test(prompt),
        'the assistant is telling customers about Google Drive again');
});

test('the two keys that only sound like Drive are untouched', () => {
    // If these ever go, every signed-in user is signed out and the server stops
    // recognising them. The names are wrong on purpose; see the comment above
    // _tokenExpKey in sale/app.js.
    assert.match(APP, /getStorageKey\('sj_drive_access_token'\)/,
        'the Google identity token key is gone — every signed-in user is logged out');
    assert.match(APP, /getStorageKey\('sj_drive_token_exp'\)/,
        'the identity token expiry key is gone — stale sessions stop being detected');
    // The two files a Drive cleanup would never think to open.
    assert.match(read('sale/finance.js') + read('ask/index.html'), /sj_drive_access_token/,
        'the readers outside /sale/app.js no longer find the token they authenticate with');
    // And the comment that explains why, so the next sweep reads it first.
    assert.match(APP, /and are not about Drive/,
        'the note explaining why these keys keep a misleading name is gone');
});

test('the field the sign-in reads is not confused with the one that went', () => {
    // settings-drive-client-id was deleted with the Drive settings UI.
    // lock-google-client-id is read WITHOUT a guard on the sign-in path.
    // They are two hidden inputs with nearly the same name and opposite fates.
    assert.ok(!/id="settings-drive-client-id"/.test(HTML), 'the dead client-id field is back');
    assert.match(HTML, /id="lock-google-client-id"/, 'the live client-id field was taken instead');
    assert.ok(!/getElementById\('settings-drive-client-id'\)/.test(APP),
        'something still writes to the deleted field');
});
