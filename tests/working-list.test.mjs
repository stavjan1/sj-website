// THE WORKING LIST. Stav, 30/08, standing in the shower listing his open jobs
// from memory because the app would not do it for him: "וואי כמה דברים אני מקווה
// שלא אשכח מישהו."
//
// The rules are small and the consequences are not — a job wrongly filtered out
// of this list is a job he forgets exists. These pin every branch.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readApp } from './_app-source.mjs';

const app = readApp().replace(/RNRE/g, 'RN');

function load() {
    const start = app.indexOf('const STALE_AFTER_MS');
    const end = app.indexOf('function ackStaleProject');
    assert.ok(start > -1 && end > start, 'the working-list model moved or was renamed');
    const ctx = vm.createContext({ Date, Number, Math, Boolean,
        isJob: (p) => !!p && p.kind !== 'ask' });
    vm.runInContext(app.slice(start, end), ctx);
    return ctx;
}

const DAY = 86400000;
const job = (o) => Object.assign({ id: 'x', kind: 'job', status: 'טיוטה' }, o);

test('an open job is on the list, and a paid one is not', () => {
    const { isWorkingProject } = load();
    assert.equal(isWorkingProject(job({})), true, 'a draft is open work');
    assert.equal(isWorkingProject(job({ status: 'נשלח' })), true, 'a sent quote is still open');
    assert.equal(isWorkingProject(job({ status: 'הושלם' })), true,
        'work that was done but not paid for is very much still open');
    assert.equal(isWorkingProject(job({ status: 'שולם' })), false, 'paid is finished');
});

test('a question is never on the work board, and a closed job leaves it', () => {
    const { isWorkingProject } = load();
    assert.equal(isWorkingProject(job({ kind: 'ask' })), false,
        'a question asked on the way to the van is not a job');
    assert.equal(isWorkingProject(job({ closedAs: 'done' })), false);
    assert.equal(isWorkingProject(job({ closedAs: 'lost' })), false);
    assert.equal(isWorkingProject(null), false);
});

test('waiting-on-client means the ball is with them, and only while open', () => {
    const { isWaitingOnClient } = load();
    assert.equal(isWaitingOnClient(job({ status: 'נשלח' })), true);
    assert.equal(isWaitingOnClient(job({ status: 'טיוטה' })), false, 'not sent yet — the ball is his');
    assert.equal(isWaitingOnClient(job({ status: 'הושלם' })), false);
    assert.equal(isWaitingOnClient(job({ status: 'נשלח', closedAs: 'lost' })), false,
        'a closed job must never reappear in the waiting rail');
});

test('a quote goes quiet after fourteen days, not before', () => {
    const { isStaleProject } = load();
    const now = Date.now();
    assert.equal(isStaleProject(job({ status: 'נשלח', quoteOutAt: now - 13 * DAY })), false);
    assert.equal(isStaleProject(job({ status: 'נשלח', quoteOutAt: now - 15 * DAY })), true);
    assert.equal(isStaleProject(job({ status: 'נשלח' })), false,
        'a quote that never went out cannot have gone quiet');
});

test('acknowledging silences THIS quote, and a new quote re-arms the alarm', () => {
    // staleAckAt is compared against quoteOutAt rather than just being a flag:
    // pressing "I know" must not mute the project forever. Send a new quote and
    // it has to be able to go quiet again.
    const { isStaleProject } = load();
    const now = Date.now();
    const sentAt = now - 20 * DAY;
    assert.equal(isStaleProject(job({ status: 'נשלח', quoteOutAt: sentAt })), true);
    assert.equal(isStaleProject(job({ status: 'נשלח', quoteOutAt: sentAt, staleAckAt: now - 1 * DAY })), false,
        'the acknowledgement did not silence it');
    assert.equal(isStaleProject(job({ status: 'נשלח', quoteOutAt: now - 16 * DAY, staleAckAt: now - 30 * DAY })), true,
        'an acknowledgement from BEFORE the quote went out must not mute the new one');
});

test('staleDays reports the age of the quote, and zero when it never went out', () => {
    const { staleDays } = load();
    assert.equal(staleDays(job({ quoteOutAt: Date.now() - 21 * DAY })), 21);
    assert.equal(staleDays(job({})), 0);
});
