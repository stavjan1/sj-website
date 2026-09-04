// A stylesheet that does not close a block does not fail loudly — the browser
// swallows every rule after it as part of the unclosed one, so a whole tail of
// the design silently stops existing. It has happened twice, both times when a
// merge dropped a lone `}` line, and both times the file still had an equal
// number of braces because a stray `}` elsewhere balanced the count.
//
// So: walk the file, and require that the nesting never goes negative and ends
// at zero. That catches the dropped brace AND the stray one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SHEETS = [
  'site/assets/tokens.css',
  'site/assets/ui.css',
  'site/styles.css',
  'site/sale/css/shell.css',
  'site/sale/css/panels.css',
  'site/sale/css/pdf.css',
  'site/sale/controlroom.css',
  'site/sale/periodic.css',
  'site/sale/nextstep.css',
];

// Braces inside comments and strings are text, not structure.
function strip(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

function lineOf(css, index) {
  return css.slice(0, index).split('\n').length;
}

for (const file of SHEETS) {
  test(`${file} closes every block it opens`, () => {
    const raw = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const css = strip(raw);
    let depth = 0;
    for (let i = 0; i < css.length; i++) {
      const ch = css[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        assert.ok(depth >= 0, `${file}: a closing brace with nothing open, line ${lineOf(css, i)}`);
      }
    }
    assert.equal(depth, 0, `${file}: ${depth} block(s) left open — everything after the first one is dead CSS`);
  });

  test(`${file} has no rule that swallows the next selector`, () => {
    const raw = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const css = strip(raw);
    // A declaration block whose body contains "…{" means a selector was parsed
    // as a value: the sign of a missing close a few lines above.
    const blocks = css.matchAll(/\{([^{}]*)\{/g);
    for (const m of blocks) {
      const body = m[1];
      // @media/@supports legitimately nest; a plain selector body never does.
      const opensNested = /^\s*(?:@|:|\/)/.test(body) === false && /[;:]/.test(body);
      assert.ok(!opensNested || /@(media|supports|container|layer|keyframes)/.test(css.slice(Math.max(0, m.index - 200), m.index)),
        `${file}: a block near line ${lineOf(css, m.index)} appears to contain a selector — a missing "}" above it`);
    }
  });
}

// ── A class the JS invents must exist in a stylesheet ────────────────────────
//
// applyReportsLock() builds a .tier-lock-overlay to cover the reports panel for
// free users. Not one of its class names had a single rule in any stylesheet —
// grep returned zero across the whole project — so the "lock" was an unstyled
// div appended below the panel. It covered nothing and blocked nothing: every
// free user had the Pro reports in full, with the upgrade pitch printed
// underneath them.
//
// The failure is invisible by construction. The JS is correct, the HTML is
// correct, nothing throws, and the only symptom is a paid feature being free.
test('the classes JS builds for overlays are actually styled', () => {
  const all = SHEETS.map((f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  const app = readFileSync(new URL('../site/sale/app.js', import.meta.url), 'utf8');

  // Every className string assigned in app.js whose name looks like a cover.
  const built = new Set();
  const re = /className\s*=\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(app))) {
    for (const cls of m[1].split(/\s+/)) {
      if (/(lock|overlay|scrim|backdrop)/i.test(cls)) built.add(cls);
    }
  }
  assert.ok(built.size, 'no overlay classes found — did the selector convention change?');

  const missing = [...built].filter((cls) => !all.includes('.' + cls));
  assert.deepEqual(missing, [],
    'JS builds these overlay classes but no stylesheet defines them — they cover nothing');
});
