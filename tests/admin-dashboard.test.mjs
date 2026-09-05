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
import { readApp } from './_app-source.mjs';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readApp();
const HTML = readFileSync(join(ROOT, 'site', 'sale', 'index.html'), 'utf8');

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

test('the AI card leads with who is answering customers, in words', () => {
  // The state that went unnoticed for days: X-AI-Provider had said `cloudflare`
  // on every single call while this card showed green bars and full quotas.
  // Percentages cannot say "your bot is on the spare engine"; a sentence can.
  const src = APP.slice(APP.indexOf('function aiVerdictHtml('),
                        APP.indexOf('function aiPressureHtml('));
  const ctx = createContext({ Date, escapeHtml: (s) => String(s) });
  runInContext(src + ';globalThis.v = aiVerdictHtml;', ctx);
  const v = ctx.v;
  const today = new Date().toISOString().slice(0, 10);

  assert.match(v({ events: [] }), /המנוע החזק/, 'a clean day does not say so');

  // A fallback that is still in force is the loud case.
  const down = v({ events: [{ date: today, outcome: 'fail', status: 404, note: 'עובר לספק cloudflare' }] });
  assert.match(down, /מהמנוע החלופי/, 'a live fallback is not announced');
  assert.match(down, /שם המודל/, 'a 404 is not explained as a model-name problem');
  assert.match(down, /var\(--danger\)/, 'a live fallback is not styled as the problem it is');

  // Quota reads differently from a broken model: one waits, the other needs a
  // change. And the two QUOTAS read differently from each other — a per-minute
  // limit clears in seconds, a daily one is over until midnight — so the card
  // must not call both "the daily quota", which is what it used to do.
  const quota = v({ events: [{ date: today, outcome: 'quota', scope: 'day', note: 'עובר לספק cloudflare' }] });
  assert.match(quota, /המכסה היומית/, 'exhausted daily quota is not named');
  assert.ok(!/שם המודל/.test(quota), 'quota is being reported as a model problem');

  const minute = v({ events: [{ date: today, outcome: 'quota', scope: 'minute', note: 'עובר לספק cloudflare' }] });
  assert.match(minute, /לדקה/, 'a per-minute limit is reported as a spent daily quota');
  assert.ok(!/המכסה היומית של/.test(minute), 'a per-minute limit still claims the day is over');

  // Yesterday's trouble is not today's headline.
  assert.match(v({ events: [{ date: '2020-01-01', outcome: 'fail', status: 500 }] }), /המנוע החזק/,
    'an old failure is reported as the current state');
});

test('nothing re-exports a global function as a wrapper around itself', () => {
  // `window.adminAuthHtml = (msg) => adminAuthHtml(msg);` looks like exposing a
  // function and is the opposite: this file is a classic script, so the
  // declaration is already on window, and the assignment replaces it with a
  // body that calls itself. adminAuthHtml() was a stack overflow — thrown
  // inside the catch block of every card that handled an expired hour, so the
  // card never wrote anything and kept its "טוען…" forever.
  //
  // Found by running the deployed page. Reading the source had not caught it in
  // however long the line had been there.
  for (const src of [APP, readFileSync(join(ROOT, 'site', 'sale', 'finance.js'), 'utf8')]) {
    // Code only: the comment above quotes the broken line deliberately, and a
    // test that fails on its own explanation is a test nobody keeps.
    const code = src.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('//')).join('\n');
    const bad = code.match(/window\.([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*\1\s*\(/g) || [];
    assert.deepEqual(bad, [], `self-referential re-export: ${bad.join(', ')}`);
  }
});

test('exactly one button offers to reconnect', () => {
  // The funnel card built its own. Two buttons doing the same job is confusing
  // on its own, and the funnel's would have refreshed the funnel alone —
  // leaving the other six cards as empty as they were before the click.
  const FIN = readFileSync(join(ROOT, 'site', 'sale', 'finance.js'), 'utf8');
  assert.ok(!/adminAuthHtml\(/.test(FIN), 'the funnel still renders its own sign-in panel');
  assert.ok(/window\.adminErrorHtml/.test(FIN), 'the funnel does not use the shared failure');

  // In app.js the button lives inside adminAuthHtml, and adminAuthHtml is
  // reached from exactly one place: the strip at the top of the panel. Two in
  // the code — its own declaration, and the strip's two calls collapse to the
  // same site — so anything beyond that is a card growing a button again.
  const code = APP.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const sites = (code.match(/adminAuthHtml\(/g) || []).length;
  assert.ok(sites <= 3, `adminAuthHtml appears at ${sites} sites; a card is rendering its own button`);
});

test('every admin card sits inside exactly one screen', () => {
  // Rewritten for the seven-screen layout (5/9/2026): the grouping moved from
  // a data-admin-tab on every card to one wrapper per screen, so a card picks
  // its home by where it sits. A card outside every wrapper would be visible
  // under every tab at once — or under none. tests/admin-screens.test.mjs pins
  // the seven screens themselves; this only guards the containment.
  const panel = HTML.slice(HTML.indexOf('ניהול מערכת · Admin'));
  const body = panel.slice(0, panel.indexOf('</section>'));
  const firstScreen = body.indexOf('data-admin-tab=');
  assert.ok(firstScreen > -1, 'the screen wrappers are gone');
  const before = body.slice(0, firstScreen);
  const loose = (before.match(/class="section-card"[^>]*/g) || []).filter((c) => !/admin-auth-card/.test(c));
  assert.deepEqual(loose, [], `card above the screens would show on every tab: ${loose.join(' | ')}`);

  // And every tab in the bar has a screen behind it.
  const tabs = [...body.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]);
  const homes = new Set([...body.matchAll(/data-admin-tab="(\w+)"/g)].map((m) => m[1]));
  assert.ok(tabs.length >= 4, 'the tab bar is missing');
  for (const t of tabs) assert.ok(homes.has(t), `tab "${t}" opens onto nothing`);
});

test('the recovery strip is never behind a tab', () => {
  // It answers "can this screen read anything", which is true whichever
  // question is being asked. The day's headline numbers used to sit beside it;
  // they are the overview screen now (the first tab, and the default).
  const panel = HTML.slice(HTML.indexOf('ניהול מערכת · Admin'));
  const body = panel.slice(0, panel.indexOf('</section>'));
  const auth = body.indexOf('id="admin-auth-card"');
  const firstScreen = body.indexOf('data-admin-tab=');
  assert.ok(auth > -1 && auth < firstScreen, 'the reconnect strip can be hidden by a tab');
});

test('a re-render keeps the tab you were on', () => {
  // Every card refresh calls renderAdminAll, which rebuilds card contents. If
  // the tab were not re-applied, one refresh would dump all thirteen cards back
  // onto the page at once.
  const fn = body('function renderAdminAll(');
  assert.match(fn, /setAdminTab\(_adminTab\)/, 'a refresh forgets which tab was open');
});
