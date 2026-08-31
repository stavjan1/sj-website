// The line from the quote to the money. Stav, 30/08: "בפרויקט ילחצו 'הנפקת חשבון
// עסקה' זה אוטומטית ישנה סטטוס לביצוע וגם ינפיק על ידי הAPI שלו."
//
// The half that is easy to get wrong is the status. It must follow the DOCUMENT
// BEING CREATED, not the button being pressed — someone who opens the form and
// closes it has not billed anybody, and a board that marks jobs done on an
// intention is worse than one that never moves at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readApp } from './_app-source.mjs';

const app = readApp();

function load() {
    const start = app.indexOf('const ISSUE_STATUS_AFTER');
    const end = app.indexOf('// Jump from a project straight into the accounting create form');
    assert.ok(start > -1 && end > start, 'the issue-from-quote block moved or was renamed');
    const moved = [];
    const ctx = vm.createContext({
        projectsList: [{ id: 'p1', name: 'job', status: 'נשלח' }],
        activeProjectId: 'p1',
        invoicingAllowed: () => true,
        showUpgradeModal: (r) => { ctx.upgradeShown = r; },
        showToast: () => {},
        openAccountingForProject: (id, t) => { ctx.opened = [id, t]; },
        setProjectStatus: (id, st) => {
            moved.push([id, st]);
            const p = ctx.projectsList.find((x) => x.id === id);
            if (p) p.status = st;
        },
    });
    vm.runInContext(app.slice(start, end), ctx);
    ctx.moved = moved;
    return ctx;
}

test('opening the form arms the status but does not change it', () => {
    const c = load();
    c.issueDocFromQuote('DealInvoice');
    assert.deepEqual(c.opened, ['p1', 'DealInvoice'], 'the create form was not opened for this project');
    assert.equal(c.projectsList[0].status, 'נשלח',
        'the status moved when the form merely opened — closing it would leave a job wrongly billed');
});

test('the status moves when the document is actually created, once', () => {
    const c = load();
    c.issueDocFromQuote('DealInvoice');
    c.applyIssueStatusIfPending('p1');
    assert.equal(c.projectsList[0].status, 'הושלם');
    assert.equal(c.moved.length, 1);
    // And a second document must not move anything on its own.
    c.applyIssueStatusIfPending('p1');
    assert.equal(c.moved.length, 1, 'the intent was not disarmed — the next document would move the status again');
});

test('a receipt means money in, an invoice means the work is done', () => {
    const c = load();
    c.issueDocFromQuote('Receipt');
    c.applyIssueStatusIfPending('p1');
    assert.equal(c.projectsList[0].status, 'שולם', 'a receipt is money in hand and must say so');
});

test('a locked user is sold the plan and nothing moves', () => {
    const c = load();
    c.invoicingAllowed = () => false;
    c.issueDocFromQuote('Invoice');
    assert.equal(c.upgradeShown, 'invoicing');
    assert.equal(c.opened, undefined, 'the create form opened for someone who cannot issue');
    assert.equal(c.projectsList[0].status, 'נשלח');
});

test('every control that issues a document is on the quote screen and gated', () => {
    const html = readFileSync(new URL('../sale/index.html', import.meta.url), 'utf8');
    const calls = (html.match(/issueDocFromQuote\(/g) || []).length;
    assert.ok(calls >= 2, 'the issue buttons are gone from the quote screen');
    // PROJECT_RAIL_DOCS was declared for this and referenced from nowhere for
    // months. If it comes back, it must be used or removed — not left as a
    // constant that looks like a feature.
    const refs = (app.match(/PROJECT_RAIL_DOCS/g) || []).length;
    assert.ok(refs === 0 || refs > 1, 'PROJECT_RAIL_DOCS is declared and never used again');
});
