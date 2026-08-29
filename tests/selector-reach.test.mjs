// A selector that matches nothing is the quietest bug this codebase has.
//
// It broke three visible things in one day, always the same way: an element is
// written as id="thing" with class="something-else", and the stylesheet reaches
// for `.thing`. The rule compiles, the file is valid, nothing throws — and the
// element renders with no styling at all. That produced the money board's four
// stat cards running into each other (class="pipe-summary" id="pipeline-summary"),
// my own mobile rule for the pipeline controls (class="pipe-controls"), and a
// dead circular-dial rule left over from before the quota meter became a bar.
//
// Reading the diff cannot catch it: the CSS is correct and the markup is
// correct, they simply never meet. So this test does what a person cannot —
// takes every id in the app shell, and fails if the stylesheet styles that name
// as a CLASS while no element anywhere actually carries it as one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'sale', 'index.html'), 'utf8');
const APP = readApp();
const MARKUP = HTML + '\n' + APP;

// Only the sheets /sale/ actually loads. The legacy V2 sheet that used to sit
// beside them, sale/styles.css, was 222KB that no page linked; it is deleted.
const SHEETS = ['sale/css/panels.css', 'sale/css/shell.css', 'sale/css/pdf.css',
                'sale/controlroom.css', 'sale/nextstep.css', 'sale/periodic.css',
                'assets/ui.css'];
const CSS = SHEETS.map((f) => {
    try { return readFileSync(join(ROOT, f), 'utf8'); } catch { return ''; }
}).join('\n');

// Every class that exists in markup, including the ones JS builds at runtime.
const liveClasses = (() => {
    const set = new Set();
    for (const m of MARKUP.matchAll(/class\s*=\s*["'`]([^"'`]*)["'`]/g))
        m[1].split(/\s+/).filter(Boolean).forEach((c) => set.add(c.replace(/\$\{[\s\S]*/, '')));
    for (const m of MARKUP.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*['"]([\w-]+)['"]/g)) set.add(m[1]);
    for (const m of MARKUP.matchAll(/className\s*=\s*['"`]([^'"`]*)['"`]/g))
        m[1].split(/\s+/).filter(Boolean).forEach((c) => set.add(c));
    return set;
})();

const liveIds = (() => {
    const set = new Set();
    for (const m of HTML.matchAll(/\bid\s*=\s*["']([\w-]+)["']/g)) set.add(m[1]);
    return set;
})();

test('the stylesheets and the markup agree on what is a class', () => {
    // An id that no element carries as a class, but that a loaded stylesheet
    // styles AS a class — with a word boundary, so `.thing-wrap` does not count
    // as styling `.thing`.
    const offenders = [];
    for (const id of liveIds) {
        if (liveClasses.has(id)) continue;                 // it is a class too: fine
        const asClass = new RegExp(`\\.${id.replace(/[-]/g, '\\-')}(?![\\w-])`);
        if (asClass.test(CSS)) offenders.push(id);
    }
    assert.deepEqual(offenders, [],
        'these ids are styled as classes in a loaded stylesheet, so those rules match nothing');
});

test('the money board keeps the styling it only just got', () => {
    // The specific one Stav photographed. Both names are covered now, and the
    // element carries the class — if either half moves, this fails.
    assert.match(HTML, /class="pipe-summary"\s+id="pipeline-summary"/,
        'the stats container still has both names');
    assert.match(CSS, /\.pipe-summary\s*\{[^}]*display:\s*grid/,
        'and the class is the one the grid rule targets');
});

test('the legacy sheet is still not loaded, so nobody styles against it', () => {
    // sale/styles.css is deleted, and this stays as the guard against it (or
    // anything like it) being linked back in: the moment a 222KB sheet nobody
    // reads becomes live, every rule in it starts competing with the real ones.
    assert.ok(!/href="[^"]*sale\/styles\.css/.test(HTML) && !/href="styles\.css/.test(HTML),
        'sale/index.html now loads the legacy sheet — the scan above must include it');
});

test('hidden means hidden, with no rule allowed to out-rank it', () => {
    // `hidden` is enforced by [hidden]{display:none} at the very bottom of the
    // cascade, so ANY single-class display rule beats it — and this codebase has
    // 169 of those. That is how the admin control room stayed on screen across
    // all four tabs while the code that hid it looked perfectly correct.
    assert.match(CSS, /\[hidden\]\s*\{\s*display:\s*none\s*!important/,
        'the global [hidden] guard is gone — 169 class rules can hide-proof an element again');
    // And nothing may go back to contradicting it. Comments are stripped first
    // (several of these rules carry a note explaining the trap, and the word
    // "display" inside a note is not a declaration), and the value is CAPTURED
    // rather than checked with a lookahead — `\s*(?!none)` lets the whitespace
    // backtrack to zero and then reads " none" as "not none", which is how the
    // first version of this test failed on sixteen perfectly correct rules.
    const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const overrides = [];
    for (const [, sel, body] of bare.matchAll(/([^{}]*\[hidden\][^{}]*)\{([^}]*)\}/g)) {
        for (const [, value] of body.matchAll(/display\s*:\s*([a-zA-Z-]+)/g)) {
            if (value !== 'none') overrides.push(sel.trim().replace(/\s+/g, ' ') + ' → ' + value);
        }
    }
    assert.deepEqual(overrides, [],
        'these rules make a hidden element visible again');
});

test('starting work is one screen, not two', () => {
    // בית and "שיחה חדשה" were two designs for one moment. The home screen won:
    // it greets, asks the product's question, and offers examples. An empty chat
    // offered a cursor.
    const i = APP.indexOf('function startNewConversation(');
    const body = APP.slice(i, APP.indexOf('\n}', i));
    assert.match(body, /switchTab\('home'\)/, 'a new conversation opens the home screen');
    assert.match(body, /home-input/, 'with the cursor in the box');
    // And the drawer must not list a destination that its own top button already is.
    assert.match(APP, /if \(b\.id === 'tab-home'\) return false;/,
        'בית is filtered out of the destinations, since "שיחה חדשה" is right above them');
});

test('the way in to the conversations survives every screen', () => {
    // Stav, 28/08: entered as a guest, had one conversation, and then "פתאום
    // לא רואים כלום". The thread was saved and the list rendered fine — the
    // BUTTON was gone. placeBackButton() moves the back arrow and the bell out
    // of .ctx-bar and into the screen's own heading, then hides the emptied
    // bar; the ☰ was the one control it never moved, so on every screen with a
    // title the only door to the conversations went display:none with its
    // parent. Below 1100px, where the list is a drawer rather than a column,
    // that left no way back to a conversation at all.
    const i = APP.indexOf('function placeBackButton(');
    const body = APP.slice(i, APP.indexOf('\n}', i));
    assert.match(body, /convo-open-btn/, 'placeBackButton must know about the ☰');
    // Both directions: into the heading, and back to the bar.
    assert.match(body, /h2\.insertBefore\(convo/, 'it travels into the title with the others');
    assert.match(body, /bar\.insertBefore\(convo/, 'and comes home when there is no title');
    // And emptiness is measured, not inferred — the old `is-empty` was set from
    // "the header is visible", which was a statement about two other buttons.
    assert.match(body, /Array\.from\(bar\.children\)\.some/,
        'is-empty must be decided by what is actually left in the bar');
    assert.doesNotMatch(body, /toggle\('is-empty', headerVisible\)/,
        'the old inference is back, and it cannot see a third control');
});

test('the customer chooser is ours on every surface', () => {
    // The last native <select> a user meets: it opened as a white OS list over
    // a dark app, with "+ לקוח חדש" sitting in it disguised as a customer.
    assert.doesNotMatch(HTML, /id="banner-client-select"/,
        'the project banner is back on a native dropdown');
    assert.match(HTML, /class="banner-client"[\s\S]{0,200}openClientPicker/,
        'the banner opens the product picker');
    // And detaching stayed possible when the dropdown went away.
    const market = readFileSync(join(ROOT, 'sale', 'market.js'), 'utf8');
    const i = market.indexOf('function openClientPicker(');
    const body = market.slice(i, market.indexOf('\n}', i));
    assert.match(body, /ללא לקוח/, 'the picker still offers "no customer"');
});

test('a closed drawer cannot swallow the app', () => {
    // .convo-drawer is position:fixed inset:0 — the entire viewport — and its
    // harmlessness rested on JS setting `hidden` whenever the width changed.
    // A missed resize therefore leaves an invisible scrim (opacity 0) over
    // everything, eating every click, with nothing on screen to explain it.
    // CSS now makes a drawer without .open inert below the column breakpoint,
    // so the flag being stale costs nothing.
    assert.match(CSS, /\.convo-drawer:not\(\.open\)\s*\{[^}]*pointer-events:\s*none/,
        'a closed drawer is clickable again');
    assert.match(CSS, /\.convo-drawer:not\(\.open\)\s\.convo-scrim\s*\{[^}]*display:\s*none/,
        'the scrim of a closed drawer is back over the app');
    // And the layout is re-decided on navigation, not only on a resize event —
    // the one signal that is always delivered.
    const i = APP.indexOf('function switchTab(');
    const body = APP.slice(i, APP.indexOf('\n}', i));
    assert.match(body, /syncConversationsLayout\(\)/,
        'switching screens no longer re-decides column vs drawer');
});

test('the phone row gives the name the whole row, open or closed', () => {
    // Measured at 375px before the fix: the closed row spent about a third of
    // itself on a status pill reading "טיוטה" — true of nearly every row, so it
    // told you nothing while the name you were scanning for was ellipsised. And
    // opening the row made it WORSE: the desktop rule
    // `#panel-projects .project-card .project-endcap { grid-column: 2 }` is an
    // ID selector, so it outranked the phone block's three-class rule no matter
    // how much later that block was declared, and the clock and bin came back
    // into row 1 and swelled the auto column to 145px. Title: 261px → 149px.
    // These two assertions are what keep the phone block winning.
    assert.match(CSS, /@media \(max-width: 768px\)[\s\S]*?#panel-projects \.project-card \.project-endcap \{ display: none; \}/,
        'the status pill is back on the closed phone row, taking the name\'s width');
    assert.match(CSS, /#panel-projects \.project-card\.is-open \.project-endcap \{[^}]*grid-row: 2/,
        'opening a row puts its controls back beside the name instead of under it');
});

test('nothing under the conversation may be squeezed to a sliver', () => {
    // .chat-container is a flex column and every child shrinks by default, so a
    // long thread quietly stole height from the furniture below it: the three
    // errand buttons rendered 13px tall out of 36 — "אני רואה שם 3 דברים שאי
    // אפשר לראות" — and the suggestion chips 32 out of 60. Fixed at the
    // container, so a control added later is protected without being told.
    assert.match(CSS, /\.chat-container > \*\s*\{\s*flex: none;\s*\}/,
        'the chat column can squeeze its own furniture again');
    assert.match(CSS, /\.chat-container > \.chat-messages\s*\{\s*flex: 1 1 auto; min-height: 0;\s*\}/,
        'the thread must be the one thing that gives');
});

test('settings is reachable from the one menu a phone has', () => {
    // It lived behind the account chip at the very bottom of the drawer, under
    // Safari's own bar, in a panel that did not scroll to it. Stav: "בטלפון רק
    // אין גישה להגיע להגדרות בלשונית שלוש קווים."
    const chat = readFileSync(join(ROOT, 'sale', 'chat.js'), 'utf8');
    const i = chat.indexOf('function renderDrawerDestinations(');
    const body = chat.slice(i, chat.indexOf('\n}', i));
    // THE ASSERTION IS "REACHABLE ON A PHONE", not "is a rail button". It used to
    // check for id="tab-settings" in the rail, which was the implementation at
    // the time. On 30/08 Stav asked for הגדרות and מאגר מחירים to move into the
    // profile menu, and doing that recreated this exact bug: panels.css hides
    // .sidebar outright under 768px, so the account menu — and everything moved
    // into it — does not exist on a phone at all. This test caught it.
    //
    // So it now asserts the thing that must stay true however the desktop is
    // arranged: every screen a phone can only reach through this drawer is
    // listed in it, and nothing is listed twice.
    assert.match(body, /\.sidebar \.nav-btn/, 'the drawer stopped mirroring the rail');
    for (const [tab, label] of [['business', 'פרטי העסק'], ['catalog', 'מאגר מחירים'], ['settings', 'הגדרות']]) {
        const inDrawer = body.includes(`tab: '${tab}'`);
        const inRail = HTML.includes(`id="tab-${tab}"`);
        assert.ok(inDrawer || inRail,
            `${label} is reachable from neither the drawer nor the rail — on a phone it does not exist`);
        assert.ok(!(inDrawer && inRail),
            `${label} is in both the drawer list and the rail — the phone would draw it twice`);
    }
});

test('the thread list belongs to the conversation, not to every screen', () => {
    // Measured at 1440 before: 76px rail + 264px thread column = 340px of
    // chrome, 24% of the screen, on the price catalogue — where a list of
    // conversation titles has nothing to do with anything on screen. And the
    // same five destinations were drawn TWICE, side by side, at once.
    // The list now appears only where a conversation is. There is nothing to
    // collapse, which is the answer to "Gemini or Claude": neither needed a
    // toggle, because a panel that is only ever there when it is relevant is
    // not in the way. Measured after: tool screens 1100 → 1364px of content.
    assert.match(CSS, /body:has\(#panel-catalog\.active\)\s+#convo-drawer/,
        'the thread column follows the conversation no longer');
    // The TOOL screens are enumerated, never the conversation ones: a browser
    // without :has(), or a screen written next year, must fail to the side
    // where the column APPEARS rather than the side where it vanishes.
    assert.doesNotMatch(CSS, /body:has\(#panel-wizard\.active\)\s+#convo-drawer\s*\{[^}]*display:\s*none/,
        'the gate is listed the dangerous way round — a new screen would lose the list silently');
    assert.match(CSS, /\.convo-dest:not\(\.is-step\)\s*\{\s*display: none;\s*\}/,
        'the destinations are mirrored into the panel and drawn twice again');
});

test('there is one step rail, and it is the sidebar', () => {
    // The floating .project-rail was a third navigation surface: it existed
    // only between 861 and 1099px, reserved 168px of every project screen for
    // itself, and drew the same three steps the sidebar was being forced to
    // hide so they would not appear twice. Deleting it returned 168px of
    // content at 1017px — the width Stav's own laptop reports.
    assert.ok(!/project-rail/.test(HTML), 'the floating step rail is back in the markup');
    assert.ok(!/renderProjectRail/.test(APP), 'its renderer is back');
    assert.ok(!/168px/.test(readFileSync(join(ROOT, 'sale', 'css', 'shell.css'), 'utf8')),
        'the 168px reservation for it is back');
    // The flag it used to own outlives it, and three rules depend on that —
    // the project banner's visibility among them. Reading the element first
    // and returning early made the flag a property of the rail's existence.
    const i = APP.indexOf('function updateProjectRail(');
    const body = APP.slice(i, APP.indexOf('\n}', i));
    const flag = body.indexOf("classList.toggle('in-project-stage'");
    const early = body.indexOf('if (!onStage) return;');
    assert.ok(flag > -1 && early > flag,
        'in-project-stage must be set before anything can return early, or the banner disappears with it');
});
