// Cloudflare Pages Function — multi-provider AI chat proxy.
// The browser sends OpenAI-style { provider, model, messages, response_format?,
// stream? } and reads choices[...] back. Keys stay server-side. Provider
// fallback + format translation live in ./_ai.js. Default provider: Gemini,
// falling back to DeepSeek (then Grok) when out of quota.

import { generate } from './_ai.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: 'בקשה לא תקינה (JSON שגוי).' } }, 400);
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: { message: 'בקשה ללא הודעות (messages).' } }, 400);
  }

  return generate(env, {
    provider: (body.provider || 'gemini').toLowerCase(),
    model: body.model,
    messages: body.messages,
    response_format: body.response_format,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    stream: body.stream === true,
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
