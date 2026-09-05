// THE GROWING RAIL. Stav, 5.9.2026: "someone who enters for the first time
// wants to see everything: what helps me, how much do I need to use?" — so
// the rail shows only the places he can use today. בית · עבודות · לקוחות on
// the first visit; כסף is born the moment the first quote leaves the machine
// and never goes away; תזרים exists only for the plans that own it, and the
// button is named by what it does, not by what it costs.
//
// What these pin that a screenshot cannot: the unlock is a pure function of
// persisted data (so phone and desktop agree and a veteran's rail is full in
// the first frame), it is monotonic, the sample job never triggers it, the
// "show everything" checkbox never exposes a locked screen, and every
// announced moment is wired where the co-pilot already says "ללוח הכסף".
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const app = read('site/sale/app.js');
const html = read('site/sale/index.html');
const shell = read('site/sale/css/shell.css');
const panels = read('site/sale/css/panels.css');

function fnBody(name, src = app) {
    const a = src.indexOf(`function ${name}(`);
    assert.ok(a > -1, `${name} is missing`);
    const b = src.indexOf('\n}\n', a);
    return src.slice(a, b + 3);
}
function slice(from, to, src = app) {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a + 1);
    assert.ok(a > -1 && b > a, `${from} … ${to} moved or was renamed`);
    return src.slice(a, b);
}

// ── The rail module, run against a fake app ─────────────────────────────────
// A DOM of two buttons that start hidden, as the markup ships them.
function fakeDoc() {
    const mk = (id) => {
        const classes = new Set();
        return { id, hidden: true, checked: false, classes,
            classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c) } };
    };
    const els = { 'tab-money': mk('tab-money'), 'tab-pro': mk('tab-pro'), 'set-rail-all': mk('set-rail-all') };
    return { els, getElementById: (id) => els[id] || null };
}
function load(over = {}) {
    const src = fnBody('moneyEnabled') + fnBody('moneyDocsEnabled')
        + slice('const RAIL_STAGED = [', '// How many clients are due');
    const calls = { toast: [], persisted: 0, stats: 0 };
    const ctx = vm.createContext(Object.assign({
        Date, Number, Math, Boolean, Array, Object, String, console, calls,
        setTimeout: (fn) => { fn(); },
        appState: { settings: {} },
        projectsList: [], invoicesList: [],
        userTier: { tier: 'free' },
        isAdmin: () => false,
        isJob: (p) => !!p && p.kind !== 'ask',
        isSampleProject: (p) => !!(p && p.sample === true),
        persistSettings: () => { calls.persisted++; },
        renderStatistics: () => { calls.stats++; },
        showToast: (m) => { calls.toast.push(m); },
        window: { matchMedia: () => ({ matches: false }) },
        document: fakeDoc(),
    }, over));
    vm.runInContext(src, ctx);
    return ctx;
}
const job = (o) => Object.assign({ id: 'p' + Math.random().toString(36).slice(2, 7), kind: 'job', status: 'טיוטה', name: 'x' }, o);

// ── 1. The first visit ──────────────────────────────────────────────────────
test('first-visit markup: כסף and תזרים start hidden, and the PRO button says what it does', () => {
    assert.match(html, /<button class="nav-btn" id="tab-money" onclick="switchTab\('money'\)" hidden>/, '#tab-money ships hidden');
    assert.match(html, /<button class="nav-btn" id="tab-pro" onclick="switchTab\('pro'\)" title="PRO — תזרים מזומנים" hidden>/, '#tab-pro ships hidden, title kept');
    const pro = slice('id="tab-pro"', '</button>', html);
    assert.ok(pro.includes('<span>תזרים</span>'), 'a tab says what you do in it, not what it costs');
    assert.ok(!pro.includes('<span>PRO</span>'));
    // The three that are always there are not hidden.
    for (const id of ['tab-home', 'tab-projects', 'tab-clients']) {
        const btn = html.slice(html.indexOf(`id="${id}"`), html.indexOf('>', html.indexOf(`id="${id}"`)));
        assert.ok(!/\bhidden\b/.test(btn), `${id} is on the first-visit rail`);
    }
    // Not a grey lock: no rule dims a locked rail button.
    assert.doesNotMatch(shell, /\.nav-btn\.is-locked|\.nav-btn\.locked/, 'no grey-locked variant exists');
    // panels.css already enforces [hidden]; the design's .nav-btn[hidden] "fix" was verified unnecessary and must not exist.
    assert.match(panels, /^\[hidden\] \{ display: none !important; \}/m, 'the global [hidden] rule is what hides the buttons');
    assert.doesNotMatch(shell, /\.nav-btn\[hidden\]/, 'no duplicate .nav-btn[hidden] rule');
});

test('the settings row "הצג את כל הלשוניות מההתחלה" exists next to the guide switch and drives settings.railAll', () => {
    assert.match(html, /<input type="checkbox" id="set-rail-all" onchange="setRailAll\(this\.checked\)">/);
    assert.ok(html.includes('הצג את כל הלשוניות מההתחלה'));
    const guideRow = html.indexOf('id="set-guide-on"');
    const railRow = html.indexOf('id="set-rail-all"');
    assert.ok(railRow > guideRow && railRow - guideRow < 1500, 'the two rows sit together');
    const ctx = load();
    ctx.setRailAll(true);
    assert.equal(ctx.appState.settings.railAll, true);
    assert.equal(ctx.document.els['tab-money'].hidden, false, 'the checkbox reveals כסף at once');
    assert.equal(ctx.document.els['set-rail-all'].checked, true, 'and the checkbox mirrors the setting');
    assert.ok(ctx.calls.persisted >= 1);
});

// ── 2. The unlock rule ──────────────────────────────────────────────────────
test('railStage("money"): drafts alone do not open it; a real quote that left does; the sample never does', () => {
    let ctx = load({ projectsList: [job({}), job({ status: 'טיוטה', guide: { done: [true, true, false] } })] });
    assert.equal(ctx.railStage('money'), false, 'a draft-only account has no money to show');

    ctx = load({ projectsList: [job({ sample: true, status: 'נשלח', guide: { sentAt: 1 } })] });
    assert.equal(ctx.railStage('money'), false, 'the sample job never counts');

    ctx = load({ projectsList: [job({ guide: { sentAt: 1700000000000 } })] });
    assert.equal(ctx.railStage('money'), true, 'a sent quote');

    ctx = load({ projectsList: [job({ quoteOutAt: 1700000000000 })] });
    assert.equal(ctx.railStage('money'), true, 'a PDF that came down / a copied link is a quote the board can hold');

    ctx = load({ projectsList: [job({ status: 'הושלם' })] });
    assert.equal(ctx.railStage('money'), true, 'a status he moved past טיוטה himself');

    ctx = load({ projectsList: [job({ kind: 'ask', status: 'נשלח' })] });
    assert.equal(ctx.railStage('money'), false, 'a question is not a job');

    ctx = load({ invoicesList: [{ id: 'i1' }] });
    assert.equal(ctx.railStage('money'), true, 'an invoice is money');
});

test('railStage("money") is sticky through railSeen, opened by railAll, and always on for the admin', () => {
    let ctx = load({ appState: { settings: { railSeen: { money: 1700000000000 } } } });
    assert.equal(ctx.railStage('money'), true, 'seen once: stays even after every sent job is deleted');

    ctx = load({ appState: { settings: { railAll: true } } });
    assert.equal(ctx.railStage('money'), true, '"show everything" opens כסף');

    ctx = load({ isAdmin: () => true });
    assert.equal(ctx.railStage('money'), true, 'the owner sees everything, always');

    // Stav's veto: moneyEnabled() false re-hides the tab for everyone but him,
    // whatever the data says — the unlock rule reads it first.
    ctx = load({ appState: { settings: { railAll: true, railSeen: { money: 1 } } }, projectsList: [job({ guide: { sentAt: 1 } })] });
    vm.runInContext('function moneyEnabled() { return false; }', ctx);
    assert.equal(ctx.railStage('money'), false, 'the veto wins over railAll, railSeen and the data');
    assert.equal(fnBody('moneyEnabled').includes('return true;'), true, 'today the board is open to everyone');
    assert.match(fnBody('moneyDocsEnabled'), /return isAdmin\(\);/, 'documents stay the owner\'s');
});

test('railStage("pro") is the tier alone: pro and business, never railAll, always the admin', () => {
    for (const tier of ['guest', 'free', 'silver', 'gold', '']) {
        const ctx = load({ userTier: { tier }, appState: { settings: { railAll: true } } });
        assert.equal(ctx.railStage('pro'), false, `${tier || 'no tier'}: no button that opens a locked screen, even with "show everything"`);
    }
    for (const tier of ['pro', 'business']) {
        assert.equal(load({ userTier: { tier } }).railStage('pro'), true, tier);
    }
    assert.equal(load({ isAdmin: () => true }).railStage('pro'), true);
    // The same predicate finance.js uses at its gate.
    const fin = read('site/sale/finance.js');
    const gate = fin.slice(fin.indexOf('function hasProAccess()'), fin.indexOf('\n    }\n', fin.indexOf('function hasProAccess()')));
    assert.match(gate, /tier === 'pro' \|\| tier === 'business'/);
    assert.match(fnBody('proTierActive'), /t === 'pro' \|\| t === 'business'/);
});

// ── 3. Reveal: silent vs announced, and monotonic ───────────────────────────
test('a silent reveal un-hides with no dot and stamps railSeen; an announced one adds the dot and the arrival', () => {
    const ctx = load({ projectsList: [job({ guide: { sentAt: 1 } })] });
    const btn = ctx.document.els['tab-money'];
    assert.equal(ctx.railReveal('money', { announce: false }), true);
    assert.equal(btn.hidden, false);
    assert.ok(!btn.classes.has('rail-new'), 'init: nothing to notice');
    assert.ok(!btn.classes.has('rail-in'));
    assert.ok(ctx.appState.settings.railSeen.money > 0, 'discovered at init: never a dot for it later');
    assert.equal(ctx.railReveal('money', { announce: true }), false, 'already visible: a second reveal is a no-op');

    const ctx2 = load({ projectsList: [job({ guide: { sentAt: 1 } })] });
    const btn2 = ctx2.document.els['tab-money'];
    assert.equal(ctx2.railReveal('money', { announce: true }), true);
    assert.equal(btn2.hidden, false);
    assert.ok(btn2.classes.has('rail-new'), 'the dot');
    assert.ok(!btn2.classes.has('rail-in'), 'the arrival class is removed after the animation (setTimeout ran synchronously here)');
    assert.equal(ctx2.appState.settings.railSeen.money, undefined, 'the dot stays until he opens the tab');
    assert.deepEqual(ctx2.calls.toast, [], 'desktop: no toast');
    ctx2.railMarkSeen('money');
    assert.ok(!btn2.classes.has('rail-new'));
    assert.ok(ctx2.appState.settings.railSeen.money > 0, 'first visit stamps railSeen');
});

test('on a phone the announced reveal also says it in a toast, because the card may be scrolled away', () => {
    const ctx = load({ projectsList: [job({ guide: { sentAt: 1 } })], window: { matchMedia: (q) => ({ matches: q === '(max-width: 768px)' }) } });
    ctx.railReveal('money', { announce: true });
    assert.deepEqual(ctx.calls.toast, ['נפתח לך "כסף" בסרגל']);
});

test('syncRailStages never hides: monotonic by construction', () => {
    const ctx = load({ projectsList: [job({ guide: { sentAt: 1 } })] });
    ctx.syncRailStages();
    assert.equal(ctx.document.els['tab-money'].hidden, false);
    assert.equal(ctx.document.els['tab-pro'].hidden, true, 'free: no תזרים');
    ctx.projectsList.length = 0;
    ctx.syncRailStages();
    assert.equal(ctx.document.els['tab-money'].hidden, false, 'deleting the sent job does not take the tab back');
    assert.doesNotMatch(fnBody('syncRailStages'), /hidden = true/, 'no code path hides a rail button');
    ctx.userTier.tier = 'pro';
    ctx.syncRailStages();
    assert.equal(ctx.document.els['tab-pro'].hidden, false, 'the tier arrived: תזרים appears silently');
    assert.ok(!ctx.document.els['tab-pro'].classes.has('rail-new'), 'he bought it, he knows');
});

// ── 4. The sync points, in the real source ──────────────────────────────────
test('syncRailStages runs in initUserSession after loadProjects and before the first switchTab', () => {
    const init = fnBody('initUserSession');
    const a = init.indexOf('loadProjects();');
    const b = init.indexOf('syncRailStages()');
    const c = init.indexOf('switchTab(');
    assert.ok(a > -1 && b > a && c > b, 'loadProjects → syncRailStages → switchTab, in that order');
    assert.ok(!/await/.test(init.slice(a, c)), 'nothing asynchronous between the load and the sync: the first frame is complete');
    // loadProjects is where invoicesList is filled, so the invoice rule sees the data.
    assert.match(fnBody('loadProjects'), /invoicesList = JSON\.parse/);
    // The three entry paths all show the container and then call initUserSession synchronously.
    const shown = (app.match(/\.app-container'\)\.style\.display = 'flex';\s*\n\s*initUserSession\(\);/g) || []).length;
    assert.ok(shown >= 2, `the container is shown immediately before initUserSession (${shown} paths)`);
    assert.match(fnBody('proceedAsGuest'), /initUserSession\(\);/, 'a guest enters through the same door');
    // The other sync points: cloud merge, tier, status changes, approval landing.
    assert.match(fnBody('applyDatabaseObject'), /syncRailStages\(\)/, 'after a cloud merge on a new device');
    assert.match(fnBody('applyTierGates'), /syncRailStages\(\)/, 'when the tier arrives');
    assert.match(fnBody('pipelineAdvance'), /syncRailStages\(\)/);
    assert.match(fnBody('setProjectStatus'), /syncRailStages\(\)/);
    assert.match(fnBody('refreshApprovals'), /saveProjects\(\);\s*\n\s*try \{ syncRailStages\(\); \} catch \(e\) \{\}/, 'the approval landing path');
});

test('the door rule: switchTab("money") reveals the button before the screen paints, and the first click clears the dot', () => {
    const st = fnBody('switchTab');
    const alias = st.indexOf("else if (tabId === 'finance') { tabId = 'pro'; }");
    const door = st.indexOf("if (tabId === 'money' && railStage('money')) railReveal('money', { announce: false });");
    const paint = st.indexOf('.content-panel');
    assert.ok(alias > -1 && door > alias && door < paint, 'after the alias block, before any panel is touched');
    assert.ok(!st.includes("railReveal('pro'"), 'PRO has no door rule: its button never opens a locked screen');
    assert.match(st, /if \(targetTabBtn && targetTabBtn\.classList\.contains\('rail-new'\)\) railMarkSeen\(tabId\);/);
    // Deep links keep working: the money panel exists and switchTab null-guards a hidden button.
    assert.ok(html.includes('id="panel-money"'));
});

// ── 5. The announced moments ────────────────────────────────────────────────
test('guideQuoteSent announces (dot + card line + phone toast); guideQuoteOut announces quietly (no card line)', () => {
    const sent = fnBody('guideQuoteSent');
    const a = sent.indexOf('saveProjects();');
    const b = sent.indexOf("railReveal('money', { announce: true })");
    assert.ok(a > -1 && b > a, 'right after the save');
    assert.match(sent, /typeof railStage === 'function' && railStage\('money'\)/, 'guarded by the unlock rule');
    const out = fnBody('guideQuoteOut');
    assert.match(out, /^function guideQuoteOut\(\) \{\n\s*if \(typeof railStage === 'function' && railStage\('money'\)\) railReveal\('money', \{ announce: true \}\);/, 'first line of guideQuoteOut');

    const card = fnBody('_guideSentCardHtml');
    assert.ok(card.includes('מעכשיו יש "כסף" בסרגל — כל הצעה שיצאה יושבת שם עד שהיא משולמת.'), 'the card line');
    const firstPush = card.indexOf('next.push(');
    assert.ok(card.slice(firstPush, firstPush + 120).includes('מעכשיו יש "כסף" בסרגל'), 'it is the FIRST item, under the headline');
    // The folded row: "מה עכשיו?" and, beside it, the door to the board.
    assert.match(card, /onclick="expandGuideSentCard\(\)">מה עכשיו\?<\/button>`\s*\n\s*\+ \(boardOpen \? `<button type="button" class="gc-more" onclick="switchTab\('money'\)">ללוח הכסף<\/button>` : ''\)/);
    // The step-3 "הגיע ללקוח?" card is untouched: one question.
    const outCard = slice("ההצעה יצאה", 'function _guideSentCardHtml');
    assert.ok(!outCard.includes('מעכשיו יש "כסף"'), 'no rail line on the card that asks whether it reached the customer');
});

test('the sample project never triggers a reveal, and never counts toward the guide-off hint', () => {
    assert.match(fnBody('moneyReached'), /isJob\(p\) && !isSampleProject\(p\)/);
    assert.match(fnBody('guideSentCount'), /isJob\(p\) && !isSampleProject\(p\)/);
});

// ── 6. Money: board for everyone, documents for the owner ───────────────────
test('moneyDocsEnabled gates the documents sub-tab, the accounting alias and the receipt button', () => {
    const smv = fnBody('setMoneyView');
    assert.match(smv, /docsTab\.hidden = !moneyDocsEnabled\(\)/);
    assert.match(smv, /if \(!moneyDocsEnabled\(\) && view === 'docs'\) view = 'board';/, 'a deep link to docs lands on the board');
    assert.ok(html.includes('id="money-subtab-docs"'), 'the docs sub-tab has the id the gate uses');
    assert.match(fnBody('switchTab'), /tabId === 'accounting'\) \{ tabId = 'money'; subView = moneyDocsEnabled\(\) \? 'docs' : 'board'; \}/);
    const board = slice('function renderStatistics()', 'const PIPE_STATE');
    assert.match(board, /c\.key === 'paid' && moneyDocsEnabled\(\) && !projectHasReceipt\(p\)/, 'no "צור קבלה" door to a screen he cannot enter');
    assert.match(fnBody('pipelineAdvance'), /to === 'paid' && moneyDocsEnabled\(\) && !projectHasReceipt\(p\)/, 'nor a toast pointing at it');
    // The "בקרוב" card is now dead code kept as the veto path: still reachable only through moneyEnabled().
    assert.match(smv, /if \(!moneyEnabled\(\)\) \{/);
});

// ── 7. The phone ────────────────────────────────────────────────────────────
test('inside a job the phone bar is בית · עבודות · 1 · 2 · 3 · avatar — the steps replace the destinations and בית survives', () => {
    const mobile = shell.slice(shell.indexOf('@media (max-width: 768px)'));
    assert.match(mobile, /body\.in-project \.nav-menu \.nav-btn:not\(\.mobile-core\):not\(#tab-home\) \{ display: none; \}/);
    // The rule's terms match the markup: home is not .mobile-core (so it needs the exception), the five core are.
    assert.match(html, /<button class="nav-btn" id="tab-home"/, 'בית is not .mobile-core — the :not(#tab-home) is what keeps it');
    for (const id of ['tab-projects', 'tab-wizard', 'tab-pricing', 'tab-create']) {
        assert.match(html, new RegExp(`class="nav-btn mobile-core[^"]*" id="${id}"`), `${id} is .mobile-core`);
    }
    for (const id of ['tab-clients', 'tab-money', 'tab-pro']) {
        assert.doesNotMatch(html, new RegExp(`class="nav-btn[^"]*mobile-core[^"]*" id="${id}"`), `${id} yields to the steps inside a job`);
    }
    // body.in-project is the class the app already uses for "inside a job".
    assert.match(app, /document\.body\.classList\.toggle\('in-project', !!proj\);/);
    assert.doesNotMatch(shell, /the bar never holds more than five/, 'the stale comment is gone');
});

test('the arrival: a dot in the badge geometry, a 240ms slide, none under reduced motion', () => {
    assert.match(shell, /\.nav-btn\.rail-new::after \{[^}]*border-radius: 50%;[^}]*background: var\(--accent\);/);
    assert.match(shell, /@keyframes rail-in/);
    assert.match(shell, /\.nav-btn\.rail-in \{ animation: rail-in \.24s ease-out; \}/);
    assert.match(shell, /@media \(prefers-reduced-motion: reduce\) \{ \.nav-btn\.rail-in \{ animation: none; \} \}/);
    assert.match(fnBody('railReveal'), /setTimeout\(\(\) => btn\.classList\.remove\('rail-in'\), 400\)/);
});

// ── 8. The one pitch ────────────────────────────────────────────────────────
test('the PRO invitation: offered after the first שולם on a non-paying account, one bordered line, gone for good on ×', () => {
    const adv = fnBody('pipelineAdvance');
    assert.match(adv, /if \(to === 'paid'\) \{\s*\n\s*const s = _railSettings\(\);\s*\n\s*if \(!proTierActive\(\) && !s\.proInviteDismissed && !s\.proInviteOffer\) \{ s\.proInviteOffer = true; persistSettings\(\); \}/);
    const ctx = load();
    assert.equal(ctx.proInviteHtml(), '', 'nothing before the first שולם');
    ctx.appState.settings.proInviteOffer = true;
    const line = ctx.proInviteHtml();
    assert.ok(line.includes('רוצה לראות את זה מול חשבון הבנק? זה בתזרים של PRO.'));
    assert.match(line, /onclick="openPlansDialog\(\)">להשוואת מסלולים</);
    assert.match(line, /onclick="dismissProInvite\(\)"/);
    ctx.dismissProInvite();
    assert.ok(ctx.appState.settings.proInviteDismissed > 0, 'the flag persists');
    assert.equal(ctx.proInviteHtml(), '', 'dismissed: never again');
    assert.equal(ctx.calls.stats, 1, 're-rendered on dismiss');
    const paid = load({ userTier: { tier: 'pro' }, appState: { settings: { proInviteOffer: true } } });
    assert.equal(paid.proInviteHtml(), '', 'a payer is not pitched');
    // It rides at the top of the summary, and is not a modal or a toast.
    const board = slice('function renderStatistics()', 'const PIPE_STATE');
    assert.match(board, /const headHtml = proInviteHtml\(\) \+ `/);
    assert.doesNotMatch(fnBody('proInviteHtml'), /showToast|modal/i);
    assert.match(panels, /\.pipe-invite \{\s*\n\s*grid-column: 1 \/ -1;/);
    assert.doesNotMatch(slice('.pipe-invite {', '.pipe-invite > span', panels), /background:/, 'no colour fill');
});

// ── 9. The home line as a door ──────────────────────────────────────────────
test('the home pipeline line is a door to the board only with money in flight and a tab to land on', () => {
    const meter = fnBody('renderPipelineMeter');
    assert.match(meter, /if \(sum > 0 && boardOpen\) \{/);
    assert.match(meter, /class="home-pipeline-btn" onclick="switchTab\('money'\)"/);
    assert.match(meter, /'צבר הצעות פעילות: ₪0 — שלח הצעה ראשונה'/, 'a ₪0 line stays plain text');
    assert.match(panels, /\.home-pipeline-btn \{ all: unset; cursor: pointer; color: var\(--accent\); \}/);
});
