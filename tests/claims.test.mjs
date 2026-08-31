// Guards on what the site claims about SJ's own credentials.
//
// These exist because the claims were wrong twice in one week, on live pages,
// under Stav's name — and משרד העבודה is actively enforcing exactly this. A
// title is not a wording choice: חשמלאי בודק is a licence under חוק החשמל, and
// מהנדס רשוי is a grade above מהנדס רשום. Stav is a registered engineer.
//
// The rule these encode: SJ may describe what it does, never a grade it does
// not hold. Third-party references — "תשלום לחשמלאי בודק", "נדרש מהנדס חשמל" —
// are accurate and deliberately allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PUBLIC_TEXT = [
    ...readdirSync(ROOT).filter((f) => f.endsWith('.html') || f === 'llms.txt'),
    'ask/index.html', 'zerem/index.html', 'sale/index.html',
    'functions/api/assistant.js', 'sale/coverage.js', 'functions/api/_pricing_map.js',
].map((rel) => ({ rel, text: readFileSync(join(ROOT, rel), 'utf8') }));

// Phrases that assert SJ *is* something. Each is a self-claim in any context.
const FORBIDDEN_SELF_CLAIMS = [
    'כבודק',                    // "as an inspector"
    'בודק מוסמך סוג',
    'בודק סוג 3',
    'מהנדס רשוי מוסמך',
    'רישיון מהנדס חשמל רשוי',
    'מהנדס חשמל רשוי ומורשה',
    'מובל ע"י מהנדס רשוי',
    'מהנדס חשמל מורשה',
    'בסמכות מהנדס מורשה',
];

// Citing where a price came from is not claiming the title: the pricing map
// carries "[מקור: בודק סוג 3]" to record that a type-3 inspector supplied a
// figure, which is exactly the sourcing that makes the number trustworthy.
const ATTRIBUTION = /\[מקור:[^\]]*$/;

test('the site never claims a licence SJ does not hold', () => {
    for (const { rel, text } of PUBLIC_TEXT) {
        for (const claim of FORBIDDEN_SELF_CLAIMS) {
            let from = 0;
            for (;;) {
                const at = text.indexOf(claim, from);
                if (at === -1) break;
                const before = text.slice(Math.max(0, at - 60), at);
                assert.ok(ATTRIBUTION.test(before),
                    `${rel} claims "${claim}" — SJ is a registered engineer, not a licensed one or an inspector`);
                from = at + claim.length;
            }
        }
    }
});

test('third-party references to an inspector are left intact', () => {
    // The opposite failure: over-scrubbing until the site stops mentioning that
    // an inspector is needed at all, which is useful, true, and sells the service.
    const blob = PUBLIC_TEXT.map((f) => f.text).join('\n');
    assert.ok(blob.includes('חשמלאי בודק'),
        'no mention of an inspector anywhere — the scrub went too far');
});

test('where SJ names its own standing, it is the one it holds', () => {
    const claiming = PUBLIC_TEXT.filter(({ text }) => /בסמכות מהנדס/.test(text));
    assert.ok(claiming.length > 0, 'no page states who stands behind the work');
    for (const { rel, text } of claiming) {
        for (const m of text.matchAll(/בסמכות מהנדס[^.<"\n]{0,60}/g)) {
            assert.match(m[0], /רשום בפנקס המהנדסים/,
                `${rel}: "${m[0].trim()}" — should be רשום בפנקס המהנדסים`);
        }
    }
});

test('words that merely share a root are not swept up', () => {
    // קבלן מורשה (asbestos), אתר מורשה (disposal), עוסק מורשה (VAT status) are
    // about other people and must survive any future sweep.
    const blob = PUBLIC_TEXT.map((f) => f.text).join('\n');
    for (const keep of ['קבלן מורשה', 'עוסק מורשה']) {
        assert.ok(blob.includes(keep), `"${keep}" disappeared — a sweep was too broad`);
    }
});
