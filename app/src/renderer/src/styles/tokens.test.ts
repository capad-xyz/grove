/**
 * Guards DESIGN-SYSTEM.md against the code drifting away from it.
 *
 * The document is the source of truth for why every value is what it is, which
 * only works while it still says what the values *are*. This has already gone
 * wrong once: the palette was re-tied to capad.fyi in tokens.css and the tables
 * in §3 kept quoting the previous hexes, so the document contradicted itself.
 *
 * A doc nobody can trust is worse than no doc, so the agreement is a test.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const HERE = import.meta.dirname;
const css = readFileSync(join(HERE, 'tokens.css'), 'utf8');
const doc = readFileSync(join(HERE, '..', '..', '..', '..', 'DESIGN-SYSTEM.md'), 'utf8');

/**
 * Compare colours, not spelling. `rgba(95,191,127,.10)` and
 * `rgba(95, 191, 127, 0.1)` are the same value, and a guard that fails on
 * whitespace is a guard someone eventually deletes.
 *
 * Hex values are only lowercased — normalising digits inside them would read
 * `#08080a` as the number 8080.
 */
function norm(value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, '');
  if (v.startsWith('#')) return v;
  return v.replace(/\d*\.?\d+/g, (n) => String(Number(n)));
}

/** Every token documented in a `| \`--name\` | \`value\` |` table row. */
function documented(): Map<string, string> {
  const out = new Map<string, string>();
  const row = /\|\s*`(--[a-z-]+)`\s*\|\s*`([^`]+)`\s*\|/g;
  for (const m of doc.matchAll(row)) out.set(m[1]!, norm(m[2]!));
  return out;
}

/** Every custom property declared in the `:root` block of tokens.css. */
function declared(): Map<string, string> {
  const out = new Map<string, string>();
  const decl = /^\s*(--[a-z-]+):\s*([^;]+);/gm;
  for (const m of css.matchAll(decl)) out.set(m[1]!, norm(m[2]!));
  return out;
}

test('tokens.css declares the colour tokens the document describes', () => {
  const inCss = declared();
  const required = [
    '--bg',
    '--surface',
    '--surface-raised',
    '--surface-sunken',
    '--line',
    '--line-soft',
    '--line-strong',
    '--text',
    '--text-dim',
    '--text-faint',
    '--text-ghost',
    '--add',
    '--del',
  ];
  for (const name of required) {
    assert.ok(inCss.has(name), `${name} is missing from tokens.css`);
  }
});

test('every documented token value matches tokens.css', () => {
  const inCss = declared();
  const inDoc = documented();
  const drift: string[] = [];

  for (const [name, docValue] of inDoc) {
    const cssValue = inCss.get(name);
    if (cssValue === undefined) continue; // documented but not a :root token
    if (cssValue !== docValue) drift.push(`${name}: css=${cssValue} doc=${docValue}`);
  }

  assert.deepEqual(drift, [], `DESIGN-SYSTEM.md disagrees with tokens.css:\n  ${drift.join('\n  ')}`);
});

test('the palette stays tied to capad.fyi', () => {
  const inCss = declared();
  // Two of the three map across exactly. --muted deliberately does not: see
  // §3, contrast does not survive inversion. If these ever change, the tie is
  // being broken and the document needs to say so.
  assert.equal(inCss.get('--bg'), '#0b0b0d', "--bg should be capad.fyi's --ink");
  assert.equal(inCss.get('--text'), '#f1f0ec', "--text should be capad.fyi's --paper");
});

test('the accent is achromatic', () => {
  // The load-bearing rule: diff green and red are the only saturated colours.
  // An accent with a hue would break §2, so assert the channels stay level.
  const accent = declared().get('--accent');
  assert.ok(accent?.startsWith('#'), `--accent should be a hex value, got ${accent}`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent!.slice(i, i + 2), 16));
  const spread = Math.max(r!, g!, b!) - Math.min(r!, g!, b!);
  assert.ok(spread <= 8, `--accent has a hue (channel spread ${spread}); §5 requires achromatic`);
});
