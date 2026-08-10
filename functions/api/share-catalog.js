// Cloudflare Pages Function — POST /api/share-catalog
// A user offers their personal price catalog to the shared "system" catalog.
// This function validates and formats the submission, then returns a ready-to-post
// web3forms payload that the browser sends (see the note below). If the prices
// check out, they can be promoted into the shared catalog manually.
//
// Why the browser posts it: on the web3forms free plan, server-to-server
// submissions are rejected with 403 "This method is not allowed. Use our API in
// client side", so a Worker calling it directly always fails. The key is public
// by design (already a hidden input in the contact forms).
//
// Note on contact details: Google sign-in only exposes name + email (userinfo
// scopes). A phone number is never available from Google, so the client asks for
// it optionally and passes it through here.

// Read the web3forms key from the environment (Cloudflare → Settings → Env vars,
// name WEB3FORMS_KEY). The literal fallback keeps lead capture working until the
// env var is set — but it lives in a PUBLIC repo, so it must be rotated: set the
// new key as WEB3FORMS_KEY and the exposed one below becomes dead.
// The key is handed to the browser on purpose: web3forms access keys are public,
// and its free plan rejects server-to-server submissions outright.
const WEB3FORMS_KEY_FALLBACK = 'da99a67b-ae1d-40b1-9354-74af5ee6d62d';
const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

export async function onRequestPost(context) {
  const { request, env } = context;
  const WEB3FORMS_KEY = (env && env.WEB3FORMS_KEY) || WEB3FORMS_KEY_FALLBACK;

  let body;
  try { body = await request.json(); } catch { return json({ error: { message: 'בקשה לא תקינה.' } }, 400); }

  const name = String(body.name || '').trim().slice(0, 80) || 'משתמש';
  const email = String(body.email || '').trim().slice(0, 120);
  const phone = String(body.phone || '').trim().slice(0, 40);
  const profession = String(body.profession || '').trim().slice(0, 60);

  const catalog = Array.isArray(body.catalog) ? body.catalog : [];
  const items = catalog
    .map((it) => ({
      name: String(it && it.name != null ? it.name : '').trim().slice(0, 120),
      price: Number(it && it.price),
      unit: String(it && it.unit != null ? it.unit : '').trim().slice(0, 30),
    }))
    .filter((it) => it.name && Number.isFinite(it.price))
    .slice(0, 500);

  // Alternative payload: a raw price FILE from the sender's computer
  // (CSV/TXT embedded as text; binary formats send the name only).
  const fileName = String(body.fileName || '').trim().slice(0, 160);
  const fileText = String(body.fileText || '').slice(0, 60000);

  if (items.length === 0 && !fileName) {
    return json({ error: { message: 'אין פריטים תקינים במאגר לשיתוף.' } }, 400);
  }

  const lines = items.length
    ? items.map((it) => `• ${it.name} — ${it.price}₪${it.unit ? ' / ' + it.unit : ''}`).join('\n')
    : (fileText ? `קובץ מצורף (${fileName}):\n${'-'.repeat(20)}\n${fileText}` : `נשלח שם קובץ בלבד: ${fileName} — יש ליצור קשר עם השולח להעברתו.`);
  const contact = [
    `שם: ${name}`,
    email ? `אימייל: ${email}` : 'אימייל: (אורח — לא מחובר)',
    phone ? `טלפון: ${phone}` : 'טלפון: לא סופק',
    profession ? `תחום: ${profession}` : null,
  ].filter(Boolean).join('\n');

  const notify = {
    endpoint: WEB3FORMS_ENDPOINT,
    payload: {
      access_key: WEB3FORMS_KEY,
      subject: `מחירון שהתקבל לשיתוף — ${name}` + (items.length ? ` (${items.length} פריטים)` : ` (קובץ: ${fileName})`),
      from_name: 'שיתוף מאגר מחירים — SJ',
      email: email || 'info@sj-eng.co.il',
      name,
      message: `התקבל מחירון לשיתוף עם המערכת.\n\nפרטי השולח:\n${contact}\n\n${'='.repeat(30)}\n${items.length ? `מחירון (${items.length} פריטים):\n` : ''}${lines}`,
    },
  };

  return json({ ok: true, count: items.length, notify });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
