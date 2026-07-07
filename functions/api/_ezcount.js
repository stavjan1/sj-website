// EZcount (חשבונית אונליין) adapter — invoicing provider #4 (the low-cost option).
//
// Self-serve: the user pastes their API Key + developer email (EZcount account →
// settings → API). No separate login — both are sent with each request. Documents
// are created SYNCHRONOUSLY (POST /createDoc → doc number + PDF url).
//
// EZcount uses the Israeli-standard document-type numbering (same as Green
// Invoice). Payment/VAT-exempt shapes are best-effort — verify on a live doc.

const EZ_BASE = 'https://api.ezcount.co.il/api';

// Our internal docType → EZcount/standard numeric type code.
const EZ_DOC_TYPE = {
  DealInvoice: 300,      // חשבון עסקה
  Invoice: 305,          // חשבונית מס
  InvoiceReceipt: 320,   // חשבונית מס/קבלה
  Receipt: 400,          // קבלה
  RefundInvoice: 330,    // חשבונית זיכוי
  ReceiptRefund: 330,
};
// Our receipt method → EZcount payment_type.
const EZ_PAY_TYPE = { cash: 1, check: 2, creditCard: 3, wireTransfer: 4, other: 10 };

export async function ezCreateDocument(creds, doc) {
  if (!creds || !creds.apiKey || !creds.developerEmail) {
    return { ok: false, error: 'חסרים API Key / אימייל מפתח של EZcount.' };
  }
  const type = EZ_DOC_TYPE[doc.docType] || 305;
  const toNet = doc.vatType === 'include';
  const cust = doc.customer || {};
  const item = (doc.items || []).map((it) => ({
    details: String(it.description || '').slice(0, 300),
    amount: Number(it.quantity) || 1,
    price: toNet ? Math.round(((Number(it.pricePerUnit) || 0) / 1.18) * 100) / 100 : (Number(it.pricePerUnit) || 0),
  }));

  const body = {
    api_key: creds.apiKey,
    developer_email: creds.developerEmail,
    type,
    customer_name: String(cust.name || '').slice(0, 100),
    doc_currency: 'ILS',
    item,
    email_to_client: false,
  };
  if (cust.dealerNumber) body.customer_crn = cust.dealerNumber;
  if (cust.email) body.customer_email = cust.email;
  if (cust.address) body.customer_address = cust.address;
  if (cust.phone) body.customer_phone = cust.phone;
  if (doc.comments) body.comment = String(doc.comments).slice(0, 1000);
  if (doc.vatType === 'exempt') body.vat_type = 'EXEMPT';

  // Receipt-family: record the payment (best-effort — verify live).
  const rd = doc.receiptDetails;
  if (rd) {
    const method = rd.cashItems ? 'cash' : rd.wireTransferItems ? 'wireTransfer' : rd.creditCardItems ? 'creditCard' : rd.checkItems ? 'check' : 'other';
    const it = (rd.cashItems || rd.wireTransferItems || rd.creditCardItems || rd.checkItems || rd.otherItems || [])[0] || {};
    const pay = { payment_type: EZ_PAY_TYPE[method] || 10, payment: Number(it.sum) || 0, date: it.date || undefined };
    if (method === 'wireTransfer') { pay.bank_name = it.bankName; pay.branch = it.branchName; pay.account = it.accountNumber; pay.asmachta = it.referenceNum; }
    if (method === 'check') { pay.bank_name = it.bankName; pay.branch = it.branchName; pay.account = it.accountNumber; pay.cheque_number = it.checkId; }
    if (method === 'creditCard') { pay.cc_number = it.cardNumber; pay.cc_type = it.creditCardType; }
    body.payment = [pay];
  }

  let res, data;
  try {
    res = await fetch(EZ_BASE + '/createDoc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: 'תקלת רשת מול EZcount: ' + (e && e.message ? e.message : e) };
  }
  if (!res.ok || data.success === false || data.errorMessage || data.error) {
    return { ok: false, error: 'יצירת המסמך ב-EZcount נכשלה', status: res.status, detail: data };
  }
  const pdfUrl = data.pdf_link || data.doc_url || data.pdf || (data.doc && (data.doc.pdf_link || data.doc.url)) || null;
  const docNumber = data.doc_number || data.docnum || (data.doc && data.doc.doc_number) || null;
  return { ok: true, created: true, docNumber, pdfUrl, data };
}
