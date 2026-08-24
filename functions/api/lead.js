// Cloudflare Pages Function — "email me this conversation" for the assistant.
// Takes the chat transcript + the visitor's name/email, has the AI draft a warm,
// personalised follow-up in SJ's voice (a light, accurate knowledge demo), then:
//   1) hands the browser a ready-to-post web3forms payload so SJ gets the lead, and
//   2) if RESEND_API_KEY is configured, also emails the visitor FROM SJ (Resend).
// So it works today as lead capture, and upgrades to true auto-send once a Resend
// key + verified domain (sj-eng.co.il) are added.
//
// Why the browser posts to web3forms instead of this function: on the web3forms
// free plan, server-to-server submissions are rejected with
// 403 "This method is not allowed. Use our API in client side" — a Worker calling
// it directly always fails. The key is public by design (it is already a hidden
// input in the contact forms), so relaying it to the client costs nothing and
// keeps a single definition of it here.

import { generate } from './_ai.js';
import { rateLimit, dailyQuota } from './_tiers.js';
import { sendMail, SJ_FROM } from './_mail.js';

// web3forms key: prefer the env var (Cloudflare → Settings → Env vars,
// WEB3FORMS_KEY). The literal below is the fallback until that is set.
//
// It being in a public repo is NOT a leak: web3forms access keys are public by
// design — the contact forms carry one in a hidden input, and the free plan
// only accepts client-side submissions. What a public key costs you is form
// spam, and the fix for that is web3forms' own captcha/domain settings, not
// rotation.
//
// If you do rotate it, rotate all FIVE places or leads go missing silently:
//   functions/api/lead.js          (here — or set WEB3FORMS_KEY and skip it)
//   functions/api/share-catalog.js (same)
//   contact.html, index.html, zerem/index.html
// Those three hardcode the key in the form itself and never reach a Function,
// so setting the env var alone leaves them posting a dead key — no error, no
// bounce, the lead just never arrives. A test pins all five together.
const WEB3FORMS_KEY_FALLBACK = 'da99a67b-ae1d-40b1-9354-74af5ee6d62d';
const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

const DRAFT_PROMPT = `אתה כותב בשם SJ הנדסת חשמל מייל קצר, חם ומקצועי בעברית אל מתעניין שדיבר עם העוזר ההנדסי באתר. בהתבסס על תמלול השיחה:
- פתח בשלום אישי לפי השם.
- ציין שאתה מצרף את שיחתו עם העוזר.
- סכם במשפט-שניים את הנושא שהעלה, ואת הכיוון שבו SJ יכולים לעזור לפתור אותו, הדגמת ידע קצרה, מדויקת וענווה, בלי להמציא נתונים, תקנים או מחירים, ובלי להבטיח הבטחות. אם אינך בטוח בפרט, נסח בזהירות.
- ציין שביצענו עבודות דומות בעבר.
- הזמן אותו לפנות בכל שאלה, בנימה של עובד מצטיין ושירותי.
כתוב 4–6 משפטים, מקצועי וחם, בלי כותרות ובלי Markdown. אם לא עולה נושא חשמלי ברור מהשיחה, כתוב מייל כללי, נעים ומזמין. חתום בשורה נפרדת: "בברכה, SJ הנדסת חשמל". החזר אך ורק את גוף המייל.`;

export async function onRequestPost(context) {
  const { request, env } = context;

  // Cost/spam guard: this endpoint runs the AI and sends email, unauthenticated.
  if (!(await rateLimit(env, request, 'lead', 3))) {
    return json({ error: { message: 'נשלחו כבר מספר בקשות. נסו שוב בעוד דקה.' } }, 429);
  }

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
  // A real "email me this conversation" has a conversation behind it: the
  // visitor asked something and the assistant answered. One fabricated turn is
  // the cheapest possible way to use this endpoint as a mailer.
  if (!turns.some((m) => m.role === 'user') || !turns.some((m) => m.role === 'assistant')) {
    return json({ error: { message: 'אין שיחה לשלוח.' } }, 400);
  }

  // The abuse this endpoint is exposed to once RESEND_API_KEY exists is not
  // volume from one IP — the per-minute limiter above already answers that. It
  // is that ANYONE can make SJ's domain send mail to an address they choose,
  // carrying text they wrote. Two ceilings bound that without asking a real
  // visitor for anything: how many times one address can be mailed, and how
  // many can go out in a day at all. Both are checked before the AI call, so a
  // flood costs no tokens either.
  const addrKey = 'lead:' + email.toLowerCase().replace(/[^\w@.+-]/g, '');
  if (!(await dailyQuota(env, addrKey, 2))) {
    return json({ error: { message: 'כבר נשלח סיכום לכתובת הזאת היום.' } }, 429);
  }
  if (!(await dailyQuota(env, 'lead:all', 60))) {
    return json({ error: { message: 'נשלחו היום הרבה סיכומים. נסו שוב מחר או פנו אלינו ישירות.' } }, 429);
  }

  const transcript = turns
    // Each turn is bounded like /api/assistant does it: this endpoint is public
    // and feeds an AI call, so message size cannot be attacker-chosen.
    .map((m) => (m.role === 'user' ? 'מתעניין: ' : 'העוזר של SJ: ') + m.content.trim().slice(0, 2000))
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
      thinkingBudget: 0, // short follow-up draft — no thinking, so the 500-token
                         // budget isn't consumed by reasoning and truncated.
      stream: false,
    });
    const data = await res.json();
    draft = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  } catch (e) { /* fall through to generic */ }

  if (!draft) {
    draft = `שלום ${name},\nמצרפים את שיחתך עם העוזר ההנדסי של SJ. נשמח לעזור ולהתעמק יחד בנושא, דבר איתנו חופשי בכל שאלה.\n\nבברכה, SJ הנדסת חשמל`;
  }

  const fullBody = `${draft}\n\n— · —\nתמלול השיחה המלא:\n\n${transcript}`;

  // 2a) Lead capture for SJ — composed here, posted by the browser (see header).
  const notify = {
    endpoint: WEB3FORMS_ENDPOINT,
    payload: {
      access_key: (env && env.WEB3FORMS_KEY) || WEB3FORMS_KEY_FALLBACK,
      subject: `ליד חדש מהעוזר באתר, ${name}`,
      from_name: 'עוזר ה-AI של SJ',
      email,
      name,
      message: `מתעניין/ת: ${name} <${email}>\n\nטיוטת מייל מענה (מוכנה לשליחה):\n${draft}\n\n${'='.repeat(30)}\nתמלול השיחה:\n${transcript}`,
    },
  };

  // 2b) If Resend is configured, send the summary straight to the visitor FROM SJ.
  const sentToVisitor = (await sendMail(env, {
    to: email,
    subject: 'סיכום שיחתך עם SJ הנדסת חשמל',
    text: fullBody,
  })).ok;

  return json({
    ok: true,
    sentToVisitor,
    notify,
    message: sentToVisitor
      ? 'הסיכום נשלח אליך למייל ✓ נשמח לעזור בכל שאלה.'
      : 'קיבלנו את הפנייה ✓ ניצור איתך קשר בהקדם.',
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
