// Green Invoice (morning) adapter — invoicing provider #2.
//
// Self-serve: the user pastes their own API Key + Secret (Green Invoice dashboard
// → Settings → Developer Tools → API Keys). Auth: POST /account/token {id,secret}
// → JWT. Documents are created SYNCHRONOUSLY (POST /documents returns the number
// + PDF url immediately — no polling, unlike SmartBee's async queue).
//
// Verified against the public API/SDK enums. All secrets stay server-side.

const GI_BASE = 'https://api.greeninvoice.co.il/api/v1';

// Our internal docType → Green Invoice numeric type code.
const GI_DOC_TYPE = {
  DealInvoice: 300,      // חשבון עסקה
  Invoice: 305,          // חשבונית מס
  InvoiceReceipt: 320,   // חשבונית מס/קבלה
  Receipt: 400,          // קבלה
  RefundInvoice: 330,    // חשבונית זיכוי
  ReceiptRefund: 330,    // (זיכוי — GI has no distinct receipt-refund)
};
// Our receipt payment method → Green Invoice payment type code.
const GI_PAY_TYPE = { cash: 1, check: 2, creditCard: 3, wireTransfer: 4, other: 11 };

async function giAuth(creds) {
  if (!creds || !creds.apiKey || !creds.apiSecret) return { error: 'חסרים API Key / Secret של Green Invoice.' };
  let res, data;
  try {
    res = await fetch(GI_BASE + '/account/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: creds.apiKey, secret: creds.apiSecret }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { error: 'תקלת רשת מול Green Invoice: ' + (e && e.message ? e.message : e) };
  }
  if (!res.ok || !data.token) return { error: `הזדהות Green Invoice נכשלה (${res.status})`, status: res.status, detail: data };
  return { token: data.token };
}

// Green Invoice vatType: 0 = default (VAT added per business), 1 = exempt.
// For "include" (gross prices) we convert each line to net and keep vatType 0.
function giLineVat(vatType) { return vatType === 'exempt' ? 1 : 0; }

export async function giCreateDocument(creds, doc) {
  const auth = await giAuth(creds);
  if (auth.error) return { ok: false, error: auth.error, status: auth.status, detail: auth.detail };

  const type = GI_DOC_TYPE[doc.docType] || 300;
  const lineVat = giLineVat(doc.vatType);
  const toNet = doc.vatType === 'include';
  const income = (doc.items || []).map((it) => ({
    description: String(it.description || '').slice(0, 300),
    quantity: Number(it.quantity) || 1,
    price: toNet ? Math.round(((Number(it.pricePerUnit) || 0) / 1.18) * 100) / 100 : (Number(it.pricePerUnit) || 0),
    currency: 'ILS',
    vatType: lineVat,
  }));

  const cust = doc.customer || {};
  const payload = {
    type,
    lang: 'he',
    currency: 'ILS',
    vatType: lineVat,
    rounding: false,
    signed: true,                       // produce an official (non-draft) document
    client: {
      name: String(cust.name || '').slice(0, 100),
      taxId: cust.dealerNumber || undefined,
      emails: cust.email ? [cust.email] : undefined,
      address: cust.address || undefined,
      city: cust.city || undefined,
      phone: cust.phone || undefined,
      country: 'IL',
      add: true,                        // add/update the client in the address book
    },
    income,
    remarks: (doc.comments || '').slice(0, 1000) || undefined,
  };

  // Receipt-type documents carry the payment(s).
  const rd = doc.receiptDetails;
  if (rd) {
    const method = rd.cashItems ? 'cash' : rd.wireTransferItems ? 'wireTransfer' : rd.creditCardItems ? 'creditCard' : rd.checkItems ? 'check' : 'other';
    const it = (rd.cashItems || rd.wireTransferItems || rd.creditCardItems || rd.checkItems || rd.otherItems || [])[0] || {};
    const pay = { type: GI_PAY_TYPE[method] || 11, price: Number(it.sum) || 0, date: it.date || undefined, currency: 'ILS' };
    if (method === 'wireTransfer') { pay.bankName = it.bankName; pay.branch = it.branchName; pay.account = it.accountNumber; pay.number = it.referenceNum; }
    if (method === 'check') { pay.bankName = it.bankName; pay.branch = it.branchName; pay.account = it.accountNumber; pay.number = it.checkId; }
    if (method === 'creditCard') { pay.cardNum = it.cardNumber; pay.cardType = it.creditCardType; pay.dealType = 'regular'; }
    payload.payment = [pay];
  }

  let res, data;
  try {
    res = await fetch(GI_BASE + '/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + auth.token },
      body: JSON.stringify(payload),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: 'תקלת רשת מול Green Invoice: ' + (e && e.message ? e.message : e) };
  }
  if (!res.ok || (data && data.errorCode)) {
    return { ok: false, error: 'יצירת המסמך ב-Green Invoice נכשלה', status: res.status, detail: data };
  }
  const url = data && data.url;
  const pdfUrl = (url && (url.origin || url.he || url.en)) || (typeof url === 'string' ? url : null);
  return { ok: true, created: true, docNumber: (data && (data.number || data.id)) || null, pdfUrl, data };
}
