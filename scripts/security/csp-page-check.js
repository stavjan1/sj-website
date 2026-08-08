// Serve the real site files locally WITH the candidate CSP applied as an
// ENFORCING header, load each page in Chromium, and record every CSP violation
// the browser actually reports. This tells us what the policy would break.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = '/home/user/sj-website';
const PORT = 8931;

// Pull the candidate policy straight out of _headers so we test what ships.
const headersFile = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
const cspLine = headersFile.split('\n').find((l) => /^\s*Content-Security-Policy(-Report-Only)?:/.test(l));
const CSP = cspLine.replace(/^\s*Content-Security-Policy(-Report-Only)?:\s*/, '').trim();
console.log('TESTING POLICY (as enforcing):\n' + CSP + '\n');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  // Enforcing, so any violation is a hard failure we can observe.
  res.setHeader('Content-Security-Policy', CSP);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    return res.end('<!doctype html><p>404');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const PAGES = ['/', '/sale/', '/ask/', '/q/?t=abcdefghij', '/contact.html', '/zerem/', '/checkups/', '/thanks.html', '/privacy.html', '/accessibility.html', '/404.html'];

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const findings = {};

  for (const page of PAGES) {
    const ctx = await browser.newContext();
    const tab = await ctx.newPage();
    const hits = [];
    // The authoritative signal: the browser's own violation event.
    await tab.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        window.__csp.push({ directive: e.violatedDirective, blocked: e.blockedURI, line: e.lineNumber });
      });
    });
    tab.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy|Refused to/i.test(t)) hits.push(t.slice(0, 200));
    });
    try {
      await tab.goto('http://127.0.0.1:' + PORT + page, { waitUntil: 'load', timeout: 25000 });
      await tab.waitForTimeout(2500); // let deferred/async scripts run
    } catch (e) { hits.push('NAV ERROR: ' + e.message.slice(0, 120)); }
    const evts = await tab.evaluate(() => window.__csp || []).catch(() => []);
    findings[page] = { events: evts, console: hits };
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log('='.repeat(60));
  let total = 0;
  for (const [page, r] of Object.entries(findings)) {
    // Collapse to unique directive+blocked pairs — one line per real problem.
    const uniq = [...new Set(r.events.map((e) => `${e.directive}  <-  ${e.blocked}`))];
    total += uniq.length;
    console.log(`\n${page}`);
    if (!uniq.length) console.log('   ✅ no CSP violations');
    else uniq.forEach((u) => console.log('   ❌ ' + u));
  }
  console.log('\n' + '='.repeat(60));
  console.log(total === 0 ? 'RESULT: CLEAN — policy is safe to enforce.' : `RESULT: ${total} violation type(s) — policy would break these.`);
})();
