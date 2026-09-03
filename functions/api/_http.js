// The HTTP plumbing every route used to carry a private copy of.
//
// Thirteen files each had their own `json()`, seven their own `cors()`, eight
// their own `safeParse()` — all the same four lines, drifting one character at
// a time. This is the one copy. `json` is `jsonResponse` from _tiers.js with
// room for extra headers (the CORS routes bind theirs once); it is not a fork.
//
// MSG holds the Hebrew replies that several routes say in the same words, so a
// rewording is one edit and the client's string checks keep matching. The
// strings themselves live in _tiers.js (adminGate speaks them and _tiers is
// what this file builds on); they are re-exported here so routes import one
// helper, not two.

import { jsonResponse, MSG } from './_tiers.js';

export { MSG };

// A JSON reply. Same semantics as jsonResponse (status defaults to 200,
// Content-Type application/json; charset=utf-8); `headers` are added on top,
// which is how the CORS routes keep their per-route method list.
export function json(obj, status = 200, headers) {
  const res = jsonResponse(obj, status);
  if (!headers) return res;
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

// The CORS trio, with the method list each route advertises for itself so the
// emitted Access-Control-Allow-Methods stays exactly what it was per route.
export function corsHeaders(methods, allowHeaders = 'Content-Type, Authorization') {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': allowHeaders,
  };
}

// The OPTIONS answer: an empty 204 carrying the CORS headers.
export function preflight(request, methods, allowHeaders) {
  return new Response(null, { status: 204, headers: corsHeaders(methods, allowHeaders) });
}

// JSON.parse that answers `fallback` (null by default) instead of throwing —
// for KV values that may be missing, stale or hand-edited.
export function safeParse(raw, fallback = null) {
  try { return JSON.parse(raw); } catch { return fallback; }
}
