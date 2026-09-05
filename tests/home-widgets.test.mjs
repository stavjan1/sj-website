// The home's answers to "what now" (Wave C, Stav 4.9.2026): the resume card,
// the pipeline meter, the approval refresh, the checkup offer on a finished
// job, and the sample project. Each is a small rule with a large consequence —
// a wrong "continue" button sends him to the wrong screen, a wrong sum tells
// him money he does not have, a refresh without a throttle is a poll — so
// each branch is pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readApp } from './_app-source.mjs';

const app = readApp();
const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// The home-widgets block of app.js, run against a fake app: the helpers it
// leans on are stubbed to their real meaning, and everything that touches
// the DOM or the network is a counter.
function load(over = {}) {
    const start = app.indexOf('function isSampleProject');
    const end = app.indexOf('function openRecentProject(');
    assert.ok(start > -1 && end > start, 'the home-widgets block moved or was renamed');
    const store = new Map();
    const calls = { fetch: [], save: 0, filter: 0, toast: [] };
    const ctx = vm.createContext(Object.assign({
        Date, Number, Math, Boolean, Promise, Object, Array, String, RegExp, console,
        calls, store,
        projectsList: [],
        isJob: (p) => !!p && p.kind !== 'ask',
        isStaleDraft: () => false,
        projectLastActivity: (p) => Number(p.touched) || 0,
        draftPreview: (p) => p.name,
        escapeHtml: (s) => String(s),
        projectAmount: (p) => Number(p.quoteData && p.quoteData.finalPrice) || 0,
        getStorageKey: (k) => 'u:' + k,
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => { store.set(k, String(v)); },
        },
        saveProjects: () => { calls.save++; },
        filterProjectsList: () => { calls.filter++; },
        renderStatistics: () => {},
        showToast: (m) => { calls.toast.push(m); },
        fetchQuoteApproval: async (p) => { calls.fetch.push(p.id); return null; },
        applyQuoteApproval: () => false,
        maintFollowProject: () => true,
        document: { getElementById: () => null },
    }, over));
    vm.runInContext(app.slice(start, end), ctx);
    return ctx;
}

const job = (o) => Object.assign({ id: 'p' + Math.random().toString(36).slice(2, 7), kind: 'job', status: 'טיוטה', touched: 1 }, o);
const MIN = 60 * 1000;

// ── Resume card ─────────────────────────────────────────────────────────────

test('the resume card picks the open job touched last, and nothing when nothing is open', () => {
    const { resumeCandidate } = load();
    const older = job({ id: 'a', status: 'טיוטה', touched: 100 });
    const newer = job({ id: 'b', status: 'נשלח', touched: 200 });
    assert.equal(resumeCandidate([older, newer]).id, 'b', 'most recently touched wins');
    assert.equal(resumeCandidate([newer, older]).id, 'b', 'order in the list does not matter');
    assert.equal(resumeCandidate([]), null);
    assert.equal(resumeCandidate([job({ status: 'שולם' })]), null, 'paid is not open');
    assert.equal(resumeCandidate([job({ status: 'הושלם' })]), null, 'done is the customer\'s money, not his next step');
    assert.equal(resumeCandidate([job({ closedAs: 'lost' })]), null, 'a closed job left the board');
    assert.equal(resumeCandidate([job({ kind: 'ask' })]), null, 'a question is not work');
});

test('a draft that went stale is not offered as "continue"', () => {
    const { resumeCandidate } = load({ isStaleDraft: (p) => p.id === 'stale' });
    const stale = job({ id: 'stale', touched: 900 });
    const live = job({ id: 'live', touched: 100 });
    assert.equal(resumeCandidate([stale, live]).id, 'live');
});

test('"continue" lands on the step he left: the guide first, else the stage read off the project', () => {
    const { resumeTabFor } = load();
    // The other cluster's guide remembers the exact step; it wins when present.
    assert.equal(resumeTabFor(job({ guide: { step: 'pricing' } })), 'pricing');
    assert.equal(resumeTabFor(job({ guide: { step: 'draft' } })), 'create', 'stage aliases map to tabs');
    assert.equal(resumeTabFor(job({ guide: { step: 'plan' } })), 'wizard');
    assert.equal(resumeTabFor(job({ guide: { step: 'nonsense' }, status: 'נשלח' })), 'create', 'an unknown step falls through to the inference');
    // Without a guide: sent → the quote; priced → the table; nothing yet → the conversation.
    assert.equal(resumeTabFor(job({ status: 'נשלח' })), 'create');
    assert.equal(resumeTabFor(job({ materials: [{ name: 'x', price: 40 }] })), 'pricing');
    assert.equal(resumeTabFor(job({ laborPrice: 500 })), 'pricing');
    assert.equal(resumeTabFor(job({ quoteData: { finalPrice: 1200 } })), 'create', 'a quote that already has a total is on the quote screen');
    assert.equal(resumeTabFor(job({})), 'wizard');
    assert.equal(resumeTabFor(job({ materials: [{ name: 'x', price: 0 }] })), 'wizard', 'an unpriced list is not a price');
});

test('the resume label is "client — job", or just the job when nobody is attached', () => {
    const { resumeLabel } = load();
    assert.equal(resumeLabel(job({ name: 'עמדת טעינה', quoteData: { clientName: 'דנה כהן' } })), 'דנה כהן — עמדת טעינה');
    assert.equal(resumeLabel(job({ name: 'עמדת טעינה', quoteData: { clientName: '' } })), 'עמדת טעינה');
    assert.equal(resumeLabel(job({ name: 'עמדת טעינה' })), 'עמדת טעינה');
});

// ── Pipeline meter ──────────────────────────────────────────────────────────

test('the pipeline sums sent quotes only — not drafts, approved, paid, closed, sample or questions', () => {
    const { pipelineSum } = load();
    const q = (o) => job(Object.assign({ status: 'נשלח', quoteData: { finalPrice: 1000 } }, o));
    assert.equal(pipelineSum([q({}), q({})]), 2000);
    assert.equal(pipelineSum([q({ sample: true })]), 0, 'a demo is not money');
    assert.equal(pipelineSum([q({ approvedAt: 123 })]), 0, 'approved has moved on from "waiting"');
    assert.equal(pipelineSum([q({ status: 'שולם' })]), 0);
    assert.equal(pipelineSum([q({ status: 'הושלם' })]), 0);
    assert.equal(pipelineSum([q({ status: 'טיוטה' })]), 0, 'a draft was never sent');
    assert.equal(pipelineSum([q({ closedAs: 'lost' })]), 0);
    assert.equal(pipelineSum([q({ kind: 'ask' })]), 0);
    assert.equal(pipelineSum([]), 0);
});

// ── Approval refresh ────────────────────────────────────────────────────────

test('a project is due for an approval check only with a token, unapproved, open, and not within ten minutes of the last check', () => {
    const ctx = load();
    const { approvalRefreshDue, approvalCheckKey, store } = ctx;
    const now = 10_000_000;
    const sent = job({ id: 's', status: 'נשלח', shareToken: 'abcdefghij' });
    assert.equal(approvalRefreshDue(sent, now), true);
    assert.equal(approvalRefreshDue(job({ status: 'נשלח' }), now), false, 'no token, nothing to ask');
    assert.equal(approvalRefreshDue(job({ status: 'נשלח', shareToken: 't', approvedAt: 5 }), now), false, 'already approved');
    assert.equal(approvalRefreshDue(job({ status: 'שולם', shareToken: 't' }), now), false, 'paid is over');
    assert.equal(approvalRefreshDue(job({ status: 'נשלח', shareToken: 't', sample: true }), now), false);
    assert.equal(approvalRefreshDue(job({ status: 'נשלח', shareToken: 't', closedAs: 'lost' }), now), false);
    // The throttle: nine minutes ago is too soon, ten is due.
    store.set(approvalCheckKey('s'), String(now - 9 * MIN));
    assert.equal(approvalRefreshDue(sent, now), false, 'checked nine minutes ago');
    store.set(approvalCheckKey('s'), String(now - 10 * MIN));
    assert.equal(approvalRefreshDue(sent, now), true, 'ten minutes is the window');
});

test('refreshApprovals fetches each due project once, stamps the time first, and never fetches without a token', async () => {
    const ctx = load();
    const { calls } = ctx;
    ctx.projectsList.push(
        job({ id: 'with', status: 'נשלח', shareToken: 'abcdefghij' }),
        job({ id: 'without', status: 'נשלח' }),
        job({ id: 'draft-with', status: 'טיוטה', shareToken: 'klmnopqrst' }),
    );
    ctx.refreshApprovals();
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls.fetch.sort(), ['draft-with', 'with'], 'only the projects with a link are asked');
    // A second render a moment later must not ask again.
    ctx.refreshApprovals();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(calls.fetch.length, 2, 'the same render cycle fetched twice — that is a poll');
    assert.equal(calls.save, 0, 'nothing changed, nothing to save');
});

test('a newly seen approval saves and repaints; a fetch failure is silent', async () => {
    const ctx = load({
        fetchQuoteApproval: async (p) => { if (p.id === 'bad') throw new Error('offline'); return { at: 1, name: 'דנה' }; },
        applyQuoteApproval: (p, a) => { if (!a) return false; p.approvedAt = a.at; return true; },
    });
    ctx.projectsList.push(
        job({ id: 'ok', status: 'נשלח', shareToken: 'abcdefghij' }),
        job({ id: 'bad', status: 'נשלח', shareToken: 'klmnopqrst' }),
    );
    ctx.refreshApprovals();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(ctx.projectsList[0].approvedAt, 1);
    assert.equal(ctx.calls.save, 1);
    assert.equal(ctx.calls.filter, 1);
});

test('the approval stamp is applied once and the toast fires once (market.js)', () => {
    const start = app.indexOf('function applyQuoteApproval');
    const end = app.indexOf('\n}\n', start) + 3;
    assert.ok(start > -1, 'applyQuoteApproval moved');
    const toasts = [];
    const ctx = vm.createContext({ Date, Number, showToast: (m) => toasts.push(m) });
    vm.runInContext(app.slice(start, end), ctx);
    const p = { quoteData: { clientName: 'ישראל ישראלי' } };
    assert.equal(ctx.applyQuoteApproval(p, null), false);
    assert.equal(ctx.applyQuoteApproval(p, { at: 7, name: '' }), true);
    assert.equal(p.approvedAt, 7);
    assert.deepEqual(toasts, ['הלקוח ישראל ישראלי אישר את ההצעה!']);
    assert.equal(ctx.applyQuoteApproval(p, { at: 7, name: '' }), false, 'a second sighting changes nothing');
    assert.equal(toasts.length, 1, 'the toast must not repeat on every refresh');
});

// ── Completed → periodic checkup ────────────────────────────────────────────

test('a charger and a panel come back for inspection; a socket in a flat does not', () => {
    const { checkupIntervalFor } = load();
    const typed = (jobType, answers) => job({ spec: { jobType, answers: answers || {} } });
    assert.equal(checkupIntervalFor(typed('charger')), 12);
    assert.equal(checkupIntervalFor(typed('panel')), 24);
    assert.equal(checkupIntervalFor(typed('solar')), 12);
    assert.equal(checkupIntervalFor(typed('points')), 0, 'sockets in a flat are not a periodic inspection');
    assert.equal(checkupIntervalFor(typed('points', { property_type: { value: 'עסק/משרד' } })), 12, 'a business installation is');
    assert.equal(checkupIntervalFor(typed('fault', { property_type: { value: 'עסק/משרד' } })), 0, 'a fault call is not an installation');
    assert.equal(checkupIntervalFor(job({ name: 'חיבור גנרטור לבניין', spec: { jobType: 'infra', answers: {} } })), 12);
    assert.equal(checkupIntervalFor(job({})), 0, 'no type, no offer');
});

test('the offer appears on a finished job only, once, and not when it is already followed or declined', () => {
    const { checkupPromptFor, checkupPromptHtml } = load();
    const charger = (o) => job(Object.assign({ status: 'הושלם', spec: { jobType: 'charger', answers: {} }, quoteData: { clientName: 'ישראל ישראלי' } }, o));
    assert.equal(checkupPromptFor(charger({})), 12);
    assert.equal(checkupPromptFor(charger({ status: 'נשלח' })), 0, 'not done yet');
    assert.equal(checkupPromptFor(charger({ status: 'שולם' })), 0);
    assert.equal(checkupPromptFor(charger({ checkupDeclined: true })), 0, '"לא עכשיו" is remembered');
    assert.equal(checkupPromptFor(charger({ maintenance: { next: '2027-09-05', months: 12 } })), 0, 'already on the list');
    assert.equal(checkupPromptFor(charger({ spec: { jobType: 'points', answers: {} } })), 0);
    const html = checkupPromptHtml(charger({}));
    assert.ok(html.includes('ישראל ישראלי') && html.includes('בעוד שנה'), 'the offer names the client and the interval');
    assert.ok(html.includes('acceptCheckupFollow(') && html.includes('declineCheckupFollow('), 'two answers, both wired');
    assert.equal(checkupPromptHtml(charger({ status: 'טיוטה' })), '');
});

test('"כן" goes through the periodic-service save path in checkups.js, with the job-type interval', () => {
    const followed = [];
    const ctx = load({ maintFollowProject: (id, months) => { followed.push([id, months]); return true; } });
    ctx.projectsList.push(job({ id: 'c1', status: 'הושלם', spec: { jobType: 'panel', answers: {} } }));
    ctx.acceptCheckupFollow('c1');
    assert.deepEqual(followed, [['c1', 24]]);
    ctx.declineCheckupFollow('c1');
    assert.equal(ctx.projectsList[0].checkupDeclined, true);
    assert.equal(ctx.calls.save, 1, 'declining is remembered on the project');
    // The helper itself writes the same record maintSave writes.
    const ck = read('site/sale/checkups.js');
    assert.ok(/function maintFollowProject\(projectId, months\)/.test(ck), 'the public helper lives in checkups.js');
    const body = ck.slice(ck.indexOf('function maintFollowProject'), ck.indexOf('function maintStop'));
    for (const key of ['months', 'next', 'repeats', 'leadDays', 'eventId']) {
        assert.ok(body.includes(key + ':'), `the follow record is missing ${key} — it no longer matches maintSave`);
    }
    assert.ok(body.includes("proj.kind = 'maintenance'"), 'a followed job is a maintenance job, as maintSave makes it');
});

test('marking a job done reveals the offer from every status path, and the list render refreshes approvals', () => {
    for (const fn of ['function cycleProjectStatus(', 'function setProjectStatus(']) {
        const i = app.indexOf(fn);
        assert.ok(i > -1, fn + ' moved');
        const body = app.slice(i, app.indexOf('\n}\n', i));
        assert.ok(body.includes('revealCheckupOffer(proj)'), fn + ' does not surface the checkup offer');
    }
    const adv = app.slice(app.indexOf('function pipelineAdvance('), app.indexOf('function projectHasReceipt('));
    assert.ok(adv.includes("to === 'executed') revealCheckupOffer(p)"), 'the board drop into בוצע does not surface the offer');
    assert.ok(/^function revealCheckupOffer\(proj\)/m.test(app), 'the reveal helper exists');
    const list = app.slice(app.indexOf('function filterProjectsList()'), app.indexOf('function projectClient('));
    assert.ok(list.includes('refreshApprovals()'), 'the projects list render does not refresh approvals');
    const home = app.slice(app.indexOf('function renderHome()'), app.indexOf('function isSampleProject'));
    assert.ok(home.includes('refreshApprovals()'), 'the home render does not refresh approvals');
});

// ── Sample project ──────────────────────────────────────────────────────────

test('sample-project.json parses and has the shape createNewProject builds', () => {
    const p = JSON.parse(read('site/sale/data/sample-project.json'));
    assert.equal(p.sample, true, 'the flag that keeps it out of every sum');
    assert.equal(p.kind, 'job');
    assert.equal(p.status, 'טיוטה');
    assert.equal(p.stage, 'pricing', 'it opens at stage 2 — the materials');
    for (const key of ['name', 'autoName', 'planChatHistory', 'chatHistory', 'materials', 'laborPrice', 'quoteData', 'spec']) {
        assert.ok(key in p, `missing project key: ${key}`);
    }
    for (const key of ['clientName', 'clientSub', 'quoteNumber', 'date', 'subject', 'items', 'basePrice', 'vatType', 'finalPrice', 'summary', 'showItemizedPrices', 'customerType']) {
        assert.ok(key in p.quoteData, `missing quoteData key: ${key}`);
    }
    assert.equal(p.quoteData.clientName, 'ישראל ישראלי');
    assert.equal(p.clientPhone, '050-0000000', 'a fake phone, never a real one');
    assert.ok(['private', 'business'].includes(p.quoteData.customerType));
    assert.equal(p.consumablesPct, 5, 'the consumables line Wave B added');
    assert.equal(p.spec.jobType, 'charger');
    assert.ok(Object.keys(p.spec.answers).length >= 8, 'a specified job, not an empty card');
    for (const a of Object.values(p.spec.answers)) {
        assert.ok('value' in a && 'source' in a && 'skipped' in a, 'spec answers carry {value, source, skipped}');
    }
    assert.ok(p.materials.length >= 6, 'a real materials list');
    for (const m of p.materials) {
        assert.ok(m.name && Number(m.price) > 0 && Number(m.qty) > 0 && m.checked === true, `an unpriced or unticked line: ${m.name}`);
    }
    const laborSum = p.laborItems.reduce((s, r) => s + r.price, 0);
    assert.equal(laborSum, p.laborPrice, 'laborPrice is the sum of the labour lines, as laborItems() keeps it');
});

test('the empty projects state offers the sample, and the loader is defined and guards the sums', () => {
    const ck = read('site/sale/checkups.js');
    const empty = ck.slice(ck.indexOf('projects-empty'), ck.indexOf('לא נמצאו פרויקטים התואמים'));
    assert.ok(empty.includes('onclick="loadSampleProject()"'), 'the button on the empty state');
    assert.ok(empty.includes('טען פרויקט לדוגמה'), 'says what it loads');
    assert.ok(/^async function loadSampleProject\(\)/m.test(app), 'the handler exists');
    assert.ok(app.includes("fetch('data/sample-project.json'"), 'it loads the file, not a copy of it');
    // Both places money is added up leave the sample out.
    const metrics = app.slice(app.indexOf('function updateMetricsDashboard'), app.indexOf('function cycleProjectStatus'));
    assert.ok(metrics.includes('isSampleProject'), 'the stats count the sample');
    const board = app.slice(app.indexOf('function renderStatistics()'), app.indexOf('const PIPE_STATE'));
    assert.ok(board.includes('isSampleProject'), 'the money board counts the sample');
});

test('the home markup has a slot for each widget, and the projects card shows the approval badge', () => {
    const html = read('site/sale/index.html');
    assert.ok(html.includes('id="home-resume"'), 'resume card slot');
    assert.ok(html.includes('id="home-pipeline"'), 'pipeline meter slot');
    const badge = app.slice(app.indexOf('function approvedBadgeHtml'), app.indexOf('function renderResumeCard'));
    assert.ok(badge.includes('הלקוח אישר 🎉'));
    for (const fn of ['renderProjectsList', 'renderStatistics', 'renderResumeCard']) {
        const i = app.indexOf('function ' + fn + '(');
        assert.ok(i > -1 && app.slice(i, i + 12000).includes('approvedBadgeHtml(p)'), `${fn} does not show the approval badge`);
    }
});
