// The decision-free items of the external UX review (Antigravity, 4.9.2026),
// pinned so they cannot quietly regress:
//
//   1. /sale/ leads with the product (זרם); the studio is a credit line. The
//      trust line says only what the code can back — the admin CAN read
//      conversations (functions/api/admin-convos.js) and the terms disclose it,
//      so "SJ never sees your data" would be a lie the code contradicts.
//   2. Inside a project the ctx-bar has a named way out ("← כל העבודות") and a
//      one-line breadcrumb. The arrow that only walked history was not that.
//   3. Pricing-table controls reach 44px where a finger is pressing them.
//   4. Toasts are a live region; an error is an alert.
//   5. A control the plan will refuse says PRO before the tap.
//   6. The WhatsApp text never promises an attachment a wa.me link cannot carry.
//   7. The light theme is one tap away from every screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp, APP_FILES } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const HTML = read('site/sale/index.html');
const APP = read('site/sale/app.js');
const CSS = read('site/sale/css/panels.css');
const ALL_JS = readApp();

// A function body, sliced at the first line that is a lone closing brace.
function fnBody(src, name) {
    const i = src.indexOf(`function ${name}(`);
    assert.ok(i >= 0, `${name} is not defined`);
    const end = src.indexOf('\n}\n', i);
    return src.slice(i, end + 3);
}
function section(src, startMarker, endMarker) {
    const i = src.indexOf(startMarker);
    assert.ok(i >= 0, `marker not found: ${startMarker}`);
    const j = src.indexOf(endMarker, i);
    return src.slice(i, j < 0 ? undefined : j);
}

// ── 1. Branding and the truthful trust line ─────────────────────────────────
const TRUST = 'הנתונים והלקוחות שלך שמורים בחשבון שלך; שיחות עם הסוכן עשויות להיסקר לשיפור המערכת, כמפורט ב';

test('the lock card leads with זרם and credits SJ underneath', () => {
    const lock = section(HTML, 'id="lock-screen"', 'id="report-pdf-sheet"');
    const h2 = lock.match(/<h2[^>]*>([^<]*)<\/h2>/);
    assert.ok(h2, 'the lock card has no heading');
    assert.ok(h2[1].includes('זרם'), `the lock heading is "${h2[1]}" — the product leads, not the studio`);
    assert.ok(!h2[1].includes('SJ'), 'the studio name is back in the heading');
    assert.ok(/class="brand-credit">פותח ע"י SJ הנדסת חשמל</.test(lock), 'the credit line is gone');
    // The logo asset (the bolt tile) stays.
    assert.ok(lock.includes('fa-bolt'), 'the lock logo asset was removed');
    // The splash is what a user sees first of all.
    assert.ok(/class="splash-brand">זרם</.test(HTML), 'the splash still leads with the studio');
    assert.ok(/class="splash-credit">פותח ע"י SJ הנדסת חשמל</.test(HTML), 'the splash lost its credit line');
    assert.ok(/<title>זרם/.test(HTML), 'the tab title leads with the studio');
});

test('the trust line is the one the code can back, on the lock card and in settings', () => {
    const lock = section(HTML, 'id="lock-screen"', 'id="report-pdf-sheet"');
    const mydata = section(HTML, 'id="mydata-card"', 'id="about-card"');
    for (const [name, chunk] of [['lock card', lock], ['הנתונים שלך card', mydata]]) {
        assert.ok(chunk.includes(TRUST), `${name}: the trust line is missing or reworded`);
        assert.match(chunk, /<a href="\/zerem\/terms\.html"[^>]*>תנאי השימוש<\/a>/,
            `${name}: "תנאי השימוש" must link to the terms`);
    }
    // The claim the review suggested, which admin-convos.js contradicts.
    assert.ok(!/SJ לא רוא/.test(HTML) && !/SJ לא רוא/.test(ALL_JS),
        'the app claims SJ cannot see the data — functions/api/admin-convos.js says otherwise');
});

test('the admin conversation feed still exists, so the disclosure is still needed', () => {
    // If this file is ever deleted, the trust line may be strengthened; until
    // then the softer wording is the truthful one.
    const convos = read('functions/api/admin-convos.js');
    assert.ok(/adminGate/.test(convos), 'admin-convos.js no longer gates on the admin — re-read the trust line');
});

// ── 2. The back anchor and the breadcrumb ───────────────────────────────────
test('inside a project the ctx-bar offers "כל העבודות", and it closes the project', () => {
    const bar = section(HTML, '<div class="ctx-bar">', '<!-- The floating step rail');
    const works = bar.match(/<button[^>]*id="ctx-works"[^>]*>[\s\S]*?<\/button>/);
    assert.ok(works, '#ctx-works is not in the ctx-bar');
    assert.match(works[0], /onclick="switchTab\('projects'\)"/, 'the anchor must go through switchTab(\'projects\'), the close-project path');
    assert.ok(works[0].includes('כל העבודות'), 'the button lost its word');
    assert.ok(bar.includes('id="ctx-crumb"'), 'the breadcrumb element is gone');
    // switchTab('projects') is the path that closes the open project.
    const st = fnBody(APP, 'switchTab');
    assert.match(st, /tabId === 'projects' && activeProjectId[\s\S]*activeProjectId = null/,
        'switchTab(\'projects\') no longer closes the open project');
});

test('the breadcrumb reads עבודות / לקוח — עבודה / שלב N: שם, with the real step names', () => {
    assert.ok(APP.includes('function renderCtxCrumb('), 'renderCtxCrumb is gone');
    const steps = section(APP, 'const CTX_STEPS = {', '};');
    assert.match(steps, /wizard:\s*\{ n: 1, name: 'אפיון' \}/);
    assert.match(steps, /pricing:\s*\{ n: 2, name: 'תמחור' \}/);
    assert.match(steps, /create:\s*\{ n: 3, name: 'הצעה' \}/);
    // The names match the rail's own labels.
    for (const [id, label] of [['tab-wizard', 'אפיון'], ['tab-pricing', 'תמחור'], ['tab-create', 'הצעה']]) {
        const btn = HTML.match(new RegExp(`id="${id}"[\\s\\S]*?<span>([^<]*)</span>`));
        assert.equal(btn && btn[1], label, `the rail calls ${id} "${btn && btn[1]}", the crumb says "${label}"`);
    }
    const text = fnBody(APP, 'ctxCrumbText');
    assert.match(text, /`עבודות \/ \$\{who\}`/, 'the crumb no longer starts at עבודות');
    assert.match(text, /שלב \$\{step\.n\}: \$\{step\.name\}/, 'the crumb lost its step');
    assert.match(text, /\$\{client\.name\} — \$\{job\}/, 'the crumb lost the client — job pair');
    // Rendered whenever the screen or the project changes.
    assert.ok(fnBody(APP, 'updateBackButton').includes('renderCtxCrumb()'), 'updateBackButton no longer refreshes the crumb');
    assert.ok(fnBody(APP, 'updateActiveProjectBanner').includes('renderCtxCrumb()'), 'the banner no longer refreshes the crumb');
});

test('on a phone the anchor is a thumb target', () => {
    const phone = section(CSS, '@media (max-width: 768px) {\n    /* Never empty, never hidden', '\n}\n');
    assert.match(phone, /\.ctx-bar \.ctx-works \{[^}]*min-height: 44px;[^}]*min-width: 44px;/,
        'the works button is under 44×44 on a phone');
    // The phone rule that hides the arrow's word must not reach the anchor.
    assert.ok(!/\.ctx-works span \{ display: none/.test(CSS), 'the anchor lost its word on a phone');
});

// ── 3. Touch targets in the pricing table ───────────────────────────────────
test('quantity, delete and include-checkbox reach 44px on a coarse pointer only', () => {
    const coarse = section(CSS, 'Touch targets in the pricing table on a coarse pointer', '\n}\n');
    assert.match(coarse, /@media \(pointer: coarse\)/);
    assert.match(coarse, /input\.pt-qty \{ min-height: 44px; \}/, 'the quantity field is under 44px');
    assert.match(coarse, /\.pt-del \{ width: 44px; height: 44px; \}/, 'the row delete button is under 44px');
    assert.match(coarse, /\.pt-chk \{[^}]*width: 44px; height: 44px;/, 'the checkbox hit area is under 44px');
    // Desktop density untouched: the base rules keep their sizes.
    assert.match(CSS, /\n\.pt-del \{\n\s*width: 30px; height: 30px;/, 'the desktop delete button changed size');
    assert.match(CSS, /\n\.pt-chk \{ width: 16px; height: 16px;/, 'the desktop checkbox changed size');
});

// ── 4. Toasts ───────────────────────────────────────────────────────────────
test('the toast container is a polite live region and an error toast is an alert', () => {
    assert.match(HTML, /<div id="toast-container" class="toast-container" role="status" aria-live="polite"><\/div>/);
    const st = fnBody(APP, 'showToast');
    assert.ok(st.includes("document.getElementById('toast-container')"), 'showToast no longer writes into #toast-container');
    assert.ok(st.includes('container.appendChild(toast)'), 'showToast no longer appends to the container');
    assert.match(st, /toast\.setAttribute\('role', type === 'error' \? 'alert' : 'status'\)/,
        'an error toast is no longer an alert');
});

// ── 5. PRO tags ─────────────────────────────────────────────────────────────
test('every plan-gated control is tagged from the tier before the tap', () => {
    const fn = fnBody(APP, 'applyProTags');
    assert.ok(fn.includes("querySelectorAll('[data-pro]')"), 'applyProTags no longer reads data-pro');
    assert.ok(fn.includes("tag.className = 'pro-tag'") && fn.includes("tag.textContent = 'PRO'"), 'the tag is not a span.pro-tag saying PRO');
    assert.ok(fn.includes('tierAllows(feature)'), 'the tag must follow the tier, not a hard-coded list');
    assert.ok(fnBody(APP, 'applyTierGates').includes('applyProTags()'), 'applyTierGates no longer draws the tags');
    // Every feature named in the markup is one the tier table knows.
    const fallback = section(APP, 'const TIER_FALLBACK = {', '};');
    const features = [...HTML.matchAll(/data-pro="([\w]+)"/g)].map((m) => m[1]);
    assert.ok(features.length >= 5, `only ${features.length} controls are tagged`);
    for (const f of new Set(features)) assert.ok(new RegExp(`\\b${f}:`).test(fallback), `data-pro="${f}" names no tier feature`);
    // The controls the review named: share link, invoicing, reports, photos.
    assert.match(HTML, /id="btn-share-link" data-pro="shareLink"/);
    assert.match(HTML, /data-pro="invoicing" onclick="issueDocFromQuote\('DealInvoice'\)"/);
    assert.match(HTML, /data-pro="invoicing" onclick="issueDocFromQuote\('Invoice'\)"/);
    assert.match(HTML, /data-pro="reports" onclick="switchTab\('reports'\)"/);
    assert.match(HTML, /id="btn-attach-photo" data-pro="chatPhotos"/);
    // Each tagged control really does open the upgrade screen for a free user.
    assert.match(fnBody(APP, 'shareQuoteLink'), /tierAllows\('shareLink'\)[\s\S]*showUpgradeModal\('share'\)/);
    assert.match(fnBody(APP, 'issueDocFromQuote'), /invoicingAllowed\(\)[\s\S]*showUpgradeModal\('invoicing'\)/);
    assert.match(fnBody(ALL_JS, 'chatPhotoGate'), /tierAllows\('chatPhotos'\)[\s\S]*showUpgradeModal/);
    assert.match(fnBody(APP, 'applyReportsLock'), /tierAllows\('reports'\)[\s\S]*showUpgradeModal\('reports'\)/);
    // Gold text.
    assert.match(CSS, /\.pro-tag \{[^}]*color: var\(--warn-text\)/, 'the tag is not gold');
});

// ── 6. WhatsApp share ───────────────────────────────────────────────────────
test('no share text promises an attachment', () => {
    for (const rel of APP_FILES) {
        let src;
        try { src = read(rel); } catch { continue; }
        // The pricing prompt legitimately says a catalogue is "מצורף" to the
        // model; the phrase that lied to customers was "מצורף קובץ".
        assert.ok(!src.includes('מצורף קובץ'), `${rel} still says "מצורף קובץ" — a wa.me link carries no file`);
    }
});

test('the PDF rides the share sheet where it can, and the link or an honest note otherwise', () => {
    const share = fnBody(APP, 'shareWhatsApp');
    assert.ok(share.startsWith('function shareWhatsApp(') || APP.includes('async function shareWhatsApp('), 'shareWhatsApp must be async to await the PDF');
    const asyncShare = section(APP, 'async function shareWhatsApp(', '\n}\n');
    assert.match(asyncShare, /canShareQuoteFile\(\)/, 'the file-share path is gone');
    assert.match(asyncShare, /navigator\.share\(\{\s*files: \[file\]/, 'the PDF is not handed to navigator.share as a file');
    assert.match(asyncShare, /checkPdfExportAllowed\(\)/, 'a shared PDF must pass the same export gate as a download');
    assert.match(asyncShare, /whatsappShareText\(lines, shareLink\)/, 'the text fallback is gone');
    assert.match(fnBody(APP, 'canShareQuoteFile'), /navigator\.canShare\(\{ files: \[probe\] \}\)/, 'the capability check must be about FILES');
    const text = fnBody(APP, 'whatsappShareText');
    assert.match(text, /\/q\/|\$\{shareLink\}/, 'the text no longer carries the secure link');
    assert.ok(text.includes('ה-PDF יישלח בהודעה נפרדת'), 'without a link the text must say the PDF follows separately');
    assert.ok(!text.includes('מצורף'), 'the text-only message must not promise an attachment');
    // The link is the one shareQuoteLink stores on the project.
    assert.match(fnBody(APP, 'shareQuoteLink'), /proj\.shareLink = link/);
    assert.match(asyncShare, /proj && proj\.shareLink/);
});

// ── 7. Daylight: the light theme is one tap away ────────────────────────────
test('the theme toggle sits in the top bar and reuses toggleSystemTheme', () => {
    const bar = section(HTML, '<div class="ctx-bar">', '<!-- The floating step rail');
    assert.match(bar, /<button[^>]*id="ctx-theme"[^>]*onclick="toggleSystemTheme\(\)"/, 'no theme button in the ctx-bar');
    assert.ok(APP.includes('function toggleSystemTheme('), 'toggleSystemTheme is gone');
    // It rides with the bell into the title line on a desktop, so it is one
    // tap there too.
    const place = fnBody(APP, 'placeBackButton');
    assert.ok(place.includes("getElementById('ctx-theme')") && place.includes('h2.appendChild(theme)'),
        'placeBackButton no longer carries the theme button into the title line');
});
