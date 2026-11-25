// Part 166.1 F-03 / FR-02: lists every role -> permission grant that is neither in the role templates (src/server/platform/authz/templates.js)
// nor an approved exception (docs/erp/PERMISSION_EXCEPTIONS.json: [{ role, permission, approvedBy, reference }]).
//   node scripts/permission_audit.mjs [--db path/to/erp.db] [--json]
// Two checks: (1) the grants stored in a database (iam_role_permissions) against the templates, (2) every sensitive action
// (manage, configure, redrive, replay, issue ...) of the templates against docs/erp/PERMISSION_BASELINE.json, so a new holder of a *.manage permission is a reviewed change.
// Exit code 1 when something is found.
// Audit AUD-DEF-008: the baseline is a role/permission change, maker-checker by the approval reference (07: SYSADM maker, ITADM or DIR
// checker). docs/erp/PERMISSION_REVIEWS.json records each version of the baseline (its SHA-256) with its maker and checker:
//   --write-baseline --maker <name> --note "<why>"                 rewrites the baseline from the templates and records it, awaiting a checker
//   --record-check --checker <name> --checker-role ITADM|DIR       the checker signs the latest version (never the maker)
// The check fails when the baseline differs from its latest recorded version, and warns while that version awaits its checker.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SENSITIVE_ACTIONS, TEMPLATE_PERMISSIONS } from '../src/server/platform/authz/templates.js';

const args = process.argv.slice(2); const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BASELINE = new URL('../docs/erp/PERMISSION_BASELINE.json', import.meta.url); const EXCEPTIONS = new URL('../docs/erp/PERMISSION_EXCEPTIONS.json', import.meta.url);
const sensitive = (key) => SENSITIVE_ACTIONS.includes(String(key).split('.').at(-1));
const holders = () => { const m = {}; for (const [role, perms] of Object.entries(TEMPLATE_PERMISSIONS)) for (const p of perms) if (sensitive(p)) (m[p] ??= []).push(role); for (const k of Object.keys(m)) m[k].sort(); return Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]])); };

const REVIEWS = new URL('../docs/erp/PERMISSION_REVIEWS.json', import.meta.url);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const reviews = () => (existsSync(REVIEWS) ? JSON.parse(readFileSync(REVIEWS, 'utf8')) : []);
const saveReviews = (list) => writeFileSync(REVIEWS, `${JSON.stringify(list, null, 1)}\n`);
const today = () => new Date().toISOString().slice(0, 10);
const fail = (message) => { console.error(message); process.exit(2); };
if (args.includes('--write-baseline')) {
  const maker = argOf('--maker'); const note = argOf('--note');
  if (!maker || !note || note.trim().length < 10) fail('A baseline change is a reviewed change: give --maker <your name> and --note "<what changed and why>" (at least 10 characters).');
  const text = `${JSON.stringify(holders(), null, 1)}\n`; writeFileSync(BASELINE, text);
  const list = reviews(); list.push({ sha256: sha(text), date: today(), maker, note: note.trim(), checker: null, checkerRole: null, checkedOn: null }); saveReviews(list);
  console.log(`Baseline written and recorded (${sha(text).slice(0, 12)}); it awaits its checker: node scripts/permission_audit.mjs --record-check --checker <name> --checker-role ITADM|DIR`); process.exit(0);
}
if (args.includes('--record-check')) {
  const checker = argOf('--checker'); const role = argOf('--checker-role'); const list = reviews(); const last = list.at(-1);
  if (!last) fail('There is no recorded baseline version to check.');
  if (!checker || !['ITADM', 'DIR'].includes(role)) fail('The checker is an IT administrator or a director: give --checker <name> --checker-role ITADM|DIR.');
  if (checker.trim().toLowerCase() === String(last.maker).trim().toLowerCase()) fail('The maker of a baseline version does not check it: somebody else signs it.');
  if (last.checker) fail(`The latest version was checked already by ${last.checker} on ${last.checkedOn}.`);
  if (sha(readFileSync(BASELINE, 'utf8')) !== last.sha256) fail('The baseline differs from its latest recorded version: record the change with --write-baseline first.');
  Object.assign(last, { checker: checker.trim(), checkerRole: role, checkedOn: today() }); saveReviews(list);
  console.log(`Baseline ${last.sha256.slice(0, 12)} checked by ${checker} (${role}).`); process.exit(0);
}

const exceptions = existsSync(EXCEPTIONS) ? JSON.parse(readFileSync(EXCEPTIONS, 'utf8')) : []; const approved = new Set(exceptions.map((e) => `${e.role}|${e.permission}`));
const findings = [];
// (3) the baseline is the version recorded in the review log, and that version was checked by somebody else (AUD-DEF-008)
const warnings = [];
{
  const text = existsSync(BASELINE) ? readFileSync(BASELINE, 'utf8') : ''; const last = reviews().at(-1);
  if (!last || last.sha256 !== sha(text)) findings.push({ kind: 'BASELINE_NOT_RECORDED', role: '-', permission: 'docs/erp/PERMISSION_BASELINE.json changed without a recorded review (use --write-baseline --maker --note)' });
  else if (!last.checker) warnings.push(`the baseline version of ${last.date} (maker ${last.maker}) awaits its checker (ITADM or DIR): --record-check`);
}
// (2) holders of sensitive permissions in the templates against the reviewed baseline
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
for (const [perm, roles] of Object.entries(holders())) for (const r of roles) if (!(baseline[perm] ?? []).includes(r) && !approved.has(`${r}|${perm}`)) findings.push({ kind: 'TEMPLATE_NOT_IN_BASELINE', role: r, permission: perm });
// (1) stored grants against the templates
const dbPath = argOf('--db') ?? process.env.DATABASE_PATH;
if (dbPath && existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare("SELECT r.code AS role, g.perm_key AS permission, g.source_type AS source FROM iam_role_permissions g JOIN iam_roles r ON r.id = g.role_id WHERE g.is_active = 1 AND g.effect = 'allow' AND r.is_active = 1").all();
  for (const x of rows) { const role = String(x.role); const permission = String(x.permission); const t = TEMPLATE_PERMISSIONS[role.toUpperCase()] ?? TEMPLATE_PERMISSIONS[role]; if (t && !t.includes(permission) && !approved.has(`${role}|${permission}`)) findings.push({ kind: 'STORED_NOT_IN_TEMPLATE', role, permission, source: String(x.source) }); }
}
if (args.includes('--json')) console.log(JSON.stringify(findings, null, 1));
for (const w of warnings) console.log(`WARNING  ${w}`);
if (args.includes('--json')) { /* printed above */ } else if (findings.length === 0) console.log(`Permission audit OK: ${Object.keys(holders()).length} sensitive permissions, every holder is in the baseline${dbPath ? ' and the stored grants match the templates' : ''}.`);
else { console.log(`Permission audit: ${findings.length} grant(s) to review`); for (const f of findings) console.log(`  ${f.kind}: ${f.role} -> ${f.permission}${f.source ? ` (${f.source})` : ''}`); }
process.exit(findings.length ? 1 : 0);
