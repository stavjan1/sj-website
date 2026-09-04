// Structural guards on the site itself. Every one of these encodes a bug that
// actually shipped: a canonical pointing at a redirect, a JSON-LD block broken
// by an unescaped quote, pages left on stale asset versions after a merge, and
// a service worker precaching a shell that no longer matched the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
// Normalised: git checks out CRLF on Windows and LF on CI, and several of
// these tests slice on a newline-plus-brace boundary.
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

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
    // coverage.js became load-bearing after the shell list was written;
    // offline, the app opened without its checklists.
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
    const app = readApp();
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

test('a deploy actually reaches an installed service worker', () => {
    // "Network-first" is only as fresh as the fetch underneath it, and a plain
    // fetch() may still be answered from the browser's HTTP cache. Observed:
    // server at ?v=66, worker cache at ?v=65, page rendered ?v=65 — a whole
    // deploy behind. The HTML carries the ?v= for every other file, so one
    // stale page means the entire app is stale.
    const sw = read('sale/sw.js');
    assert.ok(/cache: 'reload'/.test(sw),
        'the shell fetch can be served from the HTTP cache, so a deploy may not arrive');
    assert.ok(/mode === 'navigate'/.test(sw),
        'navigations are not treated as shell requests');

    // The cache has to stay keyed on the original request or the offline
    // lookup below it stops finding anything.
    assert.ok(/c\.put\(e\.request, copy\)/.test(sw),
        'the cache is keyed on the rewritten request, breaking the offline fallback');
});

test('the first screen does not point in a direction', () => {
    // The empty state said "צור פרויקט חדש מימין" long after the box moved
    // above the list. It is seen once, by someone with nothing to compare it
    // to, so nobody ever reported it.
    const app = readApp();
    const fn = app.slice(app.indexOf('function renderProjectsList'));
    // Comments stripped: the one above the fix quotes the old wording, and a
    // test that cannot tell an explanation from a string is a test that
    // punishes writing things down.
    const body = fn.slice(0, fn.indexOf('\n    const cats')).replace(/\/\/.*$/gm, '');
    assert.ok(!/מימין|משמאל/.test(body),
        'the projects empty state points in a direction that can go stale');
    assert.ok(/startFirstProject\(\)/.test(body),
        'the empty state has no action, only a description');
});

test('rotating the web3forms key cannot half-happen', () => {
    // The key is public by design — web3forms puts it in a hidden input — so
    // its presence in a public repo is not the problem. The problem is that it
    // lives in FIVE places: two Functions that fall back to it, and three
    // static forms that hardcode it and never touch a Function.
    //
    // The comments say to rotate it and set WEB3FORMS_KEY. Do exactly that and
    // the Functions keep working while the three contact forms keep posting a
    // dead key — no error, no bounce, just leads quietly falling on the floor.
    // This fails loudly if a rotation only lands in some of them.
    const files = ['contact.html', 'index.html', 'zerem/index.html',
                   'functions/api/lead.js', 'functions/api/share-catalog.js'];
    const found = new Map();
    for (const f of files) {
        const text = read(f);
        for (const m of text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) {
            if (!found.has(m[0])) found.set(m[0], []);
            found.get(m[0]).push(f);
        }
    }
    assert.ok(found.size > 0, 'the web3forms key vanished from every known location');
    assert.equal(found.size, 1,
        'more than one web3forms key is live — a rotation landed in some files but not others: '
        + [...found].map(([k, fs]) => `${k.slice(0, 8)}… in ${fs.join(', ')}`).join(' | '));

    // And every one of the five still carries it, so a rotation cannot skip a file.
    const carriers = [...found.values()][0];
    for (const f of files) {
        assert.ok(carriers.includes(f), `${f} no longer carries the key — was a rotation missed here?`);
    }
});

test('an expired sign-in is not reported as a permission refusal', () => {
    // Stav pasted the Clarity token into his own admin panel and got
    // "אין הרשאה" — on his own account, on his own site. The token had simply
    // aged out (a Google access token lives an hour), and every admin endpoint
    // answered the two very different failures with one 403: "I cannot tell who
    // you are" and "I know who you are and it isn't you". The first is fixed by
    // signing in again; nothing on screen said so.
    const tiers = read('functions/api/_tiers.js');
    assert.match(tiers, /export async function adminGate/,
        'the shared admin gate is gone — the 401/403 split lived there');
    assert.match(tiers, /'auth-expired'/, 'the gate no longer distinguishes an expired sign-in');

    // No admin endpoint may go back to collapsing both cases into one 403.
    const dir = join(ROOT, 'functions/api');
    const offenders = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
        const text = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n');
        if (/!email\s*\|\|\s*email\.toLowerCase\(\)\s*!==\s*ADMIN_EMAIL/.test(text)) offenders.push(f);
    }
    assert.deepEqual(offenders, [],
        'these endpoints still answer an expired token with "אין הרשאה": ' + offenders.join(', '));
});

test('a stale Google token cannot block its own replacement', () => {
    // The deadlock: checkGoogleSession adopted the saved token without checking
    // whether it was still alive, and every refresh path bailed out early
    // whenever a token was present. So an expired token sat there forever,
    // the app kept showing "מחובר", and the server kept refusing it.
    const app = readApp();
    assert.match(app, /function _tokenIsFresh/,
        'freshness check is gone — the app is back to trusting any token it finds');
    assert.match(app, /savedToken && _tokenIsFresh\(savedToken\)/,
        'checkGoogleSession adopts the saved token again without checking it is alive');
    assert.match(app, /if \(isGuestUser\(\) \|\| _tokenIsFresh\(\) \|\| _idPromptPending\)/,
        'silentIdTokenAuth guards on presence again instead of freshness');
    // And an opaque access token (ya29…) has no readable expiry, so the mint
    // must write one down or freshness is unknowable for that shape.
    assert.match(app, /_rememberTokenExpiry\(Date\.now\(\) \+ \(parseInt\(resp\.expires_in/,
        'the access-token mint no longer records when the token dies');
});

test('the maintenance reminder is asked once and answered "never" without re-asking', () => {
    const html = read('sale/index.html');
    const app = readApp();

    // Stav specified this sentence word for word. It is the only place the app
    // tells you the choice is not final, so it must not drift.
    assert.ok(html.includes('בחר את מועד התזכורות הנוח לך, יהיה ניתן לשנות אותו בכל זמן דרך מסך ההגדרות'),
        'the reminder-timing copy changed — Stav dictated this sentence verbatim');

    // "בלי תזכורת מוקדמת" is a real answer. Gating the question on a non-empty
    // list would ask again on every maintenance project for anyone who chose it.
    assert.match(app, /function maintLeadsChosen\(\)[\s\S]{0,200}Array\.isArray\(appState\.settings\.maintenanceLeadDays\)/,
        'the "have we asked yet" check no longer tests for presence — "no reminder" would re-ask forever');

    // One global default, overridden per project only when it actually differs.
    assert.match(app, /function maintDefaultLeads/, 'the global reminder default is gone');
    assert.match(app, /chosen && chosen\.join\(','\) !== maintDefaultLeads\(\)\.join\(','\) \? chosen : null/,
        'a per-project override is stored even when it equals the global default');

    // And the settings screen must be able to change it, as the copy promises.
    assert.ok(html.includes('id="maint-setting-row"'),
        'the settings screen has no reminder-timing control, but the dialog tells the user to go there');
});

test('the calendar entry is the action, at the date you take it', () => {
    // The first attempt put an all-day note on the VISIT and tried to warn three
    // months ahead with a reminder override — which Google caps at 28 days, so
    // the long warning would have been dropped without a word. Stav described
    // what he actually wanted and it dissolves the problem: a one-hour block AT
    // the lead date ("שלח הצעת מחיר ל…"), where no long alarm is needed at all.
    const app = readApp();
    assert.match(app, /function maintBlocks/, 'the action-block builder is gone');
    assert.match(app, /ckAddDays\(due, -d\)/,
        'blocks no longer sit at due-minus-lead — they are back on the visit date');
    assert.ok(!/leads\.filter\(\(d\) => d <= 28\)/.test(app),
        'the 28-day override workaround is back; a block at the lead date does not need it');
    assert.match(app, /'שלח הצעת מחיר ל'/, 'the block no longer names the action');
    assert.match(app, /T09:00:00[\s\S]{0,200}T10:00:00/, 'the block is no longer one hour long');

    // And the reminder has to lead back to the work, not merely name it.
    assert.match(app, /function maintDeepLink/, 'the calendar entry no longer links back to the project');
    assert.match(app, /function captureMaintDeepLink[\s\S]{0,400}history\.replaceState/,
        'the deep link is not cleaned from the URL — a refresh would re-trigger it');
});

test('recurrence is a property of a project, and it ends', () => {
    const app = readApp();
    const html = read('sale/index.html');

    // The job/maintenance switch at creation is gone. Stav's counter-example:
    // panel maintenance is a one-off JOB whose OPPORTUNITY returns next year —
    // the work does not recur, the sale does. And at creation you rarely know;
    // you know when the job is finished.
    assert.ok(!html.includes('proj-kind'), 'the create-time type switch is back');
    assert.ok(!/setNewProjectKind/.test(app), 'the type-switch handler survived the removal');
    assert.match(app, /function projectRepeats/, 'recurrence is no longer readable as a property');
    assert.match(app, /if \(repeatFilterOn\) filtered = filtered\.filter\(projectRepeats\);/,
        'the recurring filter is gone from the projects list');

    // And the series is bounded. An open RRULE keeps firing years after the
    // price, the customer or the job changed.
    assert.match(app, /n > 0 \? base \+ ';COUNT=' \+ n : base/,
        'the recurrence rule lost its COUNT — the calendar series repeats forever again');
    assert.match(app, /const MAINT_REPEATS_DEFAULT = \d+;/, 'the default repeat count is gone');
    assert.ok(!/MAINT_REPEATS_DEFAULT = 0;/.test(app),
        'the default became unlimited — the whole point was that it should end');
});

test('a rendered screen is actually reachable', () => {
    // "ארכיון לקוחות" was marked shipped in the roadmap and had a renderer, its
    // own CSS and three working helpers — but no panel and no nav entry, so
    // renderClientArchive() targeted an element that did not exist and was
    // never called by anything. It read as a finished feature for weeks.
    //
    // The archive is a VIEW inside לקוחות rather than a panel of its own, and
    // periodic service is a view inside עבודות (Stav, 22/08: it is about
    // projects that come back, not about clients). The guard follows the routes
    // they are actually reached by: the old tab names still resolve, and the
    // view that opens runs its renderer.
    const html = read('sale/index.html');
    const app = readApp();
    const panels = [...html.matchAll(/id="panel-([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(panels.includes('clients'), 'the clients panel is gone');
    assert.ok(panels.includes('money'), 'the money panel is gone');
    assert.match(html, /id="clients-view-list"/, 'the client archive view is gone');
    assert.match(html, /id="projects-view-maint"/, 'the periodic-service view is gone');
    assert.match(html, /id="ck-legacy-body"/, 'the installations list lost its home');
    assert.match(app, /tabId === 'archive'\) \{ tabId = 'clients'/,
        'the old archive tab name no longer resolves — deep links and reminders break silently');
    assert.match(app, /tabId === 'checkups'\) \{ tabId = 'projects'; subView = 'maint'/,
        'the old checkups tab name no longer resolves');
    assert.match(app, /if \(onMaint\) \{ renderMaintenanceProjects\(\); try \{ renderCheckups\(\); \} catch/,
        'opening periodic service no longer renders it');
    assert.match(app, /setClientFilter\(clientFilter\)/, 'opening the clients tab no longer renders the list');

    // The link that makes the grouping trustworthy.
    assert.match(app, /function projectClient/, 'projects can no longer name a real client');
    // Stronger than the rule this replaced. The archive used to GROUP projects
    // by client — keying on the link where there was one and on typed text
    // where there was not — so a typo still split a customer, and a customer
    // with no job yet did not appear at all. It iterates clientsList itself
    // now, and text typed on a quote cannot invent anybody.
    // Stav, 29/08: "בלקוחות שיופיעו הלקוחות ולא הפרויקטים."
    const arch = app.slice(app.indexOf('function renderClientArchive('));
    const archBody = arch.slice(0, arch.indexOf('\n}'));
    assert.ok(/let list = \(clientsList \|\| \[\]\)\.map/.test(archBody),
        'the customers screen is built from projects again, so a saved customer with no job is invisible');
    assert.ok(!/_clientKey\(/.test(archBody),
        'typed text is grouping customers again — a name on a quote is not a customer record');
    // Work linked to nobody must stay findable, or moving to a real customer
    // list would silently hide it.
    assert.ok(/orphans\.push\(row\)/.test(archBody), 'unlinked work is dropped instead of counted');
    assert.ok(/openClientPicker\(/.test(archBody),
        'the unassigned list must let you fix the link where it reports it');
});

test('the model is switchable, testable, and never switches itself', () => {
    const tiers = read('functions/api/_tiers.js');
    const evalFn = read('functions/api/model-eval.js');
    const traps = read('functions/api/_model_traps.js');
    const ai = read('functions/api/_ai.js');

    // The app sat two Gemini generations behind, not by decision but because
    // changing the model meant a deploy and nobody redeploys on a hunch.
    assert.match(tiers, /export async function loadModelClass/,
        'the model is hardcoded again — switching needs a deploy');
    for (const f of ['chat.js', 'assistant.js']) {
        const src = readFileSync(join(ROOT, 'functions/api', f), 'utf8');
        assert.ok(!/MODEL_CLASS\.(basic|advanced)/.test(src),
            `${f} reads the shipped constant directly, so an admin switch would not reach it`);
    }

    // The traps existed only inside a conversation, which made "does the new
    // model still pass?" unanswerable — the real reason upgrading felt risky.
    assert.match(traps, /export const MODEL_TRAPS/, 'the trap suite is gone');
    const trapCount = (traps.match(/\n  \{\n    id: '/g) || []).length;
    assert.ok(trapCount >= 5, `only ${trapCount} traps survive; round 1 shipped 5`);
    assert.match(evalFn, /onRequestPost/, 'the traps can no longer be run against a candidate');

    // And it stays a decision. A cron that swaps models at 3am would change the
    // numbers customers are quoted, overnight, with nobody watching.
    // Check the wiring, not the prose — this file's own comments say "cron".
    assert.ok(!/export\s+(async\s+)?function\s+onSchedule/.test(evalFn),
        'model-eval grew a scheduled handler — switching must stay a decision');
    for (const wf of readdirSync(join(ROOT, '.github/workflows'))) {
        const text = readFileSync(join(ROOT, '.github/workflows', wf), 'utf8');
        assert.ok(!/model-eval/.test(text),
            `${wf} automates the model endpoint — a model must never change while nobody is watching`);
    }
    assert.match(ai, /'gemini-3\.\d+-flash'/, 'the 3.x candidates are no longer selectable for testing');
});

test('every guide milestone the app fires actually exists in the guide', () => {
    // A guide is optional; a ReferenceError in the middle of createNewProject is
    // not. This shipped: sale/app.js called coachMilestone(), sale/coach.js
    // defined coachHint(), and creating a project threw at the last line.
    const app = readApp();
    const coach = read('sale/coach.js');

    // Whatever name the app uses for the guide, the guide must expose it.
    const called = [...app.matchAll(/window\.(coach\w+)\s*\(/g)].map((m) => m[1]);
    for (const name of new Set(called)) {
        assert.match(coach, new RegExp('window\\.' + name + '\\s*='), `sale/coach.js does not expose ${name}`);
    }

    // And every milestone id fired must be one the guide knows how to show.
    const ids = [...app.matchAll(/coachSay\('([^']+)'/g)].map((m) => m[1]);
    for (const id of ids) {
        assert.match(coach, new RegExp("'" + id + "'"), `the guide has no hint called ${id}`);
    }

    // This used to demand three milestones. Three of them — the first project,
    // the first price, the first quote — moved to the next-step cards on
    // 25/08/2026, which answer the same moments from the project's own state
    // instead of a once-ever flag, and so can still help someone on his fifth
    // project. What must never happen is BOTH mechanisms losing them, which
    // would leave those moments with nothing on screen saying what to do next.
    const cards = read('sale/nextstep.js');
    assert.ok(ids.length >= 3 || /NEXT_STEP_CARDS\s*=/.test(cards),
        'nothing answers "what now" any more — not the guide and not the cards');
    for (const id of ids) {
        assert.ok(coach.includes(`'${id}'`), `coach.js has no hint for "${id}"`);
    }

    // The call site itself must be unable to throw.
    assert.match(app, /function coachSay\(id, delay\) \{\s*try \{/);
});

test('every internal doc in the deploy root is blocked, not just the remembered ones', () => {
  // There is no .cfignore, so everything committed is served. The block list is
  // maintained by hand and had drifted: ANALYTICS/BACKLOG/PRODUCT_OVERVIEW were
  // listed, COORDINATION/ROADMAP/ELECTRICAL_KIT/README and the whole security
  // review under scripts/ were not.
  const red = readFileSync(new URL('../_redirects', import.meta.url), 'utf8');
  const rooted = execSync('git ls-files "*.md"', { cwd: new URL('..', import.meta.url) })
    .toString().split('\n').map((s) => s.trim()).filter(Boolean)
    .filter((f) => f !== 'llms.txt');

  const unblocked = rooted.filter((f) => {
    const dir = f.includes('/') ? f.slice(0, f.indexOf('/')) : null;
    if (dir && (red.includes('/' + dir + '/*') || red.includes('/' + dir + '/'))) return false;
    return !red.includes('/' + f);
  });
  assert.deepEqual(unblocked, [],
    'these internal documents are publicly served — add them to _redirects');
});

// `_redirects` cannot return 404 on Cloudflare Pages (verified 4.9.2026: /scripts/*
// answered 200 with a 404 rule in place). The 404 lines in that file are the map of
// what must stay private; the block itself is a Function stub. This keeps the two
// in step, so a new 404 line without a stub fails here instead of on the web.
test('every 404 path in _redirects has a Function stub that actually denies it', () => {
    const rules = readFileSync(new URL('../_redirects', import.meta.url), 'utf8').split(/\r?\n/)
        .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /\s404\s*$/.test(l))
        .map((l) => l.split(/\s+/)[0]);
    assert.ok(rules.length >= 5, 'the map of private paths shrank');
    const missing = rules.filter((p) => {
        const rel = p.replace(/^\//, '').replace(/\/\*$/, '/[[path]]');
        return !existsSync(new URL('../functions/' + rel + '.js', import.meta.url));
    });
    assert.deepEqual(missing, [], 'these 404 rules have no Function stub, so they are public: ' + missing.join(', '));
});

// The standalone /checkups/ page was retired on 4.9.2026: the periodic-service
// screen lives inside the app. The URL had already gone out to customers on
// WhatsApp, so it must keep landing somewhere — and nothing on the site may
// point at it again, or the redirect quietly becomes the page.
test('/checkups/ redirects into the app, and nothing links to it any more', () => {
    const rules = readFileSync(join(ROOT, '_redirects'), 'utf8').split(/\r?\n/)
        .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));
    for (const from of ['/checkups', '/checkups/*']) {
        const rule = rules.find((r) => r[0] === from);
        assert.ok(rule, from + ' has no rule — old bookmarks and the WhatsApp links land on a 404');
        assert.deepEqual(rule.slice(1), ['/sale/', '301'], from);
    }
    assert.ok(!existsSync(join(ROOT, 'checkups', 'index.html')), 'the page itself is back');

    const files = execSync('git ls-files', { cwd: ROOT }).toString().split('\n')
        .map((f) => f.trim()).filter(Boolean)
        .filter((f) => f !== '_redirects' && !/\.(png|jpe?g|webp|gif|ico|woff2?|ttf|pdf|zip)$/i.test(f));
    // A link is an href/src, a sitemap <loc>, a markdown link, a full URL, a
    // location assignment or a robots rule. Prose that names the old page
    // (comments, the changelog) is history, not a link.
    const link = /(?:href|src|action)=["']?\/checkups\/|<loc>[^<]*\/checkups\/|\]\(\/checkups\/|https?:\/\/[^\s"'<)]+\/checkups\/|location(?:\.href)?\s*=\s*["']\/checkups\/|(?:Dis)?[Aa]llow:\s*\/checkups/;
    const linking = files.filter((f) => link.test(readFileSync(join(ROOT, f), 'utf8')));
    assert.deepEqual(linking, [], 'these still link to the retired page');
});
