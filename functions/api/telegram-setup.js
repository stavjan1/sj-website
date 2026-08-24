// Cloudflare Pages Function — turning the defect-report bot on, from the admin
// screen, without touching the Cloudflare dashboard or redeploying.
//
//   GET  /api/telegram-setup                    → { configured, botName, allowed, webhook }
//   POST /api/telegram-setup { action:'save', token }  → verify the token with
//        Telegram, store it in KV, mint a webhook secret and register the webhook
//   POST /api/telegram-setup { action:'pair' }   → arm "the next chat that writes
//        gets in", so the owner pairs his phone by sending the bot one message
//   POST /api/telegram-setup { action:'forget', chatId }
//   POST /api/telegram-setup { action:'disconnect' }  → delete the webhook + config
//
// The bot token is a credential: it is stored in KV, never returned to the
// browser, and every route here is admin-only.

import { adminGate, jsonResponse } from './_tiers.js';

const KEY = 'config:telegram';
const TG = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

async function load(env) {
    try { return JSON.parse(await env.SJ_DATA.get(KEY) || '{}') || {}; } catch { return {}; }
}
const save = (env, cfg) => env.SJ_DATA.put(KEY, JSON.stringify(cfg));

function publicView(cfg, envHasToken) {
    return {
        configured: !!(cfg.botToken || envHasToken),
        fromEnv: envHasToken && !cfg.botToken,
        botName: cfg.botName || null,
        allowed: Array.isArray(cfg.allowed) ? cfg.allowed : [],
        openToFirst: !!cfg.openToFirst,
        webhookAt: cfg.webhookAt || null,
        lastError: cfg.lastError || null,
    };
}

function randomSecret() {
    const b = crypto.getRandomValues(new Uint8Array(24));
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
    const { request, env } = context;
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);
    const gate = await adminGate(request);
    if (!gate.ok) return gate.response;
    return jsonResponse(publicView(await load(env), !!env.TELEGRAM_BOT_TOKEN));
}

export async function onRequestPost(context) {
    const { request, env } = context;
    if (!env.SJ_DATA) return jsonResponse({ error: { message: 'KV לא מוגדר.' } }, 501);
    const gate = await adminGate(request);
    if (!gate.ok) return gate.response;

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'JSON שגוי.' } }, 400); }
    const cfg = await load(env);

    if (body.action === 'save') {
        const token = String(body.token || '').trim();
        if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
            return jsonResponse({ error: { message: 'הטוקן לא נראה נכון. מעתיקים אותו מ-BotFather כמו שהוא (מספרים, נקודתיים, ואותיות).' } }, 400);
        }
        // Ask Telegram who this token belongs to — a wrong token fails here,
        // before anything is stored.
        let me;
        try { me = await (await fetch(TG(token, 'getMe'))).json(); } catch { me = null; }
        if (!me || !me.ok || !me.result) {
            return jsonResponse({ error: { message: 'טלגרם לא זיהה את הטוקן. אפשר ליצור חדש ב-BotFather עם /token.' } }, 400);
        }
        const secret = cfg.secret || randomSecret();
        const url = new URL(request.url);
        const webhook = `${url.origin}/api/telegram`;
        let hook;
        try {
            hook = await (await fetch(TG(token, 'setWebhook'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: webhook, secret_token: secret, allowed_updates: ['message'] }),
            })).json();
        } catch { hook = null; }
        if (!hook || !hook.ok) {
            return jsonResponse({ error: { message: 'הטוקן תקין אבל רישום הוובהוק נכשל: ' + ((hook && hook.description) || 'שגיאה מטלגרם') } }, 502);
        }
        Object.assign(cfg, {
            botToken: token,
            botName: me.result.username ? '@' + me.result.username : (me.result.first_name || 'הבוט'),
            secret,
            allowed: Array.isArray(cfg.allowed) ? cfg.allowed : [],
            webhookAt: Date.now(),
            lastError: null,
        });
        await save(env, cfg);
        return jsonResponse({ ok: true, message: `${cfg.botName} מחובר. עכשיו "חבר את הטלפון שלי" ושלחו לו הודעה.`, ...publicView(cfg, !!env.TELEGRAM_BOT_TOKEN) });
    }

    if (body.action === 'pair') {
        if (!cfg.botToken && !env.TELEGRAM_BOT_TOKEN) return jsonResponse({ error: { message: 'קודם מחברים טוקן.' } }, 400);
        cfg.openToFirst = true;
        cfg.pairArmedAt = Date.now();
        await save(env, cfg);
        return jsonResponse({ ok: true, message: 'מוכן. שלחו עכשיו הודעה כלשהי לבוט בטלגרם, והצ\'אט הזה יאושר אוטומטית.', ...publicView(cfg, !!env.TELEGRAM_BOT_TOKEN) });
    }

    if (body.action === 'forget') {
        const id = String(body.chatId || '').trim();
        cfg.allowed = (cfg.allowed || []).filter(x => String(x) !== id);
        await save(env, cfg);
        return jsonResponse({ ok: true, message: 'הצ\'אט הוסר.', ...publicView(cfg, !!env.TELEGRAM_BOT_TOKEN) });
    }

    if (body.action === 'disconnect') {
        if (cfg.botToken) { try { await fetch(TG(cfg.botToken, 'deleteWebhook')); } catch { } }
        await env.SJ_DATA.delete(KEY);
        return jsonResponse({ ok: true, message: 'הבוט נותק.', ...publicView({}, !!env.TELEGRAM_BOT_TOKEN) });
    }

    return jsonResponse({ error: { message: 'פעולה לא מוכרת.' } }, 400);
}
