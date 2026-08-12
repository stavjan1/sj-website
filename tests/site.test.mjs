// Structural guards on the site itself. Every one of these encodes a bug that
// actually shipped: a canonical pointing at a redirect, a JSON-LD block broken
// by an unescaped quote, pages left on stale asset versions after a merge, and
// a service worker precaching a shell that no longer matched the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('every JSON-LD block parses', () => {
    // A single unescaped quote inside מע"מ silently invalidated a whole FAQPage
    // once. Structured data fails quietly — nothing on the page looks wrong.
    for (const page of [...PAGES, 'ask/index.html', 'zerem/index.html']) {
        const text = read(page);
        for (const m of text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
            assert.doesNotThrow(() => JSON.parse(m[1]), `${page}: JSON-LD does not parse`);
        }
    }
});

test('declared URLs point at what the server serves', () => {
    // Cloudflare Pages serves /about and 308-redirects /about.html. A canonical
    // naming the redirecting form sends every crawler through a hop.
    const offenders = [];
    for (const page of PAGES) {
        const text = read(page);
        for (const m of text.matchAll(/(?:rel="canonical" href|property="og:url" content)="([^"]*)"/g)) {
            if (/sj-eng\.co\.il\/[a-z-]+\.html/.test(m[1])) offenders.push(`${page}: ${m[1]}`);
        }
    }
    assert.deepEqual(offenders, [], 'declared URLs still name the .html form');

    const sitemap = read('sitemap.xml');
    const stale = [...sitemap.matchAll(/<loc>([^<]*\.html)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(stale, [], 'sitemap still lists .html URLs');
});

test('every indexable page declares a canonical', () => {
    for (const page of PAGES) {
        if (['404.html', 'login.html', 'thanks.html'].includes(page)) continue;
        assert.match(read(page), /rel="canonical"/, `${page}: no canonical`);
    }
});

test('all pages agree on one asset version', () => {
    // A cherry-pick once left pages on v=1, v=43 and v=44 while the CSS and JS
    // behind them had moved on — returning visitors got a stale app.
    const versions = new Set();
    for (const page of [...PAGES, 'ask/index.html', 'zerem/index.html', 'sale/index.html', 'q/index.html']) {
        if (!existsSync(join(ROOT, page))) continue;
        for (const m of read(page).matchAll(/\?v=(\d+)/g)) versions.add(m[1]);
    }
    assert.equal(versions.size, 1, `pages reference ${versions.size} asset versions: ${[...versions].join(', ')}`);
});

test('the offline shell contains every script the app loads', () => {
    // coverage.js and sketch.js became load-bearing after the shell list was
    // written; offline, the app opened without its checklists.
    const sw = read('sale/sw.js');
    const html = read('sale/index.html');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)]
        .map((m) => m[1].split('?')[0])
        .filter((src) => !src.startsWith('http'));

    for (const src of scripts) {
        // The analytics beacon is deliberately not cached: caching a fire-and-
        // forget POST script buys nothing, and track.js is built to fail
        // silently when the network is gone.
        if (src.includes('track.js')) continue;
        const path = src.startsWith('/') ? src
            : src.startsWith('../') ? '/' + src.slice(3)
            : '/sale/' + src;
        assert.ok(sw.includes(`'${path}'`), `service worker does not precache ${path}`);
    }
});

test('the service worker never caches API calls', () => {
    const sw = read('sale/sw.js');
    assert.match(sw, /pathname\.startsWith\('\/api\/'\)/, 'no /api/ bypass — AI replies could be served from cache');
    assert.match(sw, /request\.method !== 'GET'/, 'writes are not excluded from the cache');
});

test('robots.txt invites the AI crawlers and keeps the app out', () => {
    const robots = read('robots.txt');
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
        assert.ok(robots.includes(bot), `robots.txt does not mention ${bot}`);
    }
    assert.match(robots, /Disallow: \/sale\//, 'the app is not disallowed');
    assert.match(robots, /Sitemap: /, 'no sitemap declared');
});

test('the pricing map keeps its scope rule', () => {
    const map = read('functions/api/_pricing_map.js');
    assert.ok(map.includes('לעולם אל תצטק') || map.includes('לעולם אל תצטט'),
        'the "never quote an inspector fee without its installation" rule is gone');
});

test('the fonts and icons survive a deploy and a dead network', () => {
    // At a job site there is no reception to fetch a typeface with. Without
    // these cached the app is blank squares, and a quote drafted on site
    // prints in a different font than one drafted at home.
    const sw = read('sale/sw.js');

    for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com']) {
        assert.ok(sw.includes(host), `${host} is no longer cached — offline loses its assets`);
    }

    // Replaying a stale Google auth script would be worse than not having it.
    for (const host of ['accounts.google.com', 'apis.google.com']) {
        assert.ok(!new RegExp(`CDN_HOSTS[^\]]*${host.replace('.', '\.')}`, 's').test(sw),
            `${host} must not be cache-first — auth has to be live`);
    }

    // The shell cache is wiped on every deploy. If the CDN cache shares that
    // fate, the fonts vanish right after an update — exactly when there is no
    // reception to re-fetch them.
    const activate = sw.slice(sw.indexOf("addEventListener('activate'"));
    const body = activate.slice(0, activate.indexOf('\n});'));
    assert.ok(/k !== CACHE && k !== CDN_CACHE/.test(body),
        'the activate handler evicts the CDN cache on every deploy');

    // A plain <link rel=stylesheet> to another origin yields an opaque
    // response: status 0, ok false. Filtering on res.ok alone would cache
    // nothing at all and the whole branch would be dead code.
    assert.ok(/res\.type === 'opaque'/.test(sw),
        'opaque CDN responses are rejected, so the icon CSS would never cache');
});

test('the local snapshots have a door, and restoring is all-or-nothing', () => {
    const app = read('sale/app.js');
    const html = read('sale/index.html');

    // The snapshots were correct and complete and reachable only by typing
    // sjDataRecovery.restore(0) into a browser console — no use to an
    // electrician whose jobs just vanished.
    assert.ok(/onclick="toggleRecoveryPanel\(\)"/.test(html),
        'nothing in the UI opens the recovery panel');
    assert.ok(html.includes('id="recovery-panel"'), 'the recovery panel is gone');
    assert.ok(/function renderRecoveryPanel/.test(app), 'renderRecoveryPanel is gone');

    // Written key by key, a quota error partway leaves the snapshot's projects
    // beside the damaged history — a state that never existed.
    const restore = app.slice(app.indexOf('restore: function'));
    const body = restore.slice(0, restore.indexOf('\n    }'));
    assert.ok(/const previous = writes\.map/.test(body),
        'restore no longer captures the previous state, so it cannot roll back');
    assert.ok(/catch \(e2\)/.test(body),
        'the rollback is unguarded — if it throws, the failure is silent');

    // Promising a safety backup that backupLocalSnapshot will skip is a lie
    // told at the worst possible moment.
    const confirmFn = app.slice(app.indexOf('function confirmRecoveryRestore'));
    const confirmBody = confirmFn.slice(0, confirmFn.indexOf('\n}'));
    assert.ok(/nothingToLose/.test(confirmBody),
        'the restore prompt promises a backup even when there is nothing to back up');
});

test('the customer-facing quote page cannot be broken out of', () => {
    // /q/ renders a quote shared from someone else's account — hostile data by
    // definition — and it has already shipped a stored XSS once: safeImg's
    // regex was anchored only at the start, so everything after
    // "data:image/png;" came back verbatim and escaped the src="..." attribute.
    //
    // Grepping for the regex would not have caught that; the mistake reads
    // fine. So run the real functions out of the page against the real attack.
    const html = read('q/index.html');
    const escSrc = html.match(/const esc = [^\n]+/);
    const imgSrc = html.match(/const safeImg = [^\n]+/);
    assert.ok(escSrc && imgSrc, 'esc/safeImg are gone from the quote page');
    const { esc, safeImg } = new Function(`${escSrc[0]}\n${imgSrc[0]}\nreturn { esc, safeImg };`)();

    const attacks = [
        '"><script>alert(1)</script>',
        "'><img src=x onerror=alert(1)>",
        '</div><svg onload=alert(1)>',
        'data:image/png;",onerror="alert(1)',              // the shape that shipped
        'data:image/png;base64,AAA" onerror="alert(1)',
        'javascript:alert(1)',
        'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
        'data:image/png;base64,AAA<script>',
    ];
    for (const a of attacks) {
        assert.ok(!/[<>"]/.test(esc(a)), `esc left markup intact: ${a}`);
        assert.equal(safeImg(a), '', `safeImg accepted a hostile src: ${a}`);
    }

    // ...and the guard has to stay narrow enough to be useful.
    for (const ok of [
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==',
        'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    ]) {
        assert.equal(safeImg(ok), ok, `safeImg rejected a legitimate logo: ${ok.slice(0, 30)}`);
    }

    // Dropping a value straight into the sheet is the whole bug class, so look
    // for exactly that: an interpolation whose entire body is a data read.
    // (Anything richer is a nested template a regex cannot honestly parse, so
    // this deliberately does not try.)
    const render = html.slice(html.indexOf('function render('));
    const body = render.slice(0, render.indexOf('\n        }'));
    const bare = [...body.matchAll(/\$\{\s*((?:q|it|biz)\.[\w.]+)\s*\}/g)].map((m) => m[1]);
    assert.deepEqual(bare, [], `value dropped into the quote sheet unescaped: ${bare.join(', ')}`);
});
