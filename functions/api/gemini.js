// Cloudflare Pages Function — server-side Gemini proxy.
// The API key lives ONLY here, in an environment variable, never in the browser.
//
// Setup (one time): Cloudflare dashboard → Pages → (this project) → Settings →
//   Environment variables → add  GEMINI_API_KEY = <your AIza... key from aistudio.google.com/apikey>
//   then redeploy. Works for every user and on every domain automatically.
//
// The client (sale/app.js) POSTs { model, systemInstruction?, contents, generationConfig? }
// and we forward it to Google with the server key attached.

export async function onRequestPost(context) {
  const { request, env } = context;

  const key = env.GEMINI_API_KEY;
  if (!key) {
    // 501 tells the client "no server key configured" so it can fall back to a personal key.
    return jsonResponse(
      { error: { message: 'מפתח Gemini אינו מוגדר בשרת. הוסף GEMINI_API_KEY בהגדרות הסביבה של Cloudflare Pages.' } },
      501
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { message: 'בקשה לא תקינה (JSON שגוי).' } }, 400);
  }

  const model = String(body.model || 'gemini-2.0-flash').replace(/[^a-zA-Z0-9.\-]/g, '');
  const { model: _omit, ...payload } = body;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return jsonResponse({ error: { message: 'שגיאת רשת מול שרתי Gemini: ' + e.message } }, 502);
  }

  // Pass Google's response (and status) straight back to the client.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
