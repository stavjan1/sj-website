// Cloudflare Pages Function — server-side AI chat proxy (OpenAI-compatible).
// The API key lives ONLY here, in an environment variable, never in the browser.
//
// Default provider is DeepSeek (cheap, strong Hebrew chat + JSON). Grok (xAI) is
// also supported — just flip the AI_PROVIDER env var.
//
// Setup (one time): Cloudflare dashboard → Pages → (this project) → Settings →
//   Environment variables → add ONE of:
//     DEEPSEEK_API_KEY = sk-...   (from platform.deepseek.com/api_keys)  [default]
//     XAI_API_KEY      = xai-...  (from console.x.ai)  + AI_PROVIDER=grok
//   then redeploy. Works for every user and on every domain automatically.
//
// The client (sale/app.js) POSTs an OpenAI-style body:
//   { model, messages:[{role,content}], response_format?, temperature?, max_tokens? }
// We attach the server key and forward it to the provider, returning its native
// response (the client reads choices[0].message.content).

const PROVIDERS = {
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    keyEnv: ['DEEPSEEK_API_KEY'],
    defaultModel: 'deepseek-chat',
    // DeepSeek model ids; anything else falls back to the default.
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  grok: {
    url: 'https://api.x.ai/v1/chat/completions',
    keyEnv: ['XAI_API_KEY', 'GROK_API_KEY'],
    defaultModel: 'grok-2-latest',
    models: ['grok-2-latest', 'grok-2', 'grok-beta', 'grok-3', 'grok-3-mini'],
  },
};

export async function onRequestPost(context) {
  const { request, env } = context;

  const providerName = (env.AI_PROVIDER || 'deepseek').toLowerCase();
  const provider = PROVIDERS[providerName] || PROVIDERS.deepseek;

  const key = firstDefined(provider.keyEnv.map((name) => env[name]));
  if (!key) {
    // 501 tells the client "no server key configured" so it can fall back to a personal key.
    return jsonResponse(
      {
        error: {
          message:
            'מפתח ה-AI אינו מוגדר בשרת. הוסף DEEPSEEK_API_KEY (או XAI_API_KEY עבור Grok) בהגדרות הסביבה של Cloudflare Pages, או הזן מפתח אישי בהגדרות.',
        },
      },
      501
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { message: 'בקשה לא תקינה (JSON שגוי).' } }, 400);
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: { message: 'בקשה ללא הודעות (messages).' } }, 400);
  }

  // Pick a model the provider actually understands; fall back to its default so a
  // stale model id (e.g. an old Gemini name) never breaks the call.
  const requested = String(body.model || '').replace(/[^a-zA-Z0-9.\-_]/g, '');
  const model = provider.models.includes(requested) ? requested : provider.defaultModel;

  const stream = body.stream === true;
  const payload = {
    model,
    messages: body.messages,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    stream,
  };
  if (typeof body.max_tokens === 'number') payload.max_tokens = body.max_tokens;
  // JSON mode — the reasoner model doesn't support response_format, so skip it there.
  if (body.response_format && model !== 'deepseek-reasoner') {
    payload.response_format = body.response_format;
  }

  let upstream;
  try {
    upstream = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return jsonResponse({ error: { message: 'שגיאת רשת מול שרת ה-AI: ' + e.message } }, 502);
  }

  // For a successful streaming request, pipe the SSE body straight through.
  if (stream && upstream.ok && upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // Otherwise (non-streaming, or an error) return the body as-is.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function firstDefined(values) {
  for (const v of values) if (v) return v;
  return undefined;
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
