// Cloudflare Pages Function — POST /api/scrape
// Fetches a supplier page and uses the AI to extract a clean price list, so the
// quote app can build a persistent "price catalog" (scrape once, reuse forever)
// instead of guessing or re-scraping on every chat.
//
// Engine: free DIY fetch by default (good for normal category/list pages). If
// FIRECRAWL_API_KEY is set, Firecrawl is used instead (handles JS-rendered /
// anti-bot sites). Extraction is done by the same multi-provider AI (_ai.js).

import { generate } from './_ai.js';

const MAX_CONTENT = 14000; // chars of page text fed to the extractor (token guard)

const EXTRACT_PROMPT = `אתה מחלץ מחירים מדפי ספקים. מהתוכן הבא של דף אינטרנט, חלץ כל מוצר נבדל שיש לו מחיר ברור.
החזר אך ורק JSON במבנה: {"items":[{"name":"שם המוצר","price":<מספר בש"ח>,"unit":"יחידה/מטר/אריזה (אם ידוע)"}]}.
כללים: price הוא מספר בלבד (ללא ₪ או פסיקים). התעלם מתפריטים, ניווט, דמי משלוח, סכומי ביניים, ופריטים ללא מחיר ברור. אל תמציא מחירים. אם אין מוצרים עם מחיר — החזר {"items":[]}.`;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch { return json({ error: { message: 'בקשה לא תקינה.' } }, 400); }

  const url = String(body.url || '').trim();
  if (!/^https?:\/\/.+/i.test(url)) {
    return json({ error: { message: 'נא להזין כתובת אתר תקינה (http/https).' } }, 400);
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
          'User-Agent': 'Mozilla/5.0 (compatible; SJ-PriceBot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
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

// Strip scripts/styles/tags → readable text.
function htmlToText(html) {
  return html
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
