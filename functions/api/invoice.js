// Cloudflare Pages Function — SmartBee invoicing (pilot on the admin account).
//
//   GET  /api/invoice?diag=1   (admin) → connectivity check: does auth work?
//   POST /api/invoice          (admin/pro/business) → create a document
//        body { docType, customer:{name,...}, items:[{description,quantity,pricePerUnit}],
//               vatType?, comments?, quoteId? }  → { apiMessageId } | { error }
//
// Documents create async on SmartBee's queue; the client can poll status via
// GET /api/invoice?msg=<apiMessageId>. Invoicing is a paid-plan feature (it has
// a real per-user cost) and is capped at ₪5,000/doc for now (see _smartbee.js).

import {
  ADMIN_EMAIL, getTierForEmail, verifyGoogleEmail, bearerToken, jsonResponse,
} from './_tiers.js';
import { smartbeeAuth, smartbeeCall, sbVatOption, SB_MAX_DOC } from './_smartbee.js';

async function requirePayingUser(context) {
  const email = await verifyGoogleEmail(bearerToken(context.request));
  if (!email) return { error: jsonResponse({ error: { message: 'נדרשת התחברות.' } }, 401) };
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL;
  const tier = await getTierForEmail(context.env, email);
  if (!isAdmin && tier !== 'pro' && tier !== 'business') {
    return { error: jsonResponse({ error: { message: 'הפקת חשבוניות זמינה במסלול Pro/עסקי.', code: 'TIER' } }, 403) };
  }
  return { email, isAdmin, tier };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Connectivity diagnostic — admin only (returns raw detail to debug the flow).
  if (url.searchParams.get('diag')) {
    const email = await verifyGoogleEmail(bearerToken(request));
    if (!email || email.toLowerCase() !== ADMIN_EMAIL) return jsonResponse({ error: { message: 'אין הרשאה.' } }, 403);
    const configured = { clientId: !!env.SMARTBEE_CLIENT_ID, password: !!env.SMARTBEE_PASSWORD, token: !!env.SMARTBEE_TOKEN };
    const auth = await smartbeeAuth(env);
    return jsonResponse({
      configured,
      authOk: !!auth.token,
      cached: !!auth.cached,
      error: auth.error || null,
      detail: auth.detail || null,
    });
  }

  // Poll a document's status.
  const msg = url.searchParams.get('msg');
  if (msg) {
    const gate = await requirePayingUser(context);
    if (gate.error) return gate.error;
    const r = await smartbeeCall(env, 'GET', '/Documents/' + encodeURIComponent(msg));
    if (!r.ok) return jsonResponse({ error: { message: r.error || 'בדיקת סטטוס נכשלה' }, status: r.status, detail: r.data }, 502);
    return jsonResponse({ ok: true, status: r.data });
  }

  return jsonResponse({ error: { message: 'בקשה לא תקינה.' } }, 400);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const gate = await requirePayingUser(context);
  if (gate.error) return gate.error;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: { message: 'JSON שגוי.' } }, 400); }

  const providerUserToken = env.SMARTBEE_TOKEN;
  if (!providerUserToken) return jsonResponse({ error: { message: 'חסר SMARTBEE_TOKEN בשרת.' } }, 501);

  const customer = body.customer || {};
  if (!customer.name || String(customer.name).trim().length < 2) {
    return jsonResponse({ error: { message: 'חסר שם לקוח בחשבונית.' } }, 400);
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const paymentItems = rawItems
    .map((it) => ({
      description: String(it.description || it.title || '').slice(0, 500),
      quantity: Number(it.quantity) || 1,
      pricePerUnit: Number(it.pricePerUnit != null ? it.pricePerUnit : it.price) || 0,
      vatOption: sbVatOption(body.vatType),
    }))
    .filter((it) => it.description && it.pricePerUnit >= 0);
  if (paymentItems.length === 0) return jsonResponse({ error: { message: 'אין סעיפים לחשבונית.' } }, 400);

  const total = paymentItems.reduce((s, it) => s + it.pricePerUnit * it.quantity, 0);
  if (total > SB_MAX_DOC) {
    return jsonResponse({ error: { message: `בשלב זה חשבונית מוגבלת ל-${SB_MAX_DOC.toLocaleString('he-IL')} ₪. פצל לכמה מסמכים או פנה לתמיכה.`, code: 'CAP' } }, 400);
  }

  const DOC_TYPES = ['InvoiceReceipt', 'Receipt', 'ReceiptRefund', 'Invoice', 'RefundInvoice', 'DealInvoice'];
  const docType = DOC_TYPES.includes(body.docType) ? body.docType : 'DealInvoice';

  const payload = {
    providerUserToken,
    providerMsgId: String(body.quoteId || Date.now()),        // dedup on SmartBee's side
    providerMsgReferenceId: String(body.reference || body.quoteId || ''),
    docType,
    customer: {
      name: String(customer.name).slice(0, 100),
      email: customer.email || undefined,
      mainPhone: customer.phone || undefined,
      dealerNumber: customer.dealerNumber || undefined,
      address: customer.address || undefined,
      cityName: customer.city || undefined,
    },
    documentItems: { paymentItems },
    comments: (body.comments || '').slice(0, 5024) || undefined,
    isDraft: body.isDraft === true,
  };

  const r = await smartbeeCall(env, 'POST', '/Documents/create', payload);
  if (!r.ok) {
    return jsonResponse({ error: { message: 'יצירת המסמך נכשלה ב-SmartBee.' }, status: r.status, detail: r.data }, 502);
  }
  // The create response returns an id to track the async result.
  const apiMessageId = r.data && (r.data.apiMessageId || r.data.id || (r.data.data && r.data.data.apiMessageId));
  return jsonResponse({ ok: true, apiMessageId: apiMessageId || null, result: r.data });
}
