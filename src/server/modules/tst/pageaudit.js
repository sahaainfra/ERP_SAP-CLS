import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';
import { ROLE_TEMPLATES } from '../../platform/authz/templates.js';

/**
 * Part 30.03 — page-by-page completion audit and placeholder elimination.
 *
 * FR-01 the master list: every page the client registers (src/client/modules/<module>/index.js, the same list the E2E checks visit)
 *       joined with the navigation registry (ui_navigation_entries) and the migration tracker (ui_page_migration: pattern, owner);
 *       each page's status comes from its audits (tst_page_audit).
 * FR-02 automated checks: the static scan of the page's source (buttons without a handler, dead links, placeholder text, hard-coded
 *       business figures, data pages without their loading and error states, console output) and the route crawl (e2e/tst-page-crawl.spec.js:
 *       every registered route opened, console errors, failing API calls, sideways overflow at 360 px, blank pages), posted here.
 * FR-03 the manual exploratory test of a page by a role: the 13 points of the Page Completion Checklist, defects, evidence screenshots
 *       through the file service.
 * FR-04 a defect is fixed (proved by a passing audit) or rescheduled with the page owner's approval (the approval engine).
 * BR-01 go-live is blocked while a business page of the production navigation fails, has an open defect or was never checked.
 */
export const AUDIT_FLAG = 'ff.qa.p3003';
export const RESCHEDULE_TYPE = 'tst_defect_reschedule';
/** The Page Completion Checklist (05_GLOBAL_STANDARDS §9.3). */
export const CHECKLIST = Object.freeze([
  ['NAV', 'Reachable from navigation; breadcrumbs, page and browser title correct'],
  ['ACTIONS', 'Every button, link, tab, filter, sort and action works and is permission-aware'],
  ['REAL_DATA', 'All data from the real API and database; no hard-coded or sample values'],
  ['PERSIST', 'Create, edit, view, delete/cancel persist and survive a refresh'],
  ['VALIDATION', 'Inline validation matching the server; errors with correlation ID'],
  ['STATES', 'Loading, empty, error and no-permission states'],
  ['LISTS', 'Search, filter, sort, pagination and export honouring filters and masks'],
  ['APPROVALS', 'Approval panel, status, history and allowed actions only'],
  ['RESPONSIVE', 'No sideways scroll at 360, 768, 1280 and 1920 px; tables adapt'],
  ['A11Y', 'Keyboard, focus, labels, contrast; dark and high-contrast themes'],
  ['DESIGN', 'Design-system components and tokens only'],
  ['FORMATS', 'Indian numbers, ₹, DD-MMM-YYYY dates, units'],
  ['E2E', 'Covered by an end-to-end test of its main action'],
].map(([code, label]) => Object.freeze({ code, label })));
const RESULTS = ['PASS', 'FAIL', 'NA'];
/** The owner of each module's pages (approves a rescheduled defect) when the migration tracker names none. */
const OWNER = { core: 'SYSADM', iam: 'SYSADM', ui: 'SYSADM', eng: 'SYSADM', msg: 'SYSADM', pol: 'SYSADM', mdm: 'PROCMGR', fin: 'ACCMGR', hr: 'HRMGR', bd: 'BD', est: 'EST', proj: 'PD', engg: 'DESIGN', bud: 'PCMGR', plan: 'PCMGR', site: 'PM', proc: 'PROCMGR', inv: 'STOREMGR', plant: 'PLANTMGR', qa: 'QCMGR', hse: 'HSEE', rmc: 'PLANTMGR', ctr: 'COMMGR', bill: 'COMMGR', pay: 'HRMGR', portal: 'SYSADM', bi: 'PCMGR', ai: 'ITADM', admin: 'ITADM', tst: 'ITADM' };
const CLIENT_MODULES = ['core', 'iam', 'ui', 'eng', 'msg', 'pol', 'mdm', 'fin', 'hr', 'bd', 'est', 'proj', 'engg', 'bud', 'plan', 'site', 'proc', 'inv', 'plant', 'qa', 'hse', 'rmc', 'ctr', 'bill', 'pay', 'portal', 'bi', 'ai', 'admin', 'tst'];
export const pageCode = (route) => route.replace(/^\//, '').replace(/\//g, '.').replace(/:/g, '');
const iso = (d = new Date()) => d.toISOString();

integrityRegistry.register({ statuses: { tst_page_audit: ['PASS', 'FAIL'], tst_page_audit_runs: ['RUNNING', 'DONE', 'FAILED'] } });
for (const [type, description] of [
  ['tst.page_audit.recorded', 'A page audit was recorded (part 30.03): data { auditId, pageCode, kind, status, defects }.'],
  ['tst.page_audit.crawled', 'A route crawl or static scan of the pages finished (part 30.03): data { runId, kind, pages, failed }.'],
  ['tst.page_defect.rescheduled', 'A page defect was rescheduled with the owner\'s approval (part 30.03 FR-04): data { auditId, defect, targetPart }.'],
]) if (!eventTypes.get(type)) eventTypes.define({ type, version: 1, schema: { type: 'object' }, owner: 'tst', description });

// ---------------------------------------------------------------- the registered pages and the static scan of their source
/** Every page the client registers, with the file of its component (read from the module's lazy imports). */
export function registeredPages(root = process.cwd()) {
  const out = [];
  for (const module of CLIENT_MODULES) {
    const file = join(root, 'src', 'client', 'modules', module, 'index.js');
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    const lazy = new Map();
    for (const m of src.matchAll(/const (\w+) = lazyPage\(\(\) => import\('\.\/([^']+)'\)/g)) lazy.set(m[1], m[2]);
    for (const m of src.matchAll(/import (\w+) from '\.\/([^']+)'/g)) lazy.set(m[1], m[2]);
    for (const m of src.matchAll(/\{ path: '([^']+)', label: '([^']+)'([^}]*?)Page: (\w+)/g)) {
      const rest = m[3];
      out.push({ module, route: m[1], label: m[2], permission: /permission: '([^']+)'/.exec(rest)?.[1] ?? null, flag: /flag: '([^']+)'/.exec(rest)?.[1] ?? null,
        onboardingOnly: /onboardingOnly: true/.test(rest), component: m[4], file: lazy.has(m[4]) ? `src/client/modules/${module}/${lazy.get(m[4])}` : null });
    }
  }
  return out;
}

const RULES = [
  { code: 'BUTTON_NO_HANDLER', why: 'A button with type="button" and no handler does nothing', test: (tag) => /^<button\b/.test(tag) && /type="button"/.test(tag) && !/on(Click|PointerDown|MouseDown|KeyDown|DoubleClick)=|\{\.\.\.|role="tab"|aria-controls|data-dismiss|data-sample|form=/.test(tag) },
  { code: 'DEAD_LINK', why: 'A link that leads nowhere', test: (tag) => /^<(a|Link)\b/.test(tag) && /\b(href|to)=["'](#|)["']/.test(tag) && !/onClick=/.test(tag) },
];
const TEXT_RULES = [
  { code: 'PLACEHOLDER_TEXT', why: 'Placeholder or development text shown to users', re: />[^<{]*\b(coming\s+soon|lorem\s+ipsum|not\s+implemented|under\s+construction|dummy\s+data)\b[^<]*</i },
  { code: 'HARDCODED_FIGURES', why: 'Business figures typed into the component instead of read from the API', re: /\b(?:const|let)\s+\w+\s*=\s*\[\s*\{[^\]]{0,400}?\b(amount|value|total|revenue|cost|qty|count)\s*:\s*\d{3,}/i },
  { code: 'CONSOLE_OUTPUT', why: 'Console output left in the page', re: /\bconsole\.(log|debug)\(/ },
];
/** The whole JSX opening tag starting at `i` (braces, strings and arrows inside attributes do not end it). */
function tagAt(code, i) {
  let depth = 0; let quote = null;
  for (let j = i + 1; j < code.length && j < i + 4000; j += 1) {
    const ch = code[j];
    if (quote) { if (ch === quote && code[j - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { if (depth > 0 || ch === '"') quote = ch; continue; }
    if (ch === '{') depth += 1; else if (ch === '}') depth -= 1; else if (ch === '>' && depth === 0) return code.slice(i, j + 1);
  }
  return code.slice(i, i + 200);
}
/** FR-02 the static scan of one page's component file. */
export function scanFile(root, file) {
  if (!file) return { available: false, findings: [] };
  const path = join(root, file);
  if (!existsSync(path)) return { available: false, findings: [] };
  const src = readFileSync(path, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
  const lineOf = (i) => code.slice(0, i).split('\n').length;
  const findings = [];
  for (const m of code.matchAll(/<(button|a|Link)\b/g)) { const tag = tagAt(code, m.index); for (const r of RULES) if (r.test(tag)) findings.push({ rule: r.code, why: r.why, line: lineOf(m.index), excerpt: tag.replace(/\s+/g, ' ').slice(0, 120) }); }
  for (const r of TEXT_RULES) { const m = r.re.exec(code); if (m) findings.push({ rule: r.code, why: r.why, line: lineOf(m.index), excerpt: m[0].slice(0, 120) }); }
  // a data page (it queries the API) must show its loading and error states
  // the shared state components and helpers (QueryState, ListReport, ObjectPage, guardOf …) draw both states for the page
  const shared = /<QueryState\b|<ListReport\b|<ObjectPage\b|<DataPage\b|\bguardOf\(|\bgateOf\(|<Guard\b/.test(code);
  if (/useQuery\(/.test(code) && !shared && !/ErrorState|error-state|isError|\.error\b/.test(code)) findings.push({ rule: 'NO_ERROR_STATE', why: 'Loads data but shows no error state', line: lineOf(code.indexOf('useQuery(')), excerpt: 'useQuery without an error state' });
  if (/useQuery\(/.test(code) && !shared && !/Skeleton|isPending|isLoading|aria-busy|skeleton/.test(code)) findings.push({ rule: 'NO_LOADING_STATE', why: 'Loads data but shows no loading state', line: lineOf(code.indexOf('useQuery(')), excerpt: 'useQuery without a loading state' });
  return { available: true, findings };
}

/** @param {any} context @param {{ root?: string }} deps */
export function createPageAuditService(context, { root = process.cwd() } = {}) {
  const { db } = context;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, AUDIT_FLAG)) throw notFound('The page completion audit is not enabled for this company.');
    if (key) assertPermissionAnywhere(actor, key);
  };
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  let pagesCache = null;
  /** FR-01: the master list (client registry ∪ navigation registry), with pattern and owner from the migration tracker. */
  function inventory() {
    if (!pagesCache) pagesCache = registeredPages(root);
    const nav = has('ui_navigation_entries') ? db.prepare("SELECT code, route, label, permission_key, feature_flag, placement FROM ui_navigation_entries WHERE kind = 'page' AND route IS NOT NULL AND is_active = 1 AND deleted_at IS NULL").all() : [];
    const mig = has('ui_page_migration') ? new Map(db.prepare('SELECT new_route, page_type, owner_role, status FROM ui_page_migration WHERE deleted_at IS NULL').all().map((m) => [m.new_route, m])) : new Map();
    const byRoute = new Map();
    for (const p of pagesCache) byRoute.set(p.route, { ...p, inNav: false, navPlacement: null });
    for (const n of nav) {
      const r = n.route.split('?')[0];
      const cur = byRoute.get(r);
      if (cur) Object.assign(cur, { inNav: true, navPlacement: n.placement });
      else byRoute.set(r, { module: n.code.split('-')[0], route: r, label: n.label, permission: n.permission_key, flag: n.feature_flag, onboardingOnly: false, component: null, file: null, inNav: true, navPlacement: n.placement, navOnly: true });
    }
    return [...byRoute.values()].map((p) => { const m = mig.get(p.route); return { ...p, code: pageCode(p.route), pattern: m?.page_type ?? null, owner: m?.owner_role ?? OWNER[p.module] ?? 'SYSADM', registered: !p.navOnly }; }).sort((a, b) => a.module.localeCompare(b.module) || a.route.localeCompare(b.route));
  }
  const parseJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
  const auditView = (a, actor = null) => ({ id: a.id, pageCode: a.page_code, route: a.route, kind: a.audit_kind, viewport: a.viewport, roleTested: a.role_tested, status: a.status, checklist: parseJson(a.checklist_json, []), defects: parseJson(a.defects_json, []),
    evidence: parseJson(a.evidence_file_ids, []), notes: a.notes, testedBy: a.tested_by, testedAt: a.tested_at, runId: a.run_id, version: a.version,
    canReschedule: actor ? hasPermissionAnywhere(actor, 'tst.page_audit.record') : false });

  /** The latest audit of each page and kind (and viewport for the crawl). */
  function latest(companyId) {
    const rows = db.prepare(`SELECT a.* FROM tst_page_audit a JOIN (SELECT page_code, audit_kind, COALESCE(viewport, '') AS vp, MAX(id) AS id FROM tst_page_audit WHERE company_id = ? AND deleted_at IS NULL GROUP BY page_code, audit_kind, COALESCE(viewport, '')) l ON l.id = a.id`).all(companyId);
    const out = new Map();
    for (const a of rows) { const k = out.get(a.page_code) ?? []; k.push(a); out.set(a.page_code, k); }
    return out;
  }
  /** One page's status: FAIL if an automated check, a manual audit or an open defect says so; NOT_TESTED until crawled. */
  function statusOf(p, audits) {
    const crawl = audits.filter((a) => a.audit_kind === 'CRAWL');
    const stat = audits.find((a) => a.audit_kind === 'STATIC');
    const manual = audits.find((a) => a.audit_kind === 'MANUAL');
    const openDefects = audits.flatMap((a) => parseJson(a.defects_json, []).filter((d) => ['OPEN', 'RESCHEDULE_REQUESTED'].includes(d.status ?? 'OPEN')));
    const failed = crawl.some((a) => a.status === 'FAIL') || stat?.status === 'FAIL' || manual?.status === 'FAIL' || openDefects.length > 0;
    const status = failed ? 'FAIL' : crawl.length ? 'PASS' : 'NOT_TESTED';
    return { status, crawl: crawl.map((a) => ({ viewport: a.viewport, status: a.status, at: a.tested_at })), staticStatus: stat?.status ?? null, manualStatus: manual?.status ?? null, manualRole: manual?.role_tested ?? null, openDefects: openDefects.length,
      rescheduled: audits.flatMap((a) => parseJson(a.defects_json, []).filter((d) => d.status === 'RESCHEDULED')).length, lastTestedAt: audits.reduce((m, a) => (a.tested_at > m ? a.tested_at : m), '') || null };
  }
  function pages(actor, q = {}) {
    guard(actor, 'tst.page_audit.view');
    const inv = inventory();
    const last = latest(actor.companyId);
    const all = inv.map((p) => ({ code: p.code, route: p.route, label: p.label, module: p.module, pattern: p.pattern, owner: p.owner, inNav: p.inNav, registered: p.registered, file: p.file, permission: p.permission, flag: p.flag, ...statusOf(p, last.get(p.code) ?? []) }));
    const businessNav = all.filter((p) => p.inNav && !['core', 'iam', 'ui', 'eng', 'tst'].includes(p.module));
    const totals = { pages: all.length, passed: all.filter((p) => p.status === 'PASS').length, failed: all.filter((p) => p.status === 'FAIL').length, notTested: all.filter((p) => p.status === 'NOT_TESTED').length,
      manual: all.filter((p) => p.manualStatus).length, openDefects: all.reduce((n, p) => n + p.openDefects, 0), rescheduled: all.reduce((n, p) => n + p.rescheduled, 0),
      businessNav: businessNav.length, businessNavBlocking: businessNav.filter((p) => p.status !== 'PASS').length };
    const rows = all.filter((p) => (!q.module || p.module === q.module) && (!q.status || p.status === q.status) && (!q.q || `${p.route} ${p.label}`.toLowerCase().includes(String(q.q).toLowerCase())) && (!q.nav || p.inNav));
    const page = Math.max(1, q.page ?? 1); const size = Math.min(200, q.pageSize ?? 25);
    const byModule = new Map(); for (const p of all) { const m = byModule.get(p.module) ?? { module: p.module, pass: 0, fail: 0, notTested: 0 }; if (p.status === 'PASS') m.pass += 1; else if (p.status === 'FAIL') m.fail += 1; else m.notTested += 1; byModule.set(p.module, m); }
    const runs = db.prepare('SELECT * FROM tst_page_audit_runs WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 10').all(actor.companyId).map((r) => ({ id: r.id, runNo: r.run_no, kind: r.run_kind, status: r.status, viewport: r.viewport, pages: r.pages_count, failed: r.failed_count, startedAt: r.started_at, finishedAt: r.finished_at, by: r.requested_by }));
    return { totals, goLive: { blocked: totals.businessNavBlocking > 0, blocking: businessNav.filter((p) => p.status !== 'PASS').slice(0, 50).map((p) => ({ code: p.code, route: p.route, label: p.label, status: p.status })) },
      rows: rows.slice((page - 1) * size, page * size), total: rows.length, page, pageSize: size, byModule: [...byModule.values()].sort((a, b) => a.module.localeCompare(b.module)), modules: [...byModule.keys()].sort(), runs,
      checklist: CHECKLIST, roles: ROLE_TEMPLATES.map((r) => r.code).filter((c) => !/^X-/.test(c)), can: { record: hasPermissionAnywhere(actor, 'tst.page_audit.record'), run: hasPermissionAnywhere(actor, 'tst.page_audit.run'), export: hasPermissionAnywhere(actor, 'tst.page_audit.export') } };
  }
  function page(actor, code) {
    guard(actor, 'tst.page_audit.view');
    const p = inventory().find((x) => x.code === code);
    if (!p) throw notFound('That page is not in the page inventory.');
    const audits = db.prepare('SELECT * FROM tst_page_audit WHERE company_id = ? AND page_code = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50').all(actor.companyId, code);
    const last = latest(actor.companyId).get(code) ?? [];
    const mine = new Set(engine.awaiting(actor).map((x) => x.id));
    const requests = db.prepare("SELECT r.* FROM core_change_requests r WHERE r.company_id = ? AND r.type = ? AND r.target_type = 'tst_page_audit' AND r.target_id IN (SELECT CAST(id AS TEXT) FROM tst_page_audit WHERE company_id = ? AND page_code = ?) ORDER BY r.id DESC LIMIT 20").all(actor.companyId, RESCHEDULE_TYPE, actor.companyId, code)
      .map((r) => ({ id: r.id, status: r.status, reason: r.reason, payload: parseJson(r.payload_json, {}), requestedBy: r.requested_by, canDecide: mine.has(r.id) }));
    return { page: { ...p, ...statusOf(p, last) }, audits: audits.map((a) => auditView(a, actor)), requests, checklist: CHECKLIST, scan: scanFile(root, p.file) };
  }

  // ---------------------------------------------------------------- FR-03: a manual audit by a role, with defects and evidence
  function record(actor, b) {
    guard(actor, 'tst.page_audit.record');
    const p = inventory().find((x) => x.code === b.pageCode);
    if (!p) throw badRequest('Choose a page of the inventory.', [{ field: 'pageCode', message: 'Not a page of the inventory' }]);
    const codes = new Set(CHECKLIST.map((c) => c.code));
    const problems = [];
    for (const [i, c] of b.checklist.entries()) { if (!codes.has(c.code)) problems.push({ field: `checklist.${i}.code`, message: 'Not a checklist point' }); if (!RESULTS.includes(c.result)) problems.push({ field: `checklist.${i}.result`, message: 'Pass, fail or not applicable' }); if (c.result === 'FAIL' && !c.note) problems.push({ field: `checklist.${i}.note`, message: 'Say what fails' }); }
    for (const c of codes) if (!b.checklist.some((x) => x.code === c)) problems.push({ field: 'checklist', message: `Answer every point (${c} is missing)` });
    if (problems.length) throw badRequest('The audit is not complete.', problems);
    const defects = (b.defects ?? []).map((d, i) => ({ no: i + 1, title: d.title, severity: d.severity, checklist: d.checklist ?? null, status: 'OPEN' }));
    if (b.checklist.some((c) => c.result === 'FAIL') && !defects.length) throw badRequest('A failed point needs a defect.', [{ field: 'defects', message: 'Record the defect behind each failed point' }]);
    const status = defects.length || b.checklist.some((c) => c.result === 'FAIL') ? 'FAIL' : 'PASS';
    return transaction(db, () => {
      const id = Number(db.prepare("INSERT INTO tst_page_audit (company_id, page_code, route, audit_kind, role_tested, checklist_json, defects_json, status, notes, tested_by, tested_at, evidence_file_ids, created_by, source_type) VALUES (?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'manual')")
        .run(actor.companyId, p.code, p.route, b.roleTested, JSON.stringify(b.checklist), JSON.stringify(defects), status, b.notes ?? null, actor.user, iso(), actor.user).lastInsertRowid);
      writeAudit(db, { companyId: actor.companyId, entity: 'tst_page_audit', entityId: id, action: 'create', newValues: { pageCode: p.code, roleTested: b.roleTested, status, defects: defects.length }, actor: actor.user });
      publishEvent(db, { type: 'tst.page_audit.recorded', entity: 'tst_page_audit', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { auditId: id, pageCode: p.code, kind: 'MANUAL', status, defects: defects.length } });
      return auditView(db.prepare('SELECT * FROM tst_page_audit WHERE id = ?').get(id), actor);
    });
  }
  const auditRow = (actor, id) => { const a = db.prepare('SELECT * FROM tst_page_audit WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!a) throw notFound('That audit does not exist.'); return a; };
  function addEvidence(actor, id, { fileId }) {
    guard(actor, 'tst.page_audit.record');
    const a = auditRow(actor, id);
    if (a.audit_kind !== 'MANUAL') throw unprocessable('Evidence is added to a manual audit.');
    if (a.tested_by !== actor.user) throw forbidden('Only the tester adds evidence to their audit.');
    const f = db.prepare("SELECT id FROM core_files WHERE id = ? AND linked_entity = 'tst_page_audit' AND linked_id = ? AND deleted_at IS NULL").get(fileId, a.id);
    if (!f) throw badRequest('Upload the screenshot to this audit first.', [{ field: 'fileId', message: 'Not a file of this audit' }]);
    const list = [...new Set([...parseJson(a.evidence_file_ids, []), fileId])];
    db.prepare('UPDATE tst_page_audit SET evidence_file_ids = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(list), actor.user, iso(), a.id);
    writeAudit(db, { companyId: actor.companyId, entity: 'tst_page_audit', entityId: a.id, action: 'evidence', newValues: { fileId }, actor: actor.user });
    return auditView(db.prepare('SELECT * FROM tst_page_audit WHERE id = ?').get(a.id), actor);
  }
  /** A defect proved fixed by the commit and test named; the page is audited again to show it. */
  function fixDefect(actor, id, no, { fixRef }) {
    guard(actor, 'tst.page_audit.record');
    const a = auditRow(actor, id);
    const defects = parseJson(a.defects_json, []);
    const d = defects.find((x) => x.no === no); if (!d) throw notFound('That defect does not exist.');
    if (d.status !== 'OPEN') throw conflict(`The defect is ${String(d.status).toLowerCase().replace('_', ' ')}.`);
    Object.assign(d, { status: 'FIXED', fixRef, fixedBy: actor.user, fixedAt: iso() });
    db.prepare('UPDATE tst_page_audit SET defects_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(defects), actor.user, iso(), a.id);
    writeAudit(db, { companyId: actor.companyId, entity: 'tst_page_audit', entityId: a.id, action: 'defect_fixed', newValues: { defect: no, fixRef }, actor: actor.user });
    return auditView(db.prepare('SELECT * FROM tst_page_audit WHERE id = ?').get(a.id), actor);
  }

  // ---------------------------------------------------------------- FR-04: rescheduling a defect needs the page owner's approval
  const engine = createApprovalEngine({ db, handlers: { [RESCHEDULE_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, actor) {
      const a = db.prepare('SELECT * FROM tst_page_audit WHERE id = ?').get(Number(request.targetId));
      const defects = parseJson(a.defects_json, []);
      const d = defects.find((x) => x.no === request.payload.defect);
      Object.assign(d, { status: 'RESCHEDULED', targetPart: request.payload.targetPart, approvedBy: actor.user, approvedAt: iso() });
      db.prepare('UPDATE tst_page_audit SET defects_json = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(defects), iso(), a.id);
      publishEvent(db, { type: 'tst.page_defect.rescheduled', entity: 'tst_page_audit', entityId: a.id, actorId: actor.user, companyId: a.company_id, data: { auditId: a.id, defect: d.no, targetPart: request.payload.targetPart } });
    },
  } } });
  function requestReschedule(actor, id, no, { targetPart, reason }) {
    guard(actor, 'tst.page_audit.record');
    const a = auditRow(actor, id);
    const defects = parseJson(a.defects_json, []);
    const d = defects.find((x) => x.no === no); if (!d) throw notFound('That defect does not exist.');
    if (d.status !== 'OPEN') throw conflict('Only an open defect is rescheduled.');
    const p = inventory().find((x) => x.code === a.page_code);
    // self-service pages (owner EMP) are approved by HR; an owner is never the person asking (the approval engine refuses that)
    const owner = p?.owner === 'EMP' ? 'HRMGR' : p?.owner ?? 'SYSADM';
    return transaction(db, () => {
      const req = engine.submit(actor, { type: RESCHEDULE_TYPE, title: `Reschedule defect ${no} of ${a.route} to part ${targetPart}`, targetType: 'tst_page_audit', targetId: String(a.id), payload: { defect: no, targetPart, pageCode: a.page_code }, reason, chain: [owner] });
      Object.assign(d, { status: 'RESCHEDULE_REQUESTED', targetPart, requestId: req.id });
      db.prepare('UPDATE tst_page_audit SET defects_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(defects), actor.user, iso(), a.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'tst_page_audit', entityId: a.id, action: 'reschedule_request', newValues: { defect: no, targetPart, owner }, reason, actor: actor.user });
      return { request: { id: req.id, status: req.status, chain: [owner] }, audit: auditView(db.prepare('SELECT * FROM tst_page_audit WHERE id = ?').get(a.id), actor) };
    });
  }
  function decideReschedule(actor, requestId, body) {
    guard(actor, 'tst.page_audit.view');
    const r = db.prepare('SELECT * FROM core_change_requests WHERE id = ? AND company_id = ? AND type = ?').get(Number(requestId), actor.companyId, RESCHEDULE_TYPE);
    if (!r) throw notFound('That request does not exist.');
    const out = engine.act(actor, r.id, body);
    if (out.status === 'REJECTED' || out.status === 'RETURNED') {
      const a = db.prepare('SELECT * FROM tst_page_audit WHERE id = ?').get(Number(r.target_id));
      const defects = parseJson(a.defects_json, []); const d = defects.find((x) => x.requestId === r.id);
      if (d) { Object.assign(d, { status: 'OPEN', rescheduleRefused: body.comment ?? null }); db.prepare('UPDATE tst_page_audit SET defects_json = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(defects), iso(), a.id); }
    }
    return { id: out.id, status: out.status };
  }

  // ---------------------------------------------------------------- FR-02: the static scan (run here) and the crawl (posted by the crawler)
  function newRun(actor, kind, viewport = null) {
    const no = `PGA-${String((db.prepare('SELECT COUNT(*) AS n FROM tst_page_audit_runs WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1).padStart(6, '0')}`;
    return Number(db.prepare("INSERT INTO tst_page_audit_runs (company_id, run_no, run_kind, status, viewport, started_at, requested_by, created_by, source_type) VALUES (?, ?, ?, 'RUNNING', ?, ?, ?, ?, 'run')").run(actor.companyId, no, kind, viewport, iso(), actor.user, actor.user).lastInsertRowid);
  }
  function finishRun(actor, runId, kind, pagesCount, failed) {
    db.prepare("UPDATE tst_page_audit_runs SET status = 'DONE', finished_at = ?, pages_count = ?, failed_count = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), pagesCount, failed, iso(), runId);
    writeAudit(db, { companyId: actor.companyId, entity: 'tst_page_audit_runs', entityId: runId, action: kind.toLowerCase(), newValues: { pages: pagesCount, failed }, actor: actor.user });
    publishEvent(db, { type: 'tst.page_audit.crawled', entity: 'tst_page_audit_runs', entityId: runId, actorId: actor.user, companyId: actor.companyId, data: { runId, kind, pages: pagesCount, failed } });
    const r = db.prepare('SELECT * FROM tst_page_audit_runs WHERE id = ?').get(runId);
    return { id: r.id, runNo: r.run_no, kind: r.run_kind, status: r.status, viewport: r.viewport, pages: r.pages_count, failed: r.failed_count };
  }
  const insertAudit = db.prepare("INSERT INTO tst_page_audit (company_id, page_code, route, audit_kind, viewport, role_tested, checklist_json, defects_json, status, tested_by, tested_at, run_id, evidence_file_ids, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'tst_page_audit_runs', ?)");
  function staticScan(actor) {
    guard(actor, 'tst.page_audit.run');
    const inv = inventory().filter((p) => p.file);
    return transaction(db, () => {
      const runId = newRun(actor, 'STATIC');
      let failed = 0;
      const seen = new Map();
      for (const p of inv) {
        if (!seen.has(p.file)) seen.set(p.file, scanFile(root, p.file));
        const s = seen.get(p.file);
        const defects = s.findings.map((f, i) => ({ no: i + 1, title: `${f.why} (${p.file}:${f.line})`, rule: f.rule, severity: ['BUTTON_NO_HANDLER', 'DEAD_LINK', 'PLACEHOLDER_TEXT', 'HARDCODED_FIGURES'].includes(f.rule) ? 'MAJOR' : 'MINOR', excerpt: f.excerpt, status: 'OPEN' }));
        const status = defects.length ? 'FAIL' : 'PASS'; if (defects.length) failed += 1;
        const checklist = [{ code: 'ACTIONS', result: defects.some((d) => ['BUTTON_NO_HANDLER', 'DEAD_LINK'].includes(d.rule)) ? 'FAIL' : 'PASS' }, { code: 'REAL_DATA', result: defects.some((d) => ['HARDCODED_FIGURES', 'PLACEHOLDER_TEXT'].includes(d.rule)) ? 'FAIL' : 'PASS' }, { code: 'STATES', result: defects.some((d) => d.rule.startsWith('NO_')) ? 'FAIL' : 'PASS' }];
        insertAudit.run(actor.companyId, p.code, p.route, 'STATIC', null, 'STATIC', JSON.stringify(checklist), JSON.stringify(defects), status, actor.user, iso(), runId, actor.user, String(runId));
      }
      return finishRun(actor, runId, 'STATIC', inv.length, failed);
    });
  }
  /** T-01: the crawler posts what it saw on each route; a route not registered is refused, a registered route not posted is reported. */
  function crawl(actor, { viewport, role, results, runId = null, final = true }) {
    guard(actor, 'tst.page_audit.run');
    const inv = inventory();
    const byRoute = new Map(inv.map((p) => [p.route, p]));
    const unknown = results.filter((r) => !byRoute.has(r.route)).map((r) => r.route);
    if (unknown.length) throw badRequest('Some routes are not registered pages.', unknown.slice(0, 20).map((r) => ({ field: 'results', message: r })));
    return transaction(db, () => {
      let run = runId;
      if (run) {
        const cur = db.prepare("SELECT * FROM tst_page_audit_runs WHERE id = ? AND company_id = ? AND run_kind = 'CRAWL'").get(run, actor.companyId);
        if (!cur) throw notFound('That crawl does not exist.');
        if (cur.status !== 'RUNNING') throw conflict('That crawl is finished; start a new one.');
        if (cur.viewport !== viewport) throw badRequest('The batch is for another viewport.', [{ field: 'viewport', message: `The crawl is ${cur.viewport}` }]);
      } else run = newRun(actor, 'CRAWL', viewport);
      for (const r of results) {
        const p = byRoute.get(r.route);
        const defects = [];
        for (const e of r.consoleErrors ?? []) defects.push({ title: `Console error: ${String(e).slice(0, 200)}`, rule: 'CONSOLE_ERROR', severity: 'MAJOR' });
        for (const e of r.failedRequests ?? []) defects.push({ title: `API call failed: ${String(e).slice(0, 200)}`, rule: 'ROUTE_ERROR', severity: 'MAJOR' });
        if ((r.overflowPx ?? 0) > 0 && viewport === 'mobile') defects.push({ title: `Scrolls sideways by ${r.overflowPx} px at 360 px`, rule: 'OVERFLOW', severity: 'MAJOR' });
        if (r.state === 'blank') defects.push({ title: 'The page showed nothing (no heading, state or content)', rule: 'BLANK', severity: 'CRITICAL' });
        if (r.a11y?.length) for (const v of r.a11y) defects.push({ title: `Accessibility: ${String(v).slice(0, 200)}`, rule: 'A11Y', severity: 'MINOR' });
        const numbered = defects.map((d, i) => ({ no: i + 1, ...d, status: 'OPEN' }));
        const status = numbered.length ? 'FAIL' : 'PASS';
        const checklist = [{ code: 'NAV', result: r.state === 'blank' ? 'FAIL' : 'PASS' }, { code: 'RESPONSIVE', result: (r.overflowPx ?? 0) > 0 && viewport === 'mobile' ? 'FAIL' : 'PASS' }, { code: 'VALIDATION', result: (r.failedRequests ?? []).length ? 'FAIL' : 'PASS' }, { code: 'STATES', result: r.state === 'blank' ? 'FAIL' : 'PASS', state: r.state ?? null, loadMs: r.loadMs ?? null }, { code: 'A11Y', result: r.a11y?.length ? 'FAIL' : 'PASS' }];
        insertAudit.run(actor.companyId, p.code, p.route, 'CRAWL', viewport, role ?? 'SYSADM', JSON.stringify(checklist), JSON.stringify(numbered), status, actor.user, iso(), run, actor.user, String(run));
      }
      const counts = db.prepare("SELECT COUNT(DISTINCT route) AS n, COUNT(DISTINCT CASE WHEN status = 'FAIL' THEN route END) AS f FROM tst_page_audit WHERE run_id = ? AND audit_kind = 'CRAWL'").get(run);
      if (!final) { db.prepare('UPDATE tst_page_audit_runs SET pages_count = ?, failed_count = ?, updated_at = ? WHERE id = ?').run(counts.n, counts.f, iso(), run); return { id: run, status: 'RUNNING', pages: counts.n, failed: counts.f }; }
      const posted = new Set(db.prepare("SELECT DISTINCT route FROM tst_page_audit WHERE run_id = ? AND audit_kind = 'CRAWL'").all(run).map((x) => x.route));
      const required = inv.filter((p) => p.registered && !p.onboardingOnly);
      const missing = required.filter((p) => !posted.has(p.route)).map((p) => p.route);
      const done = finishRun(actor, run, 'CRAWL', counts.n, counts.f);
      return { ...done, coverage: { registered: required.length, crawled: required.length - missing.length, pct: required.length ? Math.floor(((required.length - missing.length) / required.length) * 1000) / 10 : 100, missing: missing.slice(0, 50), missingCount: missing.length } };
    });
  }

  function exportPages(actor, q, format) {
    guard(actor, 'tst.page_audit.export');
    const all = pages(actor, { ...q, page: 1, pageSize: 200 });
    const rows = pages(actor, { ...q, page: 1, pageSize: 100000 }).rows.map((p) => ({ route: p.route, label: p.label, module: p.module, owner: p.owner, nav: p.inNav ? 'yes' : 'no', crawl: p.crawl.map((c) => `${c.viewport}:${c.status}`).join(' '), static: p.staticStatus ?? '', manual: p.manualStatus ? `${p.manualStatus} (${p.manualRole})` : '', defects: p.openDefects, status: p.status }));
    const columns = [['route', 'Route'], ['label', 'Page'], ['module', 'Module'], ['owner', 'Owner'], ['nav', 'In navigation'], ['crawl', 'Crawl'], ['static', 'Static scan'], ['manual', 'Manual audit'], ['defects', 'Open defects'], ['status', 'Status']].map(([key, label]) => ({ key, label }));
    const t = all.totals;
    const buffer = writeExport(format, { columns, rows, title: 'Page completion audit', sheetName: 'Pages', footer: [`${t.pages} pages · ${t.passed} pass · ${t.failed} fail · ${t.notTested} not tested · open defects ${t.openDefects} · go-live ${all.goLive.blocked ? 'blocked' : 'clear'}`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'tst.page_audit', action: 'export', newValues: { format, rows: rows.length }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `page-completion-audit.${format}` };
  }

  return { inventory, pages, page, record, addEvidence, fixDefect, requestReschedule, decideReschedule, staticScan, crawl, exportPages, engine };
}

if (!fileEntities.get('tst_page_audit')) {
  fileEntities.register({ entity: 'tst_page_audit', label: 'Page audit evidence', resolve(db, actor, id) {
    const a = db.prepare('SELECT company_id, tested_by FROM tst_page_audit WHERE id = ? AND deleted_at IS NULL').get(Number(id));
    if (!a || a.company_id !== actor.companyId) return null;
    return { companyId: a.company_id, projectId: null, siteId: null, canView: hasPermissionAnywhere(actor, 'tst.page_audit.view'), canEdit: a.tested_by === actor.user && hasPermissionAnywhere(actor, 'tst.page_audit.record'), locked: false };
  } });
}
