// Cloudflare Pages Function — POST /api/share-catalog
// A user offers their personal price catalog to the shared "system" catalog.
// We email it to SJ for review (web3forms — no setup, works across devices). If
// the prices check out, they can be promoted into the shared catalog manually.
//
// Note on contact details: Google sign-in only exposes name + email (userinfo
// scopes). A phone number is never available from Google, so the client asks for
// it optionally and passes it through here.

const WEB3FORMS_KEY = 'da99a67b-ae1d-40b1-9354-74af5ee6d62d';

export async function onRequestPost(context) {
  const { request } = context;

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

  if (items.length === 0) return json({ error: { message: 'אין פריטים תקינים במאגר לשיתוף.' } }, 400);

  const lines = items.map((it) => `• ${it.name} — ${it.price}₪${it.unit ? ' / ' + it.unit : ''}`).join('\n');
  const contact = [
    `שם: ${name}`,
    email ? `אימייל: ${email}` : 'אימייל: (אורח — לא מחובר)',
    phone ? `טלפון: ${phone}` : 'טלפון: לא סופק',
    profession ? `תחום: ${profession}` : null,
  ].filter(Boolean).join('\n');

  try {
    const r = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: `מחירון שהתקבל לשיתוף — ${name} (${items.length} פריטים)`,
        from_name: 'שיתוף מאגר מחירים — SJ',
        email: email || 'info@sj-eng.co.il',
        name,
        message: `התקבל מחירון לשיתוף עם המערכת.\n\nפרטי השולח:\n${contact}\n\n${'='.repeat(30)}\nמחירון (${items.length} פריטים):\n${lines}`,
      }),
    });
    if (!r.ok) throw new Error('web3forms ' + r.status);
  } catch (e) {
    return json({ error: { message: 'השליחה נכשלה כרגע. נסה שוב מאוחר יותר.' } }, 502);
  }

  return json({ ok: true, count: items.length });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
