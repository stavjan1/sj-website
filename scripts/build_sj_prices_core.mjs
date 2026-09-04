// Cut the pricing agent's slice out of the full SJ price book.
//
// sale/data/sj-prices.json is the whole catalogue — ~3,000 rows, 685 KB — and
// the app fetched all of it at boot even though the agent's prompt only ever
// reads the starter strip and the chase curve (getSjPriceBlock in sale/app.js).
// The catalogue VIEW still needs every row, and market.js loads the full file
// lazily when that tab opens; the boot path needs only this.
//
// Same shape as the full file (version, decisions, groups, subs) so the same
// reader works on both, rows filtered to starter === true or basis === 'chase'.
// tests/sj-prices.test.mjs fails if this mirror drifts from its source.
//
//   node scripts/build_sj_prices_core.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('site/sale/data/sj-prices.json', ROOT);
const OUT = new URL('site/sale/data/sj-prices.core.json', ROOT);

export function coreOf(book) {
    return {
        version: book.version,
        decisions: book.decisions,
        groups: book.groups,
        subs: book.subs,
        rows: (book.rows || []).filter((r) => r.starter === true || r.basis === 'chase'),
    };
}

const book = JSON.parse(readFileSync(SRC, 'utf8'));
const core = coreOf(book);
writeFileSync(OUT, JSON.stringify(core) + '\n');
console.log(`sj-prices.core.json: ${core.rows.length} of ${book.rows.length} rows, ${JSON.stringify(core).length} bytes`);
