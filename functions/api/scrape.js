// Cloudflare Pages Function — POST /api/scrape
// Fetches a supplier page and uses the AI to extract a clean price list, so the
// quote app can build a persistent "price catalog" (scrape once, reuse forever)
// instead of guessing or re-scraping on every chat.
//
// Engine: free DIY fetch by default (good for normal category/list pages). If
// FIRECRAWL_API_KEY is set, Firecrawl is used instead (handles JS-rendered /
// anti-bot sites). Extraction is done by the same multi-provider AI (_ai.js).

import { generate } from './_ai.js';
import { rateLimit, isPublicHttpUrl } from './_tiers.js';

const MAX_CONTENT = 35000; // chars of page text fed to the extractor (token guard)

const EXTRACT_PROMPT = `אתה מחלץ מחירים ומחירונים מדפי ספקים ומחירוני עבודות. מהתוכן הבא של דף אינטרנט, חלץ כל מוצר או סעיף עבודה נבדל שיש לו מחיר ברור.
החזר אך ורק JSON במבנה: {"items":[{"name":"שם המוצר או שם העבודה/השירות","price":<מספר בש"ח>,"unit":"יחידה/מטר/אריזה/נקודה/שעה (אם ידוע)"}]}.
כללים: price הוא מספר בלבד (ללא ₪ או פסיקים). התעלם מתפריטים, ניווט, דמי משלוח, סכומי ביניים, ופריטים ללא מחיר ברור. אל תמציא מחירים. אם אין מוצרים או עבודות עם מחיר — החזר {"items":[]}.`;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch { return json({ error: { message: 'בקשה לא תקינה.' } }, 400); }

  const url = String(body.url || '').trim();
  if (!/^https?:\/\/.+/i.test(url)) {
    return json({ error: { message: 'נא להזין כתובת אתר תקינה (http/https).' } }, 400);
  }
  // SSRF guard: never fetch internal/loopback/metadata hosts.
  if (!isPublicHttpUrl(url)) {
    return json({ error: { message: 'הכתובת אינה כתובת אתר ציבורית תקינה.' } }, 400);
  }
  // Cost guard: this endpoint runs the AI extractor and is unauthenticated —
  // cap per IP so it can't be used to drain AI credits.
  if (!(await rateLimit(env, request, 'scrape', 10))) {
    return json({ error: { message: 'יותר מדי בקשות סריקה. נסו שוב בעוד דקה.' } }, 429);
  }

  // 0) Shopify fast-path: collection pages expose a public products.json —
  // structured names+prices with zero AI cost and no scraping fragility.
  const shopifyItems = await tryShopifyCollection(url);
  if (shopifyItems && shopifyItems.length) {
    return json({ items: shopifyItems.slice(0, 300), source: url, engine: 'shopify', count: Math.min(shopifyItems.length, 300) });
  }

  // 1) Get the page content (markdown via Firecrawl, or raw HTML→text).
  let content = '';
  let engine = 'fetch';
  try {
    if (env.FIRECRAWL_API_KEY) {
      engine = 'firecrawl';
      const fc = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.FIRECRAWL_API_KEY}` },
        body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
      });
      const fcData = await fc.json().catch(() => ({}));
      content = (fcData && fcData.data && (fcData.data.markdown || fcData.data.content)) || '';
      if (!content) throw new Error('Firecrawl returned no content');
    } else {
      const res = await fetch(url, {
        headers: {
          // A real-browser UA — many suppliers block anything that looks like a bot.
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'he-IL,he;q=0.9,en;q=0.6',
        },
      });
      if (res.status === 403 || res.status === 503) throw new Error(`האתר חוסם גישה אוטומטית (${res.status})`);
      if (!res.ok) throw new Error(`האתר החזיר שגיאה ${res.status}`);
      const html = await res.text();
      content = htmlToText(html);
    }
  } catch (e) {
    return json({ error: { message: 'לא הצלחתי למשוך את הדף: ' + e.message + '. ייתכן שהאתר חוסם סריקה — אפשר להזין מחירים ידנית, או להגדיר FIRECRAWL_API_KEY.' } }, 502);
  }

  content = content.replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT);
  if (content.length < 40) {
    return json({ error: { message: 'הדף לא הכיל טקסט שניתן לקרוא (ייתכן שהמחירים נטענים ב-JavaScript). נסה דף קטגוריה אחר או הזן ידנית.' } }, 422);
  }

  // 2) Extract a structured price list with the AI.
  let items = [];
  try {
    const aiRes = await generate(env, {
      provider: (body.provider || 'gemini').toLowerCase(),
      model: body.model,
      messages: [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: `כתובת: ${url}\n\nתוכן הדף:\n${content}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 1500,
      stream: false,
    });
    const data = await aiRes.json();
    const raw = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!raw) {
      const msg = (data && data.error && data.error.message) || 'חילוץ המחירים נכשל.';
      return json({ error: { message: msg } }, aiRes.status === 200 ? 502 : aiRes.status);
    }
    const parsed = JSON.parse(extractJson(raw));
    items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch (e) {
    return json({ error: { message: 'שגיאה בחילוץ המחירים: ' + e.message } }, 502);
  }

  // Normalize + sanity-filter.
  const clean = items
    .map((it) => ({
      name: String(it && it.name != null ? it.name : '').trim().slice(0, 120),
      price: Number(it && it.price),
      unit: String(it && it.unit != null ? it.unit : '').trim().slice(0, 30),
    }))
    .filter((it) => it.name && Number.isFinite(it.price) && it.price > 0)
    .slice(0, 200);

  return json({ items: clean, source: url, engine, count: clean.length });
}

// Shopify stores expose /collections/<handle>/products.json publicly.
// If the URL looks like a Shopify collection, pull the structured data
// directly — exact titles, variants and prices, no AI extraction needed.
async function tryShopifyCollection(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/collections\/([^/?#]+)/);
    if (!m) return null;
    const res = await fetch(`${u.origin}/collections/${m[1]}/products.json?limit=250`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.products)) return null;
    const items = [];
    for (const p of data.products) {
      const variants = Array.isArray(p.variants) ? p.variants : [];
      for (const v of variants) {
        const price = parseFloat(v.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const vt = (v.title && v.title !== 'Default Title') ? ` — ${v.title}` : '';
        items.push({ name: `${p.title}${vt}`.trim().slice(0, 120), price, unit: '' });
      }
    }
    return items;
  } catch {
    return null;
  }
}

// Strip scripts/styles/tags → readable text.
function htmlToText(html) {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ');
}

// Pull a JSON object out of a model reply (raw, fenced, or padded).
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  return a !== -1 && b > a ? text.slice(a, b + 1) : text.trim();
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
