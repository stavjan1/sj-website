// Cloudflare Pages Function — /api/price-bom
//
// The second half of Stav's two-pass idea. The model names the products; this
// prices them, from the real catalogue, and refuses to guess.
//
//   POST /api/price-bom  { items: [{ name, qty? }, ...] }
//        → { items: [{ name, matched, price?, unit?, sku?, catalogName? }] }
//
// A line comes back either priced from the catalogue with its part number, or
// untouched and marked matched:false — in which case the model's own estimate
// stands and the quote says "(הערכה)". That distinction is the entire product.
//
// Why this is a separate call rather than something done to the model's reply
// on its way out: the reply is usually streamed, and rewriting numbers inside a
// stream means holding it back until the end, which would undo the work that
// took first-word latency from eighteen seconds to one.

import { priceBom } from './_price_match.js';
import { rateLimit } from './_tiers.js';
import { MSG, json as reply, corsHeaders, preflight } from './_http.js';

const METHODS = 'POST, OPTIONS';
const CORS = corsHeaders(METHODS);
const json = (obj, status) => reply(obj, status, CORS);

const MAX_ITEMS = 60;

export async function onRequestPost(context) {
  const { request, env } = context;

  // Cheap, but it reads a 7,361-item catalogue per call, so it is not free.
  if (!(await rateLimit(env, request, 'pricebom', 30))) {
    return json({ error: { message: MSG.TOO_MANY_REQUESTS } }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: { message: 'בקשה לא תקינה.' } }, 400); }

  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) return json({ items: [] });

  const items = raw.slice(0, MAX_ITEMS).map((it) => ({
    name: String((it && it.name) || '').slice(0, 200),
    qty: String((it && it.qty) || '').slice(0, 40),
  })).filter((it) => it.name);

  try {
    return json({ items: await priceBom(request, items) });
  } catch (e) {
    // Never fail the quote over pricing help. Everything simply stays an
    // estimate, which is what it already was a moment ago.
    return json({ items: items.map((i) => ({ ...i, matched: false })) });
  }
}

export async function onRequestOptions({ request }) {
  return preflight(request, METHODS);
}
