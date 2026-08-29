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
const PDFCSS = readFileSync(join(ROOT, 'sale', 'css', 'pdf.css'), 'utf8');
const HTML = readFileSync(join(ROOT, 'sale', 'index.html'), 'utf8');
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
