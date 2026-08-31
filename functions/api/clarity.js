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

import { adminGate, rateLimit, jsonResponse } from './_tiers.js';

const TOKEN_KEY = 'config:clarity_token';
const CACHE_KEY = 'clarity:cache';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;
  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;
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
  // Two callers are allowed, nobody else: the signed-in admin (browser), and
  // the repo's own GitHub Actions puller. The adminGate that closed the
  // public hole (traffic figures are the business's own data) also cut off
  // the puller — Actions has no Google session — so it authenticates with a
  // GitHub OIDC token instead: short-lived, signed by GitHub, pinned below to
  // THIS repository. No shared secret to provision anywhere.
  const oidcOk = await verifyGithubOidc(env, request.headers.get('X-GitHub-OIDC') || '');
  if (!oidcOk) {
    const gate = await adminGate(request);
    if (!gate.ok) return gate.response;
  }
  if (!(await rateLimit(env, request, 'clarity', 5))) {
    return jsonResponse({ ok: false, error: 'rate-limited' }, 429);
  }

  // Either place works, and neither is more correct: the admin card writes the
  // token to KV, and CLARITY_API_TOKEN is where a Cloudflare secret naturally
  // goes. Accepting only one of them is how this stayed unplugged — the token
  // existed, went to the other place, and nothing said so.
  const token = (await env.SJ_DATA.get(TOKEN_KEY)) || env.CLARITY_API_TOKEN;
  if (!token) return jsonResponse({ ok: false, error: 'token-not-set' });

  // Serve the cache while fresh — Clarity caps API calls per day.
  try {
    const cached = JSON.parse((await env.SJ_DATA.get(CACHE_KEY)) || 'null');
    if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return jsonResponse({ ok: true, fetchedAt: cached.fetchedAt, cached: true, data: cached.data });
    }
  } catch { /* refetch */ }

  // Failure cooldown: Clarity caps ~10 API calls/day, so a broken token must
  // not let anonymous callers burn the quota with a live upstream hit each.
  if (await env.SJ_DATA.get('clarity:fail')) {
    return jsonResponse({ ok: false, error: 'upstream-cooldown' }, 503);
  }

  let res;
  try {
    res = await fetch('https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3', {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
  } catch {
    await env.SJ_DATA.put('clarity:fail', '1', { expirationTtl: 900 });
    return jsonResponse({ ok: false, error: 'clarity-unreachable' }, 502);
  }
  if (!res.ok) {
    await env.SJ_DATA.put('clarity:fail', '1', { expirationTtl: 900 });
    return jsonResponse({ ok: false, error: 'clarity-' + res.status }, 502);
  }
  const data = await res.json();
  const payload = { fetchedAt: Date.now(), data };
  await env.SJ_DATA.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 });
  return jsonResponse({ ok: true, fetchedAt: payload.fetchedAt, cached: false, data });
}

// ---- GitHub Actions OIDC verification ----
// Accepts only a token GitHub itself signed for a workflow of THIS repo, with
// the audience this relay names. JWKS is cached a day and refreshed once on an
// unknown kid (key rotation).

const GH_ISSUER = 'https://token.actions.githubusercontent.com';
const GH_AUDIENCE = 'sj-clarity-pull';
const GH_REPO = 'stavjan1/sj-website';

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function fetchJwks(env, force) {
  if (!force) {
    try {
      const cached = JSON.parse((await env.SJ_DATA.get('gh:jwks')) || 'null');
      if (cached && cached.keys) return cached;
    } catch { /* refetch */ }
  }
  const res = await fetch(GH_ISSUER + '/.well-known/jwks');
  if (!res.ok) return null;
  const jwks = await res.json();
  await env.SJ_DATA.put('gh:jwks', JSON.stringify(jwks), { expirationTtl: 86400 });
  return jwks;
}

async function verifyGithubOidc(env, jwt) {
  try {
    if (!jwt) return false;
    const parts = jwt.split('.');
    if (parts.length !== 3) return false;
    const header = b64urlToJson(parts[0]);
    const payload = b64urlToJson(parts[1]);

    if (payload.iss !== GH_ISSUER) return false;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(GH_AUDIENCE)) return false;
    if (payload.repository !== GH_REPO) return false;
    const now = Date.now() / 1000;
    if (!payload.exp || now > payload.exp || (payload.nbf && now < payload.nbf)) return false;

    let jwks = await fetchJwks(env, false);
    let jwk = jwks && (jwks.keys || []).find((k) => k.kid === header.kid);
    if (!jwk) {
      jwks = await fetchJwks(env, true); // rotation — refresh once
      jwk = jwks && (jwks.keys || []).find((k) => k.kid === header.kid);
    }
    if (!jwk) return false;

    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1]));
  } catch {
    return false;
  }
}
