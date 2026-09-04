// Stamps the shared header / footer / theme-bootstrap fragments into every
// marketing page under site/ (the web root).
//
// The site is static HTML with no build step, so the header was pasted into
// eleven pages by hand and the eleven copies drifted (a link added on one page
// and forgotten on the next). The single copy now lives in partials/, and each
// page carries a marked region:
//
//     <!-- partial:header -->            (optional: cta="index.html#contact")
//     ...stamped markup...
//     <!-- /partial:header -->
//
// Run `node scripts/stamp_partials.mjs` after editing a partial; it rewrites
// every region in place. tests/partials.test.mjs fails when a page's region
// differs from what this would produce, so a hand edit inside a region cannot
// survive a commit unnoticed.
//
// Per page it sets exactly what used to differ between the copies:
//   • aria-current="page" on the nav link that names the page — in the header
//     when the page is in the main nav, otherwise in the footer;
//   • the header's "שיחת ייעוץ" button target, from the cta="…" marker
//     attribute (default contact.html; the home and contact pages use their
//     own #contact anchor, the guide pages point back at the home anchor).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
export const PARTIALS = ['theme', 'header', 'footer'];
const CTA_DEFAULT = 'contact.html';

const nl = (s) => s.replace(/\r\n/g, '\n');
// Trailing newline stripped: the markers sit on their own lines around the block.
const readPartial = (name) => nl(readFileSync(join(ROOT, 'partials', name + '.html'), 'utf8')).replace(/\n+$/, '');

function markCurrent(html, page) {
    // The nav links are bare `<a href="x.html">`; the CTA button carries a
    // class after the href and is never the current page.
    return html.replace(`<a href="${page}">`, `<a href="${page}" aria-current="page">`);
}

// The markup for one partial on one page. `attrs` are the key="value" pairs on
// the opening marker.
export function render(name, page, attrs = {}) {
    let html = readPartial(name);
    if (name === 'header') {
        const cta = attrs.cta || CTA_DEFAULT;
        html = html.replace(
            '<a href="contact.html" class="btn btn-primary btn-sm">',
            `<a href="${cta}" class="btn btn-primary btn-sm">`);
        html = markCurrent(html, page);
    } else if (name === 'footer') {
        // Only one aria-current per page: the footer marks the page when the
        // header could not (privacy, accessibility, contact, the pricing guide).
        if (!readPartial('header').includes(`<a href="${page}">`)) html = markCurrent(html, page);
    }
    return html;
}

export function parseAttrs(s) {
    const attrs = {};
    for (const m of (s || '').matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
    return attrs;
}

// The page with every marked region re-rendered. Pure: LF in, LF out.
export function stamp(html, page) {
    let out = html;
    for (const name of PARTIALS) {
        const re = new RegExp(`(<!-- partial:${name}((?: [a-z-]+="[^"]*")*) -->)\\n[\\s\\S]*?\\n(\\s*<!-- /partial:${name} -->)`, 'g');
        out = out.replace(re, (_, open, attrStr, close) => `${open}\n${render(name, page, parseAttrs(attrStr))}\n${close}`);
    }
    return out;
}

export function pages() {
    return readdirSync(SITE).filter((f) => f.endsWith('.html'));
}

function main() {
    let changed = 0;
    for (const page of pages()) {
        const raw = readFileSync(join(SITE, page), 'utf8');
        const before = nl(raw);
        if (!before.includes('<!-- partial:')) continue;
        const after = stamp(before, basename(page));
        if (after === before) continue;
        // Keep whatever line ending the checkout uses (git autocrlf on Windows).
        writeFileSync(join(SITE, page), raw.includes('\r\n') ? after.replace(/\n/g, '\r\n') : after);
        changed++;
        console.log('stamped', page);
    }
    console.log(changed ? `${changed} page(s) rewritten` : 'every page already matches the partials');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
