// The shared header, footer and theme bootstrap are stamped into the marketing
// pages from partials/ by scripts/stamp_partials.mjs. A page whose stamped
// region no longer matches what the stamper produces was edited by hand — the
// exact drift the partials exist to end — so it fails here, and the fix is to
// edit the partial and re-run the stamper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stamp, render, pages, PARTIALS } from '../scripts/stamp_partials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// Pages with the site header are the marketing pages; 404 / login / thanks
// stand on their own and are not stamped.
const STAMPED = pages().filter((p) => read(p).includes('<header class="site-header">'));

test('every partial exists and carries no per-page state', () => {
    for (const name of PARTIALS) {
        const p = join(ROOT, 'partials', name + '.html');
        assert.ok(existsSync(p), `partials/${name}.html is missing`);
        assert.ok(!read('partials/' + name + '.html').includes('aria-current'),
            `partials/${name}.html has aria-current baked in — the stamper sets it per page`);
    }
});

test('every marketing page is stamped, and its regions match the partials', () => {
    assert.ok(STAMPED.length >= 10, `only ${STAMPED.length} marketing pages found`);
    const stale = [];
    for (const page of STAMPED) {
        const html = read(page);
        for (const name of PARTIALS) {
            assert.ok(html.includes(`<!-- partial:${name}`) && html.includes(`<!-- /partial:${name} -->`),
                `${page} has no partial:${name} region — its copy of the ${name} is loose again`);
        }
        if (stamp(html, page) !== html) stale.push(page);
    }
    assert.deepEqual(stale, [],
        'these pages differ from the partials — edit partials/*.html and run `node scripts/stamp_partials.mjs`');
});

test('a page linked from the header or footer is marked current exactly once', () => {
    // The calculator is linked from neither, so it is marked nowhere; every
    // other page is named in one of the two and must be marked there only.
    const linked = (page) => (read('partials/header.html') + read('partials/footer.html')).includes(`<a href="${page}">`);
    for (const page of STAMPED) {
        const html = read(page);
        const n = (html.match(/aria-current="page"/g) || []).length;
        assert.equal(n, linked(page) ? 1 : 0, `${page}: ${n} links claim to be the current page`);
    }
});

test('the header marks the nav link and the footer only fills in for the rest', () => {
    assert.match(render('header', 'about.html'), /<a href="about.html" aria-current="page">אודות<\/a>/);
    assert.ok(!render('footer', 'about.html').includes('aria-current'), 'about is in the header, the footer must not repeat it');
    assert.match(render('footer', 'privacy.html'), /<a href="privacy.html" aria-current="page">/);
    assert.ok(!render('header', 'privacy.html').includes('aria-current'));
    // The CTA target is the one per-page knob the header has.
    assert.match(render('header', 'index.html', { cta: '#contact' }), /<a href="#contact" class="btn btn-primary btn-sm">/);
    assert.match(render('header', 'services.html'), /<a href="contact.html" class="btn btn-primary btn-sm">/);
});
