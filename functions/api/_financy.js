// Financy (Open-Finance.ai) adapter — server-side only, called by /api/financy.
//
// financySync(apiKey, record) pulls the user's connected bank + card accounts
// and their transactions, merges them into the finance record IN PLACE, and
// returns { message }. Manual accounts/entries (source !== 'financy') are
// never touched; Financy rows are matched by externalId so re-syncs update
// instead of duplicating.
//
// The HTTP details below are set from Financy's published API. If Financy
// changes its contract, this is the only file that knows about it.

export const FINANCY_BASE = 'https://financy.open-finance.ai/api';

function mapInstitution(name) {
    const n = String(name || '').toLowerCase();
    if (/leumi|לאומי/.test(n)) return 'leumi';
    if (/poalim|הפועלים/.test(n)) return 'hapoalim';
    if (/discount|דיסקונט/.test(n)) return 'discount';
    if (/mizrahi|מזרחי/.test(n)) return 'mizrahi';
    if (/one ?zero|וואן זירו/.test(n)) return 'onezero';
    if (/pepper|פפר/.test(n)) return 'pepper';
    if (/yahav|יהב/.test(n)) return 'yahav';
    if (/jerusalem|ירושלים/.test(n)) return 'jerusalem';
    if (/\bmax\b|מקס/.test(n)) return 'max';
    if (/isracard|ישראכרט/.test(n)) return 'isracard';
    if (/\bcal\b|כאל/.test(n)) return 'cal';
    if (/amex|american/.test(n)) return 'amex';
    return 'other';
}

async function call(apiKey, path) {
    const res = await fetch(FINANCY_BASE + path, {
        headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) throw new Error('Financy דחה את המפתח. בדקו שהמפתח עדכני.');
    if (!res.ok) throw new Error('Financy ענה ' + res.status + ' על ' + path);
    return res.json();
}

export async function financySync(apiKey, rec) {
    // Accounts: banks and credit cards with their current balance.
    const accountsRaw = await call(apiKey, '/accounts');
    const list = Array.isArray(accountsRaw) ? accountsRaw : (accountsRaw.accounts || accountsRaw.data || []);
    if (!Array.isArray(list)) throw new Error('תשובת Financy לא מוכרת (accounts).');

    rec.accounts = rec.accounts || [];
    rec.entries = rec.entries || [];
    const now = Date.now();
    const keep = rec.accounts.filter(a => a.source !== 'financy');
    const synced = list.map(acc => {
        const id = String(acc.id || acc.accountId || acc.externalId || '');
        const isCard = /card|credit|אשראי/i.test(String(acc.type || acc.accountType || ''));
        const prev = rec.accounts.find(a => a.source === 'financy' && a.externalId === id) || {};
        return {
            id: prev.id || ('fz_' + id),
            externalId: id,
            source: 'financy',
            name: String(acc.name || acc.nickname || acc.institution || acc.bankName || 'חשבון').slice(0, 60),
            institution: mapInstitution(acc.institution || acc.bankName || acc.provider || acc.name),
            kind: isCard ? 'card' : 'bank',
            mask: String(acc.mask || acc.last4 || acc.accountNumber || '').slice(-4),
            balance: Number(acc.balance != null ? acc.balance : acc.currentBalance) || 0,
            currency: acc.currency || 'ILS',
            asOf: new Date(now).toISOString().slice(0, 10),
        };
    });
    rec.accounts = [...keep, ...synced];

    // Transactions: last 120 days, de-duplicated by external id.
    const since = new Date(now - 120 * 864e5).toISOString().slice(0, 10);
    let added = 0, updated = 0;
    for (const acc of synced) {
        let tx;
        try { tx = await call(apiKey, `/accounts/${encodeURIComponent(acc.externalId)}/transactions?from=${since}`); }
        catch (e) { continue; } // one account failing must not kill the sync
        const rows = Array.isArray(tx) ? tx : (tx.transactions || tx.data || []);
        rows.forEach(t => {
            const ext = 'fz_' + acc.externalId + '_' + String(t.id || t.transactionId || (t.date + '_' + t.amount + '_' + (t.description || '')));
            const date = String(t.date || t.bookingDate || t.valueDate || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
            const amount = Number(t.amount) || 0;
            const desc = String(t.description || t.merchant || t.memo || '').slice(0, 120);
            const existing = rec.entries.find(e => e.externalId === ext);
            if (existing) { existing.amount = amount; existing.desc = desc; existing.date = date; updated++; }
            else { rec.entries.push({ id: ext, externalId: ext, accountId: acc.id, date, amount, desc, category: String(t.category || ''), source: 'financy' }); added++; }
        });
    }
    rec.entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (rec.entries.length > 5000) rec.entries = rec.entries.slice(-5000);

    return { message: `סונכרנו ${synced.length} חשבונות, ${added} תנועות חדשות${updated ? ` ו-${updated} עודכנו` : ''}.` };
}
