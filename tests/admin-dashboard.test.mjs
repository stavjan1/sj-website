// Guards for the admin panel's one shared failure mode.
//
// Every card on that screen reads through a Google token that lives one hour.
// When the hour lapsed they all failed at once and the panel looked broken:
// three cards printed the literal word "NO_TOKEN", four sat on "טוען…" for as
// long as you cared to watch, and the button offered to fix it could not work —
// it reached Google's popup from a 3.5-second timer, which every browser blocks.
//
// The rules below are what "the dashboard just works" actually decomposes into.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'sale', 'app.js'), 'utf8');
const HTML = readFileSync(join(ROOT, 'sale', 'index.html'), 'utf8');

// One function's source, ending at its own closing brace rather than at an
// arbitrary character count — a fixed window runs into the NEXT function and
// then reports its catch block as this one's.
const body = (marker) => {
  const i = APP.indexOf(marker);
  assert.ok(i > -1, `${marker} not found`);
  const rest = APP.slice(i);
  const end = rest.search(/\r?\n\}\r?\n/);
  return end > -1 ? rest.slice(0, end) : rest;
};

test('the sign-in popup is opened from the click, never from a timer', () => {
  // This is the entire reason "התחבר מחדש" used to do nothing: the visible
  // Google prompt was reached from inside setTimeout(…, 3500), and a popup that
  // far from the gesture is blocked without a word to the user. Everything
  // between entering adminSignInNow and requestAccessToken must be synchronous.
  const fn = body('function adminSignInNow(');
  const upToRequest = fn.slice(0, fn.indexOf('requestAccessToken'));
  assert.ok(upToRequest.length > 0, 'adminSignInNow never requests a token');
  assert.ok(!/\bawait\b/.test(upToRequest), 'an await before the popup will get it blocked');
  assert.ok(!/setTimeout/.test(upToRequest), 'a timer before the popup will get it blocked');

  // And the silent path must NOT try to open one, because it only ever runs
  // from a timer.
  const ensure = body('function ensureGoogleToken(');
  assert.ok(!/connectGoogleDrive\(/.test(ensure),
    'the silent refresh still tries to open a window it cannot open');
});

test('a blocked or dismissed popup says so', () => {
  // Silence here is indistinguishable from a broken button, which is how this
  // went unnoticed. GIS reports both cases through error_callback.
  const fn = body('function adminSignInNow(');
  assert.ok(/error_callback/.test(fn), 'no error_callback: a blocked popup would be silent');
  assert.ok(/popup_failed_to_open/.test(fn), 'a blocked popup is not explained to the user');
});

test('sign-in asks only for identity, not for Drive', () => {
  // Getting back into the dashboard must not put a Drive consent screen in
  // front of the user, and Google may refuse a silent refresh of scopes that
  // were never granted.
  const scope = APP.match(/const ADMIN_SIGNIN_SCOPE = '([^']+)'/);
  assert.ok(scope, 'ADMIN_SIGNIN_SCOPE not found');
  assert.ok(!/drive/i.test(scope[1]), `sign-in asks for Drive scopes: ${scope[1]}`);
  assert.ok(/userinfo\.email/.test(scope[1]), 'sign-in does not ask for the email it verifies against');
});

test('eight cards asking at once produce one request, not eight', () => {
  // Opening the panel fires every card together. Without sharing, that was
  // eight silent-mint calls, eight One Tap prompts, and — on failure — eight
  // consecutive 3.5-second waits before anything appeared on screen.
  const ensure = body('function ensureGoogleToken(');
  assert.ok(/_tokenRefreshInFlight/.test(ensure), 'concurrent callers are not sharing one refresh');
  assert.ok(/_tokenRefusedUntil/.test(ensure), 'a refusal is not remembered, so every card re-waits');
});

test('no admin card prints a raw error code at the user', () => {
  // "שגיאה: NO_TOKEN" is what he actually saw. The word is an internal marker;
  // it must never reach the screen.
  for (const [label, marker] of [
    ['renderAdminStats', 'async function renderAdminStats('],
    ['adminRefreshUserList', 'async function adminRefreshUserList('],
    ['renderAdminTraffic', 'async function renderAdminTraffic('],
    ['renderAdminAi', 'async function renderAdminAi('],
  ]) {
    const fn = body(marker);
    const catchAt = fn.lastIndexOf('} catch');
    assert.ok(catchAt > -1, `${label} has no catch`);
    assert.ok(/adminErrorHtml/.test(fn.slice(catchAt)),
      `${label} renders its own failure instead of the shared one`);
  }
  // The pricing map reported through a text-only line, so it could not even
  // hold a button.
  assert.ok(/_pmapStatusHtml\(adminErrorHtml\(e\)\)/.test(APP),
    'the pricing map still reports failure as plain text');
});

test('a missing permission is quiet, and never red', () => {
  // It is a routine expired hour, not a fault. Eight red boxes for it is what
  // made a working system look broken.
  const fn = body('function adminErrorHtml(');
  const noToken = fn.slice(fn.indexOf("'NO_TOKEN'"), fn.indexOf('FORBIDDEN'));
  assert.ok(!/danger/.test(noToken), 'an expired hour is styled as an error');
  assert.ok(!/NO_TOKEN.*<\/p>/.test(noToken), 'the raw code is rendered');
});

test('the panel says nothing about tokens while it is working', () => {
  // No green tick, no expiry clock, no vocabulary about Google's hour. The
  // strip exists only to recover, so when there is nothing to recover from it
  // must render empty and hide its own card.
  const fn = body('function renderAdminAuthStatus(');
  assert.ok(/_tokenIsFresh\(\)\) \{ show\(''\); return; \}/.test(fn),
    'the auth strip shows something even when everything is fine');
  assert.ok(/card\.hidden = !html/.test(fn), 'the empty strip still occupies the page');
  assert.ok(/hidden/.test(HTML.slice(HTML.indexOf('id="admin-auth-card"') - 80,
                                     HTML.indexOf('id="admin-auth-card"') + 40)),
    'the auth card is visible before JS has decided anything');
});

test('opening the panel is treated as the gesture it is', () => {
  // Clicking through to Admin is a real user gesture, so it is the one moment
  // a popup is permitted. Recovering there means the expired hour is invisible:
  // click the tab, pick the account, the cards fill in.
  assert.ok(/renderAdminAll\(\{ fromGesture: true \}\)/.test(APP),
    'the admin tab does not use its own click to recover');
  const fn = body('function renderAdminAll(');
  assert.ok(/fromGesture[\s\S]{0,200}adminSignInNow/.test(fn),
    'renderAdminAll ignores the gesture it was handed');
});

test('one token arriving refreshes every card', () => {
  // The old recovery refreshed two cards, and one of the two was a function
  // that does not exist anywhere in the file.
  const fn = body('function renderAdminAll(');
  for (const card of ['renderAdminTraffic', 'renderAdminStats', 'adminLoadPricingMap',
                      'adminRefreshUserList', 'renderAdminFunnel']) {
    assert.ok(fn.includes(card), `renderAdminAll leaves ${card} stale`);
  }
  assert.ok(!/renderAdminUsers\b/.test(APP), 'still calling a function that does not exist');
});
