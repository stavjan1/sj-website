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
    for (const [src, fn] of [
        [ADMIN, 'async function openAdminConvo('],
        [ADMIN, 'function openAdminTrafficDetail('],
        [APP, 'async function openAdminUser('],
        [APP, 'function openAdminSystemCatalog('],
    ]) {
        assert.match(fnBody(src, fn), /openAdminDrawer\(/, `${fn} does not open the drawer`);
    }
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
        fnBody(HELPER, 'async function renderAdminHelpers('), fnBody(FIN, 'window.renderAdminFunnel = async function renderAdminFunnel(')].join('\n');
    for (const m of renderers.matchAll(/<table/g)) {
        const before = renderers.slice(Math.max(0, m.index - 160), m.index);
        assert.match(before, /table-scroll/, `a table is rendered without a scroll container near: ${renderers.slice(m.index, m.index + 60)}`);
    }
    assert.match(CSS, /#panel-admin \.table-scroll \{ overflow-x: auto;/, 'the scroll container does not scroll');
    assert.match(CSS, /@media \(pointer: coarse\) \{[^}]*#panel-admin \.btn-small[^}]*min-block-size: 44px/, 'admin buttons are under 44px on a phone');
    assert.match(CSS, /\.aov-tile \{[^}]*min-block-size: 44px/, 'overview tiles are under 44px');
    assert.match(CSS, /\.adm-attn-row \{[^}]*min-block-size: 44px/, 'attention rows are under 44px');
});
