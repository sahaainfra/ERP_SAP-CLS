import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Canonical JSON: sorted keys, 2-space indent, trailing newline. Byte-stable across runs. */
export function canonical(value) {
  const sort = (v) =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]))
        : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** Approved golden changes are recorded in DECISIONS.md as: GOLDEN-APPROVED: <id> <sha256> <reason>. */
export function approvedHashes(decisionsText) {
  const out = new Map();
  for (const line of decisionsText.split(/\r?\n/)) {
    const m = /^GOLDEN-APPROVED:\s+(\S+)\s+([0-9a-f]{64})\s+(\S.*)$/.exec(line.trim());
    if (m) out.set(`${m[1]}:${m[2]}`, m[3]);
  }
  return out;
}

export function captureGolden(registry, outputsDir) {
  mkdirSync(outputsDir, { recursive: true });
  for (const g of registry) writeFileSync(join(outputsDir, `${g.id}.json`), canonical(g.run()));
}

/** Returns [{ id, status: 'ok'|'changed'|'approved'|'missing', reason? }]. */
export function compareGolden(registry, outputsDir, decisionsText = '') {
  const approvals = approvedHashes(decisionsText);
  return registry.map((g) => {
    const file = join(outputsDir, `${g.id}.json`);
    const actual = canonical(g.run());
    if (!existsSync(file)) return { id: g.id, status: 'missing' };
    if (readFileSync(file, 'utf8') === actual) return { id: g.id, status: 'ok' };
    const reason = approvals.get(`${g.id}:${sha256(actual)}`);
    return reason ? { id: g.id, status: 'approved', reason } : { id: g.id, status: 'changed', hash: sha256(actual) };
  });
}
