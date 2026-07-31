// ZeremListCards — the designed equipment/tools "bubbles" shared by the quick
// chat (/ask/) and the full app (/sale/). One renderer, one look, two hosts.
//
// API:  ZeremListCards.render(container, data, opts)
//   data: { equipment: [{item, qty, note}], tools: ["..."] }
//   opts: { job } — short job description used in the copy/share text.
//
// Theming: every color reads a --zlc-* custom property with a dark fallback,
// so each host maps its own palette (/ask/ maps its theme vars; /sale/ maps
// the app palette). Rows are tappable checklists — built for the store run
// and the site floor, not just for reading.
(function () {
  'use strict';

  const CSS = `
  .zlc-card{align-self:flex-start; width:100%; max-width:420px;
    background:var(--zlc-panel,#141d2e); border:1px solid var(--zlc-line,#243049);
    border-radius:14px; overflow:hidden}
  .zlc-head{display:flex; align-items:center; gap:9px; padding:11px 14px;
    border-bottom:1px solid var(--zlc-line,#243049); font-size:.92rem}
  .zlc-head b{color:var(--zlc-ink,#eef2fb); font-weight:800}
  .zlc-ico{font-size:1.05rem}
  .zlc-count{margin-inline-start:auto; font-size:.72rem; font-weight:700;
    color:var(--zlc-sub,#9fb0cc); background:var(--zlc-bg,#0b0f1a);
    border:1px solid var(--zlc-line,#243049); border-radius:999px; padding:3px 9px}
  .zlc-rows{display:flex; flex-direction:column}
  .zlc-row{display:flex; flex-direction:column; gap:2px; padding:9px 14px; cursor:pointer;
    border-bottom:1px solid var(--zlc-line,#243049); background:none; border-inline:none; border-top:none;
    font-family:inherit; text-align:start; -webkit-tap-highlight-color:transparent}
  .zlc-row:last-child{border-bottom:none}
  .zlc-main{display:flex; align-items:center; gap:10px}
  .zlc-chk{width:19px; height:19px; flex-shrink:0; border-radius:6px;
    border:2px solid var(--zlc-muted,#6f819e); display:flex; align-items:center;
    justify-content:center; font-size:.7rem; color:#fff; transition:all .15s}
  .zlc-name{flex:1; font-size:.9rem; color:var(--zlc-ink,#eef2fb); line-height:1.45}
  .zlc-qty{font-size:.78rem; font-weight:800; color:var(--zlc-accent,#2b74db);
    background:rgba(43,116,219,.12); border-radius:8px; padding:2px 8px; white-space:nowrap}
  .zlc-note{font-size:.76rem; color:var(--zlc-sub,#9fb0cc); padding-inline-start:29px; line-height:1.4}
  .zlc-row.done .zlc-chk{background:var(--zlc-accent,#2b74db); border-color:var(--zlc-accent,#2b74db)}
  .zlc-row.done .zlc-chk::after{content:'✓'}
  .zlc-row.done .zlc-name{text-decoration:line-through; opacity:.5}
  .zlc-row.done .zlc-qty,.zlc-row.done + .zlc-note,.zlc-row.done .zlc-note{opacity:.4}
  .zlc-actions{display:flex; gap:8px; align-self:flex-start; margin-top:-4px}
  .zlc-act{font-size:.76rem; font-weight:700; color:var(--zlc-sub,#9fb0cc);
    background:var(--zlc-panel,#141d2e); border:1px solid var(--zlc-line,#243049);
    border-radius:8px; padding:5px 11px; cursor:pointer; font-family:inherit;
    display:inline-flex; align-items:center; gap:5px}
  .zlc-act:hover{border-color:var(--zlc-accent,#2b74db); color:var(--zlc-ink,#eef2fb)}
  .zlc-act.wa{color:#25d366; border-color:rgba(37,211,102,.4)}
  `;

  function ensureCss() {
    if (document.getElementById('zlc-css')) return;
    const s = document.createElement('style');
    s.id = 'zlc-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const clean = (v) => (typeof v === 'string' ? v.trim() : '');

  // Accept slightly-off model output without dying: items may be strings or
  // objects, tools may be objects — normalize everything to one shape.
  function normalize(data) {
    const eq = (Array.isArray(data && data.equipment) ? data.equipment : [])
      .map((e) => (typeof e === 'string'
        ? { item: clean(e), qty: '', note: '' }
        : { item: clean(e.item || e.name), qty: clean(e.qty || e.quantity), note: clean(e.note) }))
      .filter((e) => e.item).slice(0, 40);
    const tools = (Array.isArray(data && data.tools) ? data.tools : [])
      .map((t) => (typeof t === 'string' ? clean(t) : clean(t && (t.item || t.name))))
      .filter(Boolean).slice(0, 25);
    return { equipment: eq, tools };
  }

  function card(icon, title, rows, renderRow) {
    const el = document.createElement('div');
    el.className = 'zlc-card';
    const head = document.createElement('div');
    head.className = 'zlc-head';
    const count = document.createElement('span');
    count.className = 'zlc-count';
    head.innerHTML = '<span class="zlc-ico">' + icon + '</span><b>' + title + '</b>';
    head.appendChild(count);
    el.appendChild(head);
    const body = document.createElement('div');
    body.className = 'zlc-rows';
    const update = () => {
      const done = body.querySelectorAll('.zlc-row.done').length;
      count.textContent = done ? done + '/' + rows.length + ' ✓' : rows.length + ' פריטים';
    };
    rows.forEach((r) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'zlc-row';
      renderRow(row, r);
      row.addEventListener('click', () => { row.classList.toggle('done'); update(); });
      body.appendChild(row);
    });
    update();
    el.appendChild(body);
    return el;
  }

  function asText(data, job) {
    const lines = [];
    lines.push('🛒 ציוד וחומרים' + (job ? ' — ' + job : '') + ':');
    for (const e of data.equipment) {
      lines.push('• ' + e.item + (e.qty ? ' — ' + e.qty : '') + (e.note ? ' (' + e.note + ')' : ''));
    }
    if (data.tools.length) {
      lines.push('');
      lines.push('🧰 כלים: ' + data.tools.join(', '));
    }
    lines.push('');
    lines.push('נבנה עם זרם ⚡ https://sj-eng.co.il/ask/');
    return lines.join('\n');
  }

  function render(container, rawData, opts) {
    ensureCss();
    const data = normalize(rawData);
    if (!data.equipment.length && !data.tools.length) return null;
    const frag = document.createDocumentFragment();

    if (data.equipment.length) {
      frag.appendChild(card('🛒', 'ציוד וחומרים', data.equipment, (row, e) => {
        const main = document.createElement('div');
        main.className = 'zlc-main';
        main.innerHTML = '<span class="zlc-chk"></span>';
        const name = document.createElement('span');
        name.className = 'zlc-name';
        name.textContent = e.item;
        main.appendChild(name);
        if (e.qty) {
          const q = document.createElement('span');
          q.className = 'zlc-qty';
          q.textContent = e.qty;
          main.appendChild(q);
        }
        row.appendChild(main);
        if (e.note) {
          const n = document.createElement('div');
          n.className = 'zlc-note';
          n.textContent = e.note;
          row.appendChild(n);
        }
      }));
    }

    if (data.tools.length) {
      frag.appendChild(card('🧰', 'ארגז כלים', data.tools, (row, t) => {
        const main = document.createElement('div');
        main.className = 'zlc-main';
        main.innerHTML = '<span class="zlc-chk"></span>';
        const name = document.createElement('span');
        name.className = 'zlc-name';
        name.textContent = t;
        main.appendChild(name);
        row.appendChild(main);
      }));
    }

    // Copy / WhatsApp — the whole point is taking the list to the store.
    const actions = document.createElement('div');
    actions.className = 'zlc-actions';
    const text = asText(data, (opts && opts.job) || '');
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'zlc-act';
    copy.innerHTML = '⧉ העתק רשימה';
    copy.onclick = () => {
      navigator.clipboard.writeText(text).then(() => {
        copy.innerHTML = '✓ הועתקה';
        setTimeout(() => { copy.innerHTML = '⧉ העתק רשימה'; }, 1500);
      });
    };
    const wa = document.createElement('button');
    wa.type = 'button';
    wa.className = 'zlc-act wa';
    wa.textContent = 'שתף בוואטסאפ';
    wa.onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    actions.appendChild(copy);
    actions.appendChild(wa);
    frag.appendChild(actions);

    container.appendChild(frag);
    return data;
  }

  window.ZeremListCards = { render };
})();
