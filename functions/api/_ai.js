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
// Workers AI (free, no key — runs on Cloudflare itself, works everywhere):
//   add a "Workers AI" binding named `AI` in Pages → Settings → Functions → Bindings.
//   It is used as the last-resort fallback so the AI works even with no external keys.

export const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    kind: 'gemini',
    keyEnv: ['GEMINI_API_KEY'],
    // gemini-2.0-flash was deprecated by Google on 2026-06-01 — requesting it
    // can surface as a misleading "429 limit: 0" free-tier quota error instead
    // of a clear "model retired" message. gemini-2.5-flash is the current
    // free-tier-capable default (2.0-flash kept in the list for compatibility
    // if a caller explicitly asks for it).
    defaultModel: 'gemini-2.5-flash',
    // gemini-2.5-pro = the "מודל מתקדם ⚡" class (pro+ plans, mapped in chat.js).
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash'],
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
  cloudflare: {
    label: 'Cloudflare',
    kind: 'cloudflare',
    binding: 'AI', // Workers AI binding (env.AI) — free, no API key, region-independent
    defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    models: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'],
  },
};

// Order tried on fallback once the explicitly-requested provider is placed first.
// `cloudflare` is last: preferred only when no external key works, but always
// available (free, via binding) so the chain never ends empty.
const FALLBACK_SEQUENCE = ['gemini', 'deepseek', 'grok', 'cloudflare'];

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
  // Workers AI uses a runtime binding (env.AI), not a string key.
  if (cfg.kind === 'cloudflare') return env && env[cfg.binding] ? env[cfg.binding] : null;
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

// Workers AI streams SSE as  data: {"response":"token"}  — convert to OpenAI shape.
export function cfStreamToOpenAI(upstreamBody) {
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
          const t = JSON.parse(p).response || '';
          if (t) controller.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n'));
        } catch (e) { /* partial / keep-alive */ }
      }
    },
    cancel() { try { reader.cancel(); } catch (e) {} },
  });
}

// Call the Workers AI binding (env.AI) and return a normalized Response (OpenAI shape).
async function callCloudflare(binding, opts, headers) {
  const cfg = PROVIDERS.cloudflare;
  const model = pickModel(cfg, opts.model);
  const input = { messages: opts.messages, stream: !!opts.stream };
  if (opts.max_tokens) input.max_tokens = opts.max_tokens;
  if (typeof opts.temperature === 'number') input.temperature = opts.temperature;

  const out = await binding.run(model, input);
  if (opts.stream) {
    return new Response(cfStreamToOpenAI(out), { status: 200, headers: { ...SSE_HEADERS, ...headers } });
  }
  const text = (out && (out.response != null ? out.response : (out.result && out.result.response))) || '';
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] }), {
    status: 200,
    headers: { ...JSON_HEADERS, ...headers },
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
    return errorResponse('לא הוגדר מנוע AI בשרת. הוסיפו "AI binding" (Workers AI) בהגדרות Cloudflare Pages — חינם, ללא מפתח — או GEMINI_API_KEY / DEEPSEEK_API_KEY.', 501);
  }

  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    // Cost isolation: paying customers (pro/business/admin) run on a separate
    // Gemini key when GEMINI_API_KEY_PAID is set, so free-tier usage never
    // eats the paid pool — and Stav can read each pool's cost separately.
    const key = (name === 'gemini' && opts.paidTier && env.GEMINI_API_KEY_PAID)
      ? env.GEMINI_API_KEY_PAID
      : keyFor(env, name);

    // Workers AI: called via runtime binding, not fetch — handle separately.
    if (PROVIDERS[name].kind === 'cloudflare') {
      const headers = { 'X-AI-Provider': name };
      if (i > 0) headers['X-AI-Fallback-From'] = order[0];
      try {
        return await callCloudflare(key, opts, headers);
      } catch (e) {
        if (i < order.length - 1) continue;
        return errorResponse('מנוע ה-AI של Cloudflare נכשל: ' + (e && e.message ? e.message : e), 502);
      }
    }

    const modelForThis = PROVIDERS[name].models.includes(opts.model) ? opts.model : undefined;

    let upstream;
    try {
      upstream = await callOnce(name, key, { ...opts, model: modelForThis });
    } catch (e) {
      if (i < order.length - 1) continue;
      return errorResponse('שגיאת רשת מול שירות ה-AI: ' + e.message, 502);
    }

    // Gemini only: a second personal key (env.GEMINI_API_KEY_2, e.g. a backup
    // Google account) is tried immediately on a quota/auth error, before
    // falling through to a weaker provider further down the chain. This is
    // the same "retry on error" idiom already used for the whole provider
    // chain below -- just one level deeper, since only Gemini has 2 keys.
    // No shared "requests used today" counter: that would need cross-request
    // state (a KV/Durable Object counter, race conditions between concurrent
    // visitors, timezone-aware daily resets) to solve a problem this simpler
    // per-request retry already handles.
    if (name === 'gemini' && RETRIABLE.includes(upstream.status) && env.GEMINI_API_KEY_2 && env.GEMINI_API_KEY_2 !== key) {
      try { await upstream.text(); } catch (e) {} // drain the failed attempt
      try {
        const retryUpstream = await callOnce(name, env.GEMINI_API_KEY_2, { ...opts, model: modelForThis });
        if (!RETRIABLE.includes(retryUpstream.status)) {
          return normalize(name, retryUpstream, !!opts.stream, { 'X-AI-Provider': name });
        }
        upstream = retryUpstream; // both Gemini keys failed; fall through to the next provider below
      } catch (e) { /* keep the original upstream response, fall through below */ }
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
