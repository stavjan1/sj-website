// The stale-drafts rule decides what disappears from the works list. Getting it
// wrong in the safe direction hides nothing; getting it wrong in the other
// direction hides a job someone is in the middle of. Both edges are pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(ROOT, 'sale/app.js'), 'utf8').replace(/\r\n/g, '\n');

// The helpers are plain functions over a project object; run them for real
// instead of pattern-matching the source.
function load(activeProjectId = null) {
    const start = app.indexOf('const STALE_DRAFT_DAYS');
    const end = app.indexOf('function staleDraftsHtml');
    assert.ok(start > -1 && end > start, 'the stale-draft helpers moved or were renamed');
    const ctx = vm.createContext({
        activeProjectId,
        getProjectStage: (p) => p.stage || 'planning',
    });
    vm.runInContext(app.slice(start, end), ctx);
    return ctx;
}

const DAY = 86400000;
const draft = (over) => ({
    id: 'd1', name: 'פרויקט חדש', status: 'טיוטה', stage: 'planning',
    materials: [], laborPrice: 0, quoteData: {}, touched: Date.now() - 9 * DAY, ...over,
});

test('a conversation that stopped a week ago is a stale draft', () => {
    const { isStaleDraft, projectIdleDays } = load();
    assert.equal(isStaleDraft(draft()), true);
    assert.equal(projectIdleDays(draft()), 9);
});

test('anything that looks like a decision keeps the work in the list', () => {
    const { isStaleDraft } = load();
    assert.equal(isStaleDraft(draft({ touched: Date.now() - 3 * DAY })), false, 'touched three days ago');
    assert.equal(isStaleDraft(draft({ materials: [{ name: 'מאמ"ת' }] })), false, 'has a materials list');
    assert.equal(isStaleDraft(draft({ laborPrice: 900 })), false, 'has a labor price');
    assert.equal(isStaleDraft(draft({ quoteData: { finalPrice: 3200 } })), false, 'has a quoted price');
    assert.equal(isStaleDraft(draft({ status: 'נשלח' })), false, 'was sent to a customer');
    assert.equal(isStaleDraft(draft({ stage: 'draft' })), false, 'reached the quote stage');
    assert.equal(isStaleDraft(draft({ clientId: 'cli1' })), false, 'is linked to a client');
});

test('the project you have open never leaves the list', () => {
    const { isStaleDraft } = load('d1');
    assert.equal(isStaleDraft(draft()), false);
});

test('a project written before `touched` existed falls back to its date', () => {
    const { isStaleDraft, projectLastActivity } = load();
    const legacy = draft({ touched: undefined, created: '2020-01-05' });
    assert.equal(isStaleDraft(legacy), true);
    assert.ok(projectLastActivity(legacy) > 0, 'a YYYY-MM-DD date should parse');
    // A backup can hand back a full ISO timestamp on the same field.
    assert.ok(projectLastActivity(draft({ touched: undefined, created: '2020-01-05T07:27:09.347Z' })) > 0);
});

test('an empty draft still reads as something on the shelf', () => {
    const { draftPreview } = load();
    assert.equal(draftPreview(draft({ planChatHistory: [
        { role: 'model', parts: [{ text: 'בוא נתכנן' }] },
        { role: 'user', parts: [{ text: 'הזזת נקודת מאור בסלון' }] },
    ] })), 'הזזת נקודת מאור בסלון');
    // No conversation at all: fall back to whatever the work is called.
    assert.equal(draftPreview(draft({ name: 'עבודה אצל דנה' })), 'עבודה אצל דנה');
});
