import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Part 05 (design system): every design variable the client uses is one the tokens or a stylesheet define. A variable that is defined nowhere makes
// the whole declaration invalid at computed time, so a border, a background or a focus ring silently disappears (found in the audit: --erp-color-border,
// --erp-color-bg-subtle, --erp-color-status-danger-*, --erp-color-focus and others). A name built at run time (var(--erp-color-${x})) is not checked here.
const root = new URL('../src/client/', import.meta.url).pathname;
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(css|jsx?|mjs)$/.test(n)) files.push(p); } };
walk(root);
const text = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

test('every --erp- variable the client reads is defined by the tokens or a stylesheet', () => {
  const defined = new Set();
  for (const t of text.values()) {
    for (const m of t.matchAll(/(--erp-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    for (const m of t.matchAll(/['"](--erp-[a-z0-9-]+)['"]\s*[:,]/g)) defined.add(m[1]);
  }
  const missing = [];
  for (const [file, t] of text) {
    for (const m of t.matchAll(/var\((--erp-[a-z0-9-]*[a-z0-9])(?=[,)])/g)) if (!defined.has(m[1])) missing.push(`${m[1]} in ${file.replace(root, '')}`);
  }
  assert.deepEqual([...new Set(missing)], [], 'undefined design variables');
});
