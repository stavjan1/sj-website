// adminGate ALWAYS returns an object: { ok: true, email } or
// { ok: false, status, body, response }. It never returns null.
//
// So `if (gate) return gate;` — the shape most guards in most codebases use —
// is always true here, and returns a plain object where a Response belongs. The
// endpoint breaks for everybody, including the admin, and it breaks in a way
// that looks like a 500 rather than like a bad guard. I wrote exactly that on
// clarity.js before this test existed.
//
// The opposite slip is worse: `if (gate.error)` is always falsy, so the gate
// passes everyone and the endpoint is simply open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../functions/api/', import.meta.url);

test('every adminGate caller checks .ok, and none of them checks the object itself', () => {
    const bad = [];
    for (const f of readdirSync(DIR).filter((n) => n.endsWith('.js'))) {
        const src = readFileSync(new URL(f, DIR), 'utf8');
        const lines = src.split('\n');
        lines.forEach((line, i) => {
            if (!line.includes('adminGate(')) return;
            // Not the definition, not an import, and not a bare mention.
            if (line.includes('function adminGate')) return;
            if (line.trimStart().startsWith('import') || line.includes("from './_tiers.js'")) return;
            if (!line.includes('adminGate(request')) return;
            // The two lines after the call are where the check lives.
            // The call line itself counts too: `return (await adminGate(req)).ok`
            // is a correct inline use.
            const after = [line].concat(lines.slice(i + 1, i + 3)).join(' ');
            // `gate.ok`, `isAdmin = gate.ok`, or the inline `(await adminGate(r)).ok`.
            const checksOk = after.includes('gate.ok') || after.includes(').ok');
            if (!checksOk) bad.push(`${f}:${i + 1} — ${after.trim().slice(0, 60)}`);
        });
    }
    assert.deepEqual(bad, [],
        'an adminGate result is not being checked with .ok — the guard either breaks the endpoint or opens it');
});

test('the gate helper still returns an object on both paths', () => {
    // If adminGate is ever changed to return null on success, every caller above
    // inverts meaning silently. Pin the contract the callers depend on.
    const t = readFileSync(new URL('_tiers.js', DIR), 'utf8');
    const i = t.indexOf('export async function adminGate');
    const fn = t.slice(i, t.indexOf('\n}', i));
    assert.ok(fn.includes('ok: false'), 'adminGate no longer reports failure as { ok: false }');
    assert.ok(fn.includes('ok: true'), 'adminGate no longer reports success as { ok: true }');
    assert.ok(!/return null/.test(fn), 'adminGate can now return null — every caller check inverts');
});
