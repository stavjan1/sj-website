// ZEREM — coach marks: the guide that points at the screen instead of talking
// about it. Everything dims except the one thing you should look at, with one
// short sentence next to it.
//
// Two kinds of guidance, one engine:
//   1. The first-run tour (three steps, skippable, once per user).
//   2. "What now?" hints — fired the FIRST time a milestone happens (a project
//      created, a quote saved…), pointing at the next real move. Each fires
//      once, ever, per user.
//
// Deliberately standalone: it reads app.js globals if they exist and degrades
// to no-ops if they don't. Nothing here can block the app — every entry point
// is wrapped, and a missing target simply skips its step.
(function () {
    'use strict';

    const SEEN_PREFIX = 'sj_coach_';
    let active = null;      // { steps, i, els } while a tour is running

    function storeKey(id) {
        return (typeof getStorageKey === 'function') ? getStorageKey(SEEN_PREFIX + id) : (SEEN_PREFIX + id);
    }
    function seen(id) {
        try { return localStorage.getItem(storeKey(id)) === '1'; } catch { return false; }
    }
    function markSeen(id) {
        try { localStorage.setItem(storeKey(id), '1'); } catch { }
    }
    function isGuest() {
        try { return typeof isGuestUser === 'function' && isGuestUser(); } catch { return false; }
    }

    // ── the spotlight itself ────────────────────────────────────────────────
    function build() {
        const wrap = document.createElement('div');
        wrap.className = 'coach';
        wrap.innerHTML = `
            <div class="coach-hole" aria-hidden="true"></div>
            <div class="coach-bubble" role="dialog" aria-modal="true" aria-live="polite">
                <div class="coach-text"><b class="coach-title"></b><span class="coach-body"></span></div>
                <div class="coach-foot">
                    <button type="button" class="coach-skip">דילוג</button>
                    <span class="coach-dots" aria-hidden="true"></span>
                    <button type="button" class="coach-next btn btn-primary btn-sm">הבא</button>
                </div>
            </div>`;
        // NOT document.body: the app scales the body (applyDisplayZoomFix sets
        // body.style.zoom, typically 0.75). A fixed overlay inside a zoomed body
        // has its coordinates multiplied too, so a spotlight positioned from
        // getBoundingClientRect — which reports post-zoom viewport pixels —
        // lands short of its target. Hanging it off <html> keeps both in the
        // same coordinate space.
        document.documentElement.appendChild(wrap);
        return {
            wrap,
            hole: wrap.querySelector('.coach-hole'),
            bubble: wrap.querySelector('.coach-bubble'),
            title: wrap.querySelector('.coach-title'),
            body: wrap.querySelector('.coach-body'),
            dots: wrap.querySelector('.coach-dots'),
            next: wrap.querySelector('.coach-next'),
            skip: wrap.querySelector('.coach-skip'),
        };
    }

    function targetOf(step) {
        if (!step.el) return null;
        try {
            const el = typeof step.el === 'function' ? step.el() : document.querySelector(step.el);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            // An element with no box (hidden tab, collapsed drawer) is not a target.
            return (r.width > 4 && r.height > 4) ? el : null;
        } catch { return null; }
    }

    function place(els, step) {
        const el = targetOf(step);
        const pad = 8;
        if (!el) {
            // No target: a plain centred card, the way a welcome note reads.
            els.wrap.classList.add('is-centred');
            els.hole.style.cssText = '';
            els.bubble.style.cssText = '';
            return;
        }
        els.wrap.classList.remove('is-centred');
        const r = el.getBoundingClientRect();
        Object.assign(els.hole.style, {
            top: (r.top - pad) + 'px',
            left: (r.left - pad) + 'px',
            width: (r.width + pad * 2) + 'px',
            height: (r.height + pad * 2) + 'px',
        });

        // The bubble goes wherever there is room: below the target, else above;
        // horizontally clamped so it never leaves the screen on a phone.
        const bw = Math.min(320, window.innerWidth - 24);
        els.bubble.style.width = bw + 'px';
        const bh = els.bubble.offsetHeight || 140;
        const below = r.bottom + 12;
        const top = (below + bh < window.innerHeight - 8) ? below : Math.max(8, r.top - bh - 12);
        let left = r.left + r.width / 2 - bw / 2;
        left = Math.max(12, Math.min(left, window.innerWidth - bw - 12));
        Object.assign(els.bubble.style, { top: top + 'px', left: left + 'px' });
    }

    function show(els, steps, i) {
        const step = steps[i];
        els.title.textContent = step.title || '';
        els.body.textContent = step.text || '';
        els.dots.textContent = steps.length > 1 ? `${i + 1}/${steps.length}` : '';
        els.next.textContent = (i === steps.length - 1) ? 'סיום' : 'הבא';
        els.skip.hidden = steps.length < 2;
        const el = targetOf(step);
        if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { } }
        // Let a smooth scroll settle before measuring, or the hole lands where
        // the target used to be.
        setTimeout(() => place(els, step), el ? 260 : 0);
    }

    function end(tourId, els) {
        if (tourId) markSeen(tourId);
        if (els && els.wrap) els.wrap.remove();
        window.removeEventListener('resize', active && active.reposition);
        window.removeEventListener('scroll', active && active.reposition, true);
        active = null;
    }

    // Run a sequence. Steps whose target is missing are dropped, so a tour
    // never shows a spotlight on nothing.
    function run(tourId, steps, opts) {
        try {
            if (active) return;                       // never stack two guides
            if (tourId && seen(tourId)) return;
            const live = steps.filter(s => !s.el || targetOf(s));
            if (!live.length) return;
            const els = build();
            let i = 0;
            const reposition = () => { if (active) place(els, live[active.i]); };
            active = { i, reposition };
            const step = () => {
                if (i >= live.length) { end(tourId, els); if (opts && opts.onDone) opts.onDone(); return; }
                active.i = i;
                show(els, live, i);
            };
            els.next.addEventListener('click', () => { i++; step(); });
            els.skip.addEventListener('click', () => end(tourId, els));
            els.wrap.addEventListener('click', (e) => { if (e.target === els.wrap) end(tourId, els); });
            document.addEventListener('keydown', function esc(e) {
                if (e.key === 'Escape' && active) { end(tourId, els); document.removeEventListener('keydown', esc); }
            });
            window.addEventListener('resize', reposition);
            window.addEventListener('scroll', reposition, true);
            step();
        } catch (e) { /* guidance must never break the app */ }
    }

    // ── the first-run tour ──────────────────────────────────────────────────
    const TOUR = [
        {
            title: 'ברוך הבא לזרם',
            text: 'קודם מבינים את העבודה, ורק אחר כך מתמחרים. שלושה מסכים, ואני מראה אותם בעשר שניות.',
        },
        {
            el: '#home-input',
            title: 'מתארים עבודה במילים',
            text: 'כותבים כאן משפט אחד על העבודה. משם נבנים האפיון, רשימת הציוד והמחיר, בלי למלא טפסים.',
        },
        {
            el: '#tab-projects',
            title: 'כל העבודות שלך',
            text: 'כל מה שפתחת יושב כאן, עם השלב שבו הוא נמצא, וממשיכים מאיפה שעצרת.',
        },
        {
            el: '#tab-money',
            title: 'הכסף, במקום אחד',
            text: 'לוח שמראה מה נשלח, מה בוצע, מה ממתין לתשלום ומה כבר שולם. גוררים כרטיס כדי לעדכן.',
        },
    ];

    window.coachStartTour = function coachStartTour(force) {
        if (force) { try { localStorage.removeItem(storeKey('tour_v1')); } catch { } }
        run('tour_v1', TOUR);
    };

    // ── "what now?" hints, one per milestone, first time only ───────────────
    const HINTS = {
        'first-project': {
            el: '#chat-user-input',
            title: 'מה עכשיו?',
            text: 'ספר לי על העבודה בשפה שלך. כשהאפיון ייסגר, כפתור התמחור ייפתח לבד.',
        },
        'first-priced': {
            el: '#tab-create',
            title: 'המחיר מוכן',
            text: 'עוברים לעורך ההצעה, מסדרים את הסעיפים, ומורידים PDF ממותג או שולחים בוואטסאפ.',
        },
        'first-quote-saved': {
            el: '#tab-money',
            title: 'ההצעה יצאה ללקוח',
            text: 'עכשיו זה עניין של העולם האמיתי: כשהוא יאשר, גררו את הכרטיס ב"כסף" ל"בוצע", ומשם ל"שולם".',
        },
        'first-paid': {
            el: () => document.querySelector('.pipe-col[data-stage="paid"] .pipe-adv.is-receipt'),
            title: 'הכסף נכנס',
            text: 'הכפתור הזה מפיק ללקוח קבלה רשמית, עם כל הפרטים כבר מלאים מהפרויקט.',
        },
    };

    // Fire a milestone hint. Safe to call from anywhere, any number of times.
    // Exposed under both names: the app's three call sites say coachMilestone,
    // and a guide whose name does not match its caller is not a guide, it is a
    // ReferenceError in the middle of creating a project.
    window.coachMilestone = window.coachHint = function coachMilestone(id, delay) {
        try {
            if (!HINTS[id] || seen(id) || isGuest()) return;
            // The tour comes first; a hint never interrupts it.
            if (active || !seen('tour_v1')) return;
            setTimeout(() => run(id, [HINTS[id]]), delay || 700);
        } catch (e) { }
    };

    // Settings offers the tour again — a guide you cannot replay is a guide you
    // resent skipping.
    window.coachReplayTour = function coachReplayTour() { window.coachStartTour(true); };
})();
