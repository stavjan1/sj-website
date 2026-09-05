// THE GUIDE. Stav, 4.9.2026: the electrician should never wonder what to do
// next. One road in the ctx-bar, one lit step, one card with one sentence and
// one button, and a stopping point where the ball is with the customer.
//
// Two things these pin that a reviewer cannot see from the screen:
//   * the step math is a pure function of persisted facts, so it must agree
//     with itself (a sent quote was priced and confirmed, whatever the flags);
//   * every sentence on the after-send card is something the code actually
//     does. A promised reminder the app cannot send is the exact lie this
//     layer exists to remove, so the text is checked against the code both
//     ways: no reminder function → no reminder word; reminder function → the
//     wording names the bell that really carries it, and nothing more.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readApp } from './_app-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readApp();
const appJs = readFileSync(join(ROOT, 'site/sale/app.js'), 'utf8').replace(/\r\n/g, '\n');
const chatJs = readFileSync(join(ROOT, 'site/sale/chat.js'), 'utf8').replace(/\r\n/g, '\n');
const html = readFileSync(join(ROOT, 'site/sale/index.html'), 'utf8').replace(/\r\n/g, '\n');
const css = readFileSync(join(ROOT, 'site/sale/css/panels.css'), 'utf8').replace(/\r\n/g, '\n');

function slice(from, to, src = appJs) {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a + 1);
    assert.ok(a > -1 && b > a, `${from} … ${to} moved or was renamed`);
    return src.slice(a, b);
}
function fnBody(name, src = appJs) {
    const a = src.indexOf(`function ${name}(`);
    assert.ok(a > -1, `${name} is missing`);
    const b = src.indexOf('\n}\n', a);
    return src.slice(a, b + 3);
}

// ── A fake DOM just big enough for the guide's renderers ────────────────────
function fakeDoc(ids, opts = {}) {
    const els = {};
    for (const id of ids) {
        els[id] = { id, hidden: true, innerHTML: '', value: '', title: '', attrs: {},
            classes: new Set(),
            setAttribute(k, v) { this.attrs[k] = v; },
            classList: { toggle(c, on) { on ? els[id].classes.add(c) : els[id].classes.delete(c); } } };
    }
    return {
        els,
        activeElement: opts.active || null,
        body: { classList: { add() {}, remove() {} } },
        getElementById: (id) => els[id] || null,
        querySelector: (sel) => (opts.query || (() => null))(sel),
        querySelectorAll: () => [],
        listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; },
    };
}

// The guide's model and renderers, loaded once into a vm with the app's
// small helpers stubbed. escapeHtml is the real one.
function loadGuide(ctx0 = {}) {
    const src = fnBody('escapeHtml')
        + slice('const GUIDE_STEPS = [', '// לקוחות and כסף');
    const ctx = vm.createContext(Object.assign({
        Date, Number, Math, Boolean, Array, Object, String, Set, console, setTimeout, clearTimeout,
        appState: { settings: {} }, projectsList: [], activeProjectId: null,
        CTX_STEPS: { wizard: 1, pricing: 1, create: 1 },
        isJob: (p) => !!p && p.kind !== 'ask',
        saveProjects() { ctx.saved = (ctx.saved || 0) + 1; },
        persistSettings() { ctx.persisted = (ctx.persisted || 0) + 1; },
        switchTab(t) { ctx.switched = t; },
        showToast() {}, filterProjectsList() {}, updateActiveProjectBanner() {},
        formatHebrewDate: (s) => s.slice(0, 10),
        FOLLOWUP_AFTER_DAYS: 3,
        document: fakeDoc(['ctx-road', 'ctx-guide', 'guide-card-wizard', 'guide-card-pricing', 'guide-card-create']),
    }, ctx0));
    vm.runInContext(src, ctx);
    return ctx;
}

const job = (o) => Object.assign({ id: 'p1', kind: 'job', status: 'טיוטה', name: 'x' }, o);

// ── 1. The road ─────────────────────────────────────────────────────────────
test('the ctx-bar carries the road and the switch, and the three panels each have one card slot', () => {
    assert.match(html, /<ol class="ctx-road" id="ctx-road"[^>]*hidden>/, 'the road is an ordered list in the ctx-bar');
    assert.match(html, /id="ctx-guide"[^>]*onclick="toggleGuide\(\)"/, 'the switch sits in the ctx-bar');
    for (const id of ['guide-card-wizard', 'guide-card-pricing', 'guide-card-create']) {
        assert.match(html, new RegExp(`<div class="guide-card" id="${id}" hidden></div>`), `${id} slot`);
    }
    // The road replaces the crumb inside a job, so the two never say the same thing twice.
    const crumb = fnBody('renderCtxCrumb');
    assert.match(crumb, /crumb\.hidden = !show \|\| road/, 'inside a job the crumb yields to the road');
    assert.match(crumb, /renderGuideBar\(/);
    // The draft screen's own copy of the three steps is hidden, not deleted: goToStage still needs it.
    assert.match(html, /id="draft-stage-rail"[^>]*hidden>/, 'the second copy of the road on the quote screen is hidden');
    assert.match(css, /\.ctx-road\s*\{/);
    assert.match(css, /\.road-step\.is-current/);
    assert.match(css, /\.road-step\.is-done/);
});

test('step math: a later step done implies the earlier ones, and the lit step is the first open one', () => {
    const { guideStepState } = loadGuide();
    let st = guideStepState(job({}));
    assert.deepEqual([...st.done], [false, false, false]);
    assert.equal(st.step, 1, 'a fresh job starts at the description');

    st = guideStepState(job({ chatHistory: [{ role: 'model', parts: [{ text: 'שלום! תאר לי את העבודה' }] }] }));
    assert.equal(st.done[0], false, 'the opening greeting is a model turn, and it is not a price');
    assert.equal(st.step, 1);

    st = guideStepState(job({ chatHistory: [{ role: 'model' }, { role: 'user', content: 'x' }] }));
    assert.equal(st.step, 1, 'his own message is not a price yet');

    st = guideStepState(job({ chatHistory: [{ role: 'model' }, { role: 'user', content: 'x' }, { role: 'model', content: '...' }] }));
    assert.deepEqual([...st.done], [true, false, false], 'the pricing answer closes step 1');
    assert.equal(st.step, 2);

    st = guideStepState(job({ materials: [{ name: 'כבל' }] }));
    assert.equal(st.done[0], true, 'materials on the job close step 1 too');

    st = guideStepState(job({ materials: [{}] }));
    assert.equal(st.done[0], false, 'an empty materials row is not a priced job');

    st = guideStepState(job({ guide: { done: [false, true, false] } }));
    assert.deepEqual([...st.done], [true, true, false], 'confirmed quantities imply a priced job');
    assert.equal(st.step, 3);

    st = guideStepState(job({ guide: { done: [false, false, false], sentAt: 1700000000000 } }));
    assert.deepEqual([...st.done], [true, true, true], 'a quote that left was priced and confirmed, whatever the flags');
    assert.equal(st.step, 3, 'the road ends at 3; there is no step 4');

    // Review, 5.9.2026: quoteOutAt is stamped on a PDF download and on a
    // copied link — neither is a send. A PDF printed to read at home must not
    // tick "הצעה ושליחה", start the follow-up clock, or say "ממתין ללקוח".
    st = guideStepState(job({ quoteOutAt: 1700000000000 }));
    assert.equal(st.done[2], false, 'quoteOutAt alone (a download, a copied link) is not a send');
    assert.deepEqual([...st.done], [true, true, false], 'but a quote that left was built: 1 and 2 are behind him');
    assert.equal(st.step, 3, 'and the road stands on 3, where the question "שלחת?" is asked');
    assert.equal(st.outAt, 1700000000000, 'the date the quote left is exposed for that question');
    assert.equal(st.sentAt, 0);

    st = guideStepState(job({ status: 'נשלח', statusChangedAt: 1700000000000 }));
    assert.deepEqual([...st.done], [true, true, true], 'a status he moved past טיוטה is a send, whatever the stamps');
    assert.equal(st.sentAt, 1700000000000, 'dated by the status change');
    st = guideStepState(job({ status: 'שולם', quoteOutAt: 5 }));
    assert.equal(st.done[2], true, 'a paid job was sent');
    assert.equal(st.sentAt, 5, 'falls back to quoteOutAt for a date');

    assert.doesNotThrow(() => guideStepState(null), 'a missing project is not a crash');
    assert.doesNotThrow(() => guideStepState(job({ guide: 'garbage', materials: 'nope' })));
});

test('the road paints three steps, ticks the done ones, lights the tab he stands on', () => {
    const ctx = loadGuide();
    const road = ctx.document.els['ctx-road'];
    const proj = job({ chatHistory: [{ role: 'user', content: 'x' }, { role: 'model', content: 'x' }] });
    ctx.renderGuideBar(proj, 'pricing');
    assert.equal(road.hidden, false);
    const steps = road.innerHTML.match(/<li class="road-step[^"]*"/g) || [];
    assert.equal(steps.length, 3);
    assert.match(steps[0], /is-done/, 'step 1 ticked');
    assert.doesNotMatch(steps[0], /is-current/);
    assert.match(steps[1], /is-current/, 'step 2 lit — it is the tab he is on');
    assert.doesNotMatch(steps[2], /is-done|is-current/);
    assert.match(road.innerHTML, /<span class="road-n">✓<\/span><span class="road-l">תיאור העבודה<\/span>/, 'a done step shows a tick, not its number');
    assert.match(road.innerHTML, /aria-current="step"/);
    for (const l of ['תיאור העבודה', 'אישור כמויות', 'הצעה ושליחה']) assert.ok(road.innerHTML.includes(l), l);
    assert.equal((road.innerHTML.match(/onclick="guideGo\(\d\)"/g) || []).length, 3, 'every step is a door to its tab');

    ctx.renderGuideBar(null, 'pricing');
    assert.equal(road.hidden, true, 'no project, no road');
    assert.equal(road.innerHTML, '');
    ctx.renderGuideBar(proj, 'home');
    assert.equal(road.hidden, true, 'outside the three project tabs there is no road');
});

test('a step on the road opens its tab through switchTab, like the rail', () => {
    const ctx = loadGuide({ activeProjectId: 'p1' });
    ctx.guideGo(3);
    assert.equal(ctx.switched, 'create');
    ctx.guideGo(1);
    assert.equal(ctx.switched, 'wizard');
});

// ── 2. One card per step, and the × ─────────────────────────────────────────
test('each step carries one sentence and the button the task named', () => {
    assert.ok(appJs.includes('תאר את העבודה במשפט אחד, כמו לקולגה בוואטסאפ.'), 'step 1');
    assert.ok(appJs.includes('עין מהירה על החומרים והמחירים — תקן מה שצריך.'), 'step 2');
    assert.match(appJs, /המשך להצעה <i class="fa-solid fa-arrow-left"/, 'step 2 button');
    assert.ok(appJs.includes('ההצעה מוכנה. שלח ללקוח.'), 'step 3');
    assert.match(appJs, /onclick="shareWhatsApp\(\)">📲 שלח בוואטסאפ</, 'step 3 button is the existing WhatsApp share');
    assert.match(appJs, /class="gc-quiet" onclick="downloadPDF\(\)">הורד PDF</, 'and a quiet PDF');
    // Step 1 reuses the chat's own chips rather than inventing new ones.
    const step1 = fnBody('_guideWizardCardHtml');
    assert.match(step1, /\.chat-suggestions \.chip/, 'the chips are cloned from the composer row');
    assert.match(css, /body\.guide-step1-card \.chat-suggestions \{ display: none !important; \}/,
        'and the composer row hides so they are not on screen twice (renderChatHistory sets display inline, so !important)');
});

test('the pricing card renders in its slot, and × dismisses it for this project only', () => {
    const proj = job({ chatHistory: [{ role: 'user', content: 'x' }, { role: 'model', content: 'x' }] });
    const other = job({ id: 'p2', chatHistory: [{ role: 'user', content: 'x' }, { role: 'model', content: 'x' }] });
    const ctx = loadGuide({
        activeProjectId: 'p1', projectsList: [proj, other],
        document: fakeDoc(['ctx-road', 'ctx-guide', 'guide-card-wizard', 'guide-card-pricing', 'guide-card-create'],
            { query: (sel) => sel === '.content-panel.active' ? { id: 'panel-pricing' } : null }),
    });
    const slot = ctx.document.els['guide-card-pricing'];
    ctx.renderGuideCards();
    assert.equal(slot.hidden, false);
    assert.ok(slot.innerHTML.includes('עין מהירה על החומרים והמחירים'));
    assert.match(slot.innerHTML, /onclick="guideContinueToQuote\(\)"/);
    assert.match(slot.innerHTML, /class="gc-x" onclick="dismissGuideCard\(\)"/, 'the × is there');
    assert.equal(ctx.document.els['guide-card-wizard'].hidden, true, 'only the open screen has a card');

    ctx.dismissGuideCard();
    assert.equal(proj.guide.off, true, 'dismissal is stored on the project');
    assert.equal(slot.hidden, true, 'and the card is gone');
    assert.ok(!other.guide || !other.guide.off, 'the other project keeps its cards');
});

test('step 2 button marks step 2 done and walks to the quote', () => {
    const proj = job({ chatHistory: [{ role: 'user', content: 'x' }, { role: 'model', content: 'x' }] });
    const ctx = loadGuide({ activeProjectId: 'p1', projectsList: [proj] });
    ctx.guideContinueToQuote();
    assert.deepEqual([...ctx.guideStepState(proj).done], [true, true, false]);
    assert.equal(proj.guide.step, 3);
    assert.equal(ctx.switched, 'create');
    assert.ok(ctx.saved >= 1, 'persisted');
    // Standing on the quote screen is the same confirmation, whichever door he used.
    assert.match(fnBody('switchTab'), /if \(tabId === 'create'\) \{\s*const gp = guideActiveProject\(\);\s*if \(gp && guideStepState\(gp\)\.done\[0\]\) guideMarkDone\(gp, 2\);/);
});

test('step 3 with money on the table and none in the quote says "build it from the table" — whatever nextstep.js is doing', () => {
    // Review, 5.9.2026: the card sent a priced job back to step 1 ("עוד אין
    // מחיר"), whose card sent it forward again — a loop. nextstep's
    // 'draft-empty' is muted after two quotes and needs proj.stage === 'draft',
    // which the road's own door never sets, so the guide says it itself.
    const proj = job({ materials: [{ name: 'כבל', checked: true }] });
    const mk = (extra) => loadGuide(Object.assign({
        activeProjectId: 'p1', projectsList: [proj],
        pricingTotals: () => ({ total: 13680 }),
        document: fakeDoc(['ctx-road', 'ctx-guide', 'guide-card-wizard', 'guide-card-pricing', 'guide-card-create'],
            { query: (sel) => sel === '.content-panel.active' ? { id: 'panel-create' } : null }),
    }, extra));
    const ctx = mk({ nextStepFor: () => null });                  // muted, or the stage never reached 'draft'
    const slot = ctx.document.els['guide-card-create'];
    ctx.renderGuideCards();
    assert.equal(slot.hidden, false);
    assert.ok(slot.innerHTML.includes('בטבלת התמחור יש 13,680 ₪'), 'the money is named');
    assert.match(slot.innerHTML, /onclick="ptToQuote\(\)"/, 'and the one button carries it over');
    assert.ok(!slot.innerHTML.includes('חזור לתיאור העבודה'), 'no loop back to step 1');
    // nextstep already saying it on this screen: the guide yields, one card.
    const busy = mk({ nextStepFor: () => ({ id: 'draft-empty', home: 'draft' }) });
    busy.renderGuideCards();
    assert.equal(busy.document.els['guide-card-create'].hidden, true);
    // Nothing priced anywhere: the honest step is still "go get a price".
    const bare = mk({ pricingTotals: () => ({ total: 0 }), nextStepFor: () => null, projectsList: [job({})] });
    bare.renderGuideCards();
    assert.ok(bare.document.els['guide-card-create'].innerHTML.includes('עוד אין מחיר בהצעה'));
    // And step 2's button takes the table's rows with it when the quote is empty.
    const cont = fnBody('guideContinueToQuote');
    assert.match(cont, /if \(rows\.length\) \{ ptToQuote\(\); return; \}/, 'step 2 → ptToQuote when there are rows and the quote is empty');
    assert.match(cont, /quoteHasMoney/, 'what he already wrote in the quote is his');
});

test('the sample project is not a slot on the plan', () => {
    // Review, 5.9.2026: a guest (cap 1) who loaded the sample could not open
    // his own first job — "פרויקט חדש" opened the upgrade modal.
    assert.match(fnBody('countJobs'), /isJob\(p\) && !isSampleProject\(p\)/);
});

test('the "describe the job" card goes quiet the moment he speaks', () => {
    // Review, 5.9.2026: the card and its cloned chips stayed for the whole
    // planning conversation; a chip click sent a second job into the thread.
    const send = fnBody('sendChatMessage', chatJs);
    const plan = send.slice(send.indexOf("activeChatMode === 'plan'"));
    assert.match(plan, /renderSpecCard\(activeProject\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*try \{ renderGuideCards\(\); \} catch \(e\) \{\}/, 'plan branch re-renders the card after his turn');
    assert.match(send, /activeProject\.chatHistory\.push\(userMsg\);[\s\S]*?try \{ renderGuideCards\(\); \} catch \(e\) \{\}[\s\S]*?await runPricingAgent/, 'price branch too');
});

test('under 360px the road keeps its three circles', () => {
    const tiny = css.slice(css.indexOf('@media (max-width: 359px) {'));
    assert.ok(tiny.length > 0, 'a sub-360 rule exists');
    assert.match(tiny, /\.ctx-bar \.ctx-road \{ flex: 0 0 auto;/, 'the road no longer shrinks');
    assert.match(tiny, /\.ctx-bar \.ctx-works svg \{ display: none; \}/, 'the arrow gives way, the word stays');
    assert.match(tiny, /\.ctx-road:not\(\[hidden\]\) ~ \.ctx-guide \{ display: none; \}/, 'the switch gives way (settings mirror it)');
});

// ── 3. Auto-advance ─────────────────────────────────────────────────────────
test('the pricing answer hands the project to the guide from the one place it lands', () => {
    const agent = fnBody('runPricingAgent', chatJs);
    assert.match(agent, /applyMaterialsFromResponse\(activeProject, responseText\);\s*\n[^\n]*\n?\s*try \{ guideOnPriced\(activeProject\); \} catch \(e\) \{\}/,
        'guideOnPriced is called right after the materials are applied');
    assert.equal((chatJs.match(/guideOnPriced\(/g) || []).length, 1, 'exactly one call in chat.js');
});

test('auto-advance is gated on the guide switch, the open tab, and an empty, idle chat input', () => {
    const wizardActive = (sel) => sel === '#panel-wizard.active' ? {} : null;
    const mk = (settings, inputValue, opts = {}) => {
        const doc = fakeDoc(['chat-user-input'], { query: opts.query || wizardActive });
        doc.els['chat-user-input'].value = inputValue;
        if (opts.focused) doc.activeElement = doc.els['chat-user-input'];
        return loadGuide({ appState: { settings }, activeProjectId: 'p1', document: doc });
    };
    const proj = job({});
    assert.equal(mk({}, '').guideCanAutoAdvance(proj), true, 'guide on by default, empty input: advance');
    assert.equal(mk({ guideOn: false }, '').guideCanAutoAdvance(proj), false, 'guide off: never');
    assert.equal(mk({}, 'עוד שלוש נקודות').guideCanAutoAdvance(proj), false, 'something half-typed: never');
    assert.equal(mk({}, '', { query: () => null }).guideCanAutoAdvance(proj), false, 'not on the chat tab: never');
    assert.equal(mk({}, '').guideCanAutoAdvance(job({ id: 'other' })), false, 'a different project than the open one: never');
    assert.equal(mk({}, '').guideCanAutoAdvance(job({ guide: { done: [false, false, false], off: true } })), false, 'he closed the cards on this job: never');
    const focused = mk({}, '', { focused: true });
    focused.document.listeners.input({ target: { id: 'chat-user-input' } });   // he just typed (and cleared) something
    assert.equal(focused.guideCanAutoAdvance(proj), false, 'focused and typed a moment ago: mid-thought, never');

    // And the walk itself happens on a timer that re-checks the gate.
    const onPriced = fnBody('guideOnPriced');
    assert.match(onPriced, /if \(!wasNew \|\| !guideCanAutoAdvance\(proj\)\) return;/);
    assert.match(onPriced, /setTimeout\(\(\) => \{\s*if \(!guideCanAutoAdvance\(proj\)\) return;[^\n]*\n\s*switchTab\('pricing'\);/);
    assert.match(css, /\.guide-card \{[\s\S]*?animation: gc-in var\(--t-fast\);/, 'a CSS fade, no animation library');
    assert.match(css, /prefers-reduced-motion: reduce\) \{ \.guide-card \{ animation: none; \}/);
});

test('guideOnPriced marks step 1 once, and a second answer does not walk him again', () => {
    const proj = job({ materials: [{ name: 'כבל', checked: true, price: 10, qty: 1 }] });
    const doc = fakeDoc(['chat-user-input'], { query: (sel) => sel === '#panel-wizard.active' ? {} : null });
    const ctx = loadGuide({ activeProjectId: 'p1', projectsList: [proj], document: doc,
        renderCtxCrumb() {}, setTimeout: (fn) => { ctx.timerFn = fn; return 1; } });
    ctx.guideOnPriced(proj);
    assert.equal(proj.guide.done[0], true);
    assert.equal(typeof ctx.timerFn, 'function', 'the walk is armed');
    ctx.timerFn();
    assert.equal(ctx.switched, 'pricing');
    ctx.switched = null; ctx.timerFn = null;
    ctx.guideOnPriced(proj);
    assert.equal(ctx.timerFn, null, 'a second pricing answer means he came back on purpose');
    ctx.guideOnPriced(job({ kind: 'ask' }));
    assert.equal(ctx.timerFn, null, 'a question has no road');
});

test('an answer in prose does not walk him to an empty table; the answer that brings numbers does', () => {
    // Review, 5.9.2026: applyMaterialsFromResponse leaves the table empty when
    // the reply carries no JSON, and the walk landed him on "עין מהירה על
    // החומרים" over nothing. nextstep's own 'price-empty' card cannot fire on
    // that path (the only user turn after priceThisProject is the handoff).
    const proj = job({ chatHistory: [{ role: 'model' }, { role: 'user', content: 'x' }, { role: 'model', content: 'בערך 3000 ₪' }] });
    const doc = fakeDoc(['chat-user-input', 'ctx-road', 'ctx-guide', 'guide-card-wizard', 'guide-card-pricing', 'guide-card-create'],
        { query: (sel) => sel === '#panel-wizard.active' ? {} : sel === '.content-panel.active' ? { id: 'panel-wizard' } : null });
    const ctx = loadGuide({ activeProjectId: 'p1', projectsList: [proj], document: doc,
        renderCtxCrumb() {}, setTimeout: (fn) => { ctx.timerFn = fn; return 1; } });
    ctx.guideOnPriced(proj);
    assert.equal(proj.guide.done[0], true, 'the agent answered: step 1 is ticked');
    assert.equal(ctx.timerFn, undefined, 'but nothing to look at on the table, so no walk');
    const card = ctx.document.els['guide-card-wizard'];
    assert.equal(card.hidden, false);
    assert.ok(card.innerHTML.includes('התמחור לא החזיר מספרים'), 'the card asks for the numbers instead');
    assert.match(card.innerHTML, /onclick="sendSuggestedChatPrompt\('פרט את התמחור:/, 'with the same request nextstep offers');
    assert.ok(!card.innerHTML.includes('התמחור התקבל'), 'and does not call an empty table "received"');
    // The detailed answer lands with rows: this is the first real pricing, and the walk happens now.
    proj.materials = [{ name: 'כבל', checked: true, price: 10, qty: 1 }];
    proj.chatHistory.push({ role: 'user', content: 'פרט' }, { role: 'model', content: '{...}' });
    ctx.guideOnPriced(proj);
    assert.equal(typeof ctx.timerFn, 'function', 'the answer with numbers arms the walk');
    ctx.renderGuideCards();
    assert.ok(card.innerHTML.includes('התמחור התקבל'), 'and the card is the door to step 2');
});

// ── 4. The stopping point ───────────────────────────────────────────────────
test('only WhatsApp is a send; a download or a copied link only repaints, and asks', () => {
    // Review, 5.9.2026: guideQuoteSent used to fire on downloadPDF and on the
    // link's clipboard write — "ההצעה נשלחה" over a toast that said "שלח
    // ללקוח", status flipped, follow-up clock running on a printed draft.
    const wa = fnBody('shareWhatsApp');
    const outs = (wa.match(/markQuoteOut\(\);/g) || []).length;
    const sent = (wa.match(/try \{ guideQuoteSent\(\{ link: [^}]+\}\); \} catch \(e\) \{\}/g) || []).length;
    assert.ok(outs > 0, 'shareWhatsApp stamps quoteOutAt');
    assert.equal(sent, outs, `shareWhatsApp: every markQuoteOut has the send hook beside it, with the link flag (${sent}/${outs})`);
    assert.match(wa, /guideQuoteSent\(\{ link: false \}\)/, 'the file share carries no link in its text');
    assert.match(wa, /guideQuoteSent\(\{ link: !!shareLink \}\)/, 'the text share carries the link only when currentShareLink still matches');
    for (const fn of ['shareQuoteLink', 'downloadPDF']) {
        const body = fnBody(fn);
        const o = (body.match(/markQuoteOut\(\);/g) || []).length;
        const h = (body.match(/try \{ guideQuoteOut\(\); \} catch \(e\) \{\}/g) || []).length;
        assert.ok(o > 0, `${fn} stamps quoteOutAt`);
        assert.equal(h, o, `${fn}: every markQuoteOut repaints the guide (${h}/${o})`);
        assert.ok(!body.includes('guideQuoteSent'), `${fn} is not a send`);
    }
    // The question, on the quote screen, and his answer.
    const proj = job({ quoteOutAt: Date.UTC(2026, 8, 4), quoteData: { basePrice: 1200 } });
    const ctx = loadGuide({
        activeProjectId: 'p1', projectsList: [proj],
        document: fakeDoc(['ctx-road', 'ctx-guide', 'guide-card-wizard', 'guide-card-pricing', 'guide-card-create'],
            { query: (sel) => sel === '.content-panel.active' ? { id: 'panel-create' } : null }),
    });
    const slot = ctx.document.els['guide-card-create'];
    ctx.renderGuideCards();
    assert.equal(slot.hidden, false);
    assert.ok(slot.innerHTML.includes('ההצעה יצאה ב-2026-09-04'), 'the fact: it left, and when');
    assert.ok(slot.innerHTML.includes('שלחת אותה ללקוח?'), 'the question');
    assert.ok(!slot.innerHTML.includes('ההצעה נשלחה'), 'no claim it was sent');
    assert.match(slot.innerHTML, /onclick="guideMarkSent\(\)">שלחתי ללקוח</, 'his answer is one tap');
    assert.match(slot.innerHTML, /onclick="shareWhatsApp\(\)"/, 'or the real send');
    assert.equal(proj.status, 'טיוטה', 'nothing flipped the status for him');
    ctx.guideMarkSent();
    assert.equal(proj.status, 'נשלח');
    assert.ok(proj.guide.sentAt > 0);
    assert.equal(proj.guide.sentLink, false, 'no link on the project: the card will not promise link approval');
    assert.ok(slot.innerHTML.includes('ההצעה נשלחה. עכשיו הכדור אצל הלקוח.'), 'now it is sent');
    const first = proj.guide.sentAt;
    ctx.guideQuoteSent({ link: true });
    assert.equal(proj.guide.sentAt, first, 'a re-send does not move the date');
    assert.equal(proj.guide.sentLink, true, 'but records that this time a link went');
});

test('guideQuoteSent completes the road, stamps sentAt, and moves a draft to נשלח without pulling a later status back', () => {
    const proj = job({});
    const ctx = loadGuide({ activeProjectId: 'p1', projectsList: [proj] });
    const before = Date.now();
    ctx.guideQuoteSent();
    assert.deepEqual([...proj.guide.done], [true, true, true]);
    assert.ok(proj.guide.sentAt >= before);
    assert.equal(proj.status, 'נשלח', 'a draft that left is a sent quote — the status every follow-up rule hangs off');
    assert.ok(proj.statusChangedAt >= before);

    const done = job({ id: 'p1', status: 'הושלם' });
    const ctx2 = loadGuide({ activeProjectId: 'p1', projectsList: [done] });
    ctx2.guideQuoteSent();
    assert.equal(done.status, 'הושלם', 'a status he already moved further along stays');
});

test('the after-send card says only what the code does — checked both ways against the app', () => {
    // Comments off, so a comment that explains what the app does NOT do
    // ("no SMS") cannot trip the banned-word check on the text itself.
    const cardFn = fnBody('_guideSentCardHtml').replace(/^\s*\/\/.*$/gm, '');
    const texts = cardFn;
    assert.ok(texts.includes('ההצעה נשלחה. עכשיו הכדור אצל הלקוח.'), 'the opening line');
    assert.ok(texts.includes('נתראה כשהוא עונה.'), 'the closing line');
    assert.ok(texts.includes('ממתין ללקוח'), 'the folded line');

    // The only reminder this app has is the in-app bell fed by getDueFollowups.
    const hasReminder = /function getDueFollowups\(/.test(app) && /function renderReminderBell\(/.test(app);
    if (hasReminder) {
        assert.ok(texts.includes('הפעמון'), 'with a real bell, the card may point at the bell');
        assert.match(cardFn, /FOLLOWUP_AFTER_DAYS/, 'and the number of days is the code\'s number, not a typed one');
        // The follow-up row is a Pro feature (tierAllows("reminders")): the free wording must not promise it.
        assert.match(cardFn, /tierAllows\('reminders'\)/, 'the sentence is chosen by the plan');
        assert.ok(texts.includes('יספור אותה'), 'free plan: the bell counts, it does not remind');
    } else {
        assert.ok(!texts.includes('הפעמון'), 'no bell in the app, no bell on the card');
    }
    // No promise the app cannot keep, on any plan.
    for (const banned of ['תזכורת', 'נזכיר', 'אזכיר', 'התראה', 'הודעה אוטומטית', 'SMS', 'מייל אוטומטי', 'פוש']) {
        assert.ok(!texts.includes(banned), `the card must not say "${banned}"`);
    }
    // The /q/ link: checkQuoteApproval stamps approvedAt when the project is opened,
    // and the list shows the badge. It does NOT move the status or the money board.
    assert.match(app, /function checkQuoteApproval\(proj\)/);
    assert.ok(fnBody('approvedBadgeHtml').includes('הלקוח אישר'), 'the badge the card names exists');
    assert.ok(texts.includes('"הלקוח אישר"'), 'the card quotes the badge as it really reads');
    assert.ok(!texts.includes('אושרה על ידי הלקוח'), 'not a label that no longer exists');
    assert.ok(!texts.includes('🎉'), 'no confetti on the card');
    assert.match(cardFn, /g\.sentLink/, 'link approval is promised only when the send carried a link');
    assert.ok(texts.includes('בפעם הבאה שתפתח את העבודה'), 'approval is discovered on open, and the card says so');
    assert.ok(!texts.includes('תעבור ללוח הכסף'), 'approval does not move the job to the money board, so the card must not say it does');
    // Without a link, the yes arrives by phone and the next move is his.
    assert.ok(texts.includes('סמן את העבודה "בוצע"'), 'no link: the honest next step is manual');
    assert.ok(!texts.includes('מפיקים חשבונית'), 'issuing an invoice is Business-only (invoicingAllowed): the board tracks it, the card must not promise it');
});

test('re-opening a sent project shows the folded line, and "מה עכשיו?" unfolds it', () => {
    const proj = job({ guide: { done: [true, true, true], sentAt: Date.UTC(2026, 8, 4) }, status: 'נשלח' });
    const mk = () => loadGuide({
        activeProjectId: 'p1', projectsList: [proj],
        tierAllows: () => false,
        document: fakeDoc(['ctx-road', 'ctx-guide', 'guide-card-wizard', 'guide-card-pricing', 'guide-card-create'],
            { query: (sel) => sel === '.content-panel.active' ? { id: 'panel-create' } : null }),
    });
    const ctx = mk();
    const slot = ctx.document.els['guide-card-create'];
    ctx.renderGuideCards();
    assert.equal(slot.hidden, false);
    assert.match(slot.innerHTML, /gc-folded/, 'folded after a reload');
    assert.match(slot.innerHTML, /נשלח ב-2026-09-04 · ממתין ללקוח/);
    assert.match(slot.innerHTML, /onclick="expandGuideSentCard\(\)">מה עכשיו\?</);
    ctx.expandGuideSentCard();
    assert.doesNotMatch(slot.innerHTML, /gc-folded/);
    assert.ok(slot.innerHTML.includes('ההצעה נשלחה. עכשיו הכדור אצל הלקוח.'));
    assert.ok(slot.innerHTML.includes('יספור אותה'), 'free plan wording');
    assert.ok(slot.innerHTML.includes('נתראה כשהוא עונה.'));
    // The customer approved by link: the wait is over, and the card says the next move.
    proj.approvedAt = Date.UTC(2026, 8, 6);
    ctx.renderGuideCards();
    assert.ok(slot.innerHTML.includes('הלקוח אישר ב-2026-09-06'), 'an approved job is not "ממתין ללקוח"');
    assert.ok(slot.innerHTML.replace(/&quot;/g, '"').includes('סמן את העבודה "בוצע"'));
    assert.ok(!slot.innerHTML.includes('ממתין ללקוח'));
    delete proj.approvedAt;
    // Marked בוצע / paid / closed: the road's ticks already say it; no wait card.
    for (const done of [{ status: 'הושלם' }, { status: 'שולם' }, { status: 'נשלח', closedAs: 'lost' }]) {
        Object.assign(proj, done);
        ctx.renderGuideCards();
        assert.equal(slot.hidden, true, `${JSON.stringify(done)}: no "ממתין ללקוח" on a finished job`);
        delete proj.closedAs;
    }
    proj.status = 'נשלח';
    // Guidance off still shows this line: it is a fact about the job, not advice.
    const off = mk();
    off.appState.settings.guideOn = false;
    off.renderGuideCards();
    assert.equal(off.document.els['guide-card-create'].hidden, true, 'off means off: no cards at all');
});

// ── 5. The switch ───────────────────────────────────────────────────────────
test('guideOn round-trips through settings: absent is on, false is off, the toggle persists', () => {
    const ctx = loadGuide({ appState: { settings: {} }, renderCtxCrumb() {},
        document: fakeDoc(['set-guide-on', 'ctx-guide', 'guide-card-wizard', 'guide-card-pricing', 'guide-card-create']) });
    assert.equal(ctx.guideOn(), true, 'default on');
    ctx.setGuideOn(false);
    assert.equal(ctx.appState.settings.guideOn, false);
    assert.equal(ctx.guideOn(), false);
    assert.equal(ctx.persisted, 1, 'written through persistSettings');
    assert.equal(ctx.document.els['set-guide-on'].checked, false, 'the settings row mirrors it');
    assert.equal(ctx.document.els['ctx-guide'].attrs['aria-pressed'], 'false');
    ctx.setGuideOn(true);
    assert.equal(ctx.guideOn(), true);
    assert.equal(ctx.document.els['set-guide-on'].checked, true);
    // Load path: loadSettings syncs the controls from the stored flag.
    assert.match(fnBody('loadSettings'), /syncGuideControls\(\)/);
    assert.match(html, /<input type="checkbox" id="set-guide-on" checked onchange="setGuideOn\(this\.checked\)">/);
    assert.ok(html.includes('🧭 הדרכה מלווה'), 'the settings row is named like the button');
});

test('turning the guide off hides the cards everywhere; the road stays', () => {
    const proj = job({ chatHistory: [{ role: 'user', content: 'x' }, { role: 'model', content: 'x' }] });
    const ctx = loadGuide({
        appState: { settings: { guideOn: false } }, activeProjectId: 'p1', projectsList: [proj],
        document: fakeDoc(['ctx-road', 'ctx-guide', 'guide-card-wizard', 'guide-card-pricing', 'guide-card-create'],
            { query: (sel) => sel === '.content-panel.active' ? { id: 'panel-pricing' } : null }),
    });
    ctx.renderGuideCards();
    assert.equal(ctx.document.els['guide-card-pricing'].hidden, true);
    ctx.renderGuideBar(proj, 'pricing');
    assert.equal(ctx.document.els['ctx-road'].hidden, false, 'the road is where you are, not advice');
    assert.ok(ctx.document.els['ctx-guide'].classes.has('is-off'));
});

test('after five sent quotes, step 1 says once where the switch is', () => {
    const sent = (id) => job({ id, guide: { done: [true, true, true], sentAt: 1 } });
    const fresh = job({ id: 'new' });
    const ctx = loadGuide({ appState: { settings: {} }, activeProjectId: 'new',
        projectsList: [sent('a'), sent('b'), sent('c'), sent('d'), fresh] });
    assert.equal(ctx._guideOffHintHtml(fresh), '', 'four is not five');
    ctx.projectsList.push(sent('e'));
    assert.ok(ctx._guideOffHintHtml(fresh).includes('אפשר לכבות את ההדרכה בכפתור 🧭'), 'five: the hint');
    assert.equal(ctx.appState.settings.guideHintProject, 'new', 'pinned to this project, in settings');
    assert.ok(ctx._guideOffHintHtml(fresh).length > 0, 'still shown while this job is open');
    assert.equal(ctx._guideOffHintHtml(job({ id: 'later' })), '', 'and never on another');
});
