// Cloudflare Pages Function — Microsoft Clarity relay.
//
// Why a relay: the analytics routine (Claude) runs in an environment whose
// network can't reach clarity.ms, but it CAN read this repo. So a GitHub
// Actions cron calls this endpoint, which fetches the Clarity Data Export API
// server-side, and commits the result into the repo for the routine to read.
//
//   POST /api/clarity  { token: "..." }  (admin) → store the Clarity API token
//                      { token: "" }     (admin) → clear it
//   GET  /api/clarity                    → { ok, fetchedAt, cached, data }
//
// The GET returns aggregate UX metrics only (session counts, popular pages,
// rage clicks — no PII), cached 6h in KV: Clarity allows ~10 API calls/day.

import { ADMIN_EMAIL, verifyGoogleEmail, bearerToken, rateLimit, jsonResponse } from './_tiers.js';

const TOKEN_KEY = 'config:clarity_token';
const CACHE_KEY = 'clarity:cache';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;
  const email = await verifyGoogleEmail(bearerToken(request));
  if (!email || email.toLowerCase() !== ADMIN_EMAIL) {
    return jsonResponse({ error: { message: 'אין הרשאה.' } }, 403);
  }
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400); }
  const token = String(body.token || '').trim();
  if (!token) {
    await env.SJ_DATA.delete(TOKEN_KEY);
    return jsonResponse({ ok: true, cleared: true });
  }
  await env.SJ_DATA.put(TOKEN_KEY, token);
  await env.SJ_DATA.delete(CACHE_KEY); // fresh token → fresh fetch on next GET
  return jsonResponse({ ok: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.SJ_DATA) return jsonResponse({ ok: false, error: 'KV לא מוגדר' }, 501);
  if (!(await rateLimit(env, request, 'clarity', 5))) {
    return jsonResponse({ ok: false, error: 'rate-limited' }, 429);
  }

  const token = await env.SJ_DATA.get(TOKEN_KEY);
  if (!token) return jsonResponse({ ok: false, error: 'token-not-set' });

  // Serve the cache while fresh — Clarity caps API calls per day.
  try {
    const cached = JSON.parse((await env.SJ_DATA.get(CACHE_KEY)) || 'null');
    if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return jsonResponse({ ok: true, fetchedAt: cached.fetchedAt, cached: true, data: cached.data });
    }
  } catch { /* refetch */ }

  let res;
  try {
    res = await fetch('https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3', {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
  } catch {
    return jsonResponse({ ok: false, error: 'clarity-unreachable' }, 502);
  }
  if (!res.ok) {
    return jsonResponse({ ok: false, error: 'clarity-' + res.status }, 502);
  }
  const data = await res.json();
  const payload = { fetchedAt: Date.now(), data };
  await env.SJ_DATA.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 });
  return jsonResponse({ ok: true, fetchedAt: payload.fetchedAt, cached: false, data });
}
