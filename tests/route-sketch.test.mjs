// The run, drawn instead of listed.
//
// Stav's own idea, in his words: the riser and the way out of the flat, marked
// per segment with the real dimensions — "קידוח 30 עם צינור 25", a bend marked
// "שרשורי". The value is in the annotations, so the rules that matter are the
// ones that keep them true: the segments are what he ticked, in order, and the
// cable and conduit are read off the priced lines rather than guessed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'sale', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function load() {
    const start = APP.indexOf('const ROUTE_PLANS');
    const end = APP.indexOf('function openRouteSketch');
    assert.ok(start > -1 && end > start, 'the route sketch moved or was renamed');
    const ctx = createContext({
        specValues: (v) => String(v == null ? '' : v).split(' | ').filter(Boolean),
        escapeHtml: (x) => String(x).replace(/[<>&"]/g, ''),
        heNum: (n) => String(n),
        Object, String, Number, Array, Math, JSON,
    });
    return runInContext(APP.slice(start, end) + '\n;({ routePlan, routeSketchSvg, routeKind })', ctx);
}

const charger = (answers, materials) => ({
    id: 'p', materials: materials || [],
    spec: { jobType: 'charger', answers },
});
const ans = (v) => ({ value: v, source: 'user', skipped: false });

test('the segments are the answers he ticked, in the order they happen', () => {
    const { routePlan } = load();
    const plan = routePlan(charger({
        route_type: ans('הלוח צמוד לחניה · קידוח אחד | יש צנרת ריקה או חוט משיכה עד החניה | ניסור או חציבה בבטון/אספלט'),
        distance_m: ans('25 מטר'),
    }));
    assert.deepEqual(plan.segments.map((s) => s.label),
        ['קידוח קיר', 'השחלה בצנרת', 'חציבה או ניסור']);
    assert.equal(plan.length, '25 מטר');
    assert.equal(plan.from, 'לוח החשמל');
    assert.equal(plan.to, 'עמדת הטעינה');
});

test('digging and cutting are marked as the segments that cost money', () => {
    const { routeKind } = load();
    assert.equal(routeKind('חפירה בקרקע').heavy, true);
    assert.equal(routeKind('ניסור או חציבה בבטון/אספלט').heavy, true);
    assert.equal(routeKind('תעלה גלויה על הקיר (עה"ט)').heavy, false);
    assert.equal(routeKind('צנרת או פיר קיימים עם מקום פנוי').heavy, false);
});

test('the cable and the conduit come off the priced lines, never from thin air', () => {
    const { routePlan } = load();
    const plan = routePlan(charger({ route_type: ans('קידוח') }, [
        { name: 'עמדת טעינה 22kW', checked: true },
        { name: 'כבל 5x10 N2XY', checked: true },
        { name: 'מריכף 23 שרשורי', checked: true },
    ]));
    assert.equal(plan.cable, 'כבל 5x10 N2XY');
    assert.equal(plan.conduit, 'מריכף 23 שרשורי');
});

test('what was not priced is drawn as missing, not invented', () => {
    const { routePlan, routeSketchSvg } = load();
    const plan = routePlan(charger({ route_type: ans('קידוח') }, [{ name: 'עמדת טעינה 22kW', checked: true }]));
    assert.equal(plan.cable, '');
    assert.equal(plan.conduit, '');
    assert.match(routeSketchSvg(plan), /לא תומחרו עדיין/);
});

test('an unticked line item is not on the drawing either', () => {
    const { routePlan } = load();
    const plan = routePlan(charger({ route_type: ans('קידוח') }, [
        { name: 'כבל 5x10 N2XY', checked: false },
    ]));
    assert.equal(plan.cable, '', 'a line he unticked is not part of this job');
});

test('no route answers still draws one honest segment, and says so', () => {
    const { routePlan } = load();
    const plan = routePlan(charger({}));
    assert.equal(plan.segments.length, 1);
    assert.equal(plan.assumed, true);
});

test('a job with no run at all is not given one', () => {
    const { routePlan } = load();
    assert.equal(routePlan({ id: 'p', spec: { jobType: 'fault', answers: {} } }), null);
    assert.equal(routePlan(null), null);
});

test('both layouts draw every segment and both ends', () => {
    const { routePlan, routeSketchSvg } = load();
    const plan = routePlan(charger({
        route_type: ans('קידוח | חפירה בקרקע | תעלה גלויה'),
        distance_m: ans('40 מטר'),
    }, [{ name: 'כבל 5x6 N2XY', checked: true }]));
    for (const opts of [undefined, { vertical: true }]) {
        const svg = routeSketchSvg(plan, opts);
        assert.equal((svg.match(/rs-seglbl/g) || []).length, 3);
        assert.equal((svg.match(/rs-endlbl/g) || []).length, 2);
        assert.match(svg, /אורך המסלול באפיון: 40 מ'/);
        assert.equal((svg.match(/rs-heavy/g) || []).length, 1);
        // The labels must sit OUTSIDE the wobbling group — a shaken label is
        // one nobody can read, and that was the first thing that went wrong.
        const group = svg.slice(svg.indexOf('<g filter'), svg.indexOf('</g>'));
        assert.doesNotMatch(group, /<text/);
    }
});

test('the sketch is free for everyone; the printed work order is the PRO thing', () => {
    // Stav asked whether the sketch should be PRO "because of the tokens" — it
    // costs none, it is built in the browser from answers and priced lines. So
    // it stays open, and the branded document for the crew is what is gated,
    // with the field reports it belongs to.
    const src = APP;
    const sketch = src.slice(src.indexOf('function openRouteSketch'), src.indexOf('function routeSketchSvgVertical') > -1
        ? src.indexOf('function openFieldWorkOrder') : src.length);
    // The dialog may LABEL the work-order button "· PRO"; what it must never do
    // is refuse to draw.
    assert.doesNotMatch(sketch, /showUpgradeModal/, 'the sketch must not be gated');
    const order = src.slice(src.indexOf('function openFieldWorkOrder'), src.indexOf('function openFieldWorkOrder') + 900);
    assert.match(order, /tierAllows\('reports'\)/);
    assert.match(order, /showUpgradeModal\('reports'\)/);
    // And no AI call anywhere in the drawing path — that was the premise worth
    // checking, not just answering.
    const draw = src.slice(src.indexOf('const ROUTE_PLANS'), src.indexOf('function openFieldWorkOrder'));
    assert.doesNotMatch(draw, /callAI|fetch\(|askListInChat|generate\(/, 'the drawing must cost nothing');
});

test('each leg carries its own metres and its own sentence', () => {
    // "תעשה את האורכים לכל קטע" — and the annotation is the point of the
    // drawing: "קידוח 30 עם צינור 25" belongs to leg 1, not to the run.
    const { routePlan, routeSketchSvg } = load();
    const p = charger({
        route_type: ans('קידוח | חפירה בקרקע | תעלה גלויה'),
        distance_m: ans('25 מטר'),
    }, [{ name: 'כבל 5x10 N2XY', checked: true }]);
    p.route = {
        'קידוח': { m: 1, note: 'קידוח 30 עם צינור 25' },
        'חפירה בקרקע': { m: 16 },
        'תעלה גלויה': { m: 8, note: 'הרכבה בגובה 120' },
    };
    const plan = routePlan(p);
    assert.deepEqual(plan.segments.map((s) => s.meters), [1, 16, 8]);
    assert.equal(plan.segments[0].note, 'קידוח 30 עם צינור 25');
    assert.equal(plan.measured, 25);
    assert.equal(plan.declared, 25);
    for (const opts of [undefined, { vertical: true }]) {
        const svg = routeSketchSvg(plan, opts);
        assert.match(svg, /קידוח 30 עם צינור 25/);
        assert.match(svg, /הרכבה בגובה 120/);
        assert.match(svg, /16 מ'/);
        assert.match(svg, /סכום הקטעים: 25/);
    }
});

test('when the legs and the measured run disagree, the drawing says so', () => {
    const { routePlan, routeSketchSvg } = load();
    const p = charger({ route_type: ans('קידוח | חפירה בקרקע'), distance_m: ans('40 מטר') });
    p.route = { 'קידוח': { m: 1 }, 'חפירה בקרקע': { m: 12 } };
    const svg = routeSketchSvg(routePlan(p));
    assert.match(svg, /לא מסתדר/, 'a 27m gap between the two totals is worth a word');

    // Within a metre it is the same number said twice, not a contradiction.
    p.route = { 'קידוח': { m: 1 }, 'חפירה בקרקע': { m: 39 } };
    assert.doesNotMatch(routeSketchSvg(routePlan(p)), /לא מסתדר/);
});

test('the drawing fits its own canvas', () => {
    // Every box must sit inside the viewBox: one gap too few in the width and
    // the last one — the destination — was cut off the left edge.
    const { routePlan, routeSketchSvg } = load();
    for (const n of [1, 2, 3, 4, 6]) {
        const chips = Array.from({ length: n }, (_, i) => `קטע ${i}`).join(' | ');
        const svg = routeSketchSvg(routePlan(charger({ route_type: ans(chips) })));
        const vb = Number(svg.match(/viewBox="0 0 (\d+)/)[1]);
        const xs = [...svg.matchAll(/<rect x="(-?[\d.]+)" y="[-\d.]+" width="([\d.]+)"/g)]
            .map((m) => [Number(m[1]), Number(m[2])]);
        assert.ok(xs.length >= n + 2, `${n} segments: expected ${n + 2} boxes, found ${xs.length}`);
        for (const [x, w] of xs) {
            assert.ok(x >= 0, `${n} segments: a box starts at ${x}, off the canvas`);
            assert.ok(x + w <= vb, `${n} segments: a box ends at ${x + w}, past ${vb}`);
        }
    }
});
