// SUMIT adapter — invoicing provider #5 (the marketing-heavy, feature-rich one).
//
// Self-serve: the user pastes their CompanyID + API Key (SUMIT → settings →
// developers/API). Auth is per-request Credentials in the JSON body. Documents
// are created SYNCHRONOUSLY (POST /accounting/documents/create/ → number + PDF).
//
// Schema verified against SUMIT's OpenAPI (api.sumit.co.il/swagger/v1/swagger.json).

const SUMIT_BASE = 'https://api.sumit.co.il';

// Our internal docType → SUMIT DocumentType enum (numeric).
const SUMIT_DOC_TYPE = {
  DealInvoice: 3,       // ProformaInvoice (חשבון עסקה)
  Invoice: 0,           // Invoice (חשבונית מס)
  InvoiceReceipt: 1,    // InvoiceAndReceipt
  Receipt: 2,           // Receipt
  RefundInvoice: 5,     // CreditInvoice
  ReceiptRefund: 7,     // CreditReceipt
};
// Our receipt method → SUMIT PaymentType enum.
const SUMIT_PAY_TYPE = { cash: 2, wireTransfer: 3, check: 4, creditCard: 5, other: 8 };

export async function sumitCreateDocument(creds, doc) {
  if (!creds || !creds.companyId || !creds.apiKey) {
    return { ok: false, error: 'חסרים CompanyID / API Key של SUMIT.' };
  }
  const cust = doc.customer || {};
  const Items = (doc.items || []).map((it) => ({
    Quantity: Number(it.quantity) || 1,
    UnitPrice: Number(it.pricePerUnit) || 0,
    Description: String(it.description || '').slice(0, 300),
    Item: { Name: String(it.description || '').slice(0, 100) },
  }));

  const body = {
    Credentials: { CompanyID: Number(creds.companyId) || creds.companyId, APIKey: creds.apiKey },
    Details: {
      Type: SUMIT_DOC_TYPE[doc.docType] != null ? SUMIT_DOC_TYPE[doc.docType] : 0,
      Customer: {
        Name: String(cust.name || '').slice(0, 100),
        CompanyNumber: cust.dealerNumber || undefined,
        EmailAddress: cust.email || undefined,
        Phone: cust.phone || undefined,
        Address: cust.address || undefined,
        City: cust.city || undefined,
        NoVAT: doc.vatType === 'exempt' ? true : undefined,
      },
      Description: (doc.comments || '').slice(0, 1000) || undefined,
    },
    Items,
    VATIncluded: doc.vatType === 'include',
  };
  if (doc.vatType === 'exempt') body.VATRate = 0;

  // Receipt-family: attach the payment (bank/branch numbers are best-effort — we
  // only collect names; verify on a live receipt).
  const rd = doc.receiptDetails;
  if (rd) {
    const method = rd.cashItems ? 'cash' : rd.wireTransferItems ? 'wireTransfer' : rd.creditCardItems ? 'creditCard' : rd.checkItems ? 'check' : 'other';
    const it = (rd.cashItems || rd.wireTransferItems || rd.creditCardItems || rd.checkItems || rd.otherItems || [])[0] || {};
    const bankNum = parseInt(it.bankName, 10);
    const branchNum = parseInt(it.branchName, 10);
    const pay = { Amount: Number(it.sum) || 0, Type: SUMIT_PAY_TYPE[method] || 8 };
    if (method === 'wireTransfer') pay.Details_BankTransfer = { BankNumber: Number.isFinite(bankNum) ? bankNum : undefined, BranchNumber: Number.isFinite(branchNum) ? branchNum : undefined, AccountNumber: it.accountNumber, Reference: it.referenceNum, DueDate: it.date };
    else if (method === 'check') pay.Details_Cheque = { BankNumber: Number.isFinite(bankNum) ? bankNum : undefined, BranchNumber: Number.isFinite(branchNum) ? branchNum : undefined, AccountNumber: it.accountNumber, ChequeNumber: it.checkId, DueDate: it.date };
    else if (method === 'creditCard') pay.Details_CreditCard = { CardBrand: it.creditCardType, Last4Digits: String(it.cardNumber || '').slice(-4), Payments: 1 };
    else if (method === 'cash') pay.Details_Cash = {};
    else pay.Details_Other = {};
    body.Payments = [pay];
  }

  let res, data;
  try {
    res = await fetch(SUMIT_BASE + '/accounting/documents/create/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: 'תקלת רשת מול SUMIT: ' + (e && e.message ? e.message : e) };
  }
  // SUMIT envelope: { Status:0, UserErrorMessage, Data:{...} }.
  if (!res.ok || (data && data.Status != null && data.Status !== 0) || (data && data.UserErrorMessage)) {
    return { ok: false, error: (data && data.UserErrorMessage) || 'יצירת המסמך ב-SUMIT נכשלה', status: res.status, detail: data };
  }
  const D = (data && data.Data) || {};
  return { ok: true, created: true, docNumber: D.DocumentNumber || D.DocumentID || null, pdfUrl: D.DocumentDownloadURL || null, data };
}
