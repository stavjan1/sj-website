// The coverage checklists are the product's core asset — what must be known
// about a job before it can be priced. They are regenerated from workflow
// output, so a bad regenerate is a real failure mode: it would ship a job type
// with no critical fields (the gate never closes) or a chips field with no
// chips (a question that cannot be answered).
//
// Zero dependencies on purpose. `node --test` is built in; adding a runner and
// a DOM to a static site is weight this repo does not need, and every check
// here is on data, not on rendering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadChecklists() {
    const src = readFileSync(join(ROOT, 'sale/coverage.js'), 'utf8');
    return JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
}

const LISTS = loadChecklists();
const TYPES = Object.keys(LISTS);

test('every job type is present and keyed by its own jobType', () => {
    assert.ok(TYPES.length >= 9, `expected at least 9 job types, got ${TYPES.length}`);
    for (const [key, list] of Object.entries(LISTS)) {
        assert.equal(list.jobType, key, `${key}: jobType does not match its key`);
        assert.ok(list.label && list.label.length > 2, `${key}: missing label`);
    }
});

test('the pricing gate can always close, and is never the whole form', () => {
    for (const [key, list] of Object.entries(LISTS)) {
        const critical = list.fields.filter((f) => f.critical).length;
        assert.ok(critical >= 1, `${key}: no critical fields — the gate would never close`);
        assert.ok(critical <= 6, `${key}: ${critical} critical fields — too much to answer before a price`);
        assert.ok(list.fields.length >= 8, `${key}: only ${list.fields.length} fields`);
        assert.ok(list.fields.length <= 15, `${key}: ${list.fields.length} fields — people abandon`);
    }
});

test('every field can actually be answered and explained', () => {
    for (const [key, list] of Object.entries(LISTS)) {
        for (const f of list.fields) {
            const at = `${key}.${f.id}`;
            assert.match(f.id, /^[a-z0-9_]+$/, `${at}: id must be snake_case ascii`);
            assert.ok(f.question, `${at}: no question`);
            assert.ok(f.why, `${at}: no reason — the card offers no argument for answering`);
            assert.ok(f.pricingImpact, `${at}: no pricingImpact — then why ask it`);
            // Skipping a field prints a sentence in the customer's quote. Without
            // it, speed would cost nothing visible, which is the whole design.
            assert.ok(f.assumption, `${at}: no assumption to print when skipped`);
            assert.ok(['chips', 'number', 'text'].includes(f.type), `${at}: unknown type ${f.type}`);
            if (f.type === 'chips') {
                assert.ok(Array.isArray(f.chips) && f.chips.length >= 2,
                    `${at}: a chips field needs at least two options`);
                assert.equal(new Set(f.chips).size, f.chips.length, `${at}: duplicate chips`);
            }
        }
        const ids = list.fields.map((f) => f.id);
        assert.equal(new Set(ids).size, ids.length, `${key}: duplicate field ids`);
    }
});

test('every job type says what it does not include', () => {
    for (const [key, list] of Object.entries(LISTS)) {
        assert.ok(list.exclusions?.length >= 5, `${key}: too few exclusions — this is where arguments start`);
        assert.ok(list.redFlags?.length >= 5, `${key}: too few red flags`);
    }
});

test('every job type asks where the property is', () => {
    // Five independent field reviews raised the same gap: nothing asked about
    // travel, parking or carrying gear up a stairwell — real hours nobody quotes.
    for (const [key, list] of Object.entries(LISTS)) {
        const asks = list.fields.some((f) =>
            /כתובת|עיר|נסיעה|חניה|מעלית|לפרוק/.test(`${f.question} ${f.why}`));
        assert.ok(asks, `${key}: no field covers location or access`);
    }
});

test('the trade vocabulary is correct', () => {
    const blob = JSON.stringify(LISTS);
    // בודק מוסמך is the title for lifting machinery and pressure vessels; the
    // electrical one is חשמלאי בודק.
    assert.ok(!blob.includes('בודק מוסמך'), 'uses "בודק מוסמך" — the electrical title is חשמלאי בודק');
    // מונה נטו offsets your own consumption; it is not selling to the utility.
    assert.ok(!/מונה נטו[^"]{0,12}מכירה/.test(blob), 'describes מונה נטו as selling to the utility');
    assert.ok(!blob.includes('הארקת אפס'), 'uses "הארקת אפס" — the term is איפוס (TN-C)');
});

test('an inspector fee is never quoted without naming the installation', () => {
    // 600 is a charging point; an apartment is ~1,500. A bare range does not
    // simplify the number, it inverts it.
    //
    // Only a real currency amount close to the phrase counts — an exclusion
    // line like "בדיקת חשמלאי בודק וטופס בדיקה" carries no price and is fine.
    const blob = JSON.stringify(LISTS);
    const INSTALLATION = /עמדה|עמדת טעינה|דירה|וילה|בית פרטי|עסק|מתקן|רכוש משותף|ציבורי/;
    for (const m of blob.matchAll(/חשמלאי בודק.{0,90}/g)) {
        const window = m[0];
        if (!/\d[\d,]*\s*₪/.test(window)) continue;   // no amount → nothing to scope
        assert.ok(INSTALLATION.test(window),
            `an inspector price appears without its installation type: ${window.slice(0, 120)}`);
    }
});

test('the written assumptions stay tied to the characterization', () => {
    // The assumptions paragraph is a claim in a document that goes to a
    // customer. Answer a field that was left open and the paragraph is no
    // longer true, so entering the draft has to re-derive it.
    const app = readFileSync(join(ROOT, 'sale/app.js'), 'utf8');
    const goToDraft = app.slice(app.indexOf('function goToDraft'), app.indexOf('function goToDraft') + 700);
    assert.ok(/refreshSpecTerms\(/.test(goToDraft), 'goToDraft does not refresh the assumptions block');
    assert.ok(app.includes('function refreshSpecTerms'), 'refreshSpecTerms is gone');

    // syncCurrentQuoteToProject REPLACES quoteData with a fixed key list, so
    // anything else parked there is destroyed the next time the user types.
    // This cost a debugging session once; it should not cost a second.
    const sync = app.slice(app.indexOf('function syncCurrentQuoteToProject'));
    const body = sync.slice(0, sync.indexOf('\n}'));
    const keys = [...body.matchAll(/^\s{12}(\w+):/gm)].map((m) => m[1]);
    assert.ok(keys.length > 5, 'could not read the quoteData key list');
    assert.ok(!app.includes('quoteData.specTermsWritten'),
        'the assumptions marker is stored inside quoteData, which is rebuilt on every form edit');
});

test('a tap during a stage slide is queued before the no-op check', () => {
    // Mid-slide the app still LOOKS like the stage being left, so `from === to`
    // is true for a tap heading back to it. If that check runs first the tap is
    // silently dropped and the thumb ends up somewhere it did not choose.
    const app = readFileSync(join(ROOT, 'sale/app.js'), 'utf8');
    const fn = app.slice(app.indexOf('function goToStage'));
    const body = fn.slice(0, fn.indexOf('\nfunction ', 10));
    const busy = body.indexOf('stageTransitionBusy) { stagePending');
    const noop = body.indexOf('if (from === to) return;');
    assert.ok(busy > -1, 'the mid-slide queue is gone');
    assert.ok(noop > -1, 'the no-op check is gone');
    assert.ok(busy < noop, 'the busy check must come before the from/to no-op check');

    // An aborted transition rejects both promises; uncaught, that is a red
    // console on a page that is working fine.
    assert.ok(/vt\.ready\.catch/.test(body), 'vt.ready rejection is unhandled');
    assert.ok(/vt\.finished\.catch/.test(body), 'vt.finished rejection is unhandled');
});

test('the page-break guide agrees with the exporter, and never prints', () => {
    const app = readFileSync(join(ROOT, 'sale/app.js'), 'utf8');

    // The guide's position is derived from the PDF margin. If the exporter's
    // margin changes and this constant does not, the line lands in the wrong
    // place and quietly lies about where the page ends.
    const declared = app.match(/marginMm:\s*(\d+)/);
    assert.ok(declared, 'PDF_PAGE.marginMm is gone');
    const quoteOpts = app.slice(app.indexOf('const options = {'));
    const exporter = quoteOpts.match(/margin:\s*(\d+)/);
    assert.ok(exporter, 'the quote exporter no longer sets a margin');
    assert.equal(declared[1], exporter[1],
        `guide margin ${declared[1]}mm != exporter margin ${exporter[1]}mm`);

    // The guides sit inside the sheet, which is exactly what html2canvas
    // photographs — so a red dashed line on a customer's quote is one missing
    // removal away.
    const capture = app.slice(app.indexOf('function _unscaleSheetForCapture'));
    const body = capture.slice(0, capture.indexOf('\n}'));
    assert.ok(/page-guide/.test(body) && /remove\(\)/.test(body),
        'the page guides are not stripped before capture');

    const css = readFileSync(join(ROOT, 'sale/styles.css'), 'utf8');
    assert.ok(/@media print[\s\S]{0,200}\.page-guide/.test(css),
        'the print path does not hide the page guides');
});

test('every file the user picks either works or says why', () => {
    // A FileReader with no onerror fails in complete silence: the dialog
    // closes, nothing changes, nothing to act on. Worst on a backup restore,
    // where the person is already trying to recover something.
    const app = readFileSync(join(ROOT, 'sale/app.js'), 'utf8');
    const readers = [...app.matchAll(/new FileReader\(\)/g)];
    assert.equal(readers.length, 1,
        `${readers.length} FileReaders — they should all go through readFileOrExplain`);

    const helper = app.slice(app.indexOf('function readFileOrExplain'));
    const body = helper.slice(0, helper.indexOf('\n}'));
    assert.ok(/onerror/.test(body) && /onabort/.test(body),
        'readFileOrExplain no longer handles failure');

    // An image the browser cannot decode never fires onload — HEIC straight
    // off an iPhone is the common one.
    const comp = app.slice(app.indexOf('function _compressImageFile'));
    const compBody = comp.slice(0, comp.indexOf('\n}\n'));
    assert.ok(/img\.onerror/.test(compBody), '_compressImageFile ignores undecodable images');

    // A logo may be transparent, and JPEG has no alpha — flattening one puts a
    // solid box behind the mark on every quote.
    assert.ok(/isLogo \? \{ max: \d+, mime: 'image\/png' \}/.test(app),
        'the logo is no longer stored as PNG, so transparency would be flattened');

    // Camera photos must never reach localStorage at full size.
    const upload = app.slice(app.indexOf('function handleImageUpload'));
    const uploadBody = upload.slice(0, upload.indexOf('\n}\n'));
    assert.ok(/_compressImageFile/.test(uploadBody), 'the logo/background path skips compression');
    assert.ok(!/localStorage\.setItem/.test(uploadBody),
        'the logo/background path writes storage directly instead of via safeLocalSet');
});
