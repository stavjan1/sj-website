// Cloudflare Pages Function — Telegram bot for field defect reports (דוח ליקויים).
//
//   POST /api/telegram           — Telegram webhook (secret-token verified)
//   GET  /api/telegram?view=<t>  — printable RTL HTML view of a finished report
//
// Flow: "פרויקט קאנטרי רעננה, דוח ליקויים" starts a session → during the site
// tour each photo + one line ("לוח ראשי - פס הארקה חלוד") becomes a finding →
// "סיים" fetches the photos, has the CHEAP model tidy the notes into
// {location, desc} rows, and stores a ZEREM-format report record in KV.
// The reply links to the printable view and to a one-click import into the app
// (/sale/?tgreport=<token>).
//
// Configuration lives in KV under `config:telegram` and is written from the
// admin screen (/api/telegram-setup): { botToken, secret, allowed:[chatId] }.
// Env vars of the same names still work and win if present, so an existing
// deployment keeps behaving exactly as before.
// KV:  tgsess:<chatId>  — active session (TTL 24h)
//      tgreport:<token> — finished report record (TTL 60 days)

import { generate } from './_ai.js';
import { rateLimit } from './_tiers.js';

// One read per request, cached for the life of the invocation.
async function loadConfig(env) {
    let cfg = {};
    try { cfg = JSON.parse(await env.SJ_DATA.get('config:telegram') || '{}') || {}; } catch { cfg = {}; }
    return {
        botToken: env.TELEGRAM_BOT_TOKEN || cfg.botToken || '',
        secret: env.TELEGRAM_WEBHOOK_SECRET || cfg.secret || '',
        allowed: (env.TELEGRAM_ALLOWED_CHATS
            ? String(env.TELEGRAM_ALLOWED_CHATS).split(',')
            : (Array.isArray(cfg.allowed) ? cfg.allowed : [])
        ).map(v => String(v).trim()).filter(Boolean),
        openToFirst: !!cfg.openToFirst,   // "the next chat that writes gets in"
    };
}

const SESS_TTL = 60 * 60 * 24;        // one working day, generous
const REPORT_TTL = 60 * 60 * 24 * 60; // 60 days to import/print
const MAX_FINDINGS = 40;
const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// Verbatim from the app's REPORT_TYPES.defects — the two must stay in sync.
const DEFECTS_TITLE = 'דוח ליקויים · בדיקת מתקן חשמל';
const DEFECTS_INTRO = 'בעת הבדיקה נמצאו ליקויים בטיחותיים במתקן החשמל, כמפורט בטבלת הממצאים שלהלן. יש לטפל בליקויים באמצעות חשמלאי בעל רישיון מתאים.';
const DEFECTS_WARNING = 'אישור הבדיקה יינתן רק לאחר השלמת הטיפול בכל הליקויים המפורטים בדוח זה ואישורם על ידי הגורם המוסמך.';

const HELP_TEXT = [
    'בוט דוחות הליקויים של זרם ⚡',
    '',
    'ככה עובדים:',
    '1. כותבים: פרויקט קאנטרי רעננה, דוח ליקויים',
    '2. במהלך הסיור שולחים תמונה של כל ליקוי, ובכיתוב שלה שורה אחת: מיקום - מה הליקוי',
    '3. בסוף כותבים: סיים',
    '',
    'תוך כדי: "בטל אחרון" מוחק ממצא שגוי, "כמה" מראה מה נרשם עד עכשיו.',
    '',
    'הבוט מסדר הכל לדוח מוכן: עם קישור לצפייה ולהדפסה, וכפתור ייבוא למערכת.',
    'לביטול באמצע: בטל',
].join('\n');

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

function newToken(len = 12) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    let out = '';
    for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
    return out;
}

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function todayIsrael() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

async function tg(cfg, method, payload) {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return res.json().catch(() => ({}));
}

function say(cfg, chatId, text) {
    return tg(cfg, 'sendMessage', { chat_id: chatId, text });
}

// Pick a mid-size photo (~≤1000px wide): big enough for a report, small enough
// to embed dozens of them in one KV record.
function pickPhoto(photos) {
    if (!Array.isArray(photos) || !photos.length) return null;
    const sorted = [...photos].sort((a, b) => (a.width || 0) - (b.width || 0));
    const fit = sorted.filter(p => (p.width || 0) <= 1000);
    return (fit.length ? fit[fit.length - 1] : sorted[0]);
}

async function fetchPhotoDataUrl(env, cfg, fileId) {
    const info = await tg(cfg, 'getFile', { file_id: fileId });
    const path = info && info.result && info.result.file_path;
    if (!path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${cfg.botToken}/${path}`);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 500 * 1024) return null; // defensive cap per photo
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return 'data:image/jpeg;base64,' + btoa(bin);
}

const sessKey = (chatId) => `tgsess:${chatId}`;

async function loadSession(env, chatId) {
    try { return JSON.parse(await env.SJ_DATA.get(sessKey(chatId)) || 'null'); }
    catch { return null; }
}

function saveSession(env, chatId, sess) {
    return env.SJ_DATA.put(sessKey(chatId), JSON.stringify(sess), { expirationTtl: SESS_TTL });
}

// "פרויקט קאנטרי רעננה, דוח ליקויים" → "קאנטרי רעננה"
function extractTitle(text) {
    let t = String(text || '').trim();
    t = t.replace(/דו"?ח\s*ליקויים/g, '')
        .replace(/תעש[יה]\s*לי\s*/g, '')
        .replace(/^\s*(זה\s+)?(ה?פרויקט|עבור|ל)\s+/g, '')
        .replace(/[,.:;־-]\s*$/g, '')
        .replace(/^\s*[,.:;־-]/g, '')
        .trim();
    return t.slice(0, 80) || 'פרויקט ללא שם';
}

const START_RE = /דו"?ח\s*ליקויים|פרויקט|התחל/;
const FINISH_RE = /^\s*(סיים|סיום|לסיים|גמרנו|זהו|\/done)\s*[.!]?\s*$/;
// A bad photo happens on every walk, and the answer cannot be "start over".
const UNDO_RE = /^\s*(בטל אחרון|מחק אחרון|אחרון|\/undo)\s*[.!]?\s*$/;
const STATUS_RE = /^\s*(כמה|סטטוס|מה יש|\/status)\s*[.!?]?\s*$/;
const CANCEL_RE = /^\s*(בטל|ביטול|\/cancel)\s*[.!]?\s*$/;

// One cheap AI call at the end tidies all raw captions into clean rows.
async function normalizeFindings(env, sess) {
    const raw = sess.findings.map((f, i) => `${i + 1}. ${f.raw || ''}`).join('\n');
    try {
        const res = await generate(env, {
            stream: false,
            max_tokens: 1500,
            // Gemini counts thinking tokens inside maxOutputTokens — without
            // this the JSON answer gets truncated mid-array (see _ai.js).
            thinkingBudget: 0,
            messages: [
                {
                    role: 'system',
                    content: 'אתה מסדר הערות שטח של חשמלאי בודק לטבלת דוח ליקויים. לכל שורה החזר אובייקט עם location (מיקום קצר, למשל "לוח ראשי", "חדר משאבות") ו-desc (תיאור הליקוי, משפט מקצועי אחד-שניים, בלי להמציא עובדות שלא נכתבו). אם אין מיקום, השאר location ריק. החזר אך ורק JSON תקין: מערך באורך זהה למספר השורות, באותו סדר.',
                },
                { role: 'user', content: raw },
            ],
        });
        const data = await res.json();
        const txt = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '';
        const match = txt.match(/\[[\s\S]*\]/);
        const arr = JSON.parse(match ? match[0] : txt);
        if (Array.isArray(arr) && arr.length === sess.findings.length) {
            return sess.findings.map((f, i) => ({
                location: String(arr[i].location || '').slice(0, 120),
                desc: String(arr[i].desc || f.raw || '').slice(0, 500),
                fileId: f.fileId,
            }));
        }
    } catch { /* fall through to naive split */ }
    return sess.findings.map(f => {
        const parts = String(f.raw || '').split(/\s*[-–—:]\s*/);
        return {
            location: (parts.length > 1 ? parts[0] : '').slice(0, 120),
            desc: (parts.length > 1 ? parts.slice(1).join(' - ') : f.raw || '').slice(0, 500),
            fileId: f.fileId,
        };
    });
}

async function finalizeReport(env, cfg, chatId, sess) {
    await say(cfg, chatId, `מסדר את ${sess.findings.length} הממצאים ומכין את הדוח…`);
    const rows = await normalizeFindings(env, sess);

    // Photo budget: stay under the Workers subrequest cap (each photo costs
    // getFile + download) and keep the record importable into the app's
    // localStorage (~5MB quota) — beyond the caps, findings keep text only.
    const MAX_PHOTOS = 20;
    const MAX_EMBED_BYTES = 3 * 1024 * 1024;
    const findings = rows.map(row => ({ location: row.location, desc: row.desc, img: '', fileId: row.fileId }));
    let embedded = 0, embeddedBytes = 0;
    for (let i = 0; i < findings.length; i += 4) {
        const chunk = findings.slice(i, i + 4).filter(f => f.fileId && embedded < MAX_PHOTOS);
        const imgs = await Promise.all(chunk.map(f => fetchPhotoDataUrl(env, cfg, f.fileId).catch(() => null)));
        chunk.forEach((f, j) => {
            const img = imgs[j];
            if (img && embedded < MAX_PHOTOS && embeddedBytes + img.length <= MAX_EMBED_BYTES) {
                f.img = img; embedded++; embeddedBytes += img.length;
            }
        });
    }
    findings.forEach(f => delete f.fileId);

    const now = new Date();
    const record = {
        v: 1,
        source: 'telegram',
        type: 'defects',
        title: DEFECTS_TITLE,
        client: sess.title,
        site: sess.site || sess.title,
        date: todayIsrael(),
        number: `R-${now.getFullYear()}-T${String(now.getTime()).slice(-5)}`,
        intro: DEFECTS_INTRO,
        warning: DEFECTS_WARNING,
        blocks: [],
        findings,
        summary: '',
        savedAt: now.getTime(),
    };

    const token = newToken();
    await env.SJ_DATA.put(`tgreport:${token}`, JSON.stringify(record), { expirationTtl: REPORT_TTL });
    await env.SJ_DATA.delete(sessKey(chatId));

    const base = 'https://www.sj-eng.co.il';
    await say(cfg, chatId, [
        `הדוח מוכן · ${findings.length} ממצאים.`,
        '',
        `לצפייה והדפסה (מהדפדפן אפשר לשמור כ-PDF):`,
        `${base}/api/telegram?view=${token}`,
        '',
        `לייבוא ועריכה במערכת זרם:`,
        `${base}/sale/?tgreport=${token}`,
        '',
        'הקישורים נשמרים 60 יום.',
    ].join('\n'));
}

async function handleUpdate(env, cfg, update) {
    const msg = update && (update.message || update.edited_message);
    if (!msg || !msg.chat) return;
    const chatId = msg.chat.id;

    if (!cfg.botToken) return;

    // Closed bot: only allow-listed chats may use it. The admin screen can arm
    // "the next chat that writes gets in", which is how the owner pairs his own
    // phone without ever copying a chat id by hand.
    if (!cfg.allowed.includes(String(chatId))) {
        if (cfg.openToFirst) {
            cfg.allowed.push(String(chatId));
            try {
                const raw = JSON.parse(await env.SJ_DATA.get('config:telegram') || '{}');
                raw.allowed = cfg.allowed;
                raw.openToFirst = false;               // one pairing, then closed again
                raw.pairedAt = Date.now();
                await env.SJ_DATA.put('config:telegram', JSON.stringify(raw));
            } catch { }
            await say(cfg, chatId, 'הצ\'אט הזה חובר לזרם ✅\n' + HELP_TEXT);
            return;
        }
        await say(cfg, chatId, `הבוט הזה פרטי. מזהה הצ'אט שלך: ${chatId}\nכדי לאשר אותו, פותחים בזרם: ניהול → בוט הטלגרם.`);
        return;
    }

    const text = (msg.text || '').trim();
    const caption = (msg.caption || '').trim();
    let sess = await loadSession(env, chatId);

    if (text === '/start' || /^עזרה$/.test(text)) {
        await say(cfg, chatId, HELP_TEXT);
        return;
    }

    if (UNDO_RE.test(text)) {
        if (!sess || !sess.findings.length) {
            await say(cfg, chatId, 'אין ממצא למחוק.');
            return;
        }
        const gone = sess.findings.pop();
        sess.pendingCaption = false;
        await saveSession(env, chatId, sess);
        const what = (gone && gone.raw) ? `"${String(gone.raw).slice(0, 40)}"` : 'הממצא האחרון';
        await say(cfg, chatId, `${what} נמחק. נשארו ${sess.findings.length} ממצאים.`);
        return;
    }

    if (STATUS_RE.test(text)) {
        if (!sess) { await say(cfg, chatId, 'אין דוח פתוח. כותבים: פרויקט X, דוח ליקויים'); return; }
        const lines = sess.findings.map((f, i) => `${i + 1}. ${String(f.raw || '(ללא תיאור)').slice(0, 60)}`);
        await say(cfg, chatId, `דוח "${sess.title}" · ${sess.findings.length} ממצאים:\n` + (lines.join('\n') || '(עדיין ריק)'));
        return;
    }

    if (CANCEL_RE.test(text)) {
        if (sess) await env.SJ_DATA.delete(sessKey(chatId));
        await say(cfg, chatId, sess ? 'בוטל. אפשר להתחיל דוח חדש מתי שרוצים.' : 'אין דוח פתוח כרגע.');
        return;
    }

    if (FINISH_RE.test(text)) {
        if (!sess || !sess.findings.length) {
            await say(cfg, chatId, 'אין עדיין ממצאים בדוח. שלחו תמונה עם כיתוב "מיקום - ליקוי" ואז "סיים".');
            return;
        }
        // Any failure must reach the user — a silent waitUntil death means
        // "סיים" and then nothing, forever.
        try {
            await finalizeReport(env, cfg, chatId, sess);
        } catch (e) {
            await say(cfg, chatId, 'משהו נכשל בהכנת הדוח. נסו "סיים" שוב; אם זה חוזר, שלחו פחות תמונות לדוח אחד.');
        }
        return;
    }

    // Starting a NEW report while an old session is still open must not append
    // the command as a finding of the old report (a stale morning session
    // would swallow the afternoon site's report otherwise).
    if (sess && sess.findings.length && text && START_RE.test(text) && !sess.pendingCaption) {
        await say(cfg, chatId, `יש דוח פתוח לפרויקט "${sess.title}" עם ${sess.findings.length} ממצאים.\nכתבו "סיים" כדי לסגור אותו, או "בטל" כדי למחוק אותו: ואז נפתח את החדש.`);
        return;
    }

    // Photo → a finding. Album photos share the album caption.
    if (msg.photo) {
        if (!sess) {
            sess = { title: 'פרויקט ללא שם', site: '', findings: [], startedAt: Date.now() };
        }
        if (sess.findings.length >= MAX_FINDINGS) {
            await say(cfg, chatId, `הגעת ל-${MAX_FINDINGS} ממצאים, זה המקסימום לדוח אחד. כתבו "סיים" ואפשר לפתוח דוח נוסף.`);
            return;
        }
        const photo = pickPhoto(msg.photo);
        let raw = caption;
        if (!raw && msg.media_group_id && sess.lastAlbum === msg.media_group_id) raw = sess.lastAlbumCaption || '';
        if (msg.media_group_id) {
            sess.lastAlbum = msg.media_group_id;
            if (caption) sess.lastAlbumCaption = caption;
        }
        sess.findings.push({ raw, fileId: photo ? photo.file_id : null });
        sess.pendingCaption = !raw;
        await saveSession(env, chatId, sess);
        if (raw) {
            await say(cfg, chatId, `נרשם ממצא ${sess.findings.length} ✓  ·  טעות? "בטל אחרון"`);
        } else {
            await say(cfg, chatId, `קיבלתי את התמונה (ממצא ${sess.findings.length}). באיזה מיקום ומה הליקוי? כתבו שורה אחת.`);
        }
        return;
    }

    // Text while a photo waits for its caption → attach it.
    if (sess && sess.pendingCaption && text) {
        const last = sess.findings[sess.findings.length - 1];
        if (last && !last.raw) {
            last.raw = text;
            sess.pendingCaption = false;
            await saveSession(env, chatId, sess);
            await say(cfg, chatId, `נרשם ממצא ${sess.findings.length} ✓  ·  טעות? "בטל אחרון"`);
            return;
        }
    }

    // Text that starts a new report.
    if (!sess && text && START_RE.test(text)) {
        sess = { title: extractTitle(text), site: '', findings: [], startedAt: Date.now() };
        await saveSession(env, chatId, sess);
        await say(cfg, chatId, `פותח דוח ליקויים לפרויקט "${sess.title}".\nשלחו תמונה של כל ליקוי עם כיתוב: מיקום - מה הליקוי. בסוף כתבו "סיים".`);
        return;
    }

    if (sess && text) {
        await say(cfg, chatId, 'רשמתי. אפשר לשלוח תמונות ממצאים, או "סיים" כשמסיימים.');
        sess.findings.push({ raw: text, fileId: null });
        await saveSession(env, chatId, sess);
        return;
    }

    await say(cfg, chatId, HELP_TEXT);
}

export async function onRequestPost(context) {
    const { request, env } = context;
    if (!env.SJ_DATA) return json({ ok: true });
    const cfg = await loadConfig(env);
    if (!cfg.botToken) return json({ ok: true });
    // The secret is MANDATORY, not recommended: without it any anonymous POST
    // would be processed as a genuine Telegram update (message relay + KV
    // writes + AI spend for free). No secret configured = webhook disabled.
    if (!cfg.secret ||
        request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== cfg.secret) {
        return json({ error: 'forbidden' }, 403);
    }
    if (!(await rateLimit(env, request, 'tg', 60))) return json({ ok: true });
    let update;
    try { update = await request.json(); } catch { return json({ ok: true }); }
    // Answer Telegram fast; do the work after the response.
    context.waitUntil(handleUpdate(env, cfg, update).catch(() => {}));
    return json({ ok: true });
}

// Printable report view — server-rendered, hostile-data-escaped, RTL, light.
// ?record=<t> returns the raw JSON record instead (the app's import path).
export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const recordToken = url.searchParams.get('record') || '';
    if (recordToken && /^[a-z2-9]{8,20}$/.test(recordToken) && env.SJ_DATA) {
        const raw = await env.SJ_DATA.get(`tgreport:${recordToken}`);
        if (!raw) return json({ error: { message: 'הדוח לא נמצא או שפג תוקפו' } }, 404);
        return new Response(raw, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    const token = url.searchParams.get('view') || '';
    if (!env.SJ_DATA || !/^[a-z2-9]{8,20}$/.test(token)) return new Response('לא נמצא', { status: 404 });
    const rec = JSON.parse(await env.SJ_DATA.get(`tgreport:${token}`) || 'null');
    if (!rec) return new Response('הדוח לא נמצא או שפג תוקפו', { status: 404 });

    const rows = (rec.findings || []).map((f, i) => `
      <tr>
        <td class="n">${i + 1}</td>
        <td>${esc(f.location)}</td>
        <td>${esc(f.desc)}</td>
        <td class="img">${/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(f.img || '') ? `<img src="${f.img}" alt="ממצא ${i + 1}">` : ''}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(rec.title)}</title>
<style>
  body { font-family: "IBM Plex Sans Hebrew", "Heebo", sans-serif; margin: 0; background: #f5f5f4; color: #1c1917; }
  .sheet { max-width: 794px; margin: 24px auto; background: #fff; padding: 40px; box-shadow: 0 1px 8px rgb(0 0 0 / .08); }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #57534e; font-size: 14px; margin-bottom: 16px; }
  .intro { font-size: 14px; line-height: 1.6; }
  .warn { border: 1px solid #a16207; border-radius: 8px; padding: 10px 14px; font-size: 13px; margin: 14px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #d6d3d1; padding: 8px; font-size: 13px; vertical-align: top; text-align: right; }
  th { background: #f5f5f4; }
  td.n { width: 30px; text-align: center; }
  td.img { width: 180px; } td.img img { width: 100%; height: auto; border-radius: 4px; }
  .foot { color: #79716b; font-size: 12px; margin-top: 20px; }
  .print-btn { position: fixed; top: 12px; inset-inline-start: 12px; padding: 10px 18px; background: #1c1917; color: #fff; border: none; border-radius: 8px; font: 500 14px "IBM Plex Sans Hebrew", sans-serif; cursor: pointer; }
  @media print { .print-btn { display: none; } body { background: #fff; } .sheet { box-shadow: none; margin: 0; padding: 0; } }
</style></head><body>
<button class="print-btn" onclick="print()">הדפסה / שמירה כ-PDF</button>
<div class="sheet">
  <h1>${esc(rec.title)}</h1>
  <div class="meta">${esc(rec.client)}${rec.site && rec.site !== rec.client ? ' · ' + esc(rec.site) : ''} · ${esc(rec.date)} · מס' ${esc(rec.number)}</div>
  <p class="intro">${esc(rec.intro)}</p>
  <div class="warn">${esc(rec.warning)}</div>
  <table>
    <thead><tr><th>מס'</th><th>מיקום</th><th>תיאור הליקוי</th><th>תמונה</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="foot">הופק באמצעות זרם · לעריכה מלאה ולדוח ממותג: יבאו את הדוח במערכת</div>
</div>
</body></html>`;

    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}
