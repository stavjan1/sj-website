// End-to-end check of the PRICING handoff, against the live endpoint.
//
// live_chat.mjs sends customer messages — the first thing the bot ever sees.
// This sends the other shape, and the one that actually produces a quote: the
// approved characterisation card followed by the agent's own product list. That
// message is where retrieval used to fail silently, because the card's question
// bullets were being searched as if they were the shopping list.
//
// It sends the CLIENT system instruction too. Without it only the server blocks
// are being measured, and the itemised A/B/C quote structure is demanded by the
// client half — so a test that omits it will report a lump sum and call it a
// regression.
//
//   node scripts/eval/live_handoff.mjs

import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const APP = read('site/sale/app.js');

function literalBlock(fn) {
  const at = APP.indexOf(`function ${fn}(`);
  if (at < 0) return '';
  const next = APP.indexOf('\nfunction ', at + 10);
  return ((next === -1 ? APP.slice(at) : APP.slice(at, next)).match(/`[^`]*`/g) || []).join('\n');
}

const sternBlock = (() => {
  const rows = JSON.parse(read('site/sale/stern-pricing.json').replace(/^﻿/, ''));
  const items = Array.isArray(rows) ? rows : rows.items;
  return items.filter((i) => i && i.description && Number(i.price) > 0)
    .map((i) => `• ${i.description} — ${i.price} ₪`).join('\n');
})();

const CLIENT = [
  literalBlock('getProfessionSystemInstruction'),
  sternBlock,
  literalBlock('getMarketAnchorsPromptBlock'),
  literalBlock('getPricingInstinctPromptBlock'),
].join('\n\n');

const HANDOFF = `האפיון הושלם ואושר. תמחר את העבודה במלואה, עבודה + חומרים.

כרטיס אפיון מאושר
• מה בדיוק עושים? התקנת עמדת טעינה חדשה
• סוג הנכס? בית פרטי דו-משפחתי
• גודל החיבור הראשי הקיים? 3x25 אמפר
• הספק העמדה המבוקש? 11 קילוואט תלת פאזי
• מרחק הלוח מהחניה? כ-25 מטר
• סוג הקיר בנקודות המעבר? בטון מזוין, קידוח אחד
• מי מספק את העמדה? הלקוח כבר רכש
• מי סוגר אחרי העבודה? סגירה גסה בלבד

רשימת המוצרים שגובשה:
• כבל N2XY 5x6 ממ"ר — כ-30 מטר כולל רזרבה
• צינור מרירון 25 להגנה בתוואי החיצוני
• צינור גמיש לבן PG 21 לפניות ליד הלוח והעמדה
• ממסר פחת Type A-EV 4x40 30mA
• מפסק פקט מוגן מים ליד העמדה
• נעלי כבל ושרוולים מתכווצים`;

const res = await fetch('https://www.sj-eng.co.il/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'system', content: CLIENT }, { role: 'user', content: HANDOFF }],
    max_tokens: 3000,
    stream: false,
  }),
});

const data = await res.json().catch(() => ({}));
const choice = data?.choices?.[0];
const text = choice?.message?.content || '';
console.log(`status ${res.status}  finish=${choice?.finish_reason}  ${text.length}ch\n`);
if (!text) {
  console.log(JSON.stringify(data).slice(0, 400));
  process.exit(1);
}

// The distinction that matters: a price taken FROM the catalog versus a price
// the model produced from memory. A SKU is the only proof of the former.
const checks = [
  ['מק"ט from the catalog', /מק"ט\s*\d{5,}/],
  ['inspector, own line',   /בודק/],
  ['pre-VAT stated',        /לפני מע"מ/],
  ['PG 21 priced',          /PG\s?21|EL-022/],
  ['מרירון priced',         /מרירון/],
  ['פקט priced',            /פקט/],
  ['cable at catalog rate', /17[.,]\d|17\.54|17\.2/],
  ['estimates flagged',     /הערכה/],
  ['JSON block returned',   /```json/],
  ['fees array emitted',    /"fees"/],
];
for (const [label, rx] of checks) console.log(`${rx.test(text) ? '✔' : '✘'} ${label}`);

console.log('\n--- lines carrying a price ---');
text.split('\n').filter((l) => /₪/.test(l)).slice(0, 16)
  .forEach((l) => console.log('   ' + l.trim().slice(0, 118)));
