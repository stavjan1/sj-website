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
  'assets/tokens.css',
  'assets/ui.css',
  'styles.css',
  'sale/css/shell.css',
  'sale/css/panels.css',
  'sale/css/pdf.css',
  'sale/controlroom.css',
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
