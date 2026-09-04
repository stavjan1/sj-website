// "תצוגה מלאה" has one job: show the exact PDF before it is sent. It was
// showing something else.
//
// Both preview paths — openFullPdfPreview and renderDesignerPreview — do
// cloneNode(true) then removeAttribute('id'), which is correct: two elements
// with the same id in one document is a bug of its own. But sixteen rules in
// pdf.css were scoped to #quote-pdf-sheet, so the clone lost all of them and
// fell back to body's 16px while the real sheet and the exported PDF are 12px.
// Measured before the fix: preview 16px, PDF 12px. A third larger, with
// different line breaks, on the screen an electrician uses to decide whether
// the document is good enough to send to his customer.
//
// A class survives cloning. An id cannot. That is the whole rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PDFCSS = readFileSync(join(ROOT, 'site', 'sale', 'css', 'pdf.css'), 'utf8');
const HTML = readFileSync(join(ROOT, 'site', 'sale', 'index.html'), 'utf8');
const APP = readApp();

test('nothing styles the quote sheet by its id', () => {
    // The id is for getElementById. The moment it also carries styling, every
    // clone of the sheet renders differently from the sheet.
    const bare = PDFCSS.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/#quote-pdf-sheet/.test(bare),
        'pdf.css styles the sheet by id again — every preview will diverge from the PDF');
    assert.match(HTML, /id="quote-pdf-sheet" class="a4-sheet quote-sheet"/,
        'the sheet lost the class its styling hangs on');
    assert.ok((PDFCSS.match(/\.quote-sheet/g) || []).length >= 10,
        'the class-scoped rules are gone');
});

test('the previews still drop the id, because two of one id is its own bug', () => {
    // This is not a mistake to be fixed — it is why the styling had to move.
    // If a future change keeps the id on the clone instead, the duplicate is
    // back and getElementById starts returning the preview copy.
    const clones = (APP.match(/cloneNode\(true\)/g) || []).length;
    const drops = (APP.match(/removeAttribute\('id'\)/g) || []).length;
    assert.ok(clones >= 2 && drops >= 2,
        'a preview stopped removing the cloned id — getElementById may now find the copy');
});

test('the document fits the screen it is being looked at on', () => {
    // Measured on a 375px phone before the fix: the A4 sat at left:-435 — more
    // than half of what the electrician was about to send his customer was off
    // the side of the screen, on the only device three of four reviewers work
    // from. The inline sheet is hidden on a phone, so the fullscreen preview is
    // the ONLY way to see the document there, and it had a hardcoded
    // `transform: scale(0.62)` in CSS. 0.62 × 794 = 492px, which fits no phone.
    const APP2 = readApp();
    const CSS = readFileSync(join(ROOT, 'site', 'sale', 'css', 'pdf.css'), 'utf8');

    assert.ok(!/\.pdf-fs-content \.a4-sheet\s*\{[^}]*scale\(/.test(CSS),
        'the fullscreen preview is back on a fixed scale, which cannot fit an unknown screen');
    assert.match(APP2, /function fitFullPreview/, 'the fullscreen preview no longer measures and fits');

    const i = APP2.indexOf('function fitFullPreview');
    const body = APP2.slice(i, APP2.indexOf(String.fromCharCode(10) + '}', i));
    // Scaling alone leaves the LAYOUT box at 794px, so the scaled document ends
    // up correctly sized and still off-screen. The wrapper has to shrink too.
    assert.match(body, /wrap\.style\.width/, 'the wrapper no longer takes the scaled width, so layout and pixels disagree');
    // And the origin must follow the writing direction: in RTL the box overflows
    // to the LEFT, so a left origin scales outward from a corner already off
    // the screen — measured at left:-435, the whole document past the edge.
    assert.match(body, /direction[\s\S]{0,120}top right/,
        'the scale origin ignores writing direction again');
});
