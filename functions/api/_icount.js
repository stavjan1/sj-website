// iCount adapter — invoicing provider #3.
//
// Self-serve: the user provides their company id + an API user's credentials
// (recommend a DEDICATED API user in iCount → Settings, not the main login, so
// it's revocable). Auth: POST /auth/login {cid,user,pass} → sid, used on every
// call. Documents are created SYNCHRONOUSLY (POST /doc/create → number + PDF).
//
// Base + doctypes verified against the public v3 API / community wrappers.

const IC_BASE = 'https://api.icount.co.il/api/v3.php';

// Our internal docType → iCount doctype string.
const IC_DOCTYPE = {
  DealInvoice: 'deal',        // חשבון עסקה
  Invoice: 'invoice',         // חשבונית מס
  InvoiceReceipt: 'invrec',   // חשבונית מס/קבלה
  Receipt: 'receipt',         // קבלה
  RefundInvoice: 'refund',    // חשבונית זיכוי
  ReceiptRefund: 'refund',
};

async function icPost(path, body) {
  let res, data;
  try {
    res = await fetch(IC_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { error: 'תקלת רשת מול iCount: ' + (e && e.message ? e.message : e) };
  }
  return { res, data };
}

async function icAuth(creds) {
  if (!creds || !creds.cid || !creds.user || !creds.pass) {
    return { error: 'חסרים פרטי חיבור ל-iCount (מזהה חברה / משתמש / סיסמה).' };
  }
  const r = await icPost('/auth/login', { cid: creds.cid, user: creds.user, pass: creds.pass });
  if (r.error) return { error: r.error };
  if (!r.res.ok || !r.data.sid) return { error: 'הזדהות iCount נכשלה', status: r.res.status, detail: r.data };
  return { sid: r.data.sid };
}

export async function icCreateDocument(creds, doc) {
  const auth = await icAuth(creds);
  if (auth.error) return { ok: false, error: auth.error, status: auth.status, detail: auth.detail };

  const doctype = IC_DOCTYPE[doc.docType] || 'invoice';
  const toNet = doc.vatType === 'include';
  const exempt = doc.vatType === 'exempt';
  const items = (doc.items || []).map((it) => {
    const item = {
      description: String(it.description || '').slice(0, 300),
      quantity: Number(it.quantity) || 1,
      unitprice: toNet ? Math.round(((Number(it.pricePerUnit) || 0) / 1.18) * 100) / 100 : (Number(it.pricePerUnit) || 0),
    };
    if (exempt) item.vat_exempt = 1;
    return item;
  });

  const cust = doc.customer || {};
  const body = {
    sid: auth.sid,
    doctype,
    client_name: String(cust.name || '').slice(0, 100),
    currency_code: 'ILS',
    doc_lang: 'he',
    items,
  };
  if (cust.dealerNumber) body.client_id_number = cust.dealerNumber;
  if (cust.email) body.email = cust.email;
  if (cust.address) body.client_address = cust.address;
  if (cust.phone) body.client_phone = cust.phone;
  if (doc.comments) body.comments = String(doc.comments).slice(0, 1000);

  // Receipt-family: record the payment. NOTE: iCount's exact payment field shapes
  // (cash / cc / cheques / banktransfer) are best-effort here — verify on a live
  // receipt and adjust if rejected.
  const rd = doc.receiptDetails;
  if (rd) {
    const it = (rd.cashItems || rd.wireTransferItems || rd.creditCardItems || rd.checkItems || rd.otherItems || [])[0] || {};
    const sum = Number(it.sum) || 0;
    if (rd.creditCardItems) body.cc = [{ sum, card_type: it.creditCardType, num: it.cardNumber }];
    else if (rd.checkItems) body.cheques = [{ sum, bank: it.bankName, branch: it.branchName, account: it.accountNumber, num: it.checkId, date: it.date }];
    else if (rd.wireTransferItems) body.banktransfer = [{ sum, bank: it.bankName, branch: it.branchName, account: it.accountNumber, asmachta: it.referenceNum, date: it.date }];
    else body.cash = sum;
  }

  const r = await icPost('/doc/create', body);
  if (r.error) return { ok: false, error: r.error };
  const data = r.data || {};
  if (!r.res.ok || data.status === false || data.error) {
    return { ok: false, error: 'יצירת המסמך ב-iCount נכשלה', status: r.res.status, detail: data };
  }
  const pdfUrl = data.doc_url || data.pdf_link || (data.urls && (data.urls.pdf || data.urls.original)) || null;
  const docNumber = data.docnum || data.doc_num || data.docNumber || null;
  return { ok: true, created: true, docNumber, pdfUrl, data };
}
