// Outbound email — one definition, used by every function that sends.
//
// Resend, not web3forms: web3forms rejects server-to-server submissions on the
// free plan (403), which is why the signup notification silently never arrived
// for as long as it existed. Resend is built for exactly this call.
//
// Configuration (Cloudflare Pages → Settings → Variables and secrets):
//   RESEND_API_KEY  — required; without it nothing is sent and every caller is
//                     told so explicitly rather than being allowed to assume.
//   RESEND_FROM     — optional; must be an address on a domain verified in
//                     Resend. Defaults to info@sj-eng.co.il.
//
// The contract that matters: this never throws and never lies. A caller always
// learns whether the mail actually went out, so no screen can claim an email
// was sent when it was not.

export const SJ_FROM = 'SJ הנדסת חשמל <info@sj-eng.co.il>';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendMail(env, { to, subject, text, replyTo }) {
  if (!env || !env.RESEND_API_KEY) return { ok: false, skipped: 'no-key' };
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { ok: false, skipped: 'no-recipient' };

  let res;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || SJ_FROM,
        to: recipients,
        reply_to: replyTo || 'info@sj-eng.co.il',
        subject,
        text,
      }),
    });
  } catch (e) {
    return { ok: false, error: 'unreachable' };
  }

  if (res.ok) return { ok: true };
  // Resend answers with a JSON error body; keep the message, it is the only
  // way to tell an unverified domain from a bad key without guessing.
  let detail = String(res.status);
  try {
    const body = await res.json();
    if (body && body.message) detail += ': ' + String(body.message).slice(0, 160);
  } catch { /* status alone will have to do */ }
  return { ok: false, error: detail };
}

// A send whose outcome is written down. Delivery that fails in silence is how
// the signup notification went missing for months; this keeps the last result
// in KV so the admin panel can show the truth instead of a promise.
export async function sendMailTracked(env, channel, mail) {
  const result = await sendMail(env, mail);
  if (env && env.SJ_DATA) {
    const record = {
      at: Date.now(),
      ok: !!result.ok,
      detail: result.error || result.skipped || null,
      to: Array.isArray(mail.to) ? mail.to[0] : mail.to,
    };
    try {
      await env.SJ_DATA.put(`mail:last:${channel}`, JSON.stringify(record), {
        expirationTtl: 60 * 60 * 24 * 120,
      });
    } catch { /* never let bookkeeping break a send */ }
  }
  return result;
}
