// What is actually in the 502?
//
// Roughly one pricing call in three came back 502 with what looked like an
// empty JSON object. It was not: the harness did `res.json().catch(() => ({}))`
// and the `{}` was its own fallback for a body that would not parse. Nobody had
// seen the real response, so "502 empty body" was never a fact — it was a
// missing catch. This prints the status line, every header and the raw text.
//
//   node scripts/eval/probe_502.mjs [attempts]

const ATTEMPTS = Number(process.argv[2]) || 6;

// Long enough to take real time to generate, which is when the failure shows.
const Q = `תן לי כתב כמויות מלא ומפורט להתקנת עמדת טעינה ביתית 11kW בבית פרטי,
מרחק 30 מטר מהלוח, מעבר דרך פיר קיים וחפירה של 8 מטר בגינה, קיר בטון מזוין.
פרט כל פריט בשורה נפרדת עם מחיר, ואז את העבודה, ואז סיכום ושורת בודק.`;

let ok = 0;
for (let i = 1; i <= ATTEMPTS; i++) {
  const started = Date.now();
  let res, raw = '', err = null;
  try {
    res = await fetch('https://www.sj-eng.co.il/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: Q }], max_tokens: 3000, stream: false }),
    });
    raw = await res.text();
  } catch (e) {
    err = e;
  }
  const ms = Date.now() - started;

  if (err) {
    console.log(`#${i}  NETWORK ${err.message}  ${ms}ms`);
  } else if (res.ok) {
    ok++;
    let len = 0;
    try { len = (JSON.parse(raw)?.choices?.[0]?.message?.content || '').length; } catch { /* shape drift */ }
    console.log(`#${i}  ${res.status}  ${ms}ms  ${len}ch`);
  } else {
    console.log(`\n#${i}  ${res.status} ${res.statusText}  ${ms}ms`);
    // The headers are where a Cloudflare-side failure identifies itself —
    // cf-ray, cf-cache-status and the AI provider markers this proxy sets.
    for (const [k, v] of res.headers) {
      if (/^(cf-|x-ai|content-type|retry|server)/i.test(k)) console.log(`     ${k}: ${String(v).slice(0, 120)}`);
    }
    console.log(`     body (${raw.length} bytes): ${raw.slice(0, 500) || '(empty)'}\n`);
  }
  await new Promise((r) => setTimeout(r, 6000));
}
console.log(`\n${ok}/${ATTEMPTS} succeeded`);
