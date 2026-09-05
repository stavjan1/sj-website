// The admin panel's seven screens (Stav, 5/9/2026).
//
// Five tabs held eighteen cards in the order they got built: the conversations
// sat under the AI keys, every "פירוט" grew a list under its card that nothing
// could close, and one screen named a code default the server had overridden
// weeks earlier. The regroup put one question on each screen, one drawer behind
// every detail, and the window beside every number. Each rule below is one of
// those, pinned so the next card added picks its home and its window the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('site/sale/index.html');
const APP = readApp();
const ADMIN = read('site/sale/admin.js');
const FIN = read('site/sale/finance.js');
const HELPER = read('site/sale/helper.js');
const CSS = read('site/sale/controlroom.css');
const EVAL_API = read('functions/api/model-eval.js');

const PANEL = (() => {
    const i = HTML.indexOf('<section id="panel-admin"');
    const j = HTML.indexOf('</section>', i);
    return HTML.slice(i, j);
})();

// One function's source, ending at its own closing brace at column 0.
const fnBody = (src, marker) => {
    const i = src.indexOf(marker);
    assert.ok(i > -1, `${marker} not found`);
    const rest = src.slice(i);
    const end = rest.search(/\n\}\n/);
    return end > -1 ? rest.slice(0, end + 2) : rest;
};

const SCREENS = ['overview', 'users', 'convos', 'ai', 'prices', 'traffic', 'system'];

test('seven screens, in the order the questions get asked', () => {
    // The tab bar and the wrappers both say the same seven names in the same
    // order, and app.js keeps the same list for the deep link.
    const tabs = [...PANEL.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(tabs, SCREENS, 'the tab bar drifted from the plan');
    const wrappers = [...PANEL.matchAll(/data-admin-tab="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(wrappers, SCREENS, 'the screen wrappers drifted from the tab bar');
    for (const s of SCREENS) {
        assert.equal((PANEL.match(new RegExp(`id="admin-tab-${s}"`, 'g')) || []).length, 1, `#admin-tab-${s} missing or doubled`);
    }
    const list = APP.match(/const ADMIN_SCREENS = \[([^\]]+)\]/);
    assert.ok(list, 'ADMIN_SCREENS is gone from app.js');
    assert.deepEqual(list[1].match(/'(\w+)'/g).map((s) => s.replace(/'/g, '')), SCREENS, 'setAdminTab knows a different set of screens');
    // The first screen is the default, and there is no room to lock the shell to.
    assert.match(APP, /return ADMIN_SCREENS\.includes\(want\) \? want : 'overview';/, 'the default screen is not the overview');
    assert.ok(!/cr-lock/.test(APP) && !/cr-lock/.test(ADMIN), 'the control room\'s scroll lock is still referenced');
});

test('every screen opens with a title and a one-line purpose', () => {
    for (const s of SCREENS) {
        const i = PANEL.indexOf(`id="admin-tab-${s}"`);
        const head = PANEL.slice(i, PANEL.indexOf('<div class="section-card"', i) > -1
            ? PANEL.indexOf('<div class="section-card"', i) : i + 1500);
        assert.match(head, /class="adm-title">[^<]{2,}</, `${s}: no title`);
        assert.match(head, /class="adm-purpose">[^<]{10,}</, `${s}: no purpose line`);
    }
});

test('every former card is still here, exactly once, inside a screen', () => {
    // Nothing lost: every id the old five-tab panel carried, plus the cards
    // that had no id and were given one so they can be found.
    const FORMER = [
        'admin-auth-card', 'admin-auth-status', 'admin-overview',
        'admin-telegram-card', 'admin-telegram-body', 'admin-funnel-card', 'admin-funnel-body',
        'admin-traffic-days', 'admin-traffic-body', 'admin-clarity-body',
        'admin-convo-q', 'admin-convos-body', 'admin-ai-body', 'admin-models-body',
        'admin-feedback-body', 'admin-contrib-body', 'admin-clarity-token', 'admin-clarity-status',
        'admin-stats-kpis', 'admin-stats-live-toggle', 'admin-stats-live-note', 'admin-stats-table',
        'admin-helpers-card', 'admin-helpers-body',
        'admin-tier-email', 'admin-tier-select', 'admin-tier-status', 'admin-tier-config',
        'admin-cat-paste', 'admin-cat-import-status', 'admin-cat-diff-note', 'admin-syscat-status',
        'admin-syscat-count', 'admin-syscat-mine', 'admin-syscat-list',
        'admin-pricing-map', 'admin-pricing-map-status', 'admin-users-list',
        'admin-status-key', 'admin-status-key2', 'admin-status-drive',
        'cr-health-dot', 'cr-health-text', 'cr-health', 'cr-feed', 'cr-feed-meta', 'cr-traffic', 'cr-traffic-meta',
    ];
    const CARDS = [
        'admin-attention-card', 'admin-users-card', 'admin-helpers-card', 'admin-convos-card',
        'admin-models-card', 'admin-ai-card', 'admin-keys-card',
        'admin-feedback-card', 'admin-contrib-card', 'admin-helper-prices-card', 'admin-stats-card', 'admin-syscat-card', 'admin-pmap-card',
        'admin-traffic-card', 'admin-funnel-card', 'admin-telegram-card', 'admin-clarity-card',
        'admin-health-card', 'admin-status-card', 'admin-tiers-card', 'admin-feed-card',
    ];
    for (const id of [...FORMER, ...CARDS]) {
        const n = (PANEL.match(new RegExp(`\\bid="${id}"`, 'g')) || []).length;
        assert.equal(n, 1, `#${id} appears ${n} times in the admin panel`);
    }
    // Which screen each card is on — the map Stav approved.
    const HOME = {
        overview: ['admin-attention-card'],
        users: ['admin-users-card', 'admin-helpers-card'],
        convos: ['admin-convos-card'],
        ai: ['admin-models-card', 'admin-ai-card', 'admin-keys-card'],
        prices: ['admin-feedback-card', 'admin-contrib-card', 'admin-helper-prices-card', 'admin-stats-card', 'admin-syscat-card', 'admin-pmap-card'],
        traffic: ['admin-traffic-card', 'admin-funnel-card', 'admin-telegram-card', 'admin-clarity-card'],
        system: ['admin-health-card', 'admin-status-card', 'admin-tiers-card', 'admin-feed-card'],
    };
    const at = (id) => PANEL.indexOf(`id="${id}"`);
    for (const [screen, cards] of Object.entries(HOME)) {
        const start = at(`admin-tab-${screen}`);
        const next = SCREENS[SCREENS.indexOf(screen) + 1];
        const end = next ? at(`admin-tab-${next}`) : PANEL.length;
        for (const c of cards) {
            const i = at(c);
            assert.ok(i > start && i < end, `#${c} is not on the ${screen} screen`);
        }
    }
    // The conversations are their own screen, not a card under the AI keys.
    const aiStart = at('admin-tab-ai'), aiEnd = at('admin-tab-prices');
    assert.ok(!(at('admin-convos-body') > aiStart && at('admin-convos-body') < aiEnd), 'the conversations are back under the AI screen');
});

test('one drawer, with an X and Escape, behind every פירוט', () => {
    // The drawer itself: title, close button, body; the app's own chrome.
    assert.match(HTML, /<aside class="stern-drawer admin-drawer" id="admin-drawer"/, 'the admin drawer is gone');
    assert.match(HTML, /id="admin-drawer-title"/, 'the drawer has no title slot');
    assert.match(HTML, /class="btn-close admin-drawer-close" onclick="closeAdminDrawer\(\)" aria-label="סגירה"/, 'the drawer has no X');
    assert.match(HTML, /id="admin-drawer-body"/, 'the drawer has no body');
    const open = fnBody(ADMIN, 'function openAdminDrawer(');
    assert.match(open, /addEventListener\('keydown', _adminDrawerEsc\)/, 'Escape is not wired on open');
    const esc = fnBody(ADMIN, 'function _adminDrawerEsc(');
    assert.match(esc, /e\.key !== 'Escape'/, 'the Escape handler does not check for Escape');
    assert.match(esc, /closeAdminDrawer\(\)/, 'Escape does not close the drawer');
    const close = fnBody(ADMIN, 'function closeAdminDrawer(');
    assert.match(close, /removeEventListener\('keydown', _adminDrawerEsc\)/, 'the Escape listener leaks after close');

    // Every detail opener goes through it.
    // openAdminConvo is a one-liner over openAdminThread since the user page
    // started opening threads with a way back (5/9); the drawer call lives there.
    for (const [src, fn] of [
        [ADMIN, 'async function openAdminThread('],
        [ADMIN, 'function openAdminTrafficDetail('],
        [APP, 'async function openAdminUser('],
        [APP, 'function openAdminSystemCatalog('],
    ]) {
        assert.match(fnBody(src, fn), /openAdminDrawer\(/, `${fn} does not open the drawer`);
    }
    assert.match(fnBody(ADMIN, 'function openAdminConvo('), /openAdminThread\(_adminConvoView\[i\]\)/, 'the feed no longer opens threads through openAdminThread');
    assert.match(FIN, /window\.openAdminFunnelUsers = function[\s\S]{0,300}window\.openAdminDrawer\(/, 'the funnel\'s per-user detail does not open the drawer');
});

test('no admin פירוט appends under its card, and nothing loops or ticks', () => {
    // The handlers that used to grow lists in place: a <dialog> appended to the
    // body for a thread, a row body toggled open under a user, a <details> for
    // the traffic table and the funnel's users, four hundred catalogue rows
    // written straight into the card.
    const adminCode = [ADMIN, fnBody(APP, 'async function adminRefreshUserList('), fnBody(APP, 'async function openAdminUser('),
        fnBody(APP, 'function adminRefreshSystemCatalogInfo('), fnBody(APP, 'function adminFeedbackHtml('),
        fnBody(FIN, 'window.renderAdminFunnel = async function renderAdminFunnel(')].join('\n');
    const code = adminCode.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
    assert.ok(!/createElement\('dialog'\)/.test(code), 'a detail still opens as a modal dialog of its own');
    assert.ok(!/document\.body\.appendChild/.test(code), 'a detail still appends itself to the body');
    assert.ok(!/adminToggleUser/.test(APP), 'the user row still toggles a body under itself');
    assert.ok(!/<details[^>]*>\s*<summary>[^<]*פירוט/.test(code), 'a פירוט still unfolds under its card as <details>');
    assert.ok(!/admin-user-body/.test(APP), 'the per-user body container is still rendered under the row');
    // A "פירוט" button in the admin markup or renderers calls an open* function.
    const buttons = [...adminCode.matchAll(/onclick="([^"(]+)\([^"]*"[^>]*>[^<]*<i[^>]*><\/i>\s*פירוט/g)].map((m) => m[1]);
    assert.ok(buttons.length >= 3, `expected the פירוט buttons, found ${buttons.length}`);
    for (const b of buttons) assert.match(b, /^(window\.)?openAdmin/, `"${b}" is a פירוט button that does not open a drawer`);

    // The room's clock and five-minute loop are gone with the room.
    assert.ok(!/setInterval/.test(ADMIN), 'admin.js still runs a timer');
    assert.ok(!/crStartClock|crStartAuto|crStopClock|renderControlRoom/.test(APP + HTML), 'the control room is still wired');
});

test('every windowed number names its window', () => {
    // Static: each renderer that draws a number from a windowed source carries
    // the window text next to it.
    const kpis = fnBody(ADMIN, 'function crPaintKpis(');
    for (const label of ["'כניסות · היום'", "'פעילים · 7 ימים'", "'הצעות · החודש'", "'ניצול AI · היום'", "'דיוק התמחור · משובים אחרונים'", "'בריאות · עכשיו'"]) {
        assert.ok(kpis.includes(label), `the overview lost the tile ${label}`);
    }
    const ai = fnBody(ADMIN, 'function aiPanelHtml(');
    assert.match(ai, /const win = `\$\{days\} ימים`;/, 'the AI card no longer names its range');
    assert.match(ai, /בקשות · \$\{win\}/, 'per-key totals lost their window');
    assert.match(ai, /לפי מודל · \$\{win\}/, 'the per-model share lost its window');
    assert.match(ai, /אירועים אחרונים · 7 ימים/, 'the events list lost its window');
    const pressure = fnBody(ADMIN, 'function aiPressureHtml(');
    assert.match(pressure, /ב-\$\{days \|\| 30\} הימים האחרונים/, 'the exhausted-days count lost its window');
    const traffic = fnBody(ADMIN, 'function trafficColumn(');
    assert.match(traffic, /צפיות\$\{win\}/, 'the traffic detail views lost their window');
    assert.match(traffic, /מבקרים\$\{win\}/, 'the traffic detail visitors lost their window');
    assert.match(fnBody(ADMIN, 'function crPaintTraffic('), /צפיות · \$\{a\.days\} ימים/, 'the day line lost its window');
    assert.match(fnBody(ADMIN, 'function crPaintFeed('), /רשומות · 7 ימים/, 'the event log lost its window');
    assert.match(fnBody(ADMIN, 'async function renderAdminClarity('), /3 ימים/, 'the heat map lost its window');
    const stats = fnBody(APP, 'async function renderAdminStats(');
    assert.match(stats, /הצעות · מאז ההתחלה/, 'the all-time quote count lost its window');
    assert.match(stats, /הצעות · החודש/, 'the monthly quote count lost its window');
    assert.match(fnBody(APP, 'function adminFeedbackHtml('), /200 המשובים האחרונים' : 'מאז ההתחלה'/, 'the feedback total lost its window');
    assert.match(fnBody(APP, 'function adminContributorsHtml('), /מאז ההתחלה/, 'the contributors count lost its window');
    assert.match(fnBody(HELPER, 'async function renderAdminHelpers('), /מאז ההתחלה/, 'the helper price counts lost their window');
    assert.match(FIN, /פעילים · 7 ימים:/, 'the funnel\'s active count lost its window');

    // Dynamic: the shared verdict headline emits the window with the number.
    const src = ['function crNum(', 'function crBar(', 'function crVerdictMix(', 'function crQualityHtml(']
        .map((m) => fnBody(ADMIN, m)).join('\n');
    const ctx = createContext({ escapeHtml: (s) => String(s), JOB_TYPE_LABELS: {} });
    runInContext(src + ';globalThis.q = crQualityHtml;', ctx);
    const small = ctx.q({ total: 12, entries: [{ verdict: 'spot_on' }, { verdict: 'spot_on' }, { verdict: 'way_off' }], rates: {} });
    assert.match(small, /67%/, 'the on-target share is wrong');
    assert.match(small, /12 משובים מאז ההתחלה/, 'a small total does not say it is the whole history');
    const capped = ctx.q({ total: 200, entries: [{ verdict: 'spot_on' }], rates: {} });
    assert.match(capped, /200 המשובים האחרונים/, 'a capped total does not say it is a window');
});

test('what runs now stands beside what the code defaults to', () => {
    // Rule (a): a live value with a code default AND a server override shows
    // both — "רץ עכשיו" large, "ברירת מחדל" small — and says who changed it,
    // or "לא ידוע" when the save predates the stamp.
    const models = fnBody(ADMIN, 'function modelsPanelHtml(');
    assert.match(models, /רץ עכשיו/, 'the models card does not say what runs now');
    assert.match(models, /ברירת מחדל בקוד:/, 'the models card does not show the code default');
    assert.match(models, /לא ידוע/, 'an unstamped override is not called unknown');
    assert.match(models, /mdl-live-v/, 'the running model is not the large value');
    assert.match(CSS, /\.mdl-live-v \{[^}]*var\(--fs-xl\)/, 'the running model is not set large');
    // The server stamps the save and reports it.
    const put = EVAL_API.slice(EVAL_API.indexOf('export async function onRequestPut'));
    assert.match(put, /cfg\.savedAt = Date\.now\(\);/, 'a model switch is not stamped with its time');
    assert.match(put, /cfg\.by = gate\.email/, 'a model switch is not stamped with who made it');
    const get = EVAL_API.slice(EVAL_API.indexOf('export async function onRequestGet'), EVAL_API.indexOf('export async function onRequestPut'));
    assert.match(get, /override,/, 'GET does not return the override stamp');
});

test('the overview claims only what the code reads', () => {
    // Rule (g): every line in the attention list reads a field the server
    // returns. The sources are the six named here and nothing else.
    const fn = fnBody(ADMIN, 'async function renderAdminOverview(');
    for (const url of ['/api/analytics?admin=1&summary=1', '/api/funnel', '/api/feedback', '/api/stats?admin=1', '/api/telegram-setup', '/api/helper-prices?admin=1']) {
        assert.ok(fn.includes(url), `the overview no longer reads ${url}`);
    }
    const attn = fnBody(ADMIN, 'function crPaintAttention(');
    assert.match(attn, /t\.exhausted/, 'exhausted keys are not listed');
    assert.match(attn, /t\.pct >= 70/, 'keys near their cap are not listed');
    assert.match(attn, /verdict === 'way_off'/, 'fresh "ממש לא" verdicts are not listed');
    assert.match(attn, /hp\.prices/, 'helpers\' new prices are not listed');
    assert.match(attn, /שקט\./, 'an empty list invents a chore instead of saying so');
    // The stamp says when the numbers were last fetched, in place of a clock.
    assert.match(fnBody(ADMIN, 'function crPaintKpis('), /admin-overview-stamp/, 'the overview does not say when it last refreshed');
});

test('phone: tables scroll in their own frame and targets are 44px', () => {
    // Every table an admin renderer emits sits in a .table-scroll, or is
    // written into a container that is one.
    const scrollIds = new Set([...PANEL.matchAll(/id="([\w-]+)"[^>]*class="[^"]*table-scroll/g)].map((m) => m[1])
        .concat([...PANEL.matchAll(/class="[^"]*table-scroll[^"]*"[^>]*id="([\w-]+)"/g)].map((m) => m[1])));
    assert.ok(scrollIds.has('admin-stats-table'), 'the stats table container does not scroll on its own');
    const renderers = [fnBody(APP, 'function adminFeedbackHtml('), fnBody(APP, 'function adminContributorsHtml('),
        fnBody(HELPER, 'async function renderAdminHelpers('), fnBody(FIN, 'window.renderAdminFunnel = async function renderAdminFunnel('),
        fnBody(ADMIN, 'function renderAdminUsersTable('), fnBody(ADMIN, 'function paintAdminUserPage(')].join('\n');
    for (const m of renderers.matchAll(/<table/g)) {
        const before = renderers.slice(Math.max(0, m.index - 160), m.index);
        assert.match(before, /table-scroll/, `a table is rendered without a scroll container near: ${renderers.slice(m.index, m.index + 60)}`);
    }
    assert.match(CSS, /#panel-admin \.table-scroll \{ overflow-x: auto;/, 'the scroll container does not scroll');
    assert.match(CSS, /@media \(pointer: coarse\) \{[^}]*#panel-admin \.btn-small[^}]*min-block-size: 44px/, 'admin buttons are under 44px on a phone');
    assert.match(CSS, /\.aov-tile \{[^}]*min-block-size: 44px/, 'overview tiles are under 44px');
    assert.match(CSS, /\.adm-attn-row \{[^}]*min-block-size: 44px/, 'attention rows are under 44px');
});

// ---- the users screen (5/9) --------------------------------------------------
// One table, joined in the browser from payloads the panel already holds, and
// behind every row the whole person in the drawer. The rules pinned here are
// the ones that keep it cheap and honest: no request per row, the drawer's
// sections in the order Stav reads them, and every action on an endpoint that
// exists.
const USERS_SRC = ADMIN.slice(ADMIN.indexOf('// USERS — who is here'), ADMIN.indexOf('// THE ADMIN DRAWER'));
const ADMIN_USERS_API = read('functions/api/admin-users.js');
const HELPER_API = read('functions/api/helper-prices.js');
const FEEDBACK_API = read('functions/api/feedback.js');
const TIER_API = read('functions/api/tier.js');

// The screen's code in a bare context: a document of five elements and no
// network at all — adminRes throws, so any fetch during a render is a failure.
function usersContext() {
    const els = {
        'admin-users-list': { innerHTML: '' },
        'admin-users-q': { value: '' },
        'admin-drawer': { classList: { contains: () => true } },
        'admin-drawer-body': { innerHTML: '' },
        'admin-drawer-title': { textContent: '' },
    };
    const calls = [];
    const ctx = createContext({
        Date, Map, Set, Number, String, Object, Array, Math, JSON,
        document: { getElementById: (id) => els[id] || null },
        window: { _adminHelperSet: new Set(['bat@x.com']) },
        escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        heNum: (n) => String(Number(n || 0)),
        signupMailNote: () => '(mail)',
        TIER_LABELS: { free: 'סילבר', pro: 'גולד', business: 'דיימונד', admin: 'מנהל' },
        PF_VERDICT_HE: { way_off: 'ממש לא', spot_on: 'בול' },
        adminRes: (url) => { calls.push(url); throw new Error('network during render: ' + url); },
        isAdmin: () => true,
        adminErrorHtml: (e) => 'ERR ' + e.message,
        showToast: () => {},
    });
    const src = [
        'let _adminUsers = [], _adminUsersMeta = null, _adminUsersLoaded = false, _usersLoading = false;',
        "let _adminUsersSort = { key: 'lastUpdated', dir: -1 };",
        'let _adminConvos = [], _adminConvosLoaded = false, _adminConvosMeta = null, _convosLoading = false;',
        'let _adminUserPage = null; const _adminSide = {}; let _crCache = {}; let _crAt = 0;',
        ...['function crWhen(', 'function adminUserName(', 'function adminConvoCounts(', 'function adminHelperSet(',
            'function adminSortUsers(', 'function renderAdminUsersTable(', 'function adminNoteTier(', 'function paintAdminUserPage(']
            .map((m) => fnBody(ADMIN, m)),
        // The fixtures are handed in through a setter so the vm's own lexical
        // bindings (not the sandbox object) are the ones the renderers read.
        'function setData(users, convos) { _adminUsers = users.users; _adminUsersMeta = users; _adminUsersLoaded = true;'
        + ' _adminConvos = convos ? convos.threads : []; _adminConvosLoaded = !!convos; _adminConvosMeta = convos; }',
        'function setPage(page, convosLoaded) { _adminUserPage = page; _adminConvosLoaded = convosLoaded; }',
    ].join('\n');
    runInContext(src, ctx);
    const rowsOf = (html) => [...html.matchAll(/<tr class="au-row"[^>]*data-email="([^"]+)"/g)].map((m) => m[1]);
    const cellsOf = (html, email) => {
        const i = html.indexOf(`data-email="${email}"`);
        return [...html.slice(i, html.indexOf('</tr>', i)).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
    };
    return { ctx, els, calls, rowsOf, cellsOf };
}

const DAY = 86400000;
const FAKE_USERS = {
    ok: true, count: 3, mailConfigured: false, mail: null,
    users: [
        { email: 'avi@x.com', name: '', projects: 2, history: 3, lastUpdated: Date.now() - 2 * DAY, firstSeen: Date.now() - 40 * DAY, tier: 'pro' },
        { email: 'bat@x.com', name: 'בת-שבע חשמל', projects: 1, history: 0, lastUpdated: Date.now() - 1 * DAY, firstSeen: null, tier: 'free' },
        { email: 'gad@x.com', name: '', projects: 0, history: 7, lastUpdated: Date.now() - 20 * DAY, firstSeen: Date.now() - 20 * DAY, tier: 'free' },
    ],
};
const FAKE_CONVOS = {
    ok: true, users: 3, failed: 0, total: 3, truncated: false, usersTruncated: false,
    threads: [
        { email: 'avi@x.com', id: 'p1', title: 'נקודת חשמל למזגן', kind: 'ask', status: null, when: Date.now() - DAY, messages: 4, asked: 'כמה עולה', answered: '450', verdict: 'way_off' },
        { email: 'avi@x.com', id: 'p2', title: 'דירה 4 חדרים', kind: 'job', status: 'טיוטה', when: Date.now() - 3 * DAY, messages: 9, asked: 'לוח חדש', answered: '…' },
        { email: 'gad@x.com', id: 'p3', title: 'שאלה על ממסר פחת', kind: 'ask', status: null, when: Date.now() - 10 * DAY, messages: 2, asked: 'ממסר', answered: '…' },
    ],
};

test('users: the table joins its counts from the cached payloads, with no fetch per row', () => {
    const { ctx, els, calls, rowsOf, cellsOf } = usersContext();
    runInContext(`setData(${JSON.stringify(FAKE_USERS)}, ${JSON.stringify(FAKE_CONVOS)}); renderAdminUsersTable();`, ctx);
    const html = els['admin-users-list'].innerHTML;
    assert.deepEqual(calls, [], 'rendering the table hit the network');
    assert.match(html, /<div class="table-scroll"><table class="au-table">/, 'the table does not scroll in its own frame');

    // One row per user, newest save first, each a door to the drawer.
    assert.match(html, /<tr class="au-row"[^>]*onclick="openAdminUser\(this\.dataset\.email\)"/, 'a row is not a door to the drawer');
    assert.deepEqual(rowsOf(html), ['bat@x.com', 'avi@x.com', 'gad@x.com'], 'rows are not sorted by last save, newest first');
    // name (record, else the email prefix) · email · tier · last save · quotes · conversations · helper
    assert.deepEqual(cellsOf(html, 'avi@x.com').slice(0, 3), ['avi', 'avi@x.com', 'גולד']);
    assert.equal(cellsOf(html, 'avi@x.com')[4], '3', 'quotes count is not the history length');
    assert.equal(cellsOf(html, 'avi@x.com')[5], '2', 'conversations are not counted from the feed');
    assert.equal(cellsOf(html, 'bat@x.com')[0], 'בת-שבע חשמל', 'the record name is not shown when there is one');
    assert.equal(cellsOf(html, 'bat@x.com')[5], '0', 'a user with no threads does not read 0');
    assert.equal(cellsOf(html, 'bat@x.com')[6], 'עוזר', 'the helper badge does not come from the helper set');
    assert.equal(cellsOf(html, 'gad@x.com')[6], '', 'a non-helper carries a badge');
    // The field behind "last active" is named for what it is.
    assert.match(html, /שמירה אחרונה = הפעם האחרונה שהמכשיר שלו שמר לענן/, 'the last-active column does not say what it measures');
    assert.match(html, /3 שיחות אצל 3 משתמשים/, 'the conversation count does not name the feed it came from');
    assert.match(html, /חדשים החודש/, 'the signup count lost its window');

    // Sortable by last save: the same header flips the order.
    runInContext("adminSortUsers('lastUpdated');", ctx);
    assert.deepEqual(rowsOf(els['admin-users-list'].innerHTML), ['gad@x.com', 'avi@x.com', 'bat@x.com'], 'sorting by last save does not flip');
    runInContext("adminSortUsers('history');", ctx);
    assert.deepEqual(rowsOf(els['admin-users-list'].innerHTML), ['gad@x.com', 'avi@x.com', 'bat@x.com'], 'sorting by quotes is off');
    runInContext("adminSortUsers('lastUpdated');", ctx);

    // The search box narrows by name or address.
    els['admin-users-q'].value = 'בת-שבע';
    runInContext('renderAdminUsersTable();', ctx);
    assert.deepEqual(rowsOf(els['admin-users-list'].innerHTML), ['bat@x.com'], 'search by name failed');
    els['admin-users-q'].value = 'gad@';
    runInContext('renderAdminUsersTable();', ctx);
    assert.deepEqual(rowsOf(els['admin-users-list'].innerHTML), ['gad@x.com'], 'search by address failed');
    els['admin-users-q'].value = '';

    // Before the feed is in memory the column says so and offers the one load,
    // instead of a column of zeros.
    runInContext(`setData(${JSON.stringify(FAKE_USERS)}, null); renderAdminUsersTable();`, ctx);
    const before = els['admin-users-list'].innerHTML;
    assert.match(before, /onclick="adminLoadConvosForUsers\(this\)"/, 'no way to load the feed from the users screen');
    assert.equal(cellsOf(before, 'avi@x.com')[5], '—', 'an unloaded feed shows a number');
    assert.match(before, /שיחות: יוצגו אחרי טעינת הפיד/, 'an unloaded feed is not explained');
    assert.deepEqual(calls, [], 'a render without the feed fetched something');

    // A tier change redraws from the cache; it does not rescan every user.
    runInContext("adminNoteTier('gad@x.com', 'business');", ctx);
    assert.match(els['admin-users-list'].innerHTML, /data-email="gad@x.com"[\s\S]*?plan-business/, 'the tier chip did not follow the change');
    assert.deepEqual(calls, [], 'a tier change refetched the list');
    assert.ok(!/adminRefreshUserList\(\)/.test(fnBody(APP, 'async function adminSetTierFor(')), 'a tier change still rescans every user');
});

test('users: the drawer shows the person in six sections, in order', () => {
    const { ctx, els, calls } = usersContext();
    const page = {
        email: 'avi@x.com', row: FAKE_USERS.users[0],
        detail: { ok: true, email: 'avi@x.com', tier: 'pro', projects: [{ id: 'p2', name: 'דירה 4 חדרים', status: 'טיוטה', amount: 12000 }] },
        helpers: { helpers: ['bat@x.com'], items: [{ id: 'i1', name: 'נקודת חשמל', unit: 'יח׳' }], prices: { 'avi@x.com': { i1: { price: 180, at: Date.now() - DAY } } } },
        feedback: { entries: [{ by: 'avi@x.com', verdict: 'way_off', jobType: 'מזגן', price: 450, note: 'יקר', at: new Date().toISOString() }, { by: 'zed@x.com', verdict: 'spot_on', at: new Date().toISOString() }] },
    };
    runInContext(`setData(${JSON.stringify(FAKE_USERS)}, ${JSON.stringify(FAKE_CONVOS)}); setPage(${JSON.stringify(page)}, true); paintAdminUserPage();`, ctx);
    const html = els['admin-drawer-body'].innerHTML;
    assert.deepEqual(calls, [], 'painting the page hit the network');
    assert.equal(els['admin-drawer-title'].textContent, 'avi', 'the drawer is not titled by the person');
    assert.deepEqual([...html.matchAll(/<section class="au-sec" data-sec="(\w+)">/g)].map((m) => m[1]),
        ['profile', 'quotes', 'convos', 'helper', 'feedback', 'actions'], 'the sections are not in the agreed order');
    assert.deepEqual([...html.matchAll(/<h4 class="tcol-title">([^<]+)<\/h4>/g)].map((m) => m[1]),
        ['פרופיל ומסלול', 'הצעות', 'שיחות', 'מחירי עוזר', 'משוב', 'פעולות']);

    const sec = (id) => { const i = html.indexOf(`data-sec="${id}"`); return html.slice(i, html.indexOf('</section>', i)); };
    // 1 · the tier control that exists today, and the helper switch through setHelper.
    assert.match(sec('profile'), /onchange="adminSetTierFor\('avi@x\.com', this\.value, this\)"/, 'the tier control is not the existing one');
    assert.match(sec('profile'), /<option value="pro" selected>/, 'the current tier is not selected');
    assert.match(sec('profile'), /type="checkbox"\s+ onchange="adminUserSetHelper\('avi@x\.com', this\.checked, this\)"/, 'the helper switch is missing or checked for a non-helper');
    assert.match(fnBody(ADMIN, 'async function adminUserSetHelper('), /await setHelper\(email, on\)/, 'the helper switch does not go through setHelper');
    assert.match(sec('profile'), /שמירה אחרונה לענן/, 'the profile does not name what "last active" is');
    // 2 · quotes: counts from the row, projects from the admin data.
    assert.match(sec('quotes'), /3 הצעות בארכיון · 2 עבודות · מאז ההתחלה/, 'the quote counts lost their window');
    assert.match(sec('quotes'), /דירה 4 חדרים[\s\S]*₪12,000/, 'the project list from the admin data is not shown');
    // 3 · conversations: this user's threads from the feed, each opening the thread view with a way back.
    const threads = [...sec('convos').matchAll(/onclick="openAdminUserThread\((\d+)\)"/g)].map((m) => m[1]);
    assert.deepEqual(threads, ['0', '1'], 'the user\'s two threads are not listed from the feed');
    assert.ok(!/ממסר פחת/.test(sec('convos')), 'another user\'s thread leaked into the page');
    assert.match(sec('convos'), /2 שיחות · מתוך פיד השיחות/, 'the thread count does not name the feed');
    const openThread = fnBody(ADMIN, 'function openAdminUserThread(');
    assert.match(openThread, /openAdminThread\(t, \{ label: 'חזרה ל'/, 'a thread from the page does not open with a back link');
    assert.match(fnBody(ADMIN, 'async function openAdminThread('), /class="au-back" onclick="adminThreadBack\(\)"/, 'the thread view has no back link');
    assert.match(fnBody(ADMIN, 'function adminThreadBack('), /b\.onBack\(\)/, 'the back link goes nowhere');
    // 4 · helper prices, this address only, with the window.
    assert.match(sec('helper'), /1 מחירים · מאז ההתחלה/, 'the helper price count lost its window');
    assert.match(sec('helper'), /נקודת חשמל[\s\S]*180/, 'his price is not shown');
    assert.match(sec('helper'), /לא עוזר כרגע/, 'a non-helper with prices is called a helper');
    // 5 · feedback, filtered to him, out of the window the server returns.
    assert.match(sec('feedback'), /1 משובים שלו · מתוך 2 המשובים האחרונים במערכת/, 'the verdict count does not name its window');
    assert.match(sec('feedback'), /ממש לא[\s\S]*מזגן · ₪450[\s\S]*“יקר”/, 'his verdict is not shown with its note');
    assert.ok(!/zed@x\.com|בול/.test(sec('feedback')), 'another user\'s verdict leaked into the page');
    // 6 · the one action, saying what it does and does not erase.
    assert.match(sec('actions'), /onclick="adminDeleteUserData\('avi@x\.com'\)"/, 'the delete action is missing');
    assert.match(sec('actions'), /לא נוגע במחירי העוזר, במשובים ובעותק שעל המכשיר שלו/, 'the delete claims more than the endpoint does');

    // Before the feed and the side sources land, the page says so rather than showing zeros.
    runInContext(`setPage(${JSON.stringify({ email: 'avi@x.com', row: FAKE_USERS.users[0], detail: null, helpers: null, feedback: null })}, false); paintAdminUserPage();`, ctx);
    const early = els['admin-drawer-body'].innerHTML;
    assert.match(early, /פיד השיחות עוד לא נטען/, 'an unloaded feed is not named');
    assert.match(early, /רשימת העבודות נטענת…/, 'a pending project list is not named');
    assert.deepEqual(calls, [], 'the early paint hit the network');
    // And a failed project fetch still shows the count with a line saying the list did not arrive.
    runInContext(`setPage(${JSON.stringify({ email: 'avi@x.com', row: FAKE_USERS.users[0], detail: null, detailErr: { message: 'boom' }, helpers: null, feedback: null })}, false); paintAdminUserPage();`, ctx);
    assert.match(els['admin-drawer-body'].innerHTML, /3 הצעות בארכיון[\s\S]*רשימת העבודות לא נטענה/, 'a failed list does not fall back to the count');
    // An admin account is not offered for deletion.
    runInContext(`setPage(${JSON.stringify({ email: 'me@x.com', row: { email: 'me@x.com', tier: 'admin' }, detail: null, helpers: null, feedback: null })}, false); paintAdminUserPage();`, ctx);
    assert.ok(!/adminDeleteUserData/.test(els['admin-drawer-body'].innerHTML), 'the admin account can be deleted from its own page');
});

test('users: every action calls an endpoint that exists, and nothing fetches per row', () => {
    // The endpoints the screen and the page touch, and the handler behind each.
    // Direct calls, plus the two side sources that go through adminSideSource
    // (which itself is one adminRes(url) behind a five-minute cache).
    const urls = [...USERS_SRC.matchAll(/adminRes\(\s*(['`])([^'`]+)\1/g)].map((m) => m[2])
        .concat([...USERS_SRC.matchAll(/adminSideSource\('\w+', '([^']+)'\)/g)].map((m) => m[1]));
    assert.deepEqual([...new Set(urls)].sort(), ['/api/admin-users', '/api/admin-users?user=', '/api/feedback', '/api/helper-prices?admin=1'].sort(),
        'the users screen talks to an endpoint outside the agreed four');
    assert.match(fnBody(ADMIN, 'async function adminSideSource('), /const res = await adminRes\(url\);/, 'the side sources bypass adminRes');
    assert.match(ADMIN_USERS_API, /export async function onRequestGet/, 'GET /api/admin-users is gone');
    assert.match(ADMIN_USERS_API, /export async function onRequestDelete/, 'DELETE /api/admin-users is gone');
    assert.match(ADMIN_USERS_API, /searchParams\.get\('user'\)/, 'the per-user detail and the delete no longer read ?user=');
    assert.match(HELPER_API, /url\.searchParams\.get\('admin'\)/, 'GET /api/helper-prices?admin=1 is gone');
    assert.match(HELPER_API, /method === 'PUT'/, 'PUT /api/helper-prices (setHelper) is gone');
    assert.match(FEEDBACK_API, /if \(method === 'GET'\) return report\(context\);/, 'the feedback admin GET is gone');
    assert.match(TIER_API, /onRequestPost/, 'POST /api/tier (adminSetTierFor) is gone');
    // The delete goes through the existing DELETE, behind the existing two gates.
    const del = fnBody(ADMIN, 'async function adminDeleteUserData(');
    assert.match(del, /await askConfirm\(\{/, 'the delete skips the confirm');
    assert.match(del, /danger: true/, 'the confirm is not styled as destructive');
    assert.match(del, /openNamePrompt\(\{[\s\S]*הקלד "מחק" כדי לאשר/, 'the delete skips the typed word');
    assert.match(del, /adminRes\('\/api\/admin-users\?user=' \+ encodeURIComponent\(email\), \{ method: 'DELETE' \}\)/, 'the delete does not use the existing DELETE path');
    // The tier control on the page is the one that exists today.
    assert.match(fnBody(APP, 'async function adminSetTierFor('), /adminRes\('\/api\/tier'/, 'adminSetTierFor no longer posts to /api/tier');
    // The server hands the name back from the record the list already reads — no extra read.
    assert.match(ADMIN_USERS_API, /name: recordName\(db\)/, 'the list no longer carries the record name');
    assert.match(ADMIN_USERS_API, /function recordName\(db\)[\s\S]{0,200}settings\.businessDetails/, 'the name is not read from the business details');

    // No fetch per row: the table renderer never touches the network, the
    // page opens with exactly one per-user read, and nothing loops over the
    // users list with a request inside.
    const table = fnBody(ADMIN, 'function renderAdminUsersTable(');
    assert.ok(!/adminRes\(|fetch\(/.test(table), 'the table renderer fetches');
    assert.ok(!/adminRes\(|fetch\(/.test(fnBody(ADMIN, 'function paintAdminUserPage(')), 'the page painter fetches');
    const open = fnBody(ADMIN, 'async function openAdminUser(');
    assert.equal((open.match(/adminRes\(/g) || []).length, 1, 'opening a user makes more than one direct request');
    assert.ok(!/_adminUsers\.(forEach|map)\([\s\S]*?adminRes\(/.test(USERS_SRC), 'a loop over the users list carries a request');
    assert.ok(!/for \([^)]*_adminUsers[^)]*\)[\s\S]{0,300}adminRes\(/.test(USERS_SRC), 'a loop over the users list carries a request');
    // The conversation count comes from the feed already in memory.
    assert.match(fnBody(ADMIN, 'function adminConvoCounts('), /_adminConvos\.forEach/, 'the counts are not read from the cached feed');
    assert.ok(!/admin-convos\?user=/.test(USERS_SRC), 'a per-user conversations request crept into the users screen');
    // The refresh is guarded like the feed: one refresh is one read per user.
    const refresh = fnBody(ADMIN, 'async function adminRefreshUserList(');
    assert.match(refresh, /if \(_usersLoading\) return;/, 'the users refresh has no double-click guard');
    assert.match(refresh, /finally\s*\{[\s\S]{0,80}_usersLoading = false;/, 'the users guard is not released in a finally');
    // The screen's markup: the search box re-renders from the cache; the helper badge has a source.
    assert.match(PANEL, /id="admin-users-q"[^>]*oninput="renderAdminUsersTable\(\)"/, 'the search box does not re-render the table');
    assert.match(fnBody(HELPER, 'async function renderAdminHelpers('), /window\._adminHelperSet = new Set\(helpers\)/, 'the helper badge has no source');
});
