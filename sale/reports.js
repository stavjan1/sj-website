// ============================================================================
//  דוחות בדיקה — findings, photos, and a branded PDF
// ============================================================================
// Lifted out of sale/app.js on 25/08/2026, unchanged. Inspection reports
// (ליקויים / תאורה / טרמוגרפי / חופשי): the editor, the findings table with
// site photos, and the export.

// ==========================================================================
// Inspection reports (דוח ליקויים / תאורה / טרמוגרפי), findings + site
// photos → branded A4 PDF. Stored locally per user; photos are compressed
// and kept out of the cloud sync to respect the KV size budget.
// ==========================================================================
const REPORT_TYPES = {
    defects: {
        title: 'דוח ליקויים · בדיקת מתקן חשמל',
        intro: 'בעת הבדיקה נמצאו ליקויים בטיחותיים במתקן החשמל, כמפורט בטבלת הממצאים שלהלן. יש לטפל בליקויים באמצעות חשמלאי בעל רישיון מתאים.',
        warning: 'אישור הבדיקה יינתן רק לאחר השלמת הטיפול בכל הליקויים המפורטים בדוח זה ואישורם על ידי הגורם המוסמך.'
    },
    lighting: {
        title: 'דוח בדיקת עוצמות הארה (תאורה)',
        intro: 'בדיקת התאורה בוצעה בכפוף לתקנות התכנון והבנייה וחוק החשמל, בסביבת העבודה הקרובה ובאמצעות מכשיר מדידה תקני ומכויל (לוקסמטר).',
        warning: 'ערכי הייחוס: 300LUX למשרדים ומעברים, 500LUX לעמדות עבודה. עוצמת הארה נמוכה מהנדרש עלולה להוות סכנה בטיחותית.'
    },
    thermal: {
        title: 'דוח בדיקה טרמוגרפית',
        intro: 'הבדיקה הטרמוגרפית בוצעה באמצעות מצלמה תרמית מכוילת, תחת עומס עבודה מייצג של המתקן. הממצאים מדורגים לפי חומרת הפרשי הטמפרטורה.',
        warning: 'ממצא חריג מחייב טיפול של חשמלאי מוסמך ובדיקה טרמוגרפית חוזרת לאחר התיקון.'
    },
    custom: { title: '', intro: '', warning: '' }
};

let reportFindings = []; // { location, desc, img(dataURL) }

// Free-form report body: an ordered list of blocks the user stacks: // { type:'text', text } | { type:'table', rows:[["",…],…] } (first row = header).
let reportBlocks = [];

function addReportBlock(type, afterIndex) {
    const block = type === 'table'
        ? { type: 'table', rows: [['', '', ''], ['', '', ''], ['', '', '']] }
        : { type: 'text', text: '' };
    if (typeof afterIndex === 'number') reportBlocks.splice(afterIndex + 1, 0, block);
    else reportBlocks.push(block);
    renderReportBlocks();
    scheduleReportPreview();
}

function removeReportBlock(i) {
    reportBlocks.splice(i, 1);
    renderReportBlocks();
    scheduleReportPreview();
}

function moveReportBlock(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= reportBlocks.length) return;
    [reportBlocks[i], reportBlocks[j]] = [reportBlocks[j], reportBlocks[i]];
    renderReportBlocks();
    scheduleReportPreview();
}

// Table sizing: Stav asked for EASY row/column add, so these are one click.
function reportTableAddRow(i) {
    const t = reportBlocks[i];
    if (!t || t.type !== 'table') return;
    t.rows.push(new Array(t.rows[0].length).fill(''));
    renderReportBlocks(); scheduleReportPreview();
}
function reportTableAddCol(i) {
    const t = reportBlocks[i];
    if (!t || t.type !== 'table' || t.rows[0].length >= 6) { if (t && t.rows[0].length >= 6) showToast('עד 6 עמודות, שהטבלה תישאר קריאה ב-A4', 'error'); return; }
    t.rows.forEach(r => r.push(''));
    renderReportBlocks(); scheduleReportPreview();
}
function reportTableDelRow(i) {
    const t = reportBlocks[i];
    if (!t || t.type !== 'table' || t.rows.length <= 1) return;
    t.rows.pop();
    renderReportBlocks(); scheduleReportPreview();
}
function reportTableDelCol(i) {
    const t = reportBlocks[i];
    if (!t || t.type !== 'table' || t.rows[0].length <= 1) return;
    t.rows.forEach(r => r.pop());
    renderReportBlocks(); scheduleReportPreview();
}
function setReportTableCell(i, r, c, v) {
    const t = reportBlocks[i];
    if (t && t.type === 'table' && t.rows[r]) t.rows[r][c] = v;
}

// A table cell holds TEXT or an IMAGE, not both (Stav). Images are compressed
// like the field photos and can be annotated (drawn on) before printing.
function reportTableCellPhoto(i, r, c, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    _compressImageFile(file, (dataUrl) => {
        if (!dataUrl) return;                 // unreadable file, already explained
        const t = reportBlocks[i];
        if (t && t.type === 'table' && t.rows[r]) t.rows[r][c] = { img: dataUrl };
        renderReportBlocks();
        scheduleReportPreview();
    });
    input.value = '';
}
function reportTableCellClear(i, r, c) {
    const t = reportBlocks[i];
    if (t && t.type === 'table' && t.rows[r]) t.rows[r][c] = '';
    renderReportBlocks();
    scheduleReportPreview();
}
function annotateTableCell(i, r, c) {
    const t = reportBlocks[i];
    const cell = t && t.rows[r] && t.rows[r][c];
    if (!cell || !cell.img) return;
    openImageAnnotator(cell.img, (d) => {
        t.rows[r][c] = { img: d };
        renderReportBlocks();
        scheduleReportPreview();
    });
}

// ---- Image annotator ("סמן"): draw freehand on a photo before printing ----
let _annSaveCb = null;
function openImageAnnotator(dataUrl, onSave) {
    closeImageAnnotator();
    _annSaveCb = onSave;
    const wrap = document.createElement('div');
    wrap.id = 'img-annotator';
    wrap.className = 'upgrade-modal-backdrop';
    wrap.innerHTML = `
        <div class="annotator-box">
            <div class="ann-head">
                <b><i class="fa-solid fa-pen"></i> סימון על התמונה</b>
                <span>צייר עם העכבר או האצבע, עיגולים, חיצים, הדגשות</span>
            </div>
            <canvas id="ann-canvas"></canvas>
            <div class="ann-actions">
                <button class="btn btn-secondary" onclick="closeImageAnnotator()">ביטול</button>
                <button class="btn btn-secondary" id="ann-clear"><i class="fa-solid fa-eraser"></i> נקה סימונים</button>
                <button class="btn btn-accent" id="ann-save"><i class="fa-solid fa-check"></i> שמור</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeImageAnnotator(); });

    const canvas = document.getElementById('ann-canvas');
    const ctx = canvas.getContext('2d');
    const base = new Image();
    base.onload = () => {
        const maxW = Math.min(860, window.innerWidth - 60);
        const s = Math.min(1, maxW / base.width);
        canvas.width = Math.round(base.width * s);
        canvas.height = Math.round(base.height * s);
        const paintBase = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(base, 0, 0, canvas.width, canvas.height); };
        paintBase();
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = Math.max(3, Math.round(canvas.width / 220));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        let drawing = false;
        const pos = (e) => {
            const rc = canvas.getBoundingClientRect();
            return { x: (e.clientX - rc.left) * canvas.width / rc.width, y: (e.clientY - rc.top) * canvas.height / rc.height };
        };
        canvas.addEventListener('pointerdown', (e) => { drawing = true; try { canvas.setPointerCapture(e.pointerId); } catch (err) {} const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); });
        canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); });
        canvas.addEventListener('pointerup', () => { drawing = false; });
        document.getElementById('ann-clear').onclick = paintBase;
        document.getElementById('ann-save').onclick = () => {
            const d = canvas.toDataURL('image/jpeg', 0.8);
            const cb = _annSaveCb;
            closeImageAnnotator();
            if (cb) cb(d);
        };
    };
    base.src = dataUrl;
}
function closeImageAnnotator() {
    const m = document.getElementById('img-annotator');
    if (m) m.remove();
    _annSaveCb = null;
}
function annotateFinding(i) {
    const f = reportFindings[i];
    if (!f || !f.img) return;
    openImageAnnotator(f.img, (d) => {
        f.img = d;
        renderReportFindings();
        scheduleReportPreview();
    });
}

function renderReportBlocks() {
    const box = document.getElementById('report-blocks');
    if (!box) return;
    if (reportBlocks.length === 0) {
        box.innerHTML = '<p class="input-help" style="margin:0;">הדוח מתחיל ריק, הוסף תיבת טקסט או טבלה למטה.</p>';
        return;
    }
    box.innerHTML = reportBlocks.map((b, i) => {
        const controls = `
            <div class="rb-controls">
                <span class="rb-kind">${b.type === 'table' ? '<i class="fa-solid fa-table"></i> טבלה' : '<i class="fa-solid fa-align-right"></i> טקסט'}</span>
                <button title="העבר למעלה" onclick="moveReportBlock(${i},-1)"><i class="fa-solid fa-chevron-up"></i></button>
                <button title="העבר למטה" onclick="moveReportBlock(${i},1)"><i class="fa-solid fa-chevron-down"></i></button>
                <button title="מחק בלוק" class="rb-del" onclick="removeReportBlock(${i})"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
        if (b.type === 'text') {
            return `<div class="rb-block">${controls}
                <textarea rows="3" placeholder="כתוב כאן טקסט חופשי לדוח..." oninput="reportBlocks[${i}].text=this.value">${escapeHtml(b.text)}</textarea>
            </div>`;
        }
        const cols = b.rows[0].length;
        const grid = b.rows.map((row, r) => row.map((cell, c) => {
            // Image cell: thumbnail (click = annotate) + remove button.
            if (cell && typeof cell === 'object' && cell.img) {
                return `<span class="rb-cellwrap rb-has-img">
                    <img src="${cell.img}" class="rb-cell-img" onclick="annotateTableCell(${i},${r},${c})" title="לחץ כדי לסמן על התמונה">
                    <button type="button" class="rb-imgdel" onclick="reportTableCellClear(${i},${r},${c})" title="הסר תמונה">✕</button>
                </span>`;
            }
            // Header row = text only; body cells offer a small camera (text OR image).
            const camera = r === 0 ? '' : `<label class="rb-cam" title="תמונה במקום טקסט">
                <i class="fa-solid fa-camera"></i>
                <input type="file" accept="image/*" style="display:none" onchange="reportTableCellPhoto(${i},${r},${c},this)">
            </label>`;
            return `<span class="rb-cellwrap">
                <input type="text" class="rb-cell${r === 0 ? ' rb-head' : ''}" value="${escapeHtml(cell)}"
                    placeholder="${r === 0 ? 'כותרת' : ''}" oninput="setReportTableCell(${i},${r},${c},this.value)">
                ${camera}
            </span>`;
        }).join('')).join('');
        return `<div class="rb-block">${controls}
            <div class="rb-table" style="grid-template-columns:repeat(${cols},1fr);">${grid}</div>
            <div class="rb-table-actions">
                <button class="btn btn-secondary btn-small" onclick="reportTableAddRow(${i})"><i class="fa-solid fa-plus"></i> שורה</button>
                <button class="btn btn-secondary btn-small" onclick="reportTableAddCol(${i})"><i class="fa-solid fa-plus"></i> עמודה</button>
                <button class="btn btn-secondary btn-small" onclick="reportTableDelRow(${i})"><i class="fa-solid fa-minus"></i> שורה</button>
                <button class="btn btn-secondary btn-small" onclick="reportTableDelCol(${i})"><i class="fa-solid fa-minus"></i> עמודה</button>
                <span class="input-help" style="margin:0;">${b.rows.length}×${cols} · השורה הראשונה = כותרות</span>
            </div>
        </div>`;
    }).join('');
}

// ---- Live preview: the REAL A4 sheet lives inside the preview box, scaled ----
function mountReportPreview() {
    const box = document.getElementById('report-live-preview');
    const sheet = document.getElementById('report-pdf-sheet');
    if (!box || !sheet || sheet.parentElement === box) return;
    sheet.classList.add('in-preview');
    sheet.removeAttribute('aria-hidden');
    box.appendChild(sheet);
}

function refreshReportPreview() {
    const box = document.getElementById('report-live-preview');
    const sheet = document.getElementById('report-pdf-sheet');
    if (!box || !sheet) return;
    mountReportPreview();
    try { buildReportSheet(collectReport()); } catch (e) { return; }
    const w = box.clientWidth;
    if (!w) return; // panel hidden — nothing to scale yet
    // Fit the card's width AND stay a compact "quick look" (~520px tall max).
    const s = Math.min(1, w / 794, 520 / Math.max(sheet.offsetHeight, 1123));
    sheet.style.transform = `scale(${s})`;
    sheet.style.transformOrigin = 'top right';
    sheet.style.marginBottom = `${-(1 - s) * sheet.offsetHeight}px`;
}

let _rptPreviewTimer = null;
function scheduleReportPreview() {
    if (_rptPreviewTimer) clearTimeout(_rptPreviewTimer);
    _rptPreviewTimer = setTimeout(refreshReportPreview, 350);
}

// Import from a saved report: TEMPLATE ONLY: the structure without content.
// Keeps: type/title, intro, warning, block layout (text emptied; tables keep
// their size + header row). Clears: client, site, findings content, summary.
function importReportTemplate(idx, e) {
    if (e) e.stopPropagation();
    const r = savedReports[idx];
    if (!r) return;
    document.getElementById('report-type').value = r.type || 'custom';
    applyReportTypeDefaults();
    if (r.type === 'custom') document.getElementById('report-custom-title').value = r.title || '';
    document.getElementById('report-intro').value = r.intro || '';
    document.getElementById('report-warning').value = r.warning || '';
    ['report-client', 'report-site', 'report-summary'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('report-date').value = getTodayDateString();
    document.getElementById('report-number').value = nextReportNumber();
    reportBlocks = (r.blocks || []).map(b => b.type === 'table'
        ? { type: 'table', rows: b.rows.map((row, ri) => ri === 0 ? row.map((c) => (typeof c === 'string' ? c : '')) : row.map(() => '')) }
        : { type: 'text', text: '' });
    reportFindings = [{ location: '', desc: '', img: '' }];
    renderReportBlocks();
    renderReportFindings();
    scheduleReportPreview();
    showToast('התבנית יובאה · מלא את התוכן החדש');
}
let savedReports = [];

function initReportsPanel() {
    try { savedReports = JSON.parse(localStorage.getItem(getStorageKey('sj_reports')) || '[]') || []; }
    catch (e) { savedReports = []; }
    const d = document.getElementById('report-date');
    if (d && !d.value) d.value = getTodayDateString();
    const n = document.getElementById('report-number');
    if (n && !n.value) n.value = nextReportNumber();
    const intro = document.getElementById('report-intro');
    if (intro && !intro.value) applyReportTypeDefaults();
    if (reportFindings.length === 0) reportFindings.push({ location: '', desc: '', img: '' });
    renderReportFindings();
    renderReportBlocks();
    renderSavedReports();
    // Live preview: any typing anywhere in the panel refreshes it (debounced).
    const panel = document.getElementById('panel-reports');
    if (panel && !panel._previewWired) {
        panel._previewWired = true;
        panel.addEventListener('input', scheduleReportPreview);
    }
    scheduleReportPreview();
}

function nextReportNumber() {
    const year = new Date().getFullYear();
    let max = 0;
    savedReports.forEach(r => {
        const m = String(r.number || '').match(new RegExp('^R-' + year + '-(\\d+)$'));
        if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `R-${year}-${max + 1}`;
}

function applyReportTypeDefaults() {
    const type = document.getElementById('report-type')?.value || 'defects';
    const t = REPORT_TYPES[type] || REPORT_TYPES.defects;
    const customWrap = document.getElementById('report-custom-title-wrap');
    if (customWrap) customWrap.style.display = type === 'custom' ? 'block' : 'none';
    const intro = document.getElementById('report-intro');
    const warning = document.getElementById('report-warning');
    if (intro) intro.value = t.intro;
    if (warning) warning.value = t.warning;
}

function addReportFinding() {
    if (reportFindings.length >= 12) { showToast('עד 12 ממצאים בדוח אחד (בשביל PDF קריא)', 'error'); return; }
    reportFindings.push({ location: '', desc: '', img: '' });
    renderReportFindings();
}

function removeReportFinding(i) {
    reportFindings.splice(i, 1);
    renderReportFindings();
}

function renderReportFindings() {
    const box = document.getElementById('report-findings');
    if (!box) return;
    if (reportFindings.length === 0) {
        box.innerHTML = '<p class="input-help">אין ממצאים עדיין, לחץ "הוסף ממצא".</p>';
        return;
    }
    box.innerHTML = reportFindings.map((f, i) => `
        <div class="rf-row">
            <span class="rf-num">${i + 1}</span>
            <input type="text" class="rf-loc" value="${escapeHtml(f.location)}" placeholder="מיקום (למשל: מטבח)" oninput="reportFindings[${i}].location=this.value">
            <textarea class="rf-desc" rows="2" placeholder="תיאור הממצא וההמלצה" oninput="reportFindings[${i}].desc=this.value">${escapeHtml(f.desc)}</textarea>
            <label class="rf-photo${f.img ? ' has' : ''}" title="${f.img ? 'לחץ על התמונה לסימון; על הרקע, החלפה' : 'צרף תמונה מהשטח'}">
                ${f.img && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(f.img) ? `<img src="${f.img}" alt="" onclick="event.preventDefault(); event.stopPropagation(); annotateFinding(${i})" title="לחץ כדי לסמן על התמונה">` : '<i class="fa-solid fa-camera"></i>'}
                <input type="file" accept="image/*" style="display:none" onchange="onReportPhoto(${i}, this)">
            </label>
            <button class="cr-del" onclick="removeReportFinding(${i})" title="מחק ממצא"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('');
}

// Compress site photos (phone camera shots are 3-8MB) to a small image so a
// full report stays well inside the localStorage budget.
//
// opts.mime matters: a logo may have a transparent background, and JPEG has no
// alpha, so flattening one produces a black or white box behind the mark.
// PNG for anything that might be transparent, JPEG for photographs.
function _compressImageFile(file, cb, opts) {
    const { max = 700, mime = 'image/jpeg', quality = 0.72 } = opts || {};
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        cb(c.toDataURL(mime, quality));
    };
    // A file the browser cannot decode: HEIC straight off an iPhone is the
    // common one: never fires onload. Without this the picker just closes and
    // nothing happens, which reads as the app being broken.
    img.onerror = () => {
        URL.revokeObjectURL(url);
        showToast('לא הצלחתי לקרוא את התמונה. אם צולמה באייפון, שמור אותה כ-JPG ונסה שוב.', 'error');
        cb(null);
    };
    img.src = url;
}

// Every file the user picks either works or says why. A FileReader with no
// onerror fails in complete silence: the dialog closes, nothing changes, and
// there is nothing to act on: worst of all on a backup restore, where the
// person is already trying to recover something.
function readFileOrExplain(file, onText, what) {
    const reader = new FileReader();
    reader.onload = () => onText(reader.result);
    reader.onerror = () => showToast(`לא הצלחתי לקרוא את ${what}. ייתכן שהקובץ פגום או נעול.`, 'error');
    reader.onabort = () => showToast(`קריאת ${what} הופסקה.`, 'error');
    reader.readAsText(file);
}

function onReportPhoto(i, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    _compressImageFile(file, (dataUrl) => {
        if (!dataUrl) return;                 // unreadable file, already explained
        reportFindings[i].img = dataUrl;
        renderReportFindings();
        scheduleReportPreview();
    });
    input.value = '';
}

function collectReport() {
    const type = document.getElementById('report-type')?.value || 'defects';
    const title = type === 'custom'
        ? (document.getElementById('report-custom-title')?.value || '').trim() || 'דוח בדיקה'
        : REPORT_TYPES[type].title;
    return {
        type, title,
        client: (document.getElementById('report-client')?.value || '').trim(),
        site: (document.getElementById('report-site')?.value || '').trim(),
        date: document.getElementById('report-date')?.value || getTodayDateString(),
        number: (document.getElementById('report-number')?.value || '').trim() || nextReportNumber(),
        intro: (document.getElementById('report-intro')?.value || '').trim(),
        warning: (document.getElementById('report-warning')?.value || '').trim(),
        summary: (document.getElementById('report-summary')?.value || '').trim(),
        blocks: reportBlocks.filter(b => b.type === 'table'
            ? b.rows.some(row => row.some(c => (typeof c === 'string' ? c.trim() : c && c.img)))
            : (b.text && b.text.trim())),
        findings: reportFindings.filter(f => f.location || f.desc || f.img),
        savedAt: Date.now()
    };
}

function buildReportSheet(r) {
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('rpt-client', r.client || '—');
    set('rpt-site', r.site);
    set('rpt-date', formatHebrewDate(r.date));
    set('rpt-number', r.number);
    set('rpt-title', r.title);
    set('rpt-intro', r.intro);
    const warn = document.getElementById('rpt-warning');
    if (warn) { warn.textContent = r.warning; warn.style.display = r.warning ? 'block' : 'none'; }
    // Free-form blocks (text + tables) render between the intro and the findings.
    const blocksBox = document.getElementById('rpt-blocks');
    if (blocksBox) {
        const cellHtml = (c) => (c && typeof c === 'object' && c.img)
            ? `<img src="${c.img}" class="rpt-cell-img" alt="">`
            : escapeHtml(c || '');
        blocksBox.innerHTML = (r.blocks || []).map(b => {
            if (b.type === 'text') return `<div class="rpt-free-text">${escapeHtml(b.text)}</div>`;
            const head = `<tr>${b.rows[0].map(c => `<th>${escapeHtml(typeof c === 'string' ? c : '')}</th>`).join('')}</tr>`;
            const body = b.rows.slice(1).map(row => `<tr>${row.map(c => `<td>${cellHtml(c)}</td>`).join('')}</tr>`).join('');
            return `<table class="rpt-free-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
        }).join('');
    }
    const tbody = document.getElementById('rpt-tbody');
    if (tbody) {
        tbody.innerHTML = r.findings.map((f, i) => `
            <tr class="rpt-row">
                <td>${i + 1}</td>
                <td>${escapeHtml(f.location)}</td>
                <td>${escapeHtml(f.desc)}</td>
                <td>${f.img ? `<img src="${f.img}" alt="">` : ''}</td>
            </tr>`).join('');
    }
    const table = document.getElementById('rpt-table');
    if (table) table.style.display = r.findings.length ? 'table' : 'none';
    const sumWrap = document.getElementById('rpt-summary-wrap');
    if (sumWrap) sumWrap.style.display = r.summary ? 'block' : 'none';
    set('rpt-summary', r.summary);
    // Branding: clone the logo column + footer from the live quote sheet so
    // business details are maintained in one place only.
    const logoSrc = document.querySelector('#quote-pdf-sheet .pdf-logo-column');
    const logoDst = document.getElementById('rpt-logo');
    if (logoSrc && logoDst) { logoDst.innerHTML = ''; logoDst.appendChild(logoSrc.cloneNode(true)); }
    const footSrc = document.querySelector('#quote-pdf-sheet .pdf-company-footer');
    const footDst = document.getElementById('rpt-footer');
    if (footSrc && footDst) { footDst.innerHTML = ''; footDst.appendChild(footSrc.cloneNode(true)); }
    const biz = appState.settings.businessDetails || {};
    set('rpt-sign-name', biz.owner || '');
    set('rpt-sign-role', biz.name || '');
}

function downloadReportPDF() {
    const r = collectReport();
    if (!r.client) { showToast('הזן לכבוד מי הדוח (שם הלקוח)', 'error'); return; }
    if (r.findings.length === 0 && r.blocks.length === 0 && !r.summary) { showToast('הוסף תוכן לדוח, טקסט, טבלה, ממצא או סיכום', 'error'); return; }
    if (typeof html2pdf === 'undefined') { showToast('מנוע ה-PDF לא נטען, רענן את הדף ונסה שוב', 'error'); return; }
    buildReportSheet(r);
    const el = document.getElementById('report-pdf-sheet');
    const filename = `${r.title}_${r.number}_${(r.client || '').replace(/\s+/g, '_')}.pdf`;
    showToast('מכין את הדוח להורדה...');
    // The sheet lives scaled inside the live-preview box, capture it unscaled.
    const restoreSheet = _unscaleSheetForCapture(el);
    return html2pdf().set({
        margin: 8,
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff', scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
    }).from(el).save()
        .then(() => { restoreSheet(); refreshReportPreview(); showToast('הדוח הורד'); saveReportToList(false); })
        .catch(err => { restoreSheet(); refreshReportPreview(); console.error('Report PDF error:', err); showToast('שגיאה ביצירת הדוח', 'error'); });
}

function saveReportToList(toast = true) {
    const r = collectReport();
    if (!r.client && r.findings.length === 0 && r.blocks.length === 0) { if (toast) showToast('אין מה לשמור עדיין', 'error'); return; }
    savedReports = savedReports.filter(x => x.number !== r.number); // resave = replace
    savedReports.unshift(r);
    savedReports = savedReports.slice(0, 30);
    try {
        localStorage.setItem(getStorageKey('sj_reports'), JSON.stringify(savedReports));
        if (toast) showToast('הדוח נשמר');
    } catch (e) {
        showToast('אין מקום לשמירה · מחק דוחות ישנים או צרף פחות תמונות', 'error');
    }
    renderSavedReports();
}

function loadSavedReport(idx) {
    const r = savedReports[idx];
    if (!r) return;
    document.getElementById('report-type').value = r.type || 'custom';
    applyReportTypeDefaults();
    if (r.type === 'custom') document.getElementById('report-custom-title').value = r.title;
    document.getElementById('report-client').value = r.client || '';
    document.getElementById('report-site').value = r.site || '';
    document.getElementById('report-date').value = r.date || getTodayDateString();
    document.getElementById('report-number').value = r.number || '';
    document.getElementById('report-intro').value = r.intro || '';
    document.getElementById('report-warning').value = r.warning || '';
    document.getElementById('report-summary').value = r.summary || '';
    reportBlocks = (r.blocks || []).map(b => b.type === 'table'
        ? { type: 'table', rows: b.rows.map(row => [...row]) }
        : { type: 'text', text: b.text || '' });
    reportFindings = (r.findings || []).map(f => ({ ...f }));
    if (reportFindings.length === 0) reportFindings.push({ location: '', desc: '', img: '' });
    renderReportBlocks();
    renderReportFindings();
    scheduleReportPreview();
    showToast('הדוח נטען לעריכה');
}

function deleteSavedReport(idx, e) {
    if (e) e.stopPropagation();
    if (!confirm('למחוק את הדוח השמור?')) return;
    savedReports.splice(idx, 1);
    localStorage.setItem(getStorageKey('sj_reports'), JSON.stringify(savedReports));
    renderSavedReports();
}

function renderSavedReports() {
    const box = document.getElementById('reports-saved-list');
    if (!box) return;
    if (savedReports.length === 0) {
        box.innerHTML = '<p class="input-help">אין דוחות שמורים עדיין.</p>';
        return;
    }
    box.innerHTML = savedReports.map((r, i) => `
        <div class="saved-report-row" onclick="loadSavedReport(${i})" title="טען דוח מלא לעריכה">
            <div class="sr-info">
                <span class="sr-title">${escapeHtml(r.title)}</span>
                <span class="sr-meta">${escapeHtml(r.client || '')} · ${formatHebrewDate(r.date)} · ${(r.findings || []).length} ממצאים${(r.blocks || []).length ? ' · ' + r.blocks.length + ' בלוקים' : ''}</span>
            </div>
            <button class="btn btn-secondary btn-small" onclick="importReportTemplate(${i}, event)" title="ייבא רק את המבנה, בלי התוכן">תבנית בלבד</button>
            <button class="cr-del" onclick="deleteSavedReport(${i}, event)" title="מחק"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('');
}

function newReport() {
    reportFindings = [{ location: '', desc: '', img: '' }];
    reportBlocks = [];
    ['report-client', 'report-site', 'report-summary', 'report-custom-title'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('report-date').value = getTodayDateString();
    document.getElementById('report-number').value = nextReportNumber();
    applyReportTypeDefaults();
    renderReportBlocks();
    renderReportFindings();
    scheduleReportPreview();
}
