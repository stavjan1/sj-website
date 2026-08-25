// ============================================================================
//  "מה עכשיו?" — the one next step, when the screen would otherwise say nothing
// ============================================================================
//
// The app already answers "what now" in three places: the agent's closing line,
// the handoff bar under the planning chat, and the bar under the pricing chat.
// A fourth voice repeating them would be a wizard from 2003. So the rule this
// file is built on is narrow and mechanical:
//
//     every card is the exact COMPLEMENT of a gate that already exists.
//
// #plan-action-bar appears when canPriceProject(proj) is true → card 1 appears
// when it is false. #price-action-bar appears when the pricing produced numbers
// → card 2 appears when it did not. A card and a bar can therefore never be on
// screen together, and that is a property of the predicates, not a discipline
// someone has to remember.
//
// The quote stage has no gate at all today, and that is where the two silent
// dead-ends live: a quote sitting at 0 ₪ because moving to the draft carries no
// numbers across, and a quote that has left the machine while its status is
// still "טיוטה" — the one status nothing in the app ever writes by itself.
//
// Every predicate reads PERSISTED STATE ONLY — the stage, the coverage, the
// pricing totals, the quote, the status. Never the DOM, never "is that button
// on screen". The buttons are being reworded and may be renamed or removed; if
// that happens, the copy in this file changes and not one line of its logic.

(function (root) {
    'use strict';

    // requestAnimationFrame does not fire in a hidden tab, so a state change
    // made while the app is in a background tab would sit unpainted and the card
    // would appear a beat AFTER he came back, instead of being there already.
    // Resolved at call time, not at load, because document.hidden changes.
    function schedule(fn) {
        if (root.document && root.document.hidden) return setTimeout(fn, 0);
        return (root.requestAnimationFrame || setTimeout)(fn, 16);
    }
    var pending = false;

    // app.js declares its state with `let`, which lives in the global LEXICAL
    // environment and never becomes a property of window. Reaching for it as a
    // property of the global object therefore reads undefined from in here,
    // while the bare name resolves correctly across classic scripts. Every read
    // of the app goes through these two, guarded, so the file still loads inside
    // a test vm that provides only some of them.
    function G(name) {
        try { return (0, eval)(name); } catch (e) { return undefined; }
    }
    function call(name, arg) {
        var f = G(name);
        return typeof f === 'function' ? f(arg) : undefined;
    }

    function esc(s) {
        var f = G('escapeHtml');
        return typeof f === 'function' ? f(String(s == null ? '' : s)) : String(s == null ? '' : s);
    }
    function num(n) { return Number(n || 0).toLocaleString('he-IL'); }

    // The cards, in priority order. nextStepFor returns the FIRST match, so
    // "one card at a time" is structural rather than a rule to obey.
    var NEXT_STEP_CARDS = [
        {
            id: 'plan-gap',
            home: 'wizard',
            // The drop-off itself: he described the job, got a ballpark, and the
            // screen went quiet — the handoff bar stays hidden until the
            // characterisation is complete, so the one moment he needs a next
            // step is the one moment nothing offers him one.
            when: function (p) {
                if (call('getProjectStage', p) !== 'planning') return false;
                var plan = Array.isArray(p.planChatHistory) ? p.planChatHistory : [];
                var asked = plan.some(function (m) { return m && m.role === 'user'; });
                var answered = plan.some(function (m) { return m && m.role === 'model'; });
                if (!asked || !answered) return false;
                return call('specCoverage', p).missingCritical.length > 0;
            },
            title: function (p) {
                var n = call('specCoverage', p).missingCritical.length;
                return n === 1 ? 'עוד תשובה אחת, והתמחור יהיה מלא' : 'עוד ' + num(n) + ' תשובות, והתמחור יהיה מלא';
            },
            body: function (p) {
                var miss = call('specCoverage', p).missingCritical;
                // A checklist field carries its human text in `question`; the id
                // is a database key and putting it on screen tells him nothing.
                var names = miss.slice(0, 3)
                    .map(function (f) { return String(f.question || f.label || '').replace(/\s*\?\s*$/, ''); })
                    .filter(Boolean);
                return 'מה שקיבלת עד עכשיו הוא אומדן לפי הנחות מקובלות. '
                    + (names.length ? 'מה שחסר: ' + esc(names.join(' · ')) + '. ' : '')
                    + 'ברגע שהשדות הקריטיים סגורים אפשר לעבור לפירוט מלא לפי סעיפים — שעות עבודה, חומרים לפי כמות, ומה לא כלול.';
            },
            actions: function () {
                return [
                    { label: 'פתח את כרטיס האפיון', call: 'openSpecFromChat()', kind: 'primary' },
                    { label: 'לא עכשיו', call: "dismissNextStep('plan-gap')", kind: 'quiet' },
                ];
            },
        },
        {
            id: 'price-empty',
            home: 'wizard',
            // The agent answered in prose and no numbers reached the table. He
            // sees a price on screen and has no idea the quote behind it is
            // empty — which is how a quarter of an hour becomes a 0 ₪ PDF.
            when: function (p) {
                if (call('getProjectStage', p) !== 'pricing') return false;
                var chat = Array.isArray(p.chatHistory) ? p.chatHistory : [];
                var real = chat.some(function (m) { return m && m.role === 'user' && !m.handoff; });
                var answered = chat.some(function (m) { return m && m.role === 'model'; });
                if (!real || !answered) return false;
                return call('pricingTotals', p).total <= 0;
            },
            title: function () { return 'התמחור לא החזיר מספרים'; },
            body: function () {
                return 'בטבלת התמחור אין עדיין שעות ולא חומרים, ולכן ההצעה תיבנה ריקה. '
                    + 'אפשר לבקש מהסוכן פירוט, או להכניס שורה אחת ביד בטבלה — ומשם ההצעה כבר יודעת לבנות את עצמה.';
            },
            actions: function () {
                return [
                    { label: 'בקש פירוט מלא', call: "sendSuggestedChatPrompt('פרט את התמחור: שעות עבודה, רשימת חומרים עם כמויות ומחירים, וסך הכל.')", kind: 'primary' },
                    { label: 'פתח טבלת תמחור', call: 'openPricingTable()', kind: 'secondary' },
                ];
            },
        },
        {
            id: 'draft-empty',
            home: 'draft',
            // Moving to the draft advances the stage and changes the tab — and
            // carries no money across. The one path that actually fills the
            // quote from the pricing table is a button on another screen.
            when: function (p) {
                if (call('getProjectStage', p) !== 'draft') return false;
                if (call('pricingTotals', p).total <= 0) return false;
                var q = p.quoteData || {};
                if (Number(q.basePrice) > 0) return false;
                return !(q.items || []).some(function (i) { return Number(i && i.price) > 0; });
            },
            title: function () { return 'ההצעה עדיין על 0 ₪'; },
            body: function (p) {
                var t = call('pricingTotals', p);
                return 'בטבלת התמחור יש ' + num(Math.round(t.total)) + ' ₪ — חומרים, שעות ותוספות. '
                    + '"בנה מהטבלה" מעתיק משם את הסעיפים והמחירים לתוך ההצעה. בלי זה ה-PDF ייצא ריק.';
            },
            actions: function () {
                return [
                    { label: 'בנה את ההצעה מהטבלה', call: 'ptToQuote()', kind: 'primary' },
                    { label: 'אני כותב את הסעיפים ידנית', call: "dismissNextStep('draft-empty')", kind: 'quiet' },
                ];
            },
        },
        {
            id: 'quote-out',
            home: 'draft',
            // Nothing in the app advances a status on its own — and the entire
            // follow-up machine hangs off "נשלח". A quote that left the machine
            // while its status says "טיוטה" gets no reminder, and he never finds
            // out that he is not getting one.
            when: function (p) {
                if (!(Number(p.quoteOutAt) > 0)) return false;
                return (p.status || 'טיוטה') === 'טיוטה';
            },
            title: function () { return 'סמן "נשלח" — וזה יחזור אליך לבד'; },
            body: function () {
                return 'ההצעה יצאה, והסטטוס עדיין "טיוטה". ברגע שהיא מסומנת "נשלח" היא נכנסת ללוח הכסף, '
                    + 'ואם הלקוח לא ענה תוך כמה ימים תקבל תזכורת עם הודעת מעקב מוכנה לשליחה.';
            },
            actions: function () {
                return [
                    { label: 'סמן נשלח', call: "setProjectStatus(activeProjectId, 'נשלח')", kind: 'primary' },
                    { label: 'עוד לא שלחתי', call: "dismissNextStep('quote-out')", kind: 'quiet' },
                ];
            },
        },
    ];

    // Somebody who has finished the loop twice does not need to be taught it.
    // Two and not one, because the last card only becomes reachable at the
    // moment the first quote exists.
    function nextStepMuted() {
        try {
            if (root.localStorage && typeof G('getStorageKey') === 'function'
                && root.localStorage.getItem(call('getStorageKey', 'sj_nextstep_off')) === '1') return true;
            var app = G('appState');
            var hist = (app && app.history) || [];
            return hist.length >= 2;
        } catch (e) { return false; }
    }

    // Pure: no DOM, no side effects. The tests drive this directly.
    function nextStepFor(proj) {
        if (!proj || nextStepMuted()) return null;
        var off = proj.nextStepOff || {};
        for (var i = 0; i < NEXT_STEP_CARDS.length; i++) {
            var card = NEXT_STEP_CARDS[i];
            if (off[card.id]) continue;
            var hit = false;
            try { hit = !!card.when(proj); } catch (e) { hit = false; }
            if (hit) return card;
        }
        return null;
    }

    function slotFor(home) {
        return root.document.getElementById(home === 'draft' ? 'next-step-draft' : 'next-step-wizard');
    }

    function cardHtml(card, proj) {
        var actions = card.actions(proj).map(function (a) {
            var cls = a.kind === 'primary' ? 'btn btn-accent btn-small'
                : a.kind === 'secondary' ? 'btn btn-secondary btn-small'
                : 'ns-quiet';
            return '<button type="button" class="' + cls + '" onclick="' + a.call + '">' + esc(a.label) + '</button>';
        }).join('');
        return '<div class="ns-title">' + esc(card.title(proj)) + '</div>'
            + '<div class="ns-body">' + card.body(proj) + '</div>'
            + '<div class="ns-btns">' + actions
            + '<button type="button" class="ns-mute" onclick="muteNextSteps()" title="לא להציג יותר צעדים הבאים">אל תציג לי צעדים הבאים</button>'
            + '</div>';
    }

    // Called from the hottest path in the app (every save), so it costs one
    // boolean until the next frame, and it can never throw upward: a guide that
    // breaks saving would be worse than no guide.
    function renderNextStep() {
        if (pending) return;
        pending = true;
        schedule(function () {
            pending = false;
            try { paint(); } catch (e) { /* a hint is never worth an exception */ }
        });
    }

    function paint() {
        var wiz = root.document.getElementById('next-step-wizard');
        var dft = root.document.getElementById('next-step-draft');
        if (!wiz && !dft) return;
        // Both slots are cleared on every pass, or a card left behind in one of
        // them survives a walk to the other screen.
        if (wiz) { wiz.hidden = true; wiz.innerHTML = ''; }
        if (dft) { dft.hidden = true; dft.innerHTML = ''; }
        if (call('coachBusy')) return;      // the tour is talking

        var list = G('projectsList') || [];
        var active = G('activeProjectId');
        var proj = active ? list.find(function (p) { return p.id === active; }) : null;
        if (!proj) return;
        var card = nextStepFor(proj);
        if (!card) return;
        var slot = slotFor(card.home);
        if (!slot) return;
        // Only on a screen that is actually open — the draft card must not paint
        // itself into a hidden panel and appear "already there" later.
        var panel = slot.closest ? slot.closest('.content-panel') : null;
        if (panel && !panel.classList.contains('active')) return;
        slot.innerHTML = cardHtml(card, proj);
        slot.hidden = false;
    }

    // Per project, per card, on the project ROOT — never inside quoteData,
    // which is rebuilt from a fixed key list on every keystroke in the quote
    // form and would drop this silently.
    function dismissNextStep(id) {
        try {
            var active = G('activeProjectId');
            var proj = (G('projectsList') || []).find(function (p) { return p.id === active; });
            if (!proj) return;
            proj.nextStepOff = proj.nextStepOff || {};
            proj.nextStepOff[id] = 1;
            call('saveProjects');
            renderNextStep();
        } catch (e) {}
    }

    function muteNextSteps() {
        try {
            root.localStorage.setItem(call('getStorageKey', 'sj_nextstep_off'), '1');
            call('showToast', 'לא אציג יותר צעדים הבאים');
            renderNextStep();
        } catch (e) {}
    }

    root.NEXT_STEP_CARDS = NEXT_STEP_CARDS;
    root.nextStepFor = nextStepFor;
    root.nextStepMuted = nextStepMuted;
    root.renderNextStep = renderNextStep;
    root.dismissNextStep = dismissNextStep;
    root.muteNextSteps = muteNextSteps;
})(typeof window !== 'undefined' ? window : globalThis);
