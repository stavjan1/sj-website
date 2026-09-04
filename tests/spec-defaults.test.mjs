// "תעשה שכל אחד יהיה מוגדר כבר להכי סטנדרטי" (Stav, 22/08).
//
// Every question in every checklist opens on the answer that is true for most
// jobs, so a new project is priceable immediately and the work becomes
// correcting what is different about this one. That promise only holds while
// three things stay true: the defaults exist for every question, each one is a
// real answer to its own question, and none of them can quietly overwrite
// something a person or the agent actually said.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';
import { createContext, runInContext } from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COVERAGE = readFileSync(join(ROOT, 'site', 'sale', 'coverage.js'), 'utf8').replace(/\r\n/g, '\n');
const APP = readApp().replace(/\r\n/g, '\n');

const cut = (name) => {
    const start = COVERAGE.indexOf('{', COVERAGE.indexOf('const ' + name));
    return JSON.parse(COVERAGE.slice(start, COVERAGE.indexOf('\n};', start) + 2));
};
const CHECKLISTS = cut('COVERAGE_CHECKLISTS');
const DEFAULTS = cut('COVERAGE_DEFAULTS');

// The card's own functions, run over a fake project. The slice starts at the
// standards block and ends before the follow-up UI, which needs a document.
function load() {
    const start = APP.indexOf('function allChecklists()');
    const end = APP.indexOf('function specExclusions');
    assert.ok(start > -1 && end > start, 'the spec engine moved or was renamed');
    const ctx = createContext({
        COVERAGE_CHECKLISTS: CHECKLISTS,
        COVERAGE_DEFAULTS: DEFAULTS,
        projectsList: [], activeProjectId: null,
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {} }) },
        confirm: () => true,
        touchProject: () => {}, saveProjects: () => {}, showToast: () => {},
        renderSpecCard: () => {}, updatePlanActionBar: () => {}, updateSpecStrip: () => {},
        Object, String, Number, Array, Boolean, Math, JSON,
    });
    return runInContext(
        APP.slice(start, end) +
        '\nfunction specExclusions(){return[];}' +
        '\n;({ applyStandardDefaults, pendingStdFields, specCoverage, needsAssumption, specAssumptions })',
        ctx);
}

const proj = (jobType, answers) => ({ id: 'p', spec: { jobType, answers: answers || {} } });

test('every question that can be answered by tapping starts on a standard', () => {
    for (const [type, list] of Object.entries(CHECKLISTS)) {
        const defs = DEFAULTS[type];
        assert.ok(defs, `${type} has no defaults at all`);
        for (const f of list.fields) {
            if (f.type !== 'chips' && f.type !== 'number') continue;   // free text has no standard
            assert.ok(defs[f.id], `${type}.${f.id} ("${f.question}") opens empty`);
        }
    }
});

test('a standard is one of its own question\'s answers', () => {
    for (const [type, defs] of Object.entries(DEFAULTS)) {
        const list = CHECKLISTS[type];
        if (!list) continue;                       // generic lives in app.js
        for (const [id, value] of Object.entries(defs)) {
            const f = list.fields.find((x) => x.id === id);
            assert.ok(f, `${type}.${id} has a default but no question`);
            if (f.type === 'chips') {
                assert.ok(f.chips.includes(value),
                    `${type}.${id} defaults to "${value}", which is not one of its chips`);
            } else if (f.type === 'number') {
                assert.match(value, /^\d/, `${type}.${id} should default to a number`);
            }
        }
    }
});

test('"לא ידוע" is never the standard', () => {
    // An unknown is a skip with extra steps: it satisfies the gate, prints an
    // assumption, and establishes nothing. Choosing one as the default would
    // ship every project with a fact nobody ever had.
    for (const [type, defs] of Object.entries(DEFAULTS)) {
        for (const [id, value] of Object.entries(defs)) {
            assert.doesNotMatch(String(value), /לא ידוע|לא יודע|טרם|עוד לא סוכם/,
                `${type}.${id} defaults to an unknown ("${value}")`);
        }
    }
});

test('a new project is priceable the moment it opens', () => {
    const { applyStandardDefaults, specCoverage } = load();
    for (const type of Object.keys(CHECKLISTS)) {
        const p = proj(type);
        applyStandardDefaults(p);
        const cov = specCoverage(p);
        assert.equal(cov.ready, true,
            `${type} still blocks pricing: ${cov.missingCritical.map((f) => f.id).join(', ')}`);
    }
});

test('a default never overwrites an answer, a guess or a skip', () => {
    const { applyStandardDefaults } = load();
    const p = proj('charger', {
        connection_size: { value: '3×63 ומעלה', source: 'user', skipped: false },
        charger_power: { value: '22kW תלת-פאזי (3×32A)', source: 'ai', skipped: false },
        mounting: { value: '', source: 'user', skipped: true },
    });
    applyStandardDefaults(p);
    assert.equal(p.spec.answers.connection_size.value, '3×63 ומעלה');
    assert.equal(p.spec.answers.connection_size.source, 'user');
    assert.equal(p.spec.answers.charger_power.source, 'ai');
    assert.equal(p.spec.answers.mounting.skipped, true);
    assert.equal(p.spec.answers.distance_m.source, 'std', 'the untouched fields still get filled');
});

test('applying twice changes nothing (it is not a reset button)', () => {
    const { applyStandardDefaults } = load();
    const p = proj('panel');
    applyStandardDefaults(p);
    p.spec.answers.mount = { value: 'על הטיח (צמוד)', source: 'user', skipped: false };
    const filled = applyStandardDefaults(p);
    assert.equal(filled, 0);
    assert.equal(p.spec.answers.mount.value, 'על הטיח (צמוד)');
});

test('a critical question with no standard answer starts as "not checked yet"', () => {
    // Photos and "what is at the end of the run" have no common case. Left
    // empty they would keep the gate shut on every new job, so the standard for
    // them is a marked skip: answered enough to price, honest enough to print.
    const { applyStandardDefaults } = load();
    const p = proj('panel');
    applyStandardDefaults(p);
    assert.equal(p.spec.answers.photos.skipped, true);
    assert.equal(p.spec.answers.photos.source, 'std');
    // Nothing optional is skipped on his behalf.
    const optionalText = CHECKLISTS.panel.fields.filter((f) => !f.critical && f.type === 'text');
    for (const f of optionalText) assert.equal(p.spec.answers[f.id], undefined, f.id);
});

test('a critical field still on its default prints as an assumption', () => {
    const { applyStandardDefaults, specAssumptions, pendingStdFields } = load();
    const p = proj('charger');
    applyStandardDefaults(p);
    const before = specAssumptions(p).length;
    assert.ok(before > 0, 'a quote built on untouched standards must say so');
    assert.ok(pendingStdFields(p).length >= before,
        'every printed assumption comes from a field still marked "סטנדרט"');

    // Confirming them is what clears the paragraph, exactly as tapping would.
    pendingStdFields(p).forEach((f) => { p.spec.answers[f.id].source = 'user'; });
    assert.equal(specAssumptions(p).length, 0);
    assert.equal(pendingStdFields(p).length, 0);
});

test('a question whose premise does not hold is not answered by default either', () => {
    const { applyStandardDefaults } = load();
    // showWhen fields exist across the checklists; none of them may be filled
    // in when the field they depend on says otherwise.
    for (const [type, list] of Object.entries(CHECKLISTS)) {
        const conditional = list.fields.filter((f) => f.showWhen && f.showWhen.field);
        if (!conditional.length) continue;
        const p = proj(type);
        applyStandardDefaults(p);
        for (const f of conditional) {
            const premise = p.spec.answers[f.showWhen.field];
            const holds = premise && !premise.skipped && premise.value
                && (!Array.isArray(f.showWhen.in) || f.showWhen.in.includes(premise.value));
            if (!holds) assert.equal(p.spec.answers[f.id], undefined,
                `${type}.${f.id} was answered although its premise does not hold`);
        }
    }
});

test('a straight panel swap is not blocked by the main breaker size', () => {
    // Stav, 22/08: "אם מחליפים ראש בראש אז גודל החיבור לא רלוונטי אלא כמות
    // המודולים." The question stays — it is worth knowing — but it stops being
    // the thing that holds the gate shut, and the module count takes over.
    const { applyStandardDefaults, specCoverage } = load();
    const swap = proj('panel', { job_scope: { value: 'החלפת לוח קיים על אותו חיבור', source: 'user', skipped: false } });
    applyStandardDefaults(swap);
    delete swap.spec.answers.main_size;
    assert.equal(specCoverage(swap).ready, true, 'a swap should price without it');

    // On a supply upgrade it is exactly the number that decides the job.
    const upgrade = proj('panel', { job_scope: { value: 'הגדלת חיבור או מעבר חד→תלת כולל לוח', source: 'user', skipped: false } });
    applyStandardDefaults(upgrade);
    delete upgrade.spec.answers.main_size;
    const cov = specCoverage(upgrade);
    assert.equal(cov.ready, false);
    assert.ok(cov.missingCritical.some((f) => f.id === 'main_size'));

    // And the module count now blocks on every panel job.
    const modules = CHECKLISTS.panel.fields.find((f) => f.id === 'panel_size_fit');
    assert.equal(modules.critical, true);
});

test('a new point is asked whether it is chased in or run on the wall', () => {
    const { applyStandardDefaults } = load();
    const adding = proj('points', { work_scope_type: { value: 'הוספת נקודות חדשות', source: 'user', skipped: false } });
    applyStandardDefaults(adding);
    assert.equal(adding.spec.answers.install_visibility.value, 'סמויה · חציבה וסגירה בקיר');

    // Swapping a faceplate in an existing box has no such question.
    const swapping = proj('points', { work_scope_type: { value: 'החלפת אביזר במקום קיים', source: 'user', skipped: false } });
    applyStandardDefaults(swapping);
    assert.equal(swapping.spec.answers.install_visibility, undefined);
});

test('a charger route starts as new work, because it always is', () => {
    // Stav: "ברור שאין צנרת ריקה. תמיד עמדת טעינה זה מחדש."
    assert.equal(DEFAULTS.charger.route_type, 'תעלה גלויה על הקיר (עה"ט)');
    assert.doesNotMatch(DEFAULTS.charger.route_type, /צנרת ריקה|חוט משיכה/);
});

test('a fault call defaults to pricing the diagnosis, not the repair', () => {
    // "לפעמים גוף תקול, לפעמים קו, לפעמים סתם מנורת שולחן שהלקוח זורק" — a
    // repair price quoted before the finding is a number that will be wrong.
    assert.equal(DEFAULTS.fault.repair_scope, 'תלוי בממצא · אאשר טלפונית בשטח');
});

test('a panel swap opens on a hung standard panel, so what is left is its size', () => {
    // Stav, 22/08: "תעשה שלהחלפת לוח הדיפולט זה לוח תלוי סטנדרטי אז מה שנשאר
    // זה לשאול כמה מקום הלוח."
    const { applyStandardDefaults } = load();
    const p = proj('panel');
    applyStandardDefaults(p);
    assert.equal(p.spec.answers.mount.value, 'על הטיח (צמוד)');
    assert.equal(p.spec.answers.panel_size_fit.value, '24 מקום');
    // A hung panel does not care about the old opening, so it is not asked.
    assert.equal(p.spec.answers.panel_niche, undefined);

    // Choose a flush panel and the niche question appears, with its own default.
    p.spec.answers.mount = { value: 'תחת הטיח (שקוע)', source: 'user', skipped: false };
    applyStandardDefaults(p);
    assert.equal(p.spec.answers.panel_niche.value, 'נכנס לפתח הקיים');

    // And the size question is now about modules only.
    const size = CHECKLISTS.panel.fields.find((f) => f.id === 'panel_size_fit');
    assert.deepEqual(size.chips, ['12 מקום', '24 מקום', '36 מקום', '48 מקום ומעלה']);
});

test('chasing asks what the wall is, because block and concrete are different money', () => {
    const { applyStandardDefaults, specCoverage } = load();
    const chase = proj('points', {
        work_scope_type: { value: 'הוספת נקודות חדשות', source: 'user', skipped: false },
        install_visibility: { value: 'סמויה · חציבה וסגירה בקיר', source: 'user', skipped: false },
    });
    applyStandardDefaults(chase);
    assert.ok(chase.spec.answers.wall_type, 'the wall must be asked when chasing');
    delete chase.spec.answers.wall_type;
    assert.equal(specCoverage(chase).ready, false, 'and it must block until answered');

    // Surface trunking never touches the wall's insides.
    const surface = proj('points', {
        work_scope_type: { value: 'הוספת נקודות חדשות', source: 'user', skipped: false },
        install_visibility: { value: 'גלויה · תעלה או פיטינג על הטיח', source: 'user', skipped: false },
    });
    applyStandardDefaults(surface);
    assert.equal(surface.spec.answers.wall_type, undefined);
    assert.equal(specCoverage(surface).ready, true);
});

test('a messy panel asks for mapping HOURS, because that is how it is billed', () => {
    // "מיפוי זה גם ככה מתומחר רק לפי שעות" — so the checklist asks for hours
    // instead of printing a warning nobody prices.
    const { applyStandardDefaults } = load();
    const messy = proj('inspection');
    applyStandardDefaults(messy);          // circuit_mapping defaults to partial
    assert.equal(messy.spec.answers.mapping_hours.value, '3 שעות');

    const tidy = proj('inspection', { circuit_mapping: { value: 'מסומן ומסודר', source: 'user', skipped: false } });
    applyStandardDefaults(tidy);
    assert.equal(tidy.spec.answers.mapping_hours, undefined, 'a labelled panel needs no mapping hours');
});

test('answering a premise seeds the question it just made askable', () => {
    // The niche question does not exist until the panel is flush; the moment it
    // does, it should open on its standard like everything else rather than sit
    // empty because the seeding already ran once.
    const { applyStandardDefaults } = load();
    const p = proj('panel');
    applyStandardDefaults(p);
    assert.equal(p.spec.answers.panel_niche, undefined);
    p.spec.answers.mount = { value: 'תחת הטיח (שקוע)', source: 'user', skipped: false };
    applyStandardDefaults(p);              // what setSpecAnswer now does for real
    assert.equal(p.spec.answers.panel_niche.value, 'נכנס לפתח הקיים');
    assert.equal(p.spec.answers.panel_niche.source, 'std');
});
