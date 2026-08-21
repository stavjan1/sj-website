// Cloudflare Pages Function — multi-provider AI chat proxy.
// The browser sends OpenAI-style { modelClass?, messages, response_format?,
// stream? } and reads choices[...] back. Keys stay server-side. Provider
// fallback + format translation live in ./_ai.js. Default provider: Gemini,
// falling back to DeepSeek (then Grok) when out of quota.
//
// Move 2 (tiers): the daily quota comes from the caller's plan
// (guest/free/pro/business — see ./_tiers.js, admin-tunable via KV
// `config:tiers`). The client never names real models — it sends
// modelClass "basic" | "advanced" and the server maps it (advanced =
// gemini-2.5-pro, allowed for pro+ only; others are silently served basic).
// Legacy {provider, model} bodies are still accepted but the model name is
// honored only for the admin — everyone else gets their class mapping.

import { generate } from './_ai.js';
import { getPricingMap } from './_pricing_map.js';
import { getKitBlock } from './_electrical_kit.js';
import { getMaterialsBlock, getTaxonomyBlock } from './_materials.js';
import {
  ADMIN_EMAIL, loadModelClass, loadTierConfig, getTierForEmail,
  verifyGoogleEmail, bearerToken, dayKey, rateLimit,
} from './_tiers.js';

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

  const email = await verifyGoogleEmail(bearerToken(request));
  const isAdmin = !!email && email.toLowerCase() === ADMIN_EMAIL;

  // Per-minute BURST guard (on top of the per-day quota below) — protects the
  // now-public /ask/ AI endpoint from spam / cost bombs. 12/min per IP is far
  // above real use; admin exempt. Fails open if KV isn't bound.
  if (!isAdmin && !(await rateLimit(env, request, 'chat', 12))) {
    return json({ error: { code: 'RATE', message: 'יותר מדי בקשות בזמן קצר, המתן דקה ונסה שוב.' } }, 429);
  }
  const tier = await getTierForEmail(env, email);
  const config = await loadTierConfig(env);
  const limits = config[tier] || config.free;

  // ---- Server-side daily quota (per tier) ----
  if (env.SJ_DATA && !isAdmin) {
    const id = email
      ? 'u:' + email.toLowerCase()
      : 'ip:' + (request.headers.get('CF-Connecting-IP') || 'unknown');
    const limit = limits.aiDaily;
    if (limit !== -1) {
      const key = `quota:${id}:${dayKey()}`;
      const used = parseInt((await env.SJ_DATA.get(key)) || '0', 10);
      if (used >= limit) {
        return json({
          error: {
            code: 'QUOTA_AI',
            tier,
            limit,
            message: email
              ? `הגעת למכסת ${limit} בקשות ה-AI היומית של המסלול שלך. המכסה מתאפסת בחצות, או ששדרוג מסלול פותח אותה מיד.`
              : `הגעת למכסת ${limit} הבקשות היומית למשתמשי אורח. התחברות עם Google מגדילה את המכסה, חינם.`,
          },
        }, 429);
      }
      // Best-effort increment (KV is eventually consistent — good enough here).
      context.waitUntil(env.SJ_DATA.put(key, String(used + 1), { expirationTtl: 60 * 60 * 26 }));
    }
  }

  // ---- Model-class mapping (real model names never come from the browser) ----
  const wantAdvanced = body.modelClass === 'advanced';
  const modelClass = await loadModelClass(env);
  const cls = wantAdvanced && limits.advancedModel ? modelClass.advanced : modelClass.basic;
  let provider = cls.provider;
  let model = cls.model;
  if (isAdmin && body.provider) {
    // Admin may still steer explicitly (testing/fallback tooling).
    provider = String(body.provider).toLowerCase();
    model = body.model || model;
  }

  // Optional Gemini thinking control (client-set, clamped). The public /ask/
  // funnel sends 0 to disable thinking → snappy replies with no mid-word
  // truncation from thinking eating the maxOutputTokens budget. Gemini-only;
  // ignored by the other providers.
  let thinkingBudget;
  if (body.thinkingBudget != null && Number.isFinite(Number(body.thinkingBudget))) {
    thinkingBudget = Math.max(0, Math.min(4096, Math.floor(Number(body.thinkingBudget))));
  }

  // Field pricing knowledge map (server-owned DATA block): real group-sourced
  // scenario tables + itemized formulas. KV `pricing:map` overrides the default
  // without a deploy. Appended as a system block so every pricing chat (guest
  // /ask/ and the in-app engine) conditions on infrastructure factors instead
  // of quoting flat numbers.
  const pricingMap = await getPricingMap(env);
  const messages = [...body.messages, { role: 'system', content: pricingMap }];

  // Characterization stage only: the equipment kit for this job family, so the
  // product list comes back complete down to the glands and the labels. Sent
  // per request rather than always — pricing chats don't need the parts bin.
  const kit = getKitBlock(typeof body.jobKit === 'string' ? body.jobKit.slice(0, 40) : '');
  if (kit) messages.push({ role: 'system', content: kit });

  // Paired with the kit, and only with it: the kit says what a job of this
  // family needs, the taxonomy says what the supply market actually stocks and
  // what each family costs. Together they are the difference between a parts
  // list written from memory and one written against a real shelf. Pricing
  // turns don't get it — they get the item-level lookup below instead.
  if (kit) {
    try {
      const taxonomy = await getTaxonomyBlock(request);
      if (taxonomy) messages.push({ role: 'system', content: taxonomy });
    } catch { /* catalog is an enhancement, never a dependency */ }
  }

  // Real supplier prices for whatever this turn is about (the ERCO/ארכה
  // catalog, ~7,000 priced items — see ./_materials.js). The pricing map above
  // teaches the model how to reason about a job; this hands it the actual cost
  // of the parts, so material lines come from a price list instead of a memory
  // of one.
  //
  // Only the last couple of user turns feed the lookup: an eight-message thread
  // about a panel swap would otherwise drag in every item mentioned along the
  // way and bury what is being asked about now. Renders to nothing when nothing
  // matches, so off-topic chats pay no token cost for this.
  if (body.materials !== false) {
    try {
      const recent = body.messages
        .filter((m) => m && m.role === 'user' && typeof m.content === 'string')
        .slice(-2)
        .map((m) => m.content)
        .join(' \n ')
        .slice(0, 1200);
      const materials = await getMaterialsBlock(request, recent, 45);
      if (materials) messages.push({ role: 'system', content: materials });
    } catch {
      // The catalog is an enhancement, never a dependency: if the index is
      // missing or malformed, the chat answers exactly as it did before this
      // existed rather than failing the request.
    }
  }

  return generate(env, {
    provider,
    model,
    // Paying plans draw from the separate paid Gemini key when configured
    // (GEMINI_API_KEY_PAID) — free users can't drain the paid pool.
    paidTier: isAdmin || tier === 'pro' || tier === 'business',
    messages,
    response_format: body.response_format,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    thinkingBudget,
    stream: body.stream === true,
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
