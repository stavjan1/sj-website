// Ask the LIVE pricing endpoint a real case and print the answer.
//
// Separate from prompt_coverage.mjs on purpose: that one is free and
// deterministic and answers "was it told?", this one costs quota and answers
// "did it use what it was told?". Run it on a few cases, not all 24.
//
//   node scripts/eval/live_chat.mjs 1 5 19
import { readFileSync } from 'node:fs';
import { hydrate, searchMaterials, searchMaterialsMulti, extractItemQueries,
         categoryStats, renderMaterialsBlock, consumableQueries } from '../../functions/api/_materials.js';
const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const db = hydrate(JSON.parse(read('data/materials/index.json')));
const APP = read('sale/app.js');
function literalBlock(fn){const at=APP.indexOf(`function ${fn}(`);if(at<0)return'';return (APP.slice(at,at+12000).match(/`[^`]*`/g)||[]).join('\n');}
function sternBlock(){const r=JSON.parse(read('sale/stern-pricing.json').replace(/^\uFEFF/,''));const items=Array.isArray(r)?r:r.items;
  return items.filter(i=>i&&i.description&&Number(i.price)>0).map(i=>`• ${i.description} — ${i.price} ₪`).join('\n');}
const CLIENT=[literalBlock('getProfessionSystemInstruction'),sternBlock(),
  literalBlock('getMarketAnchorsPromptBlock'),literalBlock('getPricingInstinctPromptBlock')].join('\n\n');

function parseCases(md){const out=[];for(const c of md.split(/^### מקרה /m).slice(1)){
  const num=parseInt(c,10);const title=(c.split('\n')[0]||'').replace(/^\d+\s*—\s*/,'').trim();
  const msg=((c.match(/\*\*ההודעה:\*\*\s*\n((?:>.*\n?)+)/)||[,''])[1]).replace(/^>\s?/gm,'').trim();
  if(msg)out.push({num,title,msg});}return out;}

const want = process.argv.slice(2).map(Number);
const cases = parseCases(read('docs/PRICING-EVAL-CASES.md')).filter(c=>want.includes(c.num));

for (const c of cases) {
  const qs = extractItemQueries(c.msg);
  const hits = qs.length>=3 ? searchMaterialsMulti(db,qs,3,45) : searchMaterials(db,c.msg,45);
  const named=new Set(hits.map(h=>h.sku));
  const forgotten=searchMaterialsMulti(db,consumableQueries(c.msg),1,12).filter(h=>!named.has(h.sku));
  const materials=renderMaterialsBlock(db,hits,categoryStats(db,c.msg),forgotten);
  const system = CLIENT + '\n\n' + materials;

  console.log(`\n${'='.repeat(78)}\nמקרה ${c.num} — ${c.title}\n${'='.repeat(78)}\n${c.msg}\n${'-'.repeat(78)}`);
  const res = await fetch('https://www.sj-eng.co.il/api/chat', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ messages:[{role:'system',content:system},{role:'user',content:c.msg}],
      max_tokens: 1600, stream:false }),
  });
  const data = await res.json().catch(()=>({}));
  const txt = data?.choices?.[0]?.message?.content;
  console.log(txt || `[${res.status}] ${JSON.stringify(data).slice(0,300)}`);
  await new Promise(r=>setTimeout(r,6000));   // stay under the 12/min burst cap
}
