// Part 166.1 F-03 / FR-02: lists every role -> permission grant that is neither in the role templates (src/server/platform/authz/templates.js)
// nor an approved exception (docs/erp/PERMISSION_EXCEPTIONS.json: [{ role, permission, approvedBy, reference }]).
//   node scripts/permission_audit.mjs [--db path/to/erp.db] [--json]
// Two checks: (1) the grants stored in a database (iam_role_permissions) against the templates, (2) every sensitive action
// (manage, configure, redrive, replay, issue ...) of the templates against docs/erp/PERMISSION_BASELINE.json, so a new holder of a *.manage permission is a reviewed change.
// Exit code 1 when something is found. `--write-baseline` rewrites the baseline from the templates (a reviewed change of the file).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SENSITIVE_ACTIONS, TEMPLATE_PERMISSIONS } from '../src/server/platform/authz/templates.js';

const args = process.argv.slice(2); const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BASELINE = new URL('../docs/erp/PERMISSION_BASELINE.json', import.meta.url); const EXCEPTIONS = new URL('../docs/erp/PERMISSION_EXCEPTIONS.json', import.meta.url);
const sensitive = (key) => SENSITIVE_ACTIONS.includes(String(key).split('.').at(-1));
const holders = () => { const m = {}; for (const [role, perms] of Object.entries(TEMPLATE_PERMISSIONS)) for (const p of perms) if (sensitive(p)) (m[p] ??= []).push(role); for (const k of Object.keys(m)) m[k].sort(); return Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]])); };

if (args.includes('--write-baseline')) { writeFileSync(BASELINE, `${JSON.stringify(holders(), null, 1)}\n`); console.log('Baseline written.'); process.exit(0); }

const exceptions = existsSync(EXCEPTIONS) ? JSON.parse(readFileSync(EXCEPTIONS, 'utf8')) : []; const approved = new Set(exceptions.map((e) => `${e.role}|${e.permission}`));
const findings = [];
// (2) holders of sensitive permissions in the templates against the reviewed baseline
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
for (const [perm, roles] of Object.entries(holders())) for (const r of roles) if (!(baseline[perm] ?? []).includes(r) && !approved.has(`${r}|${perm}`)) findings.push({ kind: 'TEMPLATE_NOT_IN_BASELINE', role: r, permission: perm });
// (1) stored grants against the templates
const dbPath = argOf('--db') ?? process.env.DATABASE_PATH;
if (dbPath && existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare("SELECT r.code AS role, g.perm_key AS permission, g.source_type AS source FROM iam_role_permissions g JOIN iam_roles r ON r.id = g.role_id WHERE g.is_active = 1 AND g.effect = 'allow' AND r.is_active = 1").all();
  for (const x of rows) { const t = TEMPLATE_PERMISSIONS[String(x.role).toUpperCase()] ?? TEMPLATE_PERMISSIONS[x.role]; if (t && !t.includes(x.permission) && !approved.has(`${x.role}|${x.permission}`)) findings.push({ kind: 'STORED_NOT_IN_TEMPLATE', role: x.role, permission: x.permission, source: x.source }); }
}
if (args.includes('--json')) console.log(JSON.stringify(findings, null, 1));
else if (findings.length === 0) console.log(`Permission audit OK: ${Object.keys(holders()).length} sensitive permissions, every holder is in the baseline${dbPath ? ' and the stored grants match the templates' : ''}.`);
else { console.log(`Permission audit: ${findings.length} grant(s) to review`); for (const f of findings) console.log(`  ${f.kind}: ${f.role} -> ${f.permission}${f.source ? ` (${f.source})` : ''}`); }
process.exit(findings.length ? 1 : 0);
