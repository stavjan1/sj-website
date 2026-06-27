// Cloudflare Pages Function — "email me this conversation" for the assistant.
// Takes the chat transcript + the visitor's name/email, has the AI draft a warm,
// personalised follow-up in SJ's voice (a light, accurate knowledge demo), then:
//   1) always emails SJ the lead + draft + transcript (web3forms — no setup), and
//   2) if RESEND_API_KEY is configured, also emails the visitor FROM SJ (Resend).
// So it works today as lead capture, and upgrades to true auto-send once a Resend
// key + verified domain (sj-eng.co.il) are added.

import { generate } from './_ai.js';

const WEB3FORMS_KEY = 'da99a67b-ae1d-40b1-9354-74af5ee6d62d';
const SJ_FROM = 'SJ הנדסת חשמל <info@sj-eng.co.il>';

const DRAFT_PROMPT = `אתה כותב בשם SJ הנדסת חשמל מייל קצר, חם ומקצועי בעברית אל מתעניין שדיבר עם העוזר ההנדסי באתר. בהתבסס על תמלול השיחה:
- פתח בשלום אישי לפי השם.
- ציין שאתה מצרף את שיחתו עם העוזר.
- סכם במשפט-שניים את הנושא שהעלה, ואת הכיוון שבו SJ יכולים לעזור לפתור אותו — הדגמת ידע קצרה, מדויקת וענווה, בלי להמציא נתונים, תקנים או מחירים, ובלי להבטיח הבטחות. אם אינך בטוח בפרט — נסח בזהירות.
- ציין שביצענו עבודות דומות בעבר.
- הזמן אותו לפנות בכל שאלה, בנימה של עובד מצטיין ושירותי.
כתוב 4–6 משפטים, מקצועי וחם, בלי כותרות ובלי Markdown. אם לא עולה נושא חשמלי ברור מהשיחה — כתוב מייל כללי, נעים ומזמין. חתום בשורה נפרדת: "בברכה, SJ הנדסת חשמל". החזר אך ורק את גוף המייל.`;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch { return json({ error: { message: 'בקשה לא תקינה.' } }, 400); }

  const name = String(body.name || '').trim().slice(0, 80) || 'שלום';
  const email = String(body.email || '').trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: { message: 'נא להזין כתובת מייל תקינה.' } }, 400);
  }

  const turns = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20);
  if (turns.length === 0) return json({ error: { message: 'אין שיחה לשלוח.' } }, 400);

  const transcript = turns
    .map((m) => (m.role === 'user' ? 'מתעניין: ' : 'העוזר של SJ: ') + m.content.trim())
    .join('\n\n');

  // 1) AI-drafted personalised follow-up (non-streaming).
  let draft = '';
  try {
    const res = await generate(env, {
      provider: (body.provider || 'gemini').toLowerCase(),
      messages: [
        { role: 'system', content: DRAFT_PROMPT },
        { role: 'user', content: `שם המתעניין: ${name}\n\nתמלול השיחה:\n${transcript}` },
      ],
      temperature: 0.5,
      max_tokens: 500,
      stream: false,
    });
    const data = await res.json();
    draft = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  } catch (e) { /* fall through to generic */ }

  if (!draft) {
    draft = `שלום ${name},\nמצרפים את שיחתך עם העוזר ההנדסי של SJ. נשמח לעזור ולהתעמק יחד בנושא — דבר איתנו חופשי בכל שאלה.\n\nבברכה, SJ הנדסת חשמל`;
  }

  const fullBody = `${draft}\n\n— — —\nתמלול השיחה המלא:\n\n${transcript}`;

  // 2a) Always notify SJ (lead capture) via web3forms — needs no setup.
  let sjNotified = false;
  try {
    const r = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: WEB3FORMS_KEY,
        subject: `ליד חדש מהעוזר באתר — ${name}`,
        from_name: 'עוזר ה-AI של SJ',
        email,
        name,
        message: `מתעניין/ת: ${name} <${email}>\n\nטיוטת מייל מענה (מוכנה לשליחה):\n${draft}\n\n${'='.repeat(30)}\nתמלול השיחה:\n${transcript}`,
      }),
    });
    sjNotified = r.ok;
  } catch (e) { /* non-fatal */ }

  // 2b) If Resend is configured, send the email straight to the visitor FROM SJ.
  let sentToVisitor = false;
  if (env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: env.RESEND_FROM || SJ_FROM,
          to: [email],
          reply_to: 'info@sj-eng.co.il',
          subject: 'סיכום שיחתך עם SJ הנדסת חשמל',
          text: fullBody,
        }),
      });
      sentToVisitor = r.ok;
    } catch (e) { /* non-fatal */ }
  }

  if (!sjNotified && !sentToVisitor) {
    return json({ error: { message: 'השליחה נכשלה כרגע. אפשר לפנות ישירות: 053-530-2887.' } }, 502);
  }

  return json({
    ok: true,
    sentToVisitor,
    message: sentToVisitor
      ? 'הסיכום נשלח אליך למייל ✓ נשמח לעזור בכל שאלה.'
      : 'קיבלנו את הפנייה ✓ נשלח אליך סיכום ונחזור אליך בהקדם.',
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
