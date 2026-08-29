// Templates are a THEME on the sheet, never a change to its markup — the PDF
// exporter walks these ids and the block designer reorders them by data-block,
// so a template that moved an element would break both.
//
// The four designs arrived completely inert: PDF_TEMPLATES was a map of slider
// values with no class field, and nothing anywhere put tpl-* on the element. A
// stylesheet that matches nothing is the quietest defect in this codebase and
// this is the third time this week.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readApp();
const CSS = readFileSync(join(ROOT, 'sale', 'css', 'quote-templates.css'), 'utf8');
const HTML = readFileSync(join(ROOT, 'sale', 'index.html'), 'utf8');

const classes = [...APP.matchAll(/cls: '(tpl-[a-z]+)'/g)].map((m) => m[1]);

test('every template offered has a theme that actually exists', () => {
    assert.ok(classes.length >= 3, 'the themed templates are gone from PDF_TEMPLATES');
    const missing = classes.filter((c) => !CSS.includes('.quote-sheet.' + c));
    assert.deepEqual(missing, [], 'these templates are offered but their CSS matches nothing');
});

test('and every theme in the stylesheet is offered', () => {
    // The other direction: CSS for a template nobody can pick is dead weight,
    // and worse, it is a design somebody will assume is live.
    const inCss = [...new Set([...CSS.matchAll(/\.quote-sheet\.(tpl-[a-z]+)/g)].map((m) => m[1]))];
    const orphaned = inCss.filter((c) => !classes.includes(c));
    assert.deepEqual(orphaned, [], 'these themes are in the stylesheet but no template offers them');
});

test('the class reaches the sheet, and the stylesheet is loaded', () => {
    assert.match(APP, /function applySheetTemplateClass/, 'nothing puts the theme class on the sheet');
    assert.match(APP, /applySheetTemplateClass\(key\)/, 'applyPdfTemplate stopped applying the class');
    // And on load, not only on click — otherwise the picker highlights one
    // template while the paper still wears the last one.
    const i = APP.indexOf('function markActivePdfTemplate');
    assert.match(APP.slice(i, i + 400), /applySheetTemplateClass/,
        'the saved template is not re-applied to the sheet on load');
    assert.match(HTML, /quote-templates\.css/, 'the template stylesheet is not loaded');
});

test('מודגשת is not offered, and that was measured not guessed', () => {
    // 1239px against a 1158px page on a SIX-item quote — the company footer
    // alone on page two. Tightened and re-measured; still 1239, because the
    // height is in the header band and the footer plate, which are the design.
    assert.ok(!classes.includes('tpl-bold'),
        'מודגשת is being offered again — it splits a six-item quote across two pages');
    assert.ok(!/\.quote-sheet\.tpl-bold/.test(CSS), 'its rules came back');
    assert.match(CSS, /DESIGNED, MEASURED, NOT SHIPPED/,
        'the note explaining why it is absent is gone, so somebody will re-add it');
});
