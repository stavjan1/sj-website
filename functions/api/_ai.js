// Shared multi-provider AI core for the Pages Functions (imported, not routed —
// the leading underscore keeps it out of the URL routing table).
//
// Goal: the browser always speaks ONE format (OpenAI-style `messages` in,
// `choices[...]` out, streaming or not) and just names a `provider`. This module
// translates to/from each provider and, if the chosen provider is out of quota
// or misconfigured, automatically falls back to the next available one and tells
// the client via the `X-AI-Fallback-From` response header.
//
// Server env keys (set in Cloudflare Pages → Settings → Environment variables):
//   GEMINI_API_KEY   — Google AI Studio key (primary, free tier)
//   DEEPSEEK_API_KEY — DeepSeek key (fallback, cheap)
//   XAI_API_KEY      — xAI/Grok key (optional)

export const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    kind: 'gemini',
    keyEnv: ['GEMINI_API_KEY'],
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'],
  },
  deepseek: {
    label: 'DeepSeek',
    kind: 'openai',
    url: 'https://api.deepseek.com/chat/completions',
    keyEnv: ['DEEPSEEK_API_KEY'],
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  grok: {
    label: 'Grok',
    kind: 'openai',
    url: 'https://api.x.ai/v1/chat/completions',
    keyEnv: ['XAI_API_KEY', 'GROK_API_KEY'],
    defaultModel: 'grok-2-latest',
    models: ['grok-2-latest', 'grok-3', 'grok-3-mini'],
  },
};

// Order tried on fallback once the explicitly-requested provider is placed first.
const FALLBACK_SEQUENCE = ['gemini', 'deepseek', 'grok'];

// Statuses that mean "this provider can't serve right now — try the next":
// 429 quota/rate, 401/403 bad/expired key, 402 no balance, 5xx upstream.
const RETRIABLE = [429, 401, 402, 403, 500, 502, 503];

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

export function keyFor(env, name) {
  const cfg = PROVIDERS[name];
  if (!cfg) return null;
  for (const k of cfg.keyEnv) if (env && env[k]) return env[k];
  return null;
}

// Build the attempt order: requested provider first (if it has a key), then the
// rest of the sequence that have keys configured.
export function buildOrder(requested, env) {
  const order = [];
  if (requested && PROVIDERS[requested] && keyFor(env, requested)) order.push(requested);
  for (const name of FALLBACK_SEQUENCE) {
    if (name !== requested && keyFor(env, name)) order.push(name);
  }
  if (order.length === 0) {
    for (const name of FALLBACK_SEQUENCE) if (keyFor(env, name)) order.push(name);
  }
  return order;
}

function pickModel(cfg, model) {
  return cfg.models.includes(model) ? model : cfg.defaultModel;
}

// OpenAI-style messages -> Gemini request body.
export function toGemini(messages, opts = {}) {
  const contents = [];
  let system = '';
  for (const m of messages || []) {
    if (!m || typeof m.content !== 'string') continue;
    if (m.role === 'system') { system += (system ? '\n' : '') + m.content; continue; }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const gc = {};
  if (opts.response_format && opts.response_format.type === 'json_object') gc.responseMimeType = 'application/json';
  if (typeof opts.temperature === 'number') gc.temperature = opts.temperature;
  if (opts.max_tokens) gc.maxOutputTokens = opts.max_tokens;
  if (Object.keys(gc).length) body.generationConfig = gc;
  return body;
}

function callOnce(name, key, opts) {
  const cfg = PROVIDERS[name];
  const model = pickModel(cfg, opts.model);
  if (cfg.kind === 'openai') {
    const payload = {
      model,
      messages: opts.messages,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.7,
      stream: !!opts.stream,
    };
    if (opts.max_tokens) payload.max_tokens = opts.max_tokens;
    if (opts.response_format && model !== 'deepseek-reasoner') payload.response_format = opts.response_format;
    return fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });
  }
  // gemini
  const method = opts.stream ? 'streamGenerateContent' : 'generateContent';
  const qs = opts.stream ? `?alt=sse&key=${key}` : `?key=${key}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}${qs}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toGemini(opts.messages, opts)),
  });
}

function geminiText(data) {
  try {
    const parts = data.candidates[0].content.parts || [];
    return parts.map((p) => p.text || '').join('');
  } catch (e) {
    return '';
  }
}

// Transform a Gemini SSE stream into an OpenAI-style SSE stream so the client
// reader (which expects choices[0].delta.content) works unchanged.
export function geminiStreamToOpenAI(upstreamBody) {
  const reader = upstreamBody.getReader();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buffer = '';
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
        return;
      }
      buffer += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.indexOf('data:') !== 0) continue;
        const p = line.slice(5).trim();
        if (!p || p === '[DONE]') continue;
        try {
          const j = JSON.parse(p);
          const t = geminiText(j);
          if (t) controller.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n'));
        } catch (e) { /* partial / keep-alive */ }
      }
    },
    cancel() { try { reader.cancel(); } catch (e) {} },
  });
}

async function normalize(name, upstream, stream, extraHeaders) {
  const headers = { ...extraHeaders };
  const kind = PROVIDERS[name].kind;

  if (kind === 'openai') {
    if (stream && upstream.ok && upstream.body) {
      return new Response(upstream.body, { status: upstream.status, headers: { ...SSE_HEADERS, ...headers } });
    }
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { ...JSON_HEADERS, ...headers } });
  }

  // gemini → OpenAI shape
  if (!upstream.ok) {
    const text = await upstream.text(); // Gemini errors are already { error: { message } }
    return new Response(text, { status: upstream.status, headers: { ...JSON_HEADERS, ...headers } });
  }
  if (stream && upstream.body) {
    return new Response(geminiStreamToOpenAI(upstream.body), { status: 200, headers: { ...SSE_HEADERS, ...headers } });
  }
  const data = await upstream.json();
  const text = geminiText(data);
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] }), {
    status: 200,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function errorResponse(message, status) {
  return new Response(JSON.stringify({ error: { message } }), { status, headers: JSON_HEADERS });
}

// Main entry: try providers in order, falling back on quota/auth/5xx errors.
export async function generate(env, opts) {
  const order = buildOrder(opts.provider, env);
  if (order.length === 0) {
    return errorResponse('לא הוגדר אף מפתח AI בשרת. הוסיפו GEMINI_API_KEY ו/או DEEPSEEK_API_KEY בהגדרות Cloudflare Pages.', 501);
  }

  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    const key = keyFor(env, name);
    const modelForThis = PROVIDERS[name].models.includes(opts.model) ? opts.model : undefined;

    let upstream;
    try {
      upstream = await callOnce(name, key, { ...opts, model: modelForThis });
    } catch (e) {
      if (i < order.length - 1) continue;
      return errorResponse('שגיאת רשת מול שירות ה-AI: ' + e.message, 502);
    }

    if (RETRIABLE.includes(upstream.status) && i < order.length - 1) {
      try { await upstream.text(); } catch (e) {} // drain before next attempt
      continue;
    }

    const headers = { 'X-AI-Provider': name };
    if (i > 0) headers['X-AI-Fallback-From'] = order[0];
    return normalize(name, upstream, !!opts.stream, headers);
  }

  return errorResponse('כל מנועי ה-AI אינם זמינים כרגע. נסו שוב מאוחר יותר.', 503);
}
