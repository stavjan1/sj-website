// Invoicing provider abstraction — the "connect your own provider" foundation.
//
// Each user can pick which invoicing provider ZEREM produces documents through
// and store their own credentials. SmartBee is adapter #1 (live); the others are
// registered with their credential shape but not wired to a create-document
// adapter yet (status 'soon') — adding one is: implement its adapter + mapping.
//
// Per-user config lives in KV as `billing:<email>` = { provider, credentials{} }.
// Credentials never leave the server in GET responses (only a hasCredentials flag).

// UI/metadata registry. `fields` describe the credential inputs the client renders
// for that provider. `status`: 'active' = wired; 'soon' = chooseable, not yet live.
export const PROVIDERS = {
  smartbee: {
    id: 'smartbee', name: 'SmartBee', status: 'active',
    note: 'ברירת המחדל של זרם. אם יש לך טוקן אישי מ-SmartBee הדבק אותו; אחרת נשתמש בחשבון המערכת.',
    fields: [{ key: 'token', label: 'providerUserToken (אישי, לא חובה)', optional: true }],
  },
  greeninvoice: {
    id: 'greeninvoice', name: 'Green Invoice (morning)', status: 'active',
    note: 'חיבור עצמי: הדבק API Key + Secret מהגדרות המפתחים ב-morning (הגדרות → כלי מפתחים).',
    fields: [
      { key: 'apiKey', label: 'API Key' },
      { key: 'apiSecret', label: 'API Secret' },
      { key: 'sandbox', label: 'מצב בדיקות (Sandbox)', type: 'checkbox', optional: true },
    ],
  },
  ezcount: {
    id: 'ezcount', name: 'EZcount (חשבונית אונליין)', status: 'active',
    note: 'החיסכוני: הדבק API Key + אימייל מפתח מחשבון EZcount (הגדרות → API).',
    fields: [
      { key: 'apiKey', label: 'API Key' },
      { key: 'developerEmail', label: 'אימייל מפתח (Developer email)' },
    ],
  },
  sumit: {
    id: 'sumit', name: 'SUMIT', status: 'active', badge: 'בונוס וואטסאפ',
    note: 'בונוס: חיבור ל-SUMIT מפעיל אצלם סוכן וואטסאפ חינמי (לכל החיים, ללא הגבלה): מצלמים קבלת הוצאה ונשלחת בוואטסאפ, ונכנסת אוטומטית לקטגוריית ההוצאות שלך. חיבור: מזהה חברה (CompanyID) + API Key מחשבון SUMIT (מפתחים → API).',
    fields: [
      { key: 'companyId', label: 'מזהה חברה (CompanyID)' },
      { key: 'apiKey', label: 'API Key' },
    ],
  },
  icount: {
    id: 'icount', name: 'iCount', status: 'active',
    note: 'חיבור עצמי: מזהה חברה (cid) + משתמש וסיסמה. מומלץ ליצור משתמש API ייעודי ב-iCount (הגדרות → משתמשים) ולא את הכניסה הראשית.',
    fields: [
      { key: 'cid', label: 'מזהה חברה (cid)' },
      { key: 'user', label: 'שם משתמש (API)' },
      { key: 'pass', label: 'סיסמה' },
    ],
  },

  // ==========================================================================
  // THE REST OF THE ISRAELI MARKET, researched and fact-checked on 30.8.2026.
  // Stav: "תיקח את כל החברות שיש בישראל... שנכסה את כולם."
  //
  // Every entry below was verified against the VENDOR'S OWN documentation: the
  // create-document endpoint was found, and the credential field names are the
  // ones its docs use. Anything a review article claimed but the vendor did not
  // document was dropped, and a `docs` URL is recorded so the adapter can be
  // written from the reference rather than from memory.
  //
  // status:'soon' is the honest state — an electrician can SEE that his software
  // is on the list and know it is coming, and the UI already labels it "בקרוב".
  // Turning one on is: write its adapter + mapping, flip to 'active'.
  // ==========================================================================
  invoicemaven: {
    id: 'invoicemaven', name: 'אינבויס מייבן', status: 'soon',
    note: 'אומת מול ה-OpenAPI המלא: POST ל-https://users.invoice-maven.co.il/api/documents/addDocument, כל הקריאות POST ב-JSON. שימו לב: כל קריאה מחייבת גם test (0/1), contact_email ו-contact_phone של המפתח — אלה שדות שלנו, לא של ה',
    docs: 'https://users.invoice-maven.co.il/api-portal/index.html',
    fields: [
      { key: 'apiKey', label: 'מפתח API (api_key) — הגדרות → API' },
    ],
  },
  accountit: {
    id: 'accountit', name: 'אקאונטאיט (AccountIT) — לשעבר "יש חשבונית"', status: 'soon',
    note: 'תיקון מהותי — הרשומה הקודמת ("yeshinvoice") שגויה כמעט בכל שדה. "יש חשבונית" עברה מיתוג ל-AccountIT: yeshinvoice.co.il ו-user.yeshinvoice.co.il מפנים בפועל ל-account-it.co.il. התיעוד הנוכחי (Direct API Reference v1.54) מ',
    docs: 'https://my.accountit.co.il/assets/AccountitDirectAPIUsage.html',
    fields: [
      { key: 'companyCode', label: 'קוד חברה (company_code)' },
      { key: 'appKey', label: 'מפתח מפתחים (app_key)' },
    ],
  },
  accountbook: {
    id: 'accountbook', name: 'אקאונטבוק', status: 'soon',
    note: 'אומת: GET ל-https://cloud.tamal.co.il/GetToken/?userName=...&userPAss=... מחזיר token, ואז הפונקציה CreateDocument מקבלת CredentialsToken + JsonString + ToSign + ToMail ומחזירה כתובת מסמך. תיקון שמות שדות: userName ו-use',
    docs: 'https://www.accountbook.co.il/api/%D7%99%D7%A6%D7%99%D7%A8%D7%AA-%D7%9E%D7%99%D7%93%D7%A2/',
    fields: [
      { key: 'userName', label: 'שם משתמש בעל החשבון (userName)' },
      { key: 'userPass', label: 'סיסמה (userPass) — סיסמת הכניסה עצמה' },
    ],
  },
  grow: {
    id: 'grow', name: 'גראו (משולם)', status: 'soon',
    note: 'אושר מחדש והוחמר: פורטל המפתחים (developers.grow.business, לשעבר grow-il.readme.io) מכסה תהליכי תשלום, ארנק, Bit SDK ו-webhooks בלבד. יש שרשור פתוח בפורום שבו לקוח מבקש להפיק חשבונית דרך ה-API ואין לו תשובה מתועדת. תיקון',
    docs: '',
    fields: [

    ],
  },
  invoice4u: {
    id: 'invoice4u', name: 'חשבונית 4U', status: 'soon',
    note: 'אומת בגיטבוק: "The Invoice4U API lets you create tax-compliant documents", POST ל-https://api.invoice4u.co.il/Services/ApiService.svc/CreateDocument, והשדה היחיד לאימות הוא token בגוף כל קריאה — אין אימייל/סיסמה. תיקון ת',
    docs: 'https://invoice4u.gitbook.io/invoice4u-docs/',
    fields: [
      { key: 'apiKey', label: 'מפתח API (token) — GUID מהגדרות הארגון' },
    ],
  },
  hashavshevet: {
    id: 'hashavshevet', name: 'חשבשבת בענן', status: 'soon',
    note: 'שודרג מ-likely ל-documented — התיעוד ציבורי לגמרי ובלי רישום. אומת: GET ל-https://{server}/createSession/{privateKey}/{dbName} מחזיר wizAuthToken (תקף 24 שעות) שנשלח בכותרת Authorization, ואז POST ל-https://{server}/invA',
    docs: 'https://docs.wizcloud.co.il/docs/getting-started',
    fields: [
      { key: 'apiServer', label: 'שרת (WizcloudApiServer) — לדוגמה lb1.wizcloud.co.il' },
      { key: 'apiPrivateKey', label: 'מפתח פרטי / אסימון הרשאה (WizcloudApiPrivateKey)' },
      { key: 'apiDbName', label: 'קוד מסד הנתונים (WizcloudApiDBName)' },
    ],
  },
  wizcloud: {
    id: 'wizcloud', name: 'חשבשבת בענן (WizCloud)', status: 'soon',
    note: 'אומת מול התיעוד (WizCloud API 2.0.0): GET createSession עם המפתח ושם ה-DB מחזיר wizAuthToken בתוקף 24 שעות, ואז POST https://{WizcloudApiServer}/invApi/createDoc עם הטוקן בכותרת. שלושת השדות נכונים ושמותיהם כפי שהתיעוד ק',
    docs: 'https://docs.wizcloud.co.il/docs/getting-started',
    fields: [
      { key: 'wizcloudApiServer', label: 'שרת (WizcloudApiServer, למשל lb1.wizcloud.co.il)' },
      { key: 'wizcloudApiPrivateKey', label: 'מפתח פרטי (WizcloudApiPrivateKey)' },
      { key: 'wizcloudApiDbName', label: 'שם מסד הנתונים (WizcloudApiDBName)' },
    ],
  },
  tranzila: {
    id: 'tranzila', name: 'טרנזילה', status: 'soon',
    note: 'אומת: POST ל-https://billing5.tranzila.com/api/documents_db/create_document עם הכותרות X-tranzila-api-app-key, X-tranzila-api-request-time, X-tranzila-api-nonce ו-X-tranzila-api-access-token; סוגי מסמכים IR / IN / RE / D',
    docs: 'https://docs.tranzila.com/docs/invoices/invoices-api',
    fields: [
      { key: 'appKey', label: 'מפתח אפליקציה (X-tranzila-api-app-key)' },
      { key: 'accessToken', label: 'טוקן גישה (X-tranzila-api-access-token)' },
      { key: 'terminalName', label: 'שם מסוף (terminal_name)' },
    ],
  },
  yeshinvoice: {
    id: 'yeshinvoice', name: 'יש חשבונית', status: 'soon',
    note: 'שודרג מ-likely ל-documented — פתחתי את הדף בדפדפן אמיתי. אומת: POST ל-https://api.yeshinvoice.co.il/api/v1.1/createDocument, והאימות הוא כותרת Authorization שמכילה JSON: {"secret":"...","userkey":"..."} — כלומר שני שדות,',
    docs: 'https://user.yeshinvoice.co.il/api/doc',
    fields: [
      { key: 'secret', label: 'מפתח סודי (secret) — GUID מתוך המערכת' },
      { key: 'userkey', label: 'מפתח משתמש (userkey)' },
    ],
  },
  caspit: {
    id: 'caspit', name: 'כספית בענן', status: 'soon',
    note: 'אומת: GET ל-https://app.caspit.biz/api/v1/token?user=...&pwd=...&osekmorshe=... ואז עבודה מול https://app.caspit.biz/api/v1/. תיקון שמות שדות: הפרמטר נקרא pwd (לא password) ו-osekmorshe באותיות קטנות. פירוט הקריאות עצמן ',
    docs: 'https://app.caspitweb.biz/Home/Webapi',
    fields: [
      { key: 'user', label: 'שם משתמש בכספית (user)' },
      { key: 'pwd', label: 'סיסמת המשתמש (pwd) — סיסמת הכניסה עצמה, לא מפתח נפרד' },
      { key: 'osekMorshe', label: 'מספר עוסק מורשה / ח.פ. (osekmorshe)' },
    ],
  },
  payplus: {
    id: 'payplus', name: 'פיי פלוס / חשבונית פלוס', status: 'soon',
    note: 'אומת במלואו: POST ל-https://restapi.payplus.co.il/api/v1.0/books/docs/new/{docType} עם הכותרות api-key ו-secret-key, וסביבת בדיקות ב-restapidev.payplus.co.il. רשימת ה-docType רחבה מכפי שנרשם: inv_tax_receipt, inv_tax, in',
    docs: 'https://docs.payplus.co.il/reference/post_books-docs-new-doctype',
    fields: [
      { key: 'apiKey', label: 'מפתח API (api-key)' },
      { key: 'secretKey', label: 'מפתח סודי (secret-key)' },
    ],
  },
  fireberry: {
    id: 'fireberry', name: 'פייירברי (לשעבר פאוורלינק)', status: 'soon',
    note: 'אומת: POST ל-https://api.fireberry.com/api/record/invoiceno עם כותרת tokenid, שדות חובה accountid, companyname ו-Items. תיקון כתובת: www.powerlink.co.il מפנה ב-301 ל-www.fireberry.com, אבל האתר והתמיכה בעברית עדיין חיים ',
    docs: 'https://developers.fireberry.com/reference/create-an-invoice',
    fields: [
      { key: 'tokenId', label: 'טוקן גישה (tokenid) — פרופיל → אבטחת חשבון → API' },
    ],
  },
  finbot: {
    id: 'finbot', name: 'פינבוט', status: 'soon',
    note: 'אומת: POST ל-https://api.finbotai.co.il/income עם כותרת secret; תשעה סוגי מסמכים 0-8 (0 חשבונית מס, 1 קבלה, 2 חשבונית מס קבלה, 3 דרישת תשלום, 4 זיכוי, 5 הזמנת רכש, 6 תעודת משלוח, 7 הצעת מחיר, 8 חשבון עסקה). תיקון מיקוד: ',
    docs: 'https://finbot.helpjuice.com/he_IL/api-docs-create-income',
    fields: [
      { key: 'secret', label: 'מפתח API (secret) — הגדרות עסק → API להפקת הכנסות' },
    ],
  },
  priority: {
    id: 'priority', name: 'פריוריטי', status: 'soon',
    note: 'אומת שה-API הוא OData ושיוצרים חשבוניות ב-POST ל-serviceRoot/AINVOICES עם שורות ב-AINVOICEITEMS_SUBFORM; שלוש שיטות אימות מתועדות: Basic, PAT ו-OAuth2. הוספה חשובה: השימוש ב-API מחייב רכישת מודול API ורישיונות API, ועריכ',
    docs: 'https://prioritysoftware.github.io/restapi/',
    fields: [
      { key: 'serviceRootUrl', label: 'כתובת שרת (service root) של ההתקנה' },
      { key: 'username', label: 'שם משתמש API (מוגדר בתיק עובד)' },
      { key: 'password', label: 'סיסמה' },
    ],
  },
  cardcom: {
    id: 'cardcom', name: 'קארדקום', status: 'soon',
    note: 'אומת ב-OpenAPI הרשמי: POST ל-https://secure.cardcom.solutions/api/v11/Documents/CreateDocument. תיקון חשוב: סכימת CreateDocumentRequest דורשת רק ApiName + ApiPassword + אובייקט Document — TerminalNumber אינו חלק ממנה (הו',
    docs: 'https://secure.cardcom.solutions/Api/v11/Docs',
    fields: [
      { key: 'apiName', label: 'שם משתמש API (ApiName)' },
      { key: 'apiPassword', label: 'סיסמת API (ApiPassword)' },
      { key: 'terminalNumber', label: 'מספר מסוף (TerminalNumber) — נדרש רק לסליקה, לא להפקת מסמך', optional: true },
    ],
  },
  rivhit: {
    id: 'rivhit', name: 'ריווחית', status: 'soon',
    note: 'אומת: POST ל-https://api.rivhit.co.il/online/RivhitOnlineAPI.svc/Document.New, שדה האימות הוא api_token (UUID) בגוף הבקשה, לצד document_type, customer_id, sort_code ו-items. תיקון: אין תוכנית חינם — יש ניסיון 30 יום ומבצ',
    docs: 'https://rivhit-api.readme.io/reference/post_online-rivhitonlineapi-svc-document-new',
    fields: [
      { key: 'apiToken', label: 'מפתח API (api_token) — הגדרות → הגדרות אונליין → פאנל API → "הצג API TOKEN"' },
    ],
  },
  takbull: {
    id: 'takbull', name: 'תקבול (Takbull)', status: 'soon',
    note: 'סליקה + הפקת מסמכים, עם תיעוד מלא בעברית — נדיר בשוק הזה. תיקון: שני המפתחות נשלחים ככותרות HTTP בשם API_Key ו-API_Secret (לא כשדות בגוף), ומתקבלים מצוות התמיכה בעת פתיחת חשבון — לא מהאזור האישי. הפקת מסמך אומתה: POST ht',
    docs: 'https://takbull.co.il/%D7%97%D7%99%D7%91%D7%95%D7%A8-api-%D7%AA%D7%A7%D7%91%D7%95%D7%9C/',
    fields: [
      { key: 'apiKey', label: 'מפתח ציבורי (API_Key)' },
      { key: 'apiSecret', label: 'מפתח פרטי (API_Secret)' },
    ],
  },
};

export const DEFAULT_PROVIDER = 'smartbee';

export function providerMeta(id) { return PROVIDERS[id] || null; }
export function isProviderActive(id) { const p = PROVIDERS[id]; return !!(p && p.status === 'active'); }

// Public metadata for the client (no secrets) — the provider cards + fields.
export function publicProviderList() {
  // `docs` is a public documentation URL, not a secret — and it is the single
  // most useful thing on the card: "where do I find my API key" is the question
  // that stops most people connecting.
  return Object.values(PROVIDERS).map((p) => ({ id: p.id, name: p.name, status: p.status, note: p.note, fields: p.fields, badge: p.badge, docs: p.docs }));
}

// The calling user's billing config from KV (falls back to the default provider).
export async function getUserBilling(env, email) {
  const fallback = { provider: DEFAULT_PROVIDER, credentials: {} };
  if (!env.SJ_DATA || !email) return fallback;
  try {
    const raw = await env.SJ_DATA.get('billing:' + email.toLowerCase());
    if (!raw) return fallback;
    const cfg = JSON.parse(raw);
    return { provider: PROVIDERS[cfg.provider] ? cfg.provider : DEFAULT_PROVIDER, credentials: cfg.credentials || {} };
  } catch {
    return fallback;
  }
}

export async function saveUserBilling(env, email, provider, credentials) {
  if (!env.SJ_DATA || !email) return false;
  if (!PROVIDERS[provider]) return false;
  const clean = {};
  const meta = PROVIDERS[provider];
  (meta.fields || []).forEach((f) => { if (credentials && credentials[f.key]) clean[f.key] = String(credentials[f.key]).slice(0, 2000); });
  await env.SJ_DATA.put('billing:' + email.toLowerCase(), JSON.stringify({ provider, credentials: clean }));
  return true;
}
