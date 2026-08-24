// Cloudflare Pages Function — try a model before customers do.
//
// Why this exists: the app ran gemini-2.5-flash while Google had shipped three
// newer Flash generations, and nobody had decided to stay — switching just felt
// risky, because the pricing agent answers in a strict JSON protocol and its
// numbers reach real customers. "Feels risky" with no way to check is how a
// stack quietly ages.
//
// So: no auto-updating. A detector that says a newer model exists, a trap suite
// that can be run against it on demand, and a switch that is one admin click
// AFTER the evidence. Deliberately not a cron that swaps models at 3am.
//
//   GET  /api/model-eval            (admin) → configured models, what Google
//                                             offers now, and what looks newer
//   POST /api/model-eval  { model } (admin) → run the traps against that model
//   PUT  /api/model-eval  { basic, advanced } (admin) → switch (config:models)

import { adminGate, jsonResponse, loadModelClass, MODEL_CLASS } from './_tiers.js';
import { PROVIDERS, keyFor, generate } from './_ai.js';
import { MODEL_TRAPS, scoreTrap } from './_model_traps.js';
import { getPricingMap } from './_pricing_map.js';
import { renderQuoteChecklist } from './_materials.js';

// A model id's generation, for "is there something newer": gemini-3.6-flash → 3.6.
function genOf(id) {
  const m = /gemini-(\d+(?:\.\d+)?)/.exec(String(id || ''));
  return m ? parseFloat(m[1]) : 0;
}
// Preview/experimental ids are reported but never proposed as an upgrade —
// they can vanish or change under you without notice.
function isStable(id) {
  return !/preview|exp|experimental/i.test(String(id || ''));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;

  const configured = await loadModelClass(env);
  const key = keyFor(env, 'gemini');

  // Ask Google what it actually serves today rather than trusting a list baked
  // into this file — a hardcoded catalogue is exactly what went stale before.
  let available = null;
  let listError = null;
  if (key) {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key));
      if (res.ok) {
        const data = await res.json();
        available = (data.models || [])
          .map((m) => String(m.name || '').replace(/^models\//, ''))
          .filter((n) => n.startsWith('gemini-'))
          .filter((n) => !/embedding|aqa|tts|live|image/i.test(n));
      } else {
        listError = 'google-' + res.status;
      }
    } catch { listError = 'unreachable'; }
  } else {
    listError = 'no-key';
  }

  const curGen = genOf(configured.basic.model);
  const newer = (available || [])
    .filter((n) => isStable(n) && /flash/.test(n) && genOf(n) > curGen)
    .sort((a, b) => genOf(b) - genOf(a));

  return jsonResponse({
    ok: true,
    configured,
    shipped: MODEL_CLASS,             // what the code defaults to, before any override
    allowed: PROVIDERS.gemini.models, // what this server will accept
    available,
    listError,
    newer,
    trapCount: MODEL_TRAPS.length,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400); }
  const model = String(body.model || '').trim();
  if (!model) return jsonResponse({ error: { message: 'לא נבחר מודל.' } }, 400);
  if (!PROVIDERS.gemini.models.includes(model)) {
    return jsonResponse({ error: { message: 'מודל לא מוכר לשרת: ' + model } }, 400);
  }

  const results = [];
  for (const trap of MODEL_TRAPS) {
    const started = Date.now();
    let answer = '';
    let error = null;
    try {
      // The SAME prompt a customer's question is answered with. The comment
      // here used to claim that and the code did not do it: only the trap text
      // was sent, so this measured the bare model's own knowledge while
      // production answers with the pricing map attached.
      //
      // The difference is not academic. Stav asked why a model kept failing the
      // 6×4 cable trap when the rules are written down — and they are, in the
      // pricing map: "חד-פאזי = 3 גידים; תלת-פאזי = 5 גידים. כבלים עם 6 גידים
      // ומעלה = פיקוד בלבד". Asked through /api/chat, the same model catches
      // that trap cleanly. Asked here, it failed. The scores were real and they
      // were about something nobody is shipping.
      const res = await generate(env, {
        provider: 'gemini',
        model,
        messages: [
          { role: 'system', content: await getPricingMap(env) },
          { role: 'system', content: renderQuoteChecklist() },
          { role: 'user', content: trap.prompt },
        ],
        temperature: 0.3,
        max_tokens: 700,
        thinkingBudget: 0,
      });
      const data = await res.json();
      answer = (((data.choices || [])[0] || {}).message || {}).content || '';
      if (!res.ok) error = (data.error && data.error.message) || ('status ' + res.status);
    } catch (e) {
      error = e && e.message ? e.message : 'שגיאה';
    }
    const score = error ? { pass: false, failed: ['הבקשה נכשלה'] } : scoreTrap(trap, answer);
    results.push({
      id: trap.id, title: trap.title, why: trap.why,
      pass: score.pass, failed: score.failed, error,
      ms: Date.now() - started,
      excerpt: answer.slice(0, 400),
    });
  }

  const passed = results.filter((r) => r.pass).length;
  return jsonResponse({
    ok: true, model, passed, total: results.length,
    avgMs: Math.round(results.reduce((s, r) => s + r.ms, 0) / (results.length || 1)),
    results,
  });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const gate = await adminGate(request);
  if (!gate.ok) return gate.response;
  if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400); }
  const cfg = {};
  for (const cls of ['basic', 'advanced']) {
    const model = body[cls] && String(body[cls]).trim();
    if (!model) continue;
    if (!PROVIDERS.gemini.models.includes(model)) {
      return jsonResponse({ error: { message: 'מודל לא מוכר לשרת: ' + model } }, 400);
    }
    cfg[cls] = { provider: 'gemini', model };
  }
  if (!Object.keys(cfg).length) {
    await env.SJ_DATA.delete('config:models');   // back to the shipped defaults
    return jsonResponse({ ok: true, cleared: true, configured: MODEL_CLASS });
  }
  await env.SJ_DATA.put('config:models', JSON.stringify(cfg));
  return jsonResponse({ ok: true, configured: await loadModelClass(env) });
}
