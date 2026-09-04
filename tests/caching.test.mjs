// The caching contract in _headers (Stav, 4.9.2026): a URL with ?v= never
// changes, so versioned scripts and stylesheets cache for a year, immutable —
// and everything fetched by bare name keeps revalidating. The contract holds
// only while both halves stay true, and each half fails quietly on its own:
// an immutable file referenced without a version is a file a returning visitor
// keeps for a year after it changed; a page that stops being no-cache is a
// deploy that never arrives. These tests read _headers the way Cloudflare
// does (every matching rule applies, the last one wins) and check both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// CRLF normalised: a Windows checkout (autocrlf) puts \r before every \n.
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const IMMUTABLE = 'public, max-age=31536000, immutable';

// _headers → [{ path, headers: [[name, value]] }], comments and blanks dropped.
function parseHeaders() {
    const rules = [];
    let current = null;
    for (const raw of read('_headers').split('\n')) {
        const line = raw.replace(/\s+$/, '');
        if (!line || /^\s*#/.test(line)) continue;
        if (!/^\s/.test(line)) { current = { path: line, headers: [] }; rules.push(current); continue; }
        const m = line.trim().match(/^(!?)([^:]+?)(?::\s*(.*))?$/);
        if (m && current) current.headers.push([m[2].trim(), m[1] ? null : (m[3] || '')]);
    }
    return rules;
}

// Cloudflare's wildcard: `*` matches any run of characters, slashes included.
function matches(pattern, path) {
    const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return re.test(path);
}

const RULES = parseHeaders();

// Cloudflare applies every matching rule in file order; for one header name
// the last match wins. Returns the value, or undefined when no rule sets it.
function cacheControlFor(path) {
    let value;
    for (const rule of RULES) {
        if (!matches(rule.path, path)) continue;
        for (const [name, v] of rule.headers) if (name === 'Cache-Control') value = v;
    }
    return value;
}

const TRACKED = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

test('_headers: the specific no-cache rules come after the broad immutable ones', () => {
    // Order is the whole mechanism. An immutable rule placed after a no-cache
    // rule for the same path silently wins, and a page becomes a year-old page.
    const lastImmutable = RULES.map((r, i) => (r.headers.some(([, v]) => v === IMMUTABLE) ? i : -1)).filter((i) => i >= 0).pop();
    const firstNoCache = RULES.findIndex((r) => r.headers.some(([, v]) => v === 'no-cache'));
    assert.ok(lastImmutable >= 0, 'no immutable rule at all — the contract is gone');
    assert.ok(firstNoCache > lastImmutable, 'a no-cache rule sits above an immutable rule; the last match wins, so the page would cache for a year');
});

test('every path _headers marks immutable is referenced with ?v= (or ?p=) wherever it appears', () => {
    // Every src=/href=/fetch() reference in tracked HTML and JS, resolved
    // against the file that makes it, checked against the rule it would hit.
    // sale/sw.js and thing/sw.js are exempt on purpose: their precache lists
    // are bare names by design (the worker matches them with ignoreSearch).
    const scanned = TRACKED.filter((f) => /\.(html|js|mjs)$/.test(f) && !/(^|\/)sw\.js$/.test(f) && !f.includes('/vendor/'));
    const bare = [];
    for (const file of scanned) {
        const src = read(file);
        const dir = posix.dirname('/' + file);
        const refs = [
            ...src.matchAll(/(?:src|href)=["']([^"'\s>]+)["']/g),
            ...src.matchAll(/fetch\(\s*["']([^"'\s]+)["']/g),
        ].map((m) => m[1]);
        for (const ref of refs) {
            if (/^(?:https?:)?\/\/|^(?:data|mailto|tel|blob):|^[#?]|\$\{|^\.\.\.$|^\+|\+\s*$/.test(ref)) continue;
            const [pathPart, query = ''] = ref.split('?');
            if (!pathPart) continue;
            const abs = posix.normalize(pathPart.startsWith('/') ? pathPart : posix.join(dir, pathPart));
            if (cacheControlFor(abs) !== IMMUTABLE) continue;
            if (/(^|&)[vp]=\d+/.test(query)) continue;
            bare.push(`${file}: ${ref} → ${abs}`);
        }
    }
    assert.deepEqual(bare, [], `immutable but referenced without a version:\n  ${bare.join('\n  ')}`);
});

test('every tracked page, every page route, both workers and the manifest stay no-cache', () => {
    const pages = TRACKED.filter((f) => f.endsWith('.html') && !f.startsWith('partials/') && !f.startsWith('docs/'));
    assert.ok(pages.length > 10, 'the page list is suspiciously short');
    for (const page of pages) {
        assert.equal(cacheControlFor('/' + page), 'no-cache', `/${page} is not no-cache`);
        if (page.endsWith('/index.html')) {
            const route = '/' + page.slice(0, -'index.html'.length);
            assert.equal(cacheControlFor(route), 'no-cache', `${route} (the route to ${page}) is not no-cache`);
        }
    }
    assert.equal(cacheControlFor('/'), 'no-cache');
    for (const f of ['/sale/sw.js', '/thing/sw.js', '/sale/manifest.webmanifest', '/sale/data/sj-prices.core.json', '/sale/data/sj-prices.json', '/sale/stern-pricing.json', '/assets/team/stav.jpg']) {
        assert.equal(cacheControlFor(f), 'no-cache', `${f} is not no-cache`);
    }
});

test('versioned scripts and stylesheets are immutable; bare-name images are not', () => {
    for (const f of ['/app.js', '/assistant.js', '/track.js', '/reserve.js', '/styles.css', '/assets/tokens.css', '/assets/ui.css', '/assets/listcards.js', '/assets/checkups-core.js', '/sale/app.js', '/sale/finance.js', '/sale/css/quote-templates.css', '/sale/controlroom.css', '/thing/thing.js']) {
        assert.equal(cacheControlFor(f), IMMUTABLE, `${f} is not immutable`);
    }
    // An image is addressed by its bare filename, so a year would be a year of
    // the old logo. A day, then a revalidation.
    for (const f of ['/assets/logo.png', '/assets/hero_powerlines.webp', '/assets/og-image.jpg', '/sale/icons/icon-192.png']) {
        const cc = cacheControlFor(f);
        assert.ok(cc && !cc.includes('immutable') && /max-age=86400/.test(cc), `${f}: ${cc}`);
    }
});

test('the paper faces leave the <head> and load once, before any PDF is captured', () => {
    // David Libre, Frank Ruhl Libre and Gveret Levin are drawn only on the
    // sheet and the route sketch; every other visit paid for them.
    const head = read('sale/index.html').split('</head>')[0];
    for (const family of ['David+Libre', 'Frank+Ruhl+Libre', 'Gveret+Levin']) {
        assert.ok(!head.includes(family), `${family} is still in the sale <head>`);
    }
    const app = read('sale/app.js');
    assert.match(app, /^function ensurePdfFonts\(\)/m, 'ensurePdfFonts is gone');
    const href = app.match(/PDF_FONTS_HREF = '([^']+)'/);
    assert.ok(href, 'the lazy font URL is gone');
    for (const family of ['David+Libre', 'Frank+Ruhl+Libre', 'Gveret+Levin+AlefAlefAlef', 'display=swap']) {
        assert.ok(href[1].includes(family), `${family} is not in the lazy font URL`);
    }

    // html2canvas paints whatever face is on screen at that moment: the wait
    // has to come before the capture, in both export paths.
    const body = (src, fn) => {
        const i = src.indexOf(fn);
        assert.ok(i >= 0, `${fn} is gone`);
        return src.slice(i, src.indexOf('\n}\n', i));
    };
    for (const [file, fn] of [['sale/app.js', 'async function downloadPDF()'], ['sale/reports.js', 'async function downloadReportPDF()']]) {
        const fnBody = body(read(file), fn);
        const wait = fnBody.indexOf('await ensurePdfFonts()');
        const capture = fnBody.indexOf('html2pdf().set(');
        assert.ok(wait >= 0, `${file}: ${fn} never waits for the paper faces`);
        assert.ok(capture > wait, `${file}: ${fn} captures before the faces are in`);
    }
    // The screens that draw them on the page ask for them as they open.
    assert.match(body(app, 'function switchTab(tabId, opts)'), /ensurePdfFonts\(\)/, 'the editor and pricing tabs no longer load the faces');
    assert.match(body(app, 'function updatePdfCustomStyles()'), /ensurePdfFonts\(\)/, 'a serif font choice no longer loads its face');
});

test('the marketing pages agree on one trimmed font link', () => {
    // Heebo was only ever a fallback behind Assistant in every stack, and
    // Rubik 500 was never used on a root page: three families and ten weights
    // became two and six. One URL, so a page never drifts to its own list.
    const pages = TRACKED.filter((f) => f.endsWith('.html') && !f.includes('/'));
    const links = new Set();
    for (const page of pages) {
        const m = read(page).match(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/);
        if (m) links.add(m[1]);
    }
    assert.equal(links.size, 1, `root pages load ${links.size} different font lists: ${[...links].join(' | ')}`);
    const url = [...links][0];
    assert.ok(!url.includes('Heebo'), 'Heebo is back on the marketing pages');
    assert.ok(url.includes('display=swap'), 'display=swap is gone');
});
