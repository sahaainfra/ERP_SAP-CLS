/**
 * Master data governance (part 06.01): the registry every master plugs into, and the checks they share.
 *
 *   masterTypes.register({
 *     type: 'PARTNER', label, module, financial,              financial masters add the accounts manager to the approval of new records, sensitive changes and merges
 *     codePrefix: 'BP',                                         codes are made as BP-00001 per company
 *     fields: [{ key, label, type: 'text'|'enum'|'email', required, max, options, format: 'PAN'|'GSTIN'|'IFSC'|'PIN'|'MOBILE'|'EMAIL'|'BANK_ACCOUNT', sensitive, unique: 'block'|'warn', upper }],
 *     nameField: 'name', fuzzy: { field: 'name', threshold: 85 },
 *     defaultRules: [{ field, rule: 'REQUIRED'|'FORMAT'|'STALE', param, severity }],
 *     crossCheck(data) -> [{ field, message }]                  rules between fields (for example: the GSTIN contains the PAN)
 *   })
 *   masterReferences.register({ code, label, find(db, companyId, recordIds) -> [{ entity, id, label, route, recordId }] })   who refers to a master record
 *   mdmOf(db).resolve(type, id) / .assertSelectable(actor, type, id)                                                         for the modules that use masters
 *
 * The records of a registered master are kept by the framework (mdm_records and mdm_record_versions) with their effective-dated versions; a later master that keeps its
 * own table can register with the same definition and use the change requests, duplicates, merge map, quality rules and stewards of the framework (see ARCHITECTURE section 55).
 */
const types = new Map();
export const masterTypes = {
  register(def) {
    if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(def.type)) throw new Error(`Master type ${def.type} must be in capitals`);
    if (types.has(def.type)) throw new Error(`Master type ${def.type} is already registered`);
    types.set(def.type, { financial: false, nameField: 'name', defaultRules: [], crossCheck: () => [], ...def });
  },
  get: (type) => types.get(type) ?? null,
  list: () => [...types.values()],
};
/** Labels of masters that are not registered as governed records (the common masters of 06.02), for the change requests worklist. */
export const masterLabels = new Map();
const refs = new Map();
export const masterReferences = { register(def) { refs.set(def.code, def); }, list: () => [...refs.values()] };

// ---- formats (FR-04) ----
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** The check character of a GSTIN (its 15th character), by the published algorithm. */
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = GST_CHARS.indexOf(first14[i]);
    if (v < 0) return null;
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}
export const FORMATS = Object.freeze({
  PAN: { label: 'PAN', test: (v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), hint: 'five letters, four digits and a letter, for example ABCDE1234F' },
  GSTIN: { label: 'GSTIN', test: (v) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v) && gstinCheckChar(v.slice(0, 14)) === v[14], hint: '15 characters: state code, PAN, entity number, Z and a check character' },
  IFSC: { label: 'IFSC', test: (v) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), hint: 'four letters, a zero and six letters or digits, for example SBIN0001234' },
  PIN: { label: 'PIN code', test: (v) => /^[1-9][0-9]{5}$/.test(v), hint: 'six digits, not starting with 0' },
  MOBILE: { label: 'mobile number', test: (v) => /^[6-9][0-9]{9}$/.test(v), hint: 'ten digits starting with 6, 7, 8 or 9' },
  EMAIL: { label: 'e-mail address', test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), hint: 'name@example.com' },
  BANK_ACCOUNT: { label: 'bank account number', test: (v) => /^[0-9]{9,18}$/.test(v), hint: '9 to 18 digits' },
});
/** A value as it is stored: trimmed, capitals where the format wants them, a mobile number without +91 or spaces. */
export function normalise(field, value) {
  if (value === undefined || value === null) return null;
  let v = String(value).trim();
  if (!v) return null;
  if (['PAN', 'GSTIN', 'IFSC'].includes(field.format) || field.upper) v = v.toUpperCase().replace(/\s+/g, '');
  if (field.format === 'MOBILE') v = v.replace(/[\s-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  if (field.format === 'BANK_ACCOUNT' || field.format === 'PIN') v = v.replace(/\s+/g, '');
  if (field.format === 'EMAIL') v = v.toLowerCase();
  return v;
}

// ---- fuzzy names (FR-02) ----
const SUFFIXES = /\b(private limited|pvt\.? ?ltd\.?|pvt|limited|ltd\.?|llp|and co|& co\.?|co\.?|company|corporation|corp|inc|m\/s\.?|messrs)\b/g;
/** A name reduced to what tells it apart: lower case, no punctuation, no company suffixes or titles. */
export const nameKey = (s) => String(s ?? '').toLowerCase().replace(/[.,'"()/\\-]/g, ' ').replace(SUFFIXES, ' ').replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
const bigrams = (s) => { const t = ` ${s} `; const out = new Map(); for (let i = 0; i < t.length - 1; i += 1) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) ?? 0) + 1); } return out; };
/** How alike two names are, 0 to 100 (Dice coefficient of letter pairs, after the names are reduced; the same words in another order count as the same). */
export function similarity(a, b) {
  const x = nameKey(a); const y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y || x.split(' ').sort().join(' ') === y.split(' ').sort().join(' ')) return 100;
  const p = bigrams(x); const q = bigrams(y);
  let both = 0; let total = 0;
  for (const [g, n] of p) { both += Math.min(n, q.get(g) ?? 0); total += n; }
  for (const n of q.values()) total += n;
  return Math.round((200 * both) / total);
}
/** A sensitive value shown to someone who may not see it: only its last four characters. */
export const mask = (v) => (v == null || v === '' ? v : `${'•'.repeat(Math.max(0, String(v).length - 4))}${String(v).slice(-4)}`);

const services = new WeakMap();
export const bindMdm = (db, s) => services.set(db, s);
/** The governance service of a database, for the modules that use masters (resolve a merged record, refuse an inactive one). */
export const mdmOf = (db) => services.get(db) ?? null;
