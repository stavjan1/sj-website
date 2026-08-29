// The Financy credentials are a READ credential for the user's bank. financy.js
// stores clientId / clientSecret / userId and a minted bearer token, and builds
// a publicStatus() helper precisely so they are never echoed — and then
// /api/finance returned the whole raw record, secret and live token included.
//
// It is the user's own credential going to the user's own browser over TLS, so
// no cross-user exposure. But any XSS on /sale, any browser extension and any
// intermediate cache could read it, and billing.js answers the same class of
// question with hasCredentials:true.
//
// Redacting alone would have been a bug of its own: the browser PUTs the whole
// blob back on every save, so the first save after a load would have erased the
// credentials it was never sent. Both halves are pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../functions/api/finance.js', import.meta.url), 'utf8');

async function load() {
    const grab = (name) => {
        const i = SRC.indexOf('function ' + name);
        assert.ok(i > -1, name + ' is gone from finance.js');
        return SRC.slice(i, SRC.indexOf('\n}', i) + 2);
    };
    const ci = SRC.indexOf('const FINANCY_SECRETS');
    assert.ok(ci > -1, 'the secret list is gone');
    const consts = SRC.slice(ci, SRC.indexOf('\n', ci));
    const mod = [consts, grab('redactFinancy'), grab('keepFinancySecrets'),
        'export { redactFinancy, keepFinancySecrets };'].join('\n');
    return import('data:text/javascript;base64,' + Buffer.from(mod).toString('base64'));
}

const stored = () => ({
    accounts: [], settings: { financy: {
        clientId: 'CID', clientSecret: 'SHHH', userId: 'U1',
        token: 'LIVE', tokenExp: 123, lastSync: 5, connected: true } } });

test('the bank secret and the live token never reach the browser', async () => {
    const { redactFinancy } = await load();
    const out = redactFinancy(stored());
    const fz = out.settings.financy;
    assert.equal(fz.clientSecret, undefined, 'the bank client secret is still in the response');
    assert.equal(fz.token, undefined, 'the live bearer token is still in the response');
    assert.equal(fz.tokenExp, undefined);
    // What the screen actually uses must survive, or the card says "not connected".
    assert.equal(fz.lastSync, 5);
    assert.equal(fz.connected, true);
    assert.equal(fz.hasCredentials, true, 'the browser can no longer tell that it IS connected');
});

test('redacting does not mutate the stored record', async () => {
    const { redactFinancy } = await load();
    const rec = stored();
    redactFinancy(rec);
    assert.equal(rec.settings.financy.clientSecret, 'SHHH',
        'the redaction edited the record in place — the next write would persist the hole');
});

test('a save from a browser that was never sent the secret does not erase it', async () => {
    // THE TRAP. The client PUTs the whole blob back. Without this, redacting the
    // GET would have destroyed the credentials on the very next autosave.
    const { redactFinancy, keepFinancySecrets } = await load();
    const rec = stored();
    const asSeenByBrowser = redactFinancy(rec);
    const merged = keepFinancySecrets(asSeenByBrowser, rec);
    assert.equal(merged.settings.financy.clientSecret, 'SHHH', 'the save erased the bank secret');
    assert.equal(merged.settings.financy.token, 'LIVE', 'the save erased the live token');
});

test('a genuinely new connection still writes its own credentials', async () => {
    // Disconnecting or re-connecting must not be blocked by the merge: a value
    // the browser DID send wins over the stored one.
    const { keepFinancySecrets } = await load();
    const incoming = { settings: { financy: { clientId: 'NEW', clientSecret: 'FRESH', userId: 'U2' } } };
    const merged = keepFinancySecrets(incoming, stored());
    assert.equal(merged.settings.financy.clientSecret, 'FRESH',
        'a newly entered secret was overwritten by the old one');
    // And with no prior record at all it must simply pass through.
    assert.ok(keepFinancySecrets(incoming, null));
});
