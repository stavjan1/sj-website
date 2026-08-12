/* ZEREM — single-line job sketches.
 *
 * The AI never draws. Asking a language model for SVG produces overlapping,
 * crooked shapes that look wrong to anyone who has held a conduit; what it is
 * good at is deciding WHICH scene a job is and what the numbers are. So the
 * scene vocabulary and every line live here, and the characterization card —
 * which already records route length, mount type, wall type and route type —
 * supplies the parameters. A sketch therefore costs nothing extra: no second
 * request, no tokens, no waiting.
 *
 * House style, per Stav: black and white, single-line, as minimal as it can be
 * while still being unambiguous. Everything is stroked in currentColor so the
 * same drawing works in the app's dark themes, on the light theme, and in
 * print without a second palette.
 */
(function (global) {
    'use strict';

    const NS = 'http://www.w3.org/2000/svg';
    const el = (name, attrs) => {
        const n = document.createElementNS(NS, name);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        return n;
    };

    // ── primitives ───────────────────────────────────────────────────────────
    // Each returns an SVG fragment. Nothing here knows about electrical work;
    // the scenes below assemble meaning out of these.

    function line(x1, y1, x2, y2, dashed) {
        return el('line', { x1, y1, x2, y2, ...(dashed ? { 'stroke-dasharray': '5 4' } : {}) });
    }

    function box(x, y, w, h, dashed) {
        return el('rect', { x, y, width: w, height: h, fill: 'none', ...(dashed ? { 'stroke-dasharray': '5 4' } : {}) });
    }

    // A wall reads as a wall because of the hatch, not because of a label.
    function wall(g, x, y, w, h) {
        g.appendChild(box(x, y, w, h));
        const step = 9;
        for (let i = -h; i < w; i += step) {
            const x1 = Math.max(x, x + i), y1 = Math.max(y, y + h - (i + h - (x1 - x - i)));
            const x2 = Math.min(x + w, x + i + h), y2 = y + h - (x2 - x - i);
            if (x2 > x1) g.appendChild(el('line', { x1, y1: y + h - (x1 - x - i), x2, y2, 'stroke-width': 0.6, opacity: 0.55 }));
        }
    }

    // Ground: one firm line with short ticks hanging off it.
    function ground(g, x1, x2, y) {
        g.appendChild(line(x1, y, x2, y));
        for (let x = x1 + 6; x < x2; x += 12) g.appendChild(el('line', { x1: x, y1: y, x2: x - 5, y2: y + 6, 'stroke-width': 0.6, opacity: 0.6 }));
    }

    // Interlocking paving — the thing that has to come up and go back down.
    function pavers(g, x1, x2, y, h) {
        g.appendChild(box(x1, y, x2 - x1, h));
        for (let x = x1 + 14; x < x2; x += 14) g.appendChild(el('line', { x1: x, y1: y, x2: x, y2: y + h, 'stroke-width': 0.6, opacity: 0.7 }));
    }

    // A distribution board: outline plus DIN rows, which is what makes it read
    // as a board rather than a plain rectangle.
    function panelBox(g, x, y, w, h, label) {
        g.appendChild(box(x, y, w, h));
        const rows = Math.max(1, Math.min(4, Math.round(h / 14)));
        for (let i = 1; i <= rows; i++) {
            const yy = y + (h / (rows + 1)) * i;
            g.appendChild(el('line', { x1: x + 4, y1: yy, x2: x + w - 4, y2: yy, 'stroke-width': 0.7, opacity: 0.75 }));
        }
        if (label) g.appendChild(text(x + w / 2, y - 6, label, 'middle'));
    }

    function text(x, y, str, anchor, small) {
        const t = el('text', {
            x, y, 'text-anchor': anchor || 'start',
            'font-size': small ? 9 : 11, 'font-family': 'Heebo, Arial, sans-serif',
            // ltr on purpose, for Hebrew labels, in an RTL app. text-anchor is
            // resolved against the element's direction: under rtl, "end" means
            // the LEFT edge, so every right-hand label grew outward past the
            // canvas and was cut off — "מבט צד" arrived as "ט צד". ltr makes the
            // anchors purely geometric. The Hebrew still reads right-to-left,
            // because bidi orders the glyphs inside the run either way.
            fill: 'currentColor', stroke: 'none', direction: 'ltr',
        });
        t.textContent = str;
        return t;
    }

    // Dimension line with arrowheads and the measurement sitting on it.
    function dim(g, x1, x2, y, label) {
        g.appendChild(line(x1, y, x2, y));
        [[x1, 1], [x2, -1]].forEach(([x, dir]) => {
            g.appendChild(el('polyline', { points: `${x + dir * 6},${y - 3} ${x},${y} ${x + dir * 6},${y + 3}`, fill: 'none' }));
        });
        g.appendChild(el('line', { x1, y1: y - 7, x2: x1, y2: y + 7, 'stroke-width': 0.6 }));
        g.appendChild(el('line', { x1: x2, y1: y - 7, x2: x2, y2: y + 7, 'stroke-width': 0.6 }));
        if (label) {
            const cx = (x1 + x2) / 2;
            g.appendChild(el('rect', { x: cx - 26, y: y - 9, width: 52, height: 14, fill: 'var(--sketch-bg, #fff)', stroke: 'none' }));
            g.appendChild(text(cx, y + 4, label, 'middle', true));
        }
    }

    // A chase cut into the wall — drawn as the zigzag everyone recognises.
    function chase(g, x, y1, y2) {
        const pts = [];
        for (let y = y1, i = 0; y < y2; y += 8, i++) pts.push(`${x + (i % 2 ? 4 : -4)},${y}`);
        pts.push(`${x},${y2}`);
        g.appendChild(el('polyline', { points: pts.join(' '), fill: 'none', 'stroke-width': 0.9 }));
    }

    function socket(g, x, y, label) {
        g.appendChild(box(x, y, 16, 20));
        g.appendChild(el('circle', { cx: x + 8, cy: y + 10, r: 4, fill: 'none', 'stroke-width': 0.8 }));
        if (label) g.appendChild(text(x + 8, y + 32, label, 'middle', true));
    }

    function junctionBox(g, x, y, label) {
        g.appendChild(box(x, y, 20, 20));
        g.appendChild(el('line', { x1: x + 4, y1: y + 4, x2: x + 16, y2: y + 16, 'stroke-width': 0.6, opacity: 0.6 }));
        if (label) g.appendChild(text(x + 10, y - 5, label, 'middle', true));
    }

    // ── scenes ───────────────────────────────────────────────────────────────
    // Each scene answers one question: what does this job physically look like?
    // Parameters come from the characterization card, so an unanswered field
    // simply means that part of the drawing stays generic.

    const W = 520, H = 300;

    function sceneCharger(g, p) {
        const gy = 210;
        wall(g, 20, 60, 26, gy - 60);
        panelBox(g, 52, 90, 40, 52, 'לוח');
        ground(g, 20, W - 20, gy);

        // The route is the price. Draw what it actually crosses.
        const routeStart = 100, routeEnd = 400;
        if (p.route === 'pavers') {
            pavers(g, routeStart, routeEnd, gy, 16);
            g.appendChild(text((routeStart + routeEnd) / 2, gy + 34, 'הרמת אבנים משתלבות והחזרתן', 'middle', true));
            g.appendChild(line(routeStart, gy + 8, routeEnd, gy + 8, true));
        } else if (p.route === 'trench') {
            g.appendChild(box(routeStart, gy, routeEnd - routeStart, 26, true));
            g.appendChild(line(routeStart, gy + 13, routeEnd, gy + 13, true));
            g.appendChild(text((routeStart + routeEnd) / 2, gy + 42, 'חפירה, סימון וכיסוי', 'middle', true));
        } else {
            g.appendChild(line(routeStart, gy - 8, routeEnd, gy - 8, true));
            g.appendChild(text((routeStart + routeEnd) / 2, gy - 16, 'תעלה או צנרת קיימת', 'middle', true));
        }

        // Charger on its own short wall at the parking bay.
        wall(g, W - 70, 120, 20, gy - 120);
        panelBox(g, W - 118, 140, 34, 44, 'עמדה');
        g.appendChild(line(routeEnd, gy - 8, W - 101, gy - 8));
        g.appendChild(line(W - 101, gy - 8, W - 101, 184));

        dim(g, 100, W - 101, 260, p.metres ? p.metres + ' מ׳' : 'אורך המסלול');
        g.appendChild(text(W - 20, 40, 'מבט צד', 'end'));
    }

    function scenePanel(g, p) {
        wall(g, 40, 40, W - 80, 210);
        panelBox(g, 180, 90, 120, 110, p.mount === 'surface' ? 'לוח על הטיח' : 'לוח שקוע');
        // Feed in from above, and the chase if the wall has to be opened.
        g.appendChild(line(240, 40, 240, 90, true));
        g.appendChild(text(250, 60, 'הזנה מהמונה', 'start', true));
        if (p.chase) {
            chase(g, 300, 90, 200);
            g.appendChild(text(316, 150, 'חציבה', 'start', true));
        }
        if (p.trunking) {
            g.appendChild(box(320, 96, 150, 16));
            g.appendChild(text(395, 92, 'תעלת כבלים', 'middle', true));
            g.appendChild(line(300, 104, 320, 104));
        }
        dim(g, 180, 300, 230, p.modules ? p.modules + ' מקום' : 'רוחב הלוח');
        g.appendChild(text(W - 20, 28, 'חזית קיר', 'end'));
    }

    function sceneInfra(g, p) {
        // Top view above, side view below — the pair Stav asked for.
        g.appendChild(box(30, 40, 90, 60));
        g.appendChild(text(75, 34, 'מבנה', 'middle', true));
        g.appendChild(line(120, 70, 300, 70, true));
        for (let x = 300; x <= W - 40; x += 26) {
            g.appendChild(el('line', { x1: x, y1: 50, x2: x, y2: 92, 'stroke-width': 0.7 }));
        }
        g.appendChild(line(300, 70, W - 40, 70, true));
        g.appendChild(text(W - 40, 34, 'גדר', 'end', true));
        dim(g, 120, W - 40, 112, p.metres ? p.metres + ' מ׳' : 'אורך התוואי');
        g.appendChild(text(30, 130, 'מבט על', 'start'));

        const gy = 250;
        wall(g, 30, 170, 22, gy - 170);
        ground(g, 30, W - 20, gy);
        g.appendChild(line(52, 190, 300, 190, true));
        for (let x = 300; x <= W - 40; x += 26) g.appendChild(el('line', { x1: x, y1: 190, x2: x, y2: gy, 'stroke-width': 0.7 }));
        g.appendChild(text(W - 20, 165, 'מבט צד', 'end'));
    }

    function scenePoints(g, p) {
        wall(g, 40, 40, W - 80, 200);
        const n = Math.min(4, Math.max(1, p.count || 3));
        const startX = 110, gap = 70;
        for (let i = 0; i < n; i++) socket(g, startX + i * gap, 150, i === 0 ? 'נקודה' : '');
        // Feed: either an existing conduit or a chase per point.
        for (let i = 0; i < n; i++) {
            const x = startX + i * gap + 8;
            if (p.chase) chase(g, x, 60, 150);
            else g.appendChild(line(x, 60, x, 150, true));
        }
        g.appendChild(line(60, 60, startX + (n - 1) * gap + 8, 60));
        g.appendChild(text(60, 52, p.chase ? 'חציבה מהתקרה' : 'צנרת קיימת', 'start', true));

        // The rule Stav called out: an external CEE point is either chiselled
        // in or fed from a surface junction box. Draw the second option so the
        // choice is visible rather than assumed.
        if (p.external) {
            junctionBox(g, W - 110, 92, 'קופסת חיבורים IP44');
            g.appendChild(line(W - 100, 112, W - 100, 150));
            socket(g, W - 108, 150, 'שקע CEE');
            g.appendChild(text(W - 20, 250, 'חלופה: חציבה במקום קופסה', 'end', true));
        }
        g.appendChild(text(W - 20, 28, 'חזית קיר', 'end'));
    }

    function sceneGeneric(g, p) {
        const gy = 200;
        wall(g, 30, 60, 24, gy - 60);
        panelBox(g, 60, 90, 40, 50, 'מקור');
        ground(g, 30, W - 30, gy);
        g.appendChild(line(100, 120, W - 120, 120, true));
        panelBox(g, W - 110, 95, 40, 50, 'יעד');
        dim(g, 100, W - 110, 250, p.metres ? p.metres + ' מ׳' : 'מרחק');
    }

    const SCENES = {
        charger: sceneCharger,
        panel: scenePanel,
        infra: sceneInfra,
        points: scenePoints,
        lighting: scenePoints,
        earthing: sceneGeneric,
        solar: sceneGeneric,
        inspection: null,     // nothing physical to draw — a report is not a route
        fault: null,
        generic: sceneGeneric,
    };

    /* Reads the characterization answers and returns only what a drawing needs.
       Everything is best-effort: an unanswered field leaves that detail generic
       rather than guessed. */
    function paramsFromSpec(list, answers) {
        const val = (test) => {
            const f = (list.fields || []).find(x => test(x));
            const a = f && answers[f.id];
            return a && !a.skipped ? String(a.value) : '';
        };
        const joined = Object.values(answers || {}).map(a => String(a.value || '')).join(' ');
        const metres = (joined.match(/(\d{1,3})\s*(?:מ׳|מטר|מ')/) || [])[1] || '';

        return {
            metres,
            route: /משתלב|אבנים/.test(joined) ? 'pavers'
                : /חפיר|חפירה/.test(joined) ? 'trench'
                : /פיר|תעלה קיימת|צנרת קיימת/.test(joined) ? 'existing' : '',
            mount: /על הטיח|צמוד/.test(joined) ? 'surface' : /שקוע|תחת הטיח/.test(joined) ? 'flush' : '',
            chase: /חציב/.test(joined),
            trunking: /תעל/.test(joined),
            external: /חוץ|חיצוני|CEE|cee/.test(joined),
            modules: (joined.match(/(\d{1,2})\s*מקום/) || [])[1] || '',
            count: parseInt((val(f => /count|כמות/.test(f.id + f.question)) || '').replace(/\D/g, ''), 10) || 0,
        };
    }

    /* Draw into a host element. Returns false when the job type has nothing
       physical worth drawing — the caller then hides the button rather than
       showing an empty frame. */
    function render(host, jobType, list, answers) {
        const scene = SCENES[jobType];
        host.innerHTML = '';
        if (!scene) return false;

        const svg = el('svg', {
            // direction=ltr on the canvas, deliberately, inside an RTL app.
            // text-anchor is resolved against the inherited direction, so under
            // rtl "end" means the LEFT edge — every right-hand label grew
            // outward past the viewBox and was clipped ("מבט צד" arrived as
            // "ט צד"). Forcing ltr makes the anchors purely geometric; the
            // Hebrew inside each label still lays out right-to-left on its own,
            // because bidi works per text run.
            viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', direction: 'ltr',
            'aria-label': 'שרטוט סכמטי של העבודה — לא בקנה מידה',
        });
        const g = el('g', {
            stroke: 'currentColor', 'stroke-width': 1.3, fill: 'none',
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        });
        svg.appendChild(g);
        scene(g, paramsFromSpec(list, answers || {}));
        host.appendChild(svg);
        return true;
    }

    global.ZeremSketch = { render, canDraw: (t) => !!SCENES[t] };
})(window);
