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

test('the picker and the paper are on the same screen', () => {
    // Stav, 29/08: "אי אפשר לשים את בחירת עיצוב מודרני וכו בלמעלה והמסך שמראה
    // איך זה יוצא למטה. זה קשור אחד לשני ושמת אותם בנפרד." A picker whose
    // effect you cannot see is a guess, not a choice — so the template row, the
    // background and the two knobs moved into the designer, which already had
    // the live paper beside it.
    const i = APP.indexOf('function openQuoteDesigner');
    const body = APP.slice(i, APP.indexOf('\n}', APP.indexOf('renderDesignerPreview();', i)));
    assert.match(body, /dz-step-tpl/, 'the template picker is not on the design screen');
    assert.match(body, /dz-step-bg/, 'the background picker is not on the design screen');
    assert.match(body, /designer-preview/, 'the live paper is gone from the design screen');

    // And every control must repaint the paper, or this is the old arrangement
    // with a shorter walk.
    for (const fn of ['designerPickTemplate', 'designerSetWatermark', 'designerKnob']) {
        const j = APP.indexOf('function ' + fn);
        assert.ok(j > -1, `${fn} is gone`);
        assert.match(APP.slice(j, APP.indexOf('\n}', j)), /renderDesignerPreview\(\)/,
            `${fn} changes the design without repainting the preview`);
    }
});

test('the walkthrough runs once, in his words', () => {
    // A walkthrough that returns is one people learn to dismiss without
    // reading, which is worse than none.
    assert.match(APP, /sj_seen_designer_coach/, 'the walkthrough no longer remembers it has run');
    for (const line of ['זה מסך עיצוב הצעת המחיר', 'ופה זה בורר בחירה מתבניות']) {
        assert.ok(APP.includes(line), `the walkthrough lost the line: ${line}`);
    }
});
