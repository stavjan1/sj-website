// Cloudflare Pages Function — multi-provider AI chat proxy.
// The browser sends OpenAI-style { provider, model, messages, response_format?,
// stream? } and reads choices[...] back. Keys stay server-side. Provider
// fallback + format translation live in ./_ai.js. Default provider: Gemini,
// falling back to DeepSeek (then Grok) when out of quota.
//
// Daily quota (server-enforced, can't be reset by clearing the browser):
// counted per verified Google account when the client sends its token, else
// per IP. Stored in the same KV namespace as user data (`quota:<id>:<date>`,
// auto-expiring). Admin is exempt. Tune with env vars QUOTA_USER / QUOTA_GUEST.
// If KV isn't bound the check is skipped — the app still works.

import { generate } from './_ai.js';

const ADMIN_EMAIL = 'stavjan19989@gmail.com';
const DEFAULT_QUOTA_USER = 150; // signed-in Google users, per day
const DEFAULT_QUOTA_GUEST = 40; // guests (per IP), per day

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: 'בקשה לא תקינה (JSON שגוי).' } }, 400);
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: { message: 'בקשה ללא הודעות (messages).' } }, 400);
  }

  // ---- Server-side daily quota ----
  if (env.SJ_DATA) {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const email = token ? await verifyGoogleEmail(token) : null;
    const isAdmin = email && email.toLowerCase() === ADMIN_EMAIL;
    if (!isAdmin) {
      const id = email
        ? 'u:' + email.toLowerCase()
        : 'ip:' + (request.headers.get('CF-Connecting-IP') || 'unknown');
      const limit = email
        ? int(env.QUOTA_USER, DEFAULT_QUOTA_USER)
        : int(env.QUOTA_GUEST, DEFAULT_QUOTA_GUEST);
      const day = new Date().toISOString().slice(0, 10);
      const key = `quota:${id}:${day}`;
      const used = parseInt((await env.SJ_DATA.get(key)) || '0', 10);
      if (used >= limit) {
        return json({ error: { message: email
          ? `הגעת למכסת ${limit} הבקשות היומית. המכסה מתאפסת בחצות (UTC).`
          : `הגעת למכסת ${limit} הבקשות היומית למשתמשי אורח. התחברות עם Google מגדילה את המכסה.` } }, 429);
      }
      // Best-effort increment (KV is eventually consistent — good enough here).
      context.waitUntil(env.SJ_DATA.put(key, String(used + 1), { expirationTtl: 60 * 60 * 26 }));
    }
  }

  return generate(env, {
    provider: (body.provider || 'gemini').toLowerCase(),
    model: body.model,
    messages: body.messages,
    response_format: body.response_format,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    stream: body.stream === true,
  });
}

async function verifyGoogleEmail(token) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return null;
    const info = await res.json();
    return info && info.email ? info.email : null;
  } catch {
    return null;
  }
}

function int(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
