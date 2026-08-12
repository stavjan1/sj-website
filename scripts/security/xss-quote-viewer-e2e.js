// End-to-end exploit test of the stored XSS in the public quote viewer.
// Serves the REAL q/index.html, mocks /api/quote-share to return an attacker's
// stored payload, loads it in Chromium and reports whether the injected code
// actually executed.
//
// Runs twice:
//   CONTROL — the page with the OLD vulnerable safeImg patched back in.
//             The exploit MUST fire, otherwise the test proves nothing.
//   FIXED   — the page exactly as it ships today. The exploit MUST NOT fire.
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

// Resolved from this file, not hardcoded: the original absolute path meant
// the script only ran on the one machine it was written on.
const ROOT = require('path').resolve(__dirname, '..', '..');
const PAGE = fs.readFileSync(require('path').join(ROOT, 'q', 'index.html'), 'utf8');
const OLD_SAFEIMG = `const safeImg = (s) => /^data:image\\/(png|jpe?g|gif|webp|svg\\+xml);/i.test(String(s || '')) ? String(s) : '';`;

// A valid 1x1 GIF, so onload fires deterministically, then the attribute breakout.
const GIF = 'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const PAYLOAD = `data:image/gif;base64,${GIF}" onload="window.__pwned=true;document.title='PWNED'" x="`;

const STORED = {
  data: {
    clientName: 'לקוח לדוגמה',
    business: { name: 'עסק', owner: 'בעלים', phone: '0500000000' },
    quoteNumber: '1001', date: '01/01/2026', subject: 'בדיקה',
    items: [{ title: 'סעיף', description: 'תיאור', price: 100 }],
    finalPrice: 100, vatLabel: 'כולל מע"מ',
    logo: PAYLOAD,
    signature: { img: PAYLOAD, name: 'חותם', date: '01/01/2026' },
  },
};

// A real, well-formed logo — the regression guard: the fix must not break these.
const CLEAN = `data:image/gif;base64,${GIF}`;
const STORED_CLEAN = JSON.parse(JSON.stringify(STORED));
STORED_CLEAN.data.logo = CLEAN;
STORED_CLEAN.data.signature.img = CLEAN;

function serve(html, port, payload) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/quote-share')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(payload || STORED));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

async function run(label, html, port, expectPwned, payload, expectImgs) {
  const server = await serve(html, port, payload);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/?t=abcdefghij`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(1200);
  const pwned = await page.evaluate(() => window.__pwned === true);
  const title = await page.title();
  // Did a legitimate image still render? (regression guard for real logos)
  const imgs = await page.evaluate(() => document.querySelectorAll('.qs-biz img, .qs-signed img').length);
  await browser.close();
  server.close();
  const ok = pwned === expectPwned && (expectImgs == null || imgs === expectImgs);
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  console.log(`     exploit executed: ${pwned}  (expected ${expectPwned})`);
  console.log(`     document.title  : "${title}"`);
  console.log(`     <img> rendered  : ${imgs}${expectImgs == null ? '' : `  (expected ${expectImgs})`}`);
  return ok;
}

(async () => {
  // Reconstruct the ORIGINAL vulnerable page faithfully: it needs BOTH the
  // loose regex AND the unescaped sinks. (First attempt only swapped the regex
  // and left the esc() wrapper in place — the control then "passed" because the
  // escaping alone already stopped it. That is defence-in-depth working, but it
  // makes for a useless control.)
  let vulnerable = PAGE
    .replace(/const safeImg = [^\n]*\n/, OLD_SAFEIMG + '\n')
    .replace('${esc(safeImg(q.logo))}', '${safeImg(q.logo)}')
    .replace('${esc(safeImg(q.signature.img))}', '${safeImg(q.signature.img)}');
  const okControl = vulnerable.includes('webp|svg\\+xml);/i')
    && vulnerable.includes('src="${safeImg(q.logo)}"')
    && !vulnerable.includes('esc(safeImg(');
  if (!okControl) {
    console.log('⚠️  could not reconstruct the vulnerable version — control test invalid');
    process.exit(1);
  }
  console.log('Attacker payload stored in logo + signature.img:\n  ' + PAYLOAD.slice(0, 70) + '…\n');
  const a = await run('CONTROL  (old code — exploit SHOULD fire)', vulnerable, 8941, true);
  console.log('');
  const b = await run('SHIPPED  (current code — exploit MUST NOT fire)', PAGE, 8942, false, null, 0);
  console.log('');
  const c = await run('REGRESSION (shipped code, legitimate logo — MUST still render)',
    PAGE, 8943, false, STORED_CLEAN, 2);
  console.log('\n' + '='.repeat(64));
  console.log(a && b && c
    ? 'RESULT: exploit reproduced on the old code, DEAD on the shipped code,\n        and a real logo + signature still render correctly.'
    : 'RESULT: INCONCLUSIVE — read the blocks above.');
})();
