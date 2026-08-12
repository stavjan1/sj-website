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

// Line endings are normalised on read. Git stores LF but checks out CRLF on
// Windows, so a test that slices on a newline-plus-brace boundary passes on
// CI and fails on Stav's machine — or worse, the other way round.
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

function loadChecklists() {
    const src = read('sale/coverage.js');
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
    const app = read('sale/app.js');
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
    const app = read('sale/app.js');
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
    const app = read('sale/app.js');

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

    const css = read('sale/styles.css');
    assert.ok(/@media print[\s\S]{0,200}\.page-guide/.test(css),
        'the print path does not hide the page guides');
});

test('every file the user picks either works or says why', () => {
    // A FileReader with no onerror fails in complete silence: the dialog
    // closes, nothing changes, nothing to act on. Worst on a backup restore,
    // where the person is already trying to recover something.
    const app = read('sale/app.js');
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

test('the welcome screen describes the product that was actually built', () => {
    // The pivot was away from rushing to a price: "הפלטפורמה דוחפת לשלב התמחור
    // מהר וזה יוצא שמפספסים דברים". The welcome screen kept selling the old
    // story — one-click pricing, name your project first — which is the first
    // thing a new user reads and the last thing anyone thinks to update.
    const app = read('sale/app.js');
    const fn = app.slice(app.indexOf('function showWelcomeOnboarding'));
    const body = fn.slice(0, fn.indexOf('\nfunction closeOnboarding'));

    assert.ok(!/בלחיצה אחת/.test(body),
        'the welcome screen still promises one-click pricing');
    assert.ok(/נפתח כשכל השדות הקריטיים/.test(body),
        'the welcome screen does not explain that pricing is gated');
    assert.ok(/הנחה כתובה/.test(body),
        'the welcome screen does not explain what a skipped field becomes');
    // Naming stopped being required when projects started titling themselves.
    assert.ok(!/שם הלקוח או העבודה, וזהו/.test(body),
        'the welcome screen still asks for a project name');

    // Called twice before dismissal — the flag is only written on close — it
    // would stack a second copy behind the first.
    assert.ok(/getElementById\('onboarding-modal'\)\) return/.test(body),
        'nothing stops two welcome modals stacking');
});

test('changing an answer does not destroy it first', () => {
    // editSpecField used to call clearSpecAnswer before opening the field, so
    // tapping "change" on a critical answer emptied it, dropped the coverage
    // count and re-shut the pricing gate — on a project that may already have
    // been priced and drafted. Tapping to LOOK at an answer lost it.
    const app = read('sale/app.js');
    const fn = app.slice(app.indexOf('function editSpecField'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.ok(!/clearSpecAnswer/.test(body),
        'editing a field clears it before a replacement exists');

    // Not clearing is only half of it: the card skips past anything answered,
    // and the answered row renders a summary with no control. Both have to
    // know the difference between "just answered" and "opened to be changed",
    // or "tap to change it" changes nothing at all.
    assert.ok(/specEditingField/.test(body), 'editing no longer marks the field as being edited');

    const render = app.slice(app.indexOf('function renderSpecCard'));
    const renderBody = render.slice(0, render.indexOf('\nfunction '));
    assert.ok(/editingOpen/.test(renderBody),
        'the auto-advance still jumps away from a field opened for editing');
    assert.ok(/!\(isOpen && specEditingField === f\.id\)/.test(renderBody),
        'an answered field being edited still renders as a summary, with no control');

    // And the control has to come back showing what is already there.
    assert.ok(/const current = \(answers\[f\.id\]/.test(renderBody),
        'the control does not pre-fill the existing answer');
    assert.ok(/value="\$\{escapeAttr\(current\)\}"/.test(renderBody),
        'the text input does not show the current answer');
    assert.ok(/c === current \? ' active' : ''/.test(renderBody),
        'the chosen chip is not marked when re-opening an answered question');
});

test('switching job type cannot silently destroy a characterization', () => {
    // The type chips sit at the top of the card where a thumb finds them by
    // accident, and switching wipes every answer with no way back. Measured:
    // a fully answered charger job lost all 14, and switching back restored
    // nothing.
    const app = read('sale/app.js');
    const fn = app.slice(app.indexOf('function setSpecJobType'));
    const body = fn.slice(0, fn.indexOf('\n}'));

    assert.ok(/confirm\(/.test(body), 'the job type can be changed without confirming the loss');
    // Only when there is something to lose — the agent sets the type on almost
    // every new job, and a dialog there would be intolerable.
    assert.ok(/if \(answered\)/.test(body), 'it asks even when no answers exist yet');
    // Declining has to repaint, or the chip keeps showing the type not chosen.
    assert.ok(/renderSpecCard\(proj\);\s*\/\/.*\n?\s*return;|renderSpecCard\(proj\);[^\n]*\n\s*return;/.test(body),
        'declining leaves the chip showing a type the project is not on');

    // Carrying answers across is NOT the fix: of 111 field ids only 8 appear in
    // more than one checklist and all but one ask a different question under
    // the same id, so a carried answer would put a wrong fact in a quote.
    assert.ok(/spec\.answers = \{\}/.test(body), 'answers are carried across checklists');

    // The agent's own paths must stay dialog-free, and must never overwrite a
    // type the user has already answered under.
    const prefill = app.slice(app.indexOf('function applySpecPrefill'));
    const prefillBody = prefill.slice(0, prefill.indexOf('\n}\n'));
    assert.ok(!/confirm\(/.test(prefillBody), 'the agent path would block on a dialog');
    assert.ok(/source === 'user'/.test(prefillBody),
        'the agent can retype a job the user has already answered under');
});

test('one tap cannot silently discard accumulated work', () => {
    // Third of a family found in one night: change an answer (destroyed it),
    // switch job type (wiped all 14), reset the design (dropped the block order
    // and styling of every quote). None of them asked, none could be undone.
    const app = read('sale/app.js');

    const reset = app.slice(app.indexOf('function resetQuoteDesign'));
    const resetBody = reset.slice(0, reset.indexOf('\n}'));
    assert.ok(/confirm\(/.test(resetBody), 'the quote design resets with no confirmation');
    // ...but only when there is something to discard.
    assert.ok(/defaultQuoteLayout\(\)\)\)/.test(resetBody),
        'it asks even when the layout is already the default');

    // A data-deleting function with no callers is a loaded gun: the next
    // person wiring up a "change" button finds a ready-made way to wipe an
    // answer and re-shut the pricing gate.
    const calls = [...app.matchAll(/clearSpecAnswer/g)].length;
    assert.equal(calls, 1, 'clearSpecAnswer is back — it should exist only in the note explaining its removal');
    assert.ok(!/^function clearSpecAnswer/m.test(app), 'clearSpecAnswer was reinstated');
});

test('the invitation to price is gated by our checklist, not the agent prose', () => {
    // It used to require the agent's last message to contain "רשימת המוצרים"
    // or "רשימת הציוד". Phrase it any other way — and it often does — and the
    // prompt never appeared, on a finished characterization with the gate wide
    // open. The premise of this product is that OUR checklist decides when a
    // job is ready to price.
    const app = read('sale/app.js');
    const fn = app.slice(app.indexOf('function updatePlanActionBar'));
    const body = fn.slice(0, fn.indexOf('\n}'));

    assert.ok(/canPriceProject\(proj\)/.test(body), 'the gate no longer decides when pricing is offered');
    assert.ok(!/רשימת/.test(body.replace(/\/\/.*$/gm, '')),
        'the invitation is matched against the agent\'s wording again');
    // Still not offered before the agent has said anything at all.
    assert.ok(/role === 'model'/.test(body), 'the prompt can appear before the agent has replied');
    assert.ok(/activeChatMode === 'plan'/.test(body), 'the prompt is not limited to the characterization screen');
});
