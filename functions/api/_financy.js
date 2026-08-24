// Financy (Open-Finance.ai) adapter — server-side only, called by /api/financy.
//
// Real contract (docs-financy.open-finance.ai, Aug 2026):
//   token   POST https://api.open-finance.ai/oauth/token  {clientId, clientSecret, userId}
//           → { accessToken, tokenType:'Bearer', expiresIn }   (JWT; read `exp`)
//   data    GET  https://api.open-finance.ai/v2/connections?status=ACTIVE
//           GET  https://api.open-finance.ai/v2/data/accounts            (CHECKING | CARD | …)
//           GET  https://api.open-finance.ai/v2/data/transactions?dateFrom=&dateTo=&nextPage=
//   refresh POST https://api.open-finance.ai/chat/chat/connections/refresh (20 credits)
// API access needs the Starter plan; the free plan answers 403 NOT_AVAILABLE_ON_PLAN.
// Balances arrive in one of two shapes ({amount} or {balanceType, balanceAmount}).

const AUTH_URL = 'https://api.open-finance.ai/oauth/token';
const BASE = 'https://api.open-finance.ai/v2';
const REFRESH_URL = 'https://api.open-finance.ai/chat/chat/connections/refresh';

const PROVIDER_MAP = {
    hapoalim: 'hapoalim', leumi: 'leumi', discount: 'discount', mizrahi: 'mizrahi',
    pepper: 'pepper', yahav: 'yahav', onezero: 'onezero', isracard: 'isracard',
    cal: 'cal', max: 'max', americanexpress: 'amex', jerusalem: 'jerusalem',
};
function mapInstitution(providerId) {
    const k = String(providerId || '').toLowerCase().replace(/-sandbox$/, '');
    return PROVIDER_MAP[k] || 'other';
}
function jwtExp(token) {
    try { const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return (p.exp || 0) * 1000; }
    catch { return 0; }
}
function hebrewError(res, body) {
    const type = body && body.type;
    if (type === 'NOT_AVAILABLE_ON_PLAN') return 'Financy: גישת API פתוחה רק בתוכנית Starter ומעלה. שדרגו את התוכנית ב-Financy.';
    if (res.status === 401) return 'Financy דחה את פרטי הגישה. בדקו User ID / Client ID / Client Secret.';
    if (res.status === 402) return 'Financy: אין מספיק קרדיטים לרענון מהבנק החודש.';
    if (res.status === 409) return 'Financy: אין כרגע חיבורים שאפשר לרענן.';
    return 'Financy ענה ' + res.status + (body && body.message ? ': ' + String(body.message).slice(0, 120) : '');
}

// ── token (cached in the finance record, re-minted 60s before expiry) ────────
async function getToken(fz) {
    if (fz.token && fz.tokenExp && Date.now() < fz.tokenExp - 60000) return fz.token;
    const res = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ clientId: fz.clientId, clientSecret: fz.clientSecret, userId: fz.userId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.accessToken) throw new Error(hebrewError(res, body));
    fz.token = body.accessToken;
    fz.tokenExp = jwtExp(body.accessToken) || (Date.now() + (Number(body.expiresIn) > 1e6 ? Number(body.expiresIn) : (Number(body.expiresIn) || 3600) * 1000));
    return fz.token;
}

async function api(fz, path, retried) {
    const token = await getToken(fz);
    const res = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    if (res.status === 401 && !retried) { fz.token = null; return api(fz, path, true); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(hebrewError(res, body));
    return body;
}

async function listAll(fz, path) {
    const items = [];
    let next = null, guard = 0;
    do {
        const sep = path.includes('?') ? '&' : '?';
        const page = await api(fz, next ? `${path}${sep}nextPage=${encodeURIComponent(next)}` : path);
        items.push(...(page.items || []));
        next = page.nextPage || null;
    } while (next && ++guard < 20);
    return items;
}

function balanceOf(acc, preferTypes) {
    const list = Array.isArray(acc.balances) ? acc.balances : [];
    for (const t of preferTypes) {
        const hit = list.find(b => b && b.balanceType === t && b.balanceAmount);
        if (hit) return Number(hit.balanceAmount.amount) || 0;
    }
    const first = list[0];
    if (!first) return 0;
    if (first.balanceAmount) return Number(first.balanceAmount.amount) || 0;
    return Number(first.amount) || 0;
}

// ── sync: connections → accounts → transactions, merged into the record ─────
export async function financySync(fz, rec) {
    if (!fz.clientId || !fz.clientSecret || !fz.userId) throw new Error('חסרים פרטי גישה ל-Financy.');
    const connections = await listAll(fz, '/connections?status=ACTIVE');
    const accountsRaw = await listAll(fz, '/data/accounts?includeDuplicates=0');
    const now = Date.now();
    // Everything Financy knows: checking, cards, savings, loans (securities too,
    // shown as a balance). The dashboard decides what counts as cash.
    const KINDS = { CHECKING: 'bank', CARD: 'card', SAVINGS: 'savings', LOAN: 'loan', SECURITY: 'securities', SECURITIES: 'securities' };
    const wanted = accountsRaw.filter(a => KINDS[String(a.accountType || '').toUpperCase()]);

    rec.accounts = rec.accounts || [];
    rec.entries = rec.entries || [];
    const keep = rec.accounts.filter(a => a.source !== 'financy');
    const synced = wanted.map(acc => {
        const id = String(acc.id);
        const kind = KINDS[String(acc.accountType).toUpperCase()];
        const isCard = kind === 'card';
        const prev = rec.accounts.find(a => a.source === 'financy' && a.externalId === id) || {};
        const parsed = acc.parsedAccount || {};
        // cards: what accrued since the last billing (the charge that is coming);
        // checking: the official booked balance.
        const balance = isCard
            ? Math.abs(balanceOf(acc, ['interimBooked', 'closingBooked', 'expected']))
            : balanceOf(acc, ['closingBooked', 'expected', 'interimAvailable']);
        return {
            id: prev.id || ('fz_' + id),
            externalId: id,
            connectionId: acc.connectionId || null,
            source: 'financy',
            name: String(acc.accountName || acc.providerId || 'חשבון').slice(0, 60),
            institution: mapInstitution(acc.providerId),
            kind,
            mask: String(parsed.number || acc.accountNumber || '').replace(/\D/g, '').slice(-4),
            balance,
            currency: acc.currency || 'ILS',
            dueDate: isCard && acc.cardDueDate ? String(acc.cardDueDate).slice(0, 10) : null,
            creditLimit: isCard ? (Number(acc.creditLimit) || null) : null,
            asOf: new Date(now).toISOString().slice(0, 10),
        };
    });
    rec.accounts = [...keep, ...synced];

    // transactions: last 120 days (dates and limit are mutually exclusive on this API)
    const dateTo = new Date(now).toISOString().slice(0, 10);
    const dateFrom = new Date(now - 120 * 864e5).toISOString().slice(0, 10);
    const byExternal = new Map(synced.map(a => [a.externalId, a]));
    let tx = [];
    try { tx = await listAll(fz, `/data/transactions?dateFrom=${dateFrom}&dateTo=${dateTo}&includeDuplicates=0&sort=1`); }
    catch (e) { /* accounts still synced; transactions can come next time */ rec.settings.financy.lastError = e.message; }
    let added = 0, updated = 0;
    tx.forEach(t => {
        const acc = byExternal.get(String(t.accountId));
        if (!acc) return;
        const ext = 'fz_' + String(t.SK || t.id || '');
        if (!t.id && !t.SK) return;
        const d = t.date || {};
        const date = String(d.transactionDate || d.bookingDate || d.valueDate || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        const amt = t.amount || {};
        const amount = Number((amt.chargedAmount && amt.chargedAmount.amount) != null ? amt.chargedAmount.amount : (amt.originalAmount && amt.originalAmount.amount)) || 0;
        const desc = String(t.merchantName || (t.description && t.description.description) || '').slice(0, 120);
        const category = String((t.category && (t.category.main || '')) || '');
        const existing = rec.entries.find(e => e.externalId === ext);
        if (existing) { existing.amount = amount; existing.desc = desc; existing.date = date; existing.category = category; updated++; }
        else { rec.entries.push({ id: ext, externalId: ext, accountId: acc.id, date, amount, desc, category, source: 'financy' }); added++; }
    });
    rec.entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (rec.entries.length > 5000) rec.entries = rec.entries.slice(-5000);

    const fresh = connections.map(c => c.lastFetchedDataDate).filter(Boolean).sort().pop() || null;
    return {
        message: `סונכרנו ${synced.length} חשבונות (${connections.length} חיבורים), ${added} תנועות חדשות${updated ? ` ו-${updated} עודכנו` : ''}.`,
        dataDate: fresh,
    };
}

// ── on-demand refresh at the banks (costs Financy credits) ───────────────────
export async function financyRefresh(fz) {
    const token = await getToken(fz);
    const res = await fetch(REFRESH_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(hebrewError(res, body));
    return body.status === 'already_running'
        ? 'רענון מהבנקים כבר רץ, הנתונים יתעדכנו תוך דקה-שתיים.'
        : 'הבנקים מתרעננים עכשיו (20 קרדיטים). סנכרנו שוב בעוד דקה-שתיים.';
}
