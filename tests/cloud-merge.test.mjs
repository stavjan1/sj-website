// Two devices, one account. The cloud blob is written whole, so before the
// union below, device A holding 5 projects simply overwrote device B's 6 and the
// sixth was gone with nothing said. The existing guards only caught a collection
// going to ZERO, which is the total-loss case, not this one.
//
// The union is only safe because deletion leaves a tombstone: deleteProject
// moves the project into `trash` rather than dropping it. These pin both halves
// — nothing is lost, and nothing deleted comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The merge block runs inside the PUT handler; lift it out and run it directly
// rather than mocking a whole Pages Function context.
const SRC = readFileSync(new URL('../functions/api/data.js', import.meta.url), 'utf8');

function mergeInto(incoming, existing) {
    // Locate the block by single-line markers — an embedded newline in a
    // JS string literal here has already broken this file once.
    const start = SRC.indexOf('const trashIds = new Set(');
    assert.ok(start > -1, 'the union-by-id block moved or was removed');
    const open = SRC.lastIndexOf('if (existing) {', start);
    const stop = SRC.indexOf('// New-user detection', start);
    assert.ok(open > -1 && stop > start, 'could not bound the union block');
    const block = SRC.slice(open, stop);
    const fn = new Function('incoming', 'existing', block + ' return incoming;');
    return fn(incoming, existing);
}

const proj = (id) => ({ id, name: 'job ' + id });

test('a project the saving device never saw is kept, not overwritten away', () => {
    // Device A still holds 5; device B added #6 an hour ago on the phone.
    const incoming = { projects: [proj(1), proj(2), proj(3), proj(4), proj(5)], trash: [] };
    const existing = { projects: [proj(1), proj(2), proj(3), proj(4), proj(5), proj(6)] };
    const out = mergeInto(incoming, existing);
    assert.deepEqual(out.projects.map((p) => p.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6],
        'the job created on the other device was overwritten away');
});

test('a deleted project stays deleted', () => {
    // The tombstone is the whole reason the union is safe. Without this, every
    // sync would resurrect whatever the other device had just thrown out.
    const incoming = { projects: [proj(1), proj(2)], trash: [{ id: 3, _deletedAt: 'now' }] };
    const existing = { projects: [proj(1), proj(2), proj(3)] };
    const out = mergeInto(incoming, existing);
    assert.deepEqual(out.projects.map((p) => p.id), [1, 2], 'a deleted project came back');
});

test('the saving device keeps its own edits to a project both devices have', () => {
    const incoming = { projects: [{ id: 1, name: 'renamed here' }], trash: [] };
    const existing = { projects: [{ id: 1, name: 'old name' }] };
    const out = mergeInto(incoming, existing);
    assert.equal(out.projects.length, 1, 'the same project was duplicated');
    assert.equal(out.projects[0].name, 'renamed here', 'the cloud copy overwrote a fresh local edit');
});

test('clients and invoices get the same protection, and untouched shapes are left alone', () => {
    const incoming = { projects: [], clients: [{ id: 'c1' }], invoices: [{ id: 'i1' }], trash: [] };
    const existing = { projects: [], clients: [{ id: 'c1' }, { id: 'c2' }], invoices: [{ id: 'i1' }, { id: 'i2' }] };
    const out = mergeInto(incoming, existing);
    assert.deepEqual(out.clients.map((c) => c.id), ['c1', 'c2']);
    assert.deepEqual(out.invoices.map((i) => i.id), ['i1', 'i2']);
});

test('an entry with no id is never duplicated in', () => {
    // Legacy rows without ids cannot be matched, so they must be left to the
    // existing empty-collection guards rather than blindly appended forever.
    const incoming = { projects: [proj(1)], trash: [] };
    const existing = { projects: [proj(1), { name: 'no id here' }] };
    const out = mergeInto(incoming, existing);
    assert.equal(out.projects.length, 1, 'an id-less row was appended on every sync');
});
