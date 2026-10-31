import { isSensitiveKey } from '../events/mask.js';

// Columns every business table carries for bookkeeping: a change to them alone is not a change to the record.
const TECHNICAL = new Set(['updated_at', 'updated_by', 'version', 'created_at', 'created_by', 'deleted_at', 'deleted_by', 'source_type', 'source_id', 'updatedAt', 'updatedBy', 'createdAt', 'createdBy']);
const MASKED = '[masked]';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snake = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const maskIfSensitive = (key, value) => (isSensitiveKey(snake(key)) && value !== null && value !== undefined && typeof value !== 'object' ? MASKED : value);

/**
 * The field-level changes between two versions of a record: { field: { old, new } }. Technical columns are left out; a sensitive
 * field shows that it changed but never its values. A create (no `before`) lists every field with its new value, a delete every
 * field with its old value.
 */
export function diffValues(before, after) {
  const a = before && typeof before === 'object' ? before : null;
  const b = after && typeof after === 'object' ? after : null;
  const out = {};
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    if (TECHNICAL.has(key)) continue;
    const hadOld = a && key in a;
    const hasNew = b && key in b;
    if (hadOld && hasNew && same(a[key], b[key])) continue;
    out[key] = {
      ...(hadOld ? { old: maskIfSensitive(key, a[key]) } : {}),
      ...(hasNew ? { new: maskIfSensitive(key, b[key]) } : {}),
    };
  }
  return out;
}

/** A value shown to a reader: sensitive fields hidden, whatever depth they sit at. */
export function maskForView(value, key = '') {
  if (Array.isArray(value)) return value.map((v) => maskForView(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskForView(v, k)]));
  return key ? maskIfSensitive(key, value) : value;
}
