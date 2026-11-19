import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { computeBreakup, evalFormula, formulaProblems, monthFactor, r2 } from './engine.js';

// Part 24.01: payroll set-up — pay components and their formulas, salary structures with the CTC breakup, statutory parameters by date and state (PAY -> CFO),
// the payroll calendar, and the pay assignment of an employee from a date (HRMGR -> CFO, the director for a senior grade). An approved assignment sets the
// employee's monthly pay (hr_employee_pay, through the statutory service of 166.8) and, when retro-dated, the arrears that the next payroll run pays (BR-01).

export const ASSIGNMENT_DOC = 'PAY_ASSIGNMENT';
export const STATUTORY_DOC = 'PAY_STATUTORY';
const paise = (v) => Math.round(Number(v) * 100);
const rs = (p) => (p == null ? null : p / 100);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const addMonths = (p, n) => { const [y, m] = p.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
export const PARAM_CODES = ['PF', 'ESI', 'PT', 'LWF', 'GRATUITY', 'BONUS', 'TDS_NEW', 'TDS_OLD', 'OT', 'MIN_WAGE'];
const FIXED_NAMES = ['CTC_MONTHLY', 'CTC_ANNUAL', 'PF_CEILING', 'ESI_CEILING'];

export const assignmentList = defineList({
  code: 'pay.assignments', label: 'Pay assignments', permission: 'pay.assignment.view', from: 'pay_assignments x JOIN hr_employees e ON e.id = x.employee_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'e.full_name', 'e.emp_code'], defaultSort: '-effectiveFrom',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Assignment' }, employee: { sql: 'e.full_name', type: 'text', label: 'Employee' }, empCode: { sql: 'e.emp_code', type: 'text', label: 'Code' }, kind: { sql: 'x.assignment_kind', type: 'enum', label: 'Kind', options: [['NEW', 'NEW'], ['REVISION', 'REVISION'], ['PROMOTION', 'PROMOTION'], ['CORRECTION', 'CORRECTION']] }, effectiveFrom: { sql: 'x.effective_from', type: 'date', label: 'From' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS), filter: 'eq' }, employeeId: { sql: 'x.employee_id', type: 'number', label: 'Employee id', filter: 'eq' } },
});

/** @param {{ db: any, base: any, flags: any, statutory: any }} o */
export function createPaySetupService({ db, base, flags, statutory }) {
  const { may, audit, notify } = base;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.pay.p2401');
  const evt = (type, actor, companyId, entity, entityId, data) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, data });
  const rolesOf = (companyId, user) => { try { return JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user)?.roles_json ?? '[]').flat(); } catch { return []; } };
  const seesPay = (actor) => may(actor, 'pay.salary.view');
  const mask = (actor, v) => (seesPay(actor) ? v : null);

  // ---- FR-06: statutory parameters by date and state ----
  /** The parameters of a code in force on a date for a state ('ALL' when none is given): the latest start first, a company's own row before the system row. */
  function paramsAt(companyId, code, state, date) {
    const r = db.prepare("SELECT params_json FROM pay_statutory_params WHERE code = ? AND (company_id = ? OR company_id IS NULL) AND status = 'APPROVED' AND deleted_at IS NULL AND state_code IN (?, 'ALL') AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY effective_from DESC, state_code = 'ALL', company_id IS NULL LIMIT 1").get(code, companyId, state ?? 'ALL', date, date);
    return r ? JSON.parse(r.params_json) : null;
  }
  const wageRuleAt = (companyId, date) => Boolean(db.prepare("SELECT 1 FROM mdm_labour_rules WHERE state_code = 'CENTRAL' AND code_kind = 'WAGES' AND (company_id = ? OR company_id IS NULL) AND row_status = 'ACTIVE' AND deleted_at IS NULL AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)").get(companyId, date, date));
  /** What an employee's payroll needs on a date: the statutory parameters for the employee's PT and LWF states, the flags, the Code-on-Wages rule. */
  function contextOf(companyId, employeeId, date) {
    const e = db.prepare('SELECT e.*, s.pf_applicable, s.esi_applicable, s.pt_state, s.lwf_state FROM hr_employees e LEFT JOIN hr_employee_statutory s ON s.employee_id = e.id AND s.deleted_at IS NULL WHERE e.id = ? AND e.company_id = ?').get(Number(employeeId), companyId);
    if (!e) return null;
    const params = { PF: paramsAt(companyId, 'PF', null, date), ESI: paramsAt(companyId, 'ESI', null, date), PT: e.pt_state ? paramsAt(companyId, 'PT', e.pt_state, date) : null, LWF: e.lwf_state ? paramsAt(companyId, 'LWF', e.lwf_state, date) : null, GRATUITY: paramsAt(companyId, 'GRATUITY', null, date) };
    return { employee: e, params, flags: { pf: Boolean(e.pf_applicable), esi: Boolean(e.esi_applicable), ptState: e.pt_state, lwfState: e.lwf_state, gender: e.gender }, wageRule: wageRuleAt(companyId, date) };
  }

  // ---- FR-01/FR-02: components ----
  function ensure(companyId) {
    if (db.prepare('SELECT 1 FROM pay_components WHERE company_id = ? LIMIT 1').get(companyId)) return;
    db.prepare("INSERT INTO pay_components (company_id, code, name, comp_type, calc_method, formula, percent_bp, base_codes_json, statutory_code, taxable, pf_applicable, esi_applicable, pt_applicable, wage_class, prorate, sequence, gl_account_code, created_by, source_type, source_id) SELECT ?, code, name, comp_type, calc_method, formula, percent_bp, base_codes_json, statutory_code, taxable, pf_applicable, esi_applicable, pt_applicable, wage_class, prorate, sequence, gl_account_code, 'system', 'pay_template', CAST(id AS TEXT) FROM pay_components WHERE company_id IS NULL AND deleted_at IS NULL").run(companyId);
  }
  const compView = (r) => ({ id: r.id, code: r.code, name: r.name, type: r.comp_type, method: r.calc_method, formula: r.formula, percent: r.percent_bp == null ? null : r.percent_bp / 100, baseCodes: JSON.parse(r.base_codes_json || '[]'), statutoryCode: r.statutory_code, taxable: Boolean(r.taxable), pf: Boolean(r.pf_applicable), esi: Boolean(r.esi_applicable), pt: Boolean(r.pt_applicable), wageClass: r.wage_class, prorate: Boolean(r.prorate), sequence: r.sequence, glAccountCode: r.gl_account_code, status: r.comp_status, version: r.version });
  const compRows = (companyId) => { ensure(companyId); return db.prepare("SELECT * FROM pay_components WHERE company_id = ? AND deleted_at IS NULL ORDER BY sequence, code").all(companyId); };
  const engineComp = (r) => ({ ...r, base_codes: JSON.parse(r.base_codes_json || '[]') });
  const components = {
    list(actor) { need(actor, 'pay.component.view', 'see pay components'); return { components: compRows(actor.companyId).map(compView), names: FIXED_NAMES, canConfigure: may(actor, 'pay.component.configure') }; },
    save(actor, b) {
      need(actor, 'pay.component.configure', 'configure pay components'); const c = actor.companyId; const rows = compRows(c); const ex = b.id ? rows.find((x) => x.id === Number(b.id)) : rows.find((x) => x.code === b.code);
      if (b.id && !ex) throw notFound('That component does not exist.'); if (!b.id && ex) throw conflict(`${b.code} already exists; change it instead.`);
      if (ex && b.version != null && b.version !== ex.version) throw conflict('Someone changed this component: reload it.');
      const code = ex?.code ?? b.code; const seq = b.sequence ?? ex?.sequence ?? 100; const method = b.method ?? ex?.calc_method; const problems = [];
      const earlier = rows.filter((x) => x.code !== code && ['EARNING', 'REIMBURSEMENT'].includes(x.comp_type) && x.sequence < seq && x.calc_method !== 'BALANCE').map((x) => x.code);
      if (method === 'FORMULA') { const f = b.formula ?? ex?.formula; if (!f) problems.push({ field: 'formula', message: 'Write the formula.' }); else for (const m of formulaProblems(code, f, [...FIXED_NAMES, ...earlier])) problems.push({ field: 'formula', message: `${m} (it may use ${[...FIXED_NAMES, ...earlier].join(', ')})` }); }
      if (method === 'PERCENT') { const bases = b.baseCodes ?? JSON.parse(ex?.base_codes_json ?? '[]'); if (!bases.length) problems.push({ field: 'baseCodes', message: 'Name the components the percentage is of.' }); for (const x of bases) if (!earlier.includes(x)) problems.push({ field: 'baseCodes', message: `${x} is not an earning computed before this one.` }); if (!(b.percent ?? (ex?.percent_bp ?? 0) / 100)) problems.push({ field: 'percent', message: 'Give the percentage.' }); }
      if (method === 'BALANCE' && rows.some((x) => x.calc_method === 'BALANCE' && x.code !== code && x.comp_status === 'ACTIVE')) problems.push({ field: 'method', message: 'Only one component takes the balance of the CTC.' });
      if (method === 'STATUTORY' && !(b.statutoryCode ?? ex?.statutory_code)) problems.push({ field: 'statutoryCode', message: 'Choose what the law computes.' });
      if (problems.length) throw badRequest('Correct the highlighted fields', problems);
      const v = { name: b.name ?? ex?.name, comp_type: b.type ?? ex?.comp_type, calc_method: method, formula: method === 'FORMULA' ? b.formula ?? ex?.formula : null, percent_bp: method === 'PERCENT' ? Math.round((b.percent ?? ex.percent_bp / 100) * 100) : null, base_codes_json: JSON.stringify(method === 'PERCENT' ? b.baseCodes ?? JSON.parse(ex?.base_codes_json ?? '[]') : []), statutory_code: method === 'STATUTORY' ? b.statutoryCode ?? ex?.statutory_code : null,
        taxable: (b.taxable ?? Boolean(ex?.taxable ?? 1)) ? 1 : 0, pf_applicable: (b.pf ?? Boolean(ex?.pf_applicable)) ? 1 : 0, esi_applicable: (b.esi ?? Boolean(ex?.esi_applicable)) ? 1 : 0, pt_applicable: (b.pt ?? Boolean(ex?.pt_applicable)) ? 1 : 0, wage_class: b.wageClass ?? ex?.wage_class ?? 'WAGES', prorate: (b.prorate ?? Boolean(ex?.prorate ?? 1)) ? 1 : 0, sequence: seq, gl_account_code: b.glAccountCode ?? ex?.gl_account_code ?? null, comp_status: b.status ?? ex?.comp_status ?? 'ACTIVE' };
      if (ex) { db.prepare('UPDATE pay_components SET name = ?, comp_type = ?, calc_method = ?, formula = ?, percent_bp = ?, base_codes_json = ?, statutory_code = ?, taxable = ?, pf_applicable = ?, esi_applicable = ?, pt_applicable = ?, wage_class = ?, prorate = ?, sequence = ?, gl_account_code = ?, comp_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(v.name, v.comp_type, v.calc_method, v.formula, v.percent_bp, v.base_codes_json, v.statutory_code, v.taxable, v.pf_applicable, v.esi_applicable, v.pt_applicable, v.wage_class, v.prorate, v.sequence, v.gl_account_code, v.comp_status, actor.user, nowIso(), ex.id);
        audit(actor, 'pay_components', ex.id, 'update', c, { oldValues: compView(ex), newValues: v }); }
      else { const id = Number(db.prepare("INSERT INTO pay_components (company_id, code, name, comp_type, calc_method, formula, percent_bp, base_codes_json, statutory_code, taxable, pf_applicable, esi_applicable, pt_applicable, wage_class, prorate, sequence, gl_account_code, comp_status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c, code, v.name, v.comp_type, v.calc_method, v.formula, v.percent_bp, v.base_codes_json, v.statutory_code, v.taxable, v.pf_applicable, v.esi_applicable, v.pt_applicable, v.wage_class, v.prorate, v.sequence, v.gl_account_code, v.comp_status, actor.user).lastInsertRowid); audit(actor, 'pay_components', id, 'create', c, { newValues: { code, ...v } }); }
      return components.list(actor);
    },
    /** The formula builder's check: the formula run on sample values, with its steps. */
    test(actor, { code, formula, values }) { need(actor, 'pay.component.view', 'test formulas'); const names = [...FIXED_NAMES, ...Object.keys(values ?? {})]; const p = formulaProblems(code, formula, names); if (p.length) return { ok: false, problems: p };
      const r = evalFormula(code, formula, { CTC_MONTHLY: 0, CTC_ANNUAL: 0, PF_CEILING: 15000, ESI_CEILING: 21000, ...(values ?? {}) }); return { ok: true, amount: r.amount, steps: r.trace }; },
  };

  // ---- FR-03: structures ----
  const structRow = (actor, id) => { const r = db.prepare('SELECT * FROM pay_structures WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) throw notFound('That salary structure does not exist.'); return r; };
  /** The engine's components of a structure: its lines with the company's definitions (and the statutory ones always). */
  function structComps(companyId, s) {
    const all = compRows(companyId).filter((x) => x.comp_status === 'ACTIVE'); const lines = JSON.parse(s.components_json || '[]'); const codes = new Set(lines.map((l) => l.code));
    return { comps: all.filter((x) => codes.has(x.code)).map(engineComp), values: Object.fromEntries(lines.filter((l) => l.value != null).map((l) => [l.code, Number(l.value)])) };
  }
  const structView = (actor, r, detail = false) => { const o = { id: r.id, code: r.code, name: r.name, grade: r.grade, senior: Boolean(r.senior), versionNo: r.version_no, status: r.structure_status, components: JSON.parse(r.components_json || '[]'), version: r.version };
    if (detail) { o.assignments = db.prepare("SELECT COUNT(*) AS n FROM pay_assignments WHERE structure_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND effective_to IS NULL").get(r.id).n; o.versions = db.prepare('SELECT id, version_no, structure_status, created_at FROM pay_structures WHERE company_id = ? AND code = ? AND deleted_at IS NULL ORDER BY version_no DESC').all(r.company_id, r.code).map((v) => ({ id: v.id, versionNo: v.version_no, status: v.structure_status, at: v.created_at })); }
    return o; };
  const structures = {
    list(actor, { status = 'ACTIVE' } = {}) { need(actor, 'pay.structure.view', 'see salary structures'); return db.prepare(`SELECT * FROM pay_structures WHERE company_id = ? AND deleted_at IS NULL${status === 'ALL' ? '' : " AND structure_status = 'ACTIVE'"} ORDER BY grade, code`).all(actor.companyId).map((r) => structView(actor, r)); },
    get(actor, id) { need(actor, 'pay.structure.view', 'see salary structures'); return structView(actor, structRow(actor, id), true); },
    /** A structure saved: a change is a new version (the assignments on the old one keep it until revised). */
    save(actor, b) {
      need(actor, 'pay.structure.configure', 'configure salary structures'); const c = actor.companyId; const all = compRows(c); const problems = [];
      for (const [i, l] of b.components.entries()) { const comp = all.find((x) => x.code === l.code && x.comp_status === 'ACTIVE'); if (!comp) problems.push({ field: `components.${i}.code`, message: `${l.code} is not an active pay component.` }); else if (l.value != null && comp.calc_method !== 'FIXED') problems.push({ field: `components.${i}.value`, message: `${l.code} is not a fixed component; its amount is computed.` }); }
      if (b.components.filter((l) => all.find((x) => x.code === l.code)?.calc_method === 'BALANCE').length > 1) problems.push({ field: 'components', message: 'Only one component takes the balance of the CTC.' });
      if (problems.length) throw badRequest('Correct the highlighted fields', problems);
      const json = JSON.stringify(b.components.map((l) => ({ code: l.code, ...(l.value != null ? { value: Number(l.value) } : {}) })));
      return transaction(db, () => { let id; const ex = b.id ? structRow(actor, b.id) : db.prepare("SELECT * FROM pay_structures WHERE company_id = ? AND code = ? AND structure_status = 'ACTIVE' AND deleted_at IS NULL").get(c, b.code);
        if (b.id && ex.structure_status !== 'ACTIVE') throw conflict('Only the current version of a structure is changed.'); if (!b.id && ex) throw conflict(`${b.code} already exists; change it instead.`);
        if (ex) { if (b.version != null && b.version !== ex.version) throw conflict('Someone changed this structure: reload it.'); db.prepare("UPDATE pay_structures SET structure_status = 'RETIRED', updated_by = ?, updated_at = ? WHERE id = ?").run(actor.user, nowIso(), ex.id);
          id = Number(db.prepare("INSERT INTO pay_structures (company_id, code, name, grade, senior, components_json, version_no, previous_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c, ex.code, b.name ?? ex.name, b.grade ?? ex.grade, (b.senior ?? Boolean(ex.senior)) ? 1 : 0, json, ex.version_no + 1, ex.id, actor.user).lastInsertRowid); audit(actor, 'pay_structures', id, 'version', c, { oldValues: { id: ex.id, components: JSON.parse(ex.components_json) }, newValues: { components: b.components } }); }
        else { id = Number(db.prepare("INSERT INTO pay_structures (company_id, code, name, grade, senior, components_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'api')").run(c, b.code, b.name, b.grade ?? null, b.senior ? 1 : 0, json, actor.user).lastInsertRowid); audit(actor, 'pay_structures', id, 'create', c, { newValues: { code: b.code, grade: b.grade } }); }
        return structures.get(actor, id); });
    },
    /** FR-03: the CTC breakup of a structure for a CTC (and an employee's flags and states, or the ones given). */
    preview(actor, { structureId, ctcAnnual, employeeId, date, pf = true, esi = false, ptState = null, gender = null, overrides = {} }) {
      need(actor, 'pay.structure.view', 'preview salary structures'); const s = structRow(actor, structureId); const d = date ?? todayIST(); const { comps, values } = structComps(actor.companyId, s);
      const ctx = employeeId ? contextOf(actor.companyId, employeeId, d) : null; if (employeeId && !ctx) throw notFound('That employee does not exist.');
      const params = ctx?.params ?? { PF: paramsAt(actor.companyId, 'PF', null, d), ESI: paramsAt(actor.companyId, 'ESI', null, d), PT: ptState ? paramsAt(actor.companyId, 'PT', ptState, d) : null, LWF: null, GRATUITY: paramsAt(actor.companyId, 'GRATUITY', null, d) };
      const b = computeBreakup({ components: comps, values, overrides, ctcAnnual, params, employee: ctx?.flags ?? { pf, esi, ptState, gender }, month: d.slice(0, 7), wageRule: ctx?.wageRule ?? wageRuleAt(actor.companyId, d) });
      return { structure: { id: s.id, code: s.code, name: s.name, versionNo: s.version_no }, date: d, ctcAnnual, ...b };
    },
  };

  // ---- FR-06: statutory parameter changes (PAY -> CFO) ----
  const statFlow = createFlow({ db, base, docType: STATUTORY_DOC, table: 'pay_statutory_params', perm: 'pay.statutory', label: 'statutory parameter', route: '/payroll/statutory?id=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ code: r.code, state: r.state_code }), title: (r) => `${r.code} ${r.state_code} from ${r.effective_from}`, notifyCode: 'pay.decided', prefix: 'PSP',
    beforeSubmit: (_a, r) => { if (!on(r.company_id)) throw unprocessable('Payroll set-up is off for the company (ff.pay.p2401).'); },
    onApproved: (actor, r) => { evt('pay.statutory.approved', actor, r.company_id, 'pay_statutory_params', r.id, { paramId: r.id, code: r.code, state: r.state_code, effectiveFrom: r.effective_from, params: JSON.parse(r.params_json) }); } });
  const statView = (actor, r) => ({ id: r.id, docNo: r.doc_no, code: r.code, state: r.state_code, params: JSON.parse(r.params_json), effectiveFrom: r.effective_from, effectiveTo: r.effective_to, legalRef: r.legal_ref, system: r.company_id == null, status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, version: r.version,
    can: r.company_id == null ? {} : { ...statFlow.can(actor, r), ...statFlow.approveInfo(actor, r) } });
  const checkParams = (code, p) => { const bad = []; const num = (k) => { if (p[k] == null || !(Number(p[k]) >= 0)) bad.push({ field: `params.${k}`, message: `Give ${k} (a number, 0 or more).` }); };
    if (code === 'PF') ['employeeRate', 'epsRate', 'edliRate', 'adminRate', 'wageCeiling'].forEach(num); if (code === 'ESI') ['employeeRate', 'employerRate', 'wageCeiling'].forEach(num); if (code === 'GRATUITY') num('rate'); if (code === 'OT') num('multiplier'); if (code === 'LWF') ['employee', 'employer'].forEach(num);
    if (['PT', 'TDS_NEW', 'TDS_OLD'].includes(code)) { if (!Array.isArray(p.slabs) || !p.slabs.length) bad.push({ field: 'params.slabs', message: 'Give the slabs.' }); else if (p.slabs.at(-1).upTo != null) bad.push({ field: 'params.slabs', message: 'The last slab has no upper limit.' }); }
    return bad; };
  const statutoryParams = {
    flow: statFlow, paramsAt, contextOf, wageRuleAt,
    /** @param {any} actor @param {any} [q0] */
    list(actor, { code, state } = /** @type {any} */ ({})) { need(actor, 'pay.statutory.view', 'see statutory parameters'); const rows = db.prepare(`SELECT * FROM pay_statutory_params WHERE (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL${code ? ' AND code = ?' : ''}${state ? ' AND state_code = ?' : ''} ORDER BY code, state_code, effective_from DESC`).all(actor.companyId, ...(code ? [code] : []), ...(state ? [state] : []));
      const today = todayIST(); return { rows: rows.map((r) => ({ ...statView(actor, r), inForce: r.status === 'APPROVED' && JSON.stringify(paramsAt(actor.companyId, r.code, r.state_code === 'ALL' ? null : r.state_code, today)) === r.params_json })), codes: PARAM_CODES, canCreate: may(actor, 'pay.statutory.create') }; },
    get(actor, id) { need(actor, 'pay.statutory.view', 'see statutory parameters'); const r = db.prepare('SELECT * FROM pay_statutory_params WHERE id = ? AND (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) throw notFound('That parameter row does not exist.'); return { ...statView(actor, r), history: r.company_id ? statFlow.history(actor, r.id) : { approvals: [], audit: [] } }; },
    create(actor, b) { need(actor, 'pay.statutory.create', 'propose statutory parameters'); const bad = checkParams(b.code, b.params); if (bad.length) throw badRequest('Correct the highlighted fields', bad);
      const id = Number(db.prepare("INSERT INTO pay_statutory_params (company_id, doc_no, code, state_code, params_json, effective_from, legal_ref, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, statFlow.next(actor), b.code, b.state ?? 'ALL', JSON.stringify(b.params), b.effectiveFrom, b.legalRef, actor.user).lastInsertRowid);
      audit(actor, 'pay_statutory_params', id, 'create', actor.companyId, { newValues: { code: b.code, state: b.state, effectiveFrom: b.effectiveFrom, params: b.params } }); return statutoryParams.get(actor, id); },
    update(actor, id, b) { const r = statFlow.row(actor, id, 'pay.statutory.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or a returned row is changed.'); const p = b.params ?? JSON.parse(r.params_json); const bad = checkParams(r.code, p); if (bad.length) throw badRequest('Correct the highlighted fields', bad);
      db.prepare('UPDATE pay_statutory_params SET params_json = ?, effective_from = ?, legal_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(p), b.effectiveFrom ?? r.effective_from, b.legalRef ?? r.legal_ref, actor.user, nowIso(), r.id); audit(actor, 'pay_statutory_params', r.id, 'update', r.company_id, { oldValues: { params: JSON.parse(r.params_json) }, newValues: { params: p } }); return statutoryParams.get(actor, r.id); },
    remove: (actor, id) => statFlow.remove(actor, id),
    submit(actor, id) { statFlow.submit(actor, id); return statutoryParams.get(actor, id); },
    withdraw(actor, id, b) { statFlow.withdraw(actor, id, b); return statutoryParams.get(actor, id); },
    cancel(actor, id, b) { statFlow.cancel(actor, id, b); return statutoryParams.get(actor, id); },
  };

  // ---- FR-05: the payroll calendar ----
  const calView = (r) => ({ id: r.id, period: r.period, from: r.period_from, to: r.period_to, attendanceCutoff: r.attendance_cutoff, inputsCutoff: r.inputs_cutoff, payDate: r.pay_date, status: r.cal_status, version: r.version });
  const calendar = {
    /** @param {any} actor @param {any} [q0] */
    list(actor, { fy } = /** @type {any} */ ({})) { need(actor, 'pay.calendar.view', 'see the payroll calendar'); const start = fy ? `${fy.slice(0, 4)}-04` : null; return { rows: db.prepare(`SELECT * FROM pay_calendar WHERE company_id = ? AND deleted_at IS NULL${start ? ' AND period BETWEEN ? AND ?' : ''} ORDER BY period`).all(actor.companyId, ...(start ? [start, addMonths(start, 11)] : [])).map(calView), canConfigure: may(actor, 'pay.calendar.configure') }; },
    /** The twelve periods of a financial year: cut-offs and the pay date as days of the following month (or of the month itself for the cut-offs). */
    generate(actor, { fyStart, payDay = 1, attendanceCutoffDay = 25, inputsCutoffDay = 26 }) {
      need(actor, 'pay.calendar.configure', 'set up the payroll calendar'); const c = actor.companyId; let made = 0; const start = fyStart.slice(0, 7);
      for (let k = 0; k < 12; k += 1) { const p = addMonths(start, k); if (db.prepare('SELECT 1 FROM pay_calendar WHERE company_id = ? AND period = ? AND deleted_at IS NULL').get(c, p)) continue; const end = monthEnd(p); const day = (m, d) => `${m}-${String(Math.min(d, Number(monthEnd(m).slice(8)))).padStart(2, '0')}`;
        db.prepare("INSERT INTO pay_calendar (company_id, period, period_from, period_to, attendance_cutoff, inputs_cutoff, pay_date, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(c, p, `${p}-01`, end, day(p, attendanceCutoffDay), day(p, inputsCutoffDay), day(addMonths(p, 1), payDay), actor.user); made += 1; }
      audit(actor, 'pay_calendar', 0, 'generate', c, { newValues: { fyStart, made } }); return { made, ...calendar.list(actor, { fy: start }) };
    },
    update(actor, id, b) { need(actor, 'pay.calendar.configure', 'change the payroll calendar'); const r = db.prepare('SELECT * FROM pay_calendar WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!r) throw notFound('That period does not exist.');
      if (r.cal_status !== 'OPEN') throw conflict('Only an open period is changed.'); if (b.version != null && b.version !== r.version) throw conflict('Someone changed this period: reload it.');
      const v = { att: b.attendanceCutoff ?? r.attendance_cutoff, inp: b.inputsCutoff ?? r.inputs_cutoff, pay: b.payDate ?? r.pay_date }; if (v.att > v.inp) throw badRequest('Correct the highlighted fields', [{ field: 'inputsCutoff', message: 'The inputs close on or after the attendance cut-off.' }]); if (v.pay < r.period_from) throw badRequest('Correct the highlighted fields', [{ field: 'payDate', message: 'The pay date is not before the period.' }]);
      db.prepare('UPDATE pay_calendar SET attendance_cutoff = ?, inputs_cutoff = ?, pay_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(v.att, v.inp, v.pay, actor.user, nowIso(), r.id); audit(actor, 'pay_calendar', r.id, 'update', actor.companyId, { oldValues: calView(r), newValues: v }); return calView(db.prepare('SELECT * FROM pay_calendar WHERE id = ?').get(r.id)); },
    periodOf: (companyId, period) => db.prepare('SELECT * FROM pay_calendar WHERE company_id = ? AND period = ? AND deleted_at IS NULL').get(companyId, period) ?? null,
  };

  // ---- FR-04: assignments (HRMGR -> CFO, the director for a senior grade) and arrears (BR-01) ----
  const current = (employeeId, date = null) => db.prepare(`SELECT * FROM pay_assignments WHERE employee_id = ? AND status = 'APPROVED' AND deleted_at IS NULL${date ? ' AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)' : ' AND effective_to IS NULL'} ORDER BY effective_from DESC LIMIT 1`).get(employeeId, ...(date ? [date, date] : [])) ?? null;
  /** The breakup of an assignment computed on the server (BR: never the client's figures). */
  function breakupOf(companyId, s, employeeId, ctcAnnual, overrides, date) { const { comps, values } = structComps(companyId, s); const ctx = contextOf(companyId, employeeId, date); return computeBreakup({ components: comps, values, overrides, ctcAnnual, params: ctx.params, employee: ctx.flags, month: date.slice(0, 7), wageRule: ctx.wageRule }); }
  const latestRating = (employeeId) => { try { return db.prepare("SELECT final_rating FROM perf_reviews WHERE employee_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(employeeId)?.final_rating ?? null; } catch { return null; } };
  const flow = createFlow({ db, base, docType: ASSIGNMENT_DOC, table: 'pay_assignments', perm: 'pay.assignment', label: 'pay assignment', route: '/payroll/assignments?id=', where: () => ({ pid: null, sid: null }),
    ctx: (r) => ({ total: rs(r.ctc_annual_paise), senior: db.prepare('SELECT senior FROM pay_structures WHERE id = ?').get(r.structure_id)?.senior ? 'yes' : 'no', kind: r.assignment_kind, makerRole: rolesOf(r.company_id, r.requested_by ?? r.created_by).includes('HRMGR') ? 'HRMGR' : 'OTHER' }),
    title: (r) => { const e = db.prepare('SELECT emp_code, full_name FROM hr_employees WHERE id = ?').get(r.employee_id); return `${r.assignment_kind} ${e?.emp_code} ${e?.full_name}: CTC from ${r.effective_from}`; }, notifyCode: 'pay.decided', prefix: 'PAS',
    beforeSubmit: (_a, r) => { if (!on(r.company_id)) throw unprocessable('Payroll set-up is off for the company (ff.pay.p2401).'); const s = db.prepare('SELECT * FROM pay_structures WHERE id = ?').get(r.structure_id); const b = breakupOf(r.company_id, s, r.employee_id, rs(r.ctc_annual_paise), JSON.parse(r.overrides_json), r.effective_from);
      db.prepare('UPDATE pay_assignments SET component_values_json = ?, gross_monthly_paise = ? WHERE id = ?').run(JSON.stringify(b), paise(b.fullGross), r.id); },
    onApproved: (actor, r) => applyApproved(actor, db.prepare('SELECT * FROM pay_assignments WHERE id = ?').get(r.id)) });
  function applyApproved(actor, r) {
    const prev = r.previous_id ? db.prepare('SELECT * FROM pay_assignments WHERE id = ?').get(r.previous_id) : null; const b = JSON.parse(r.component_values_json);
    if (prev && prev.status === 'APPROVED') db.prepare('UPDATE pay_assignments SET effective_to = ?, updated_at = ? WHERE id = ?').run(addDays(r.effective_from, -1), nowIso(), prev.id);
    // the employee's monthly pay from the date (the fixed earnings; the monthly inputs come from each run)
    statutory.applyPay(r.company_id, r.employee_id, { effectiveFrom: r.effective_from, lines: b.lines.filter((l) => l.type === 'EARNING' && l.method !== 'INPUT' && l.full > 0).map((l) => ({ code: l.code, amount: l.full })), reason: `${r.doc_no} ${r.reason}`, user: actor.user, source: 'pay_assignments', sourceId: r.id });
    // BR-01: a revision dated back: the difference of each earning for each month before this one, the first month for its days
    let arrears = 0; const thisMonth = todayIST().slice(0, 7);
    if (prev && r.effective_from.slice(0, 7) < thisMonth) { const old = JSON.parse(prev.component_values_json); const ins = db.prepare("INSERT INTO pay_arrears (company_id, assignment_id, employee_id, arrear_month, component_code, days_factor, old_paise, new_paise, amount_paise, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pay_assignments', ?)");
      for (let m = r.effective_from.slice(0, 7); m < thisMonth; m = addMonths(m, 1)) { const f = monthFactor(m, r.effective_from);
        for (const code of new Set([...b.lines, ...(old.lines ?? [])].filter((l) => l.type === 'EARNING' && l.method !== 'INPUT').map((l) => l.code))) { const nv = b.lines.find((l) => l.code === code)?.full ?? 0; const ov = (old.lines ?? []).find((l) => l.code === code)?.full ?? 0; const amt = paise(r2((nv - ov) * f)); if (!amt) continue;
          ins.run(r.company_id, r.id, r.employee_id, m, code, f, paise(ov), paise(nv), amt, actor.user, String(r.id)); arrears += amt; } } }
    db.prepare('UPDATE pay_assignments SET arrears_paise = ? WHERE id = ?').run(arrears, r.id);
    evt('pay.assignment.approved', actor, r.company_id, 'pay_assignments', r.id, { assignmentId: r.id, docNo: r.doc_no, employeeId: r.employee_id, structureId: r.structure_id, kind: r.assignment_kind, ctcAnnual: rs(r.ctc_annual_paise), grossMonthly: rs(r.gross_monthly_paise), effectiveFrom: r.effective_from, arrears: rs(arrears) });
    notify(r.company_id, 'pay.alert', ['permission:pay.assignment.create'], r.doc_no, 'approved', `${r.doc_no} is approved from ${r.effective_from}${arrears ? `; arrears of ₹${rs(arrears)} go to the next payroll` : ''}.`, `/payroll/assignments?id=${r.id}`, `${r.id}-approved`);
  }
  const empOf = (companyId, id) => db.prepare("SELECT id, emp_code, full_name, grade, doj, employment_status, record_status FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(Number(id), companyId) ?? null;
  const view = (actor, r, detail = false) => {
    const e = empOf(r.company_id, r.employee_id); const s = db.prepare('SELECT code, name, version_no, grade, senior FROM pay_structures WHERE id = ?').get(r.structure_id); const b = JSON.parse(r.component_values_json || '{}');
    const o = { id: r.id, docNo: r.doc_no, employeeId: r.employee_id, employee: e ? `${e.emp_code} ${e.full_name}` : null, structureId: r.structure_id, structure: s ? `${s.code} v${s.version_no}` : null, grade: s?.grade, senior: Boolean(s?.senior), kind: r.assignment_kind, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, reason: r.reason, rating: r.rating,
      ctcAnnual: mask(actor, rs(r.ctc_annual_paise)), grossMonthly: mask(actor, rs(r.gross_monthly_paise)), incrementPct: r.increment_pct_bp == null ? null : r.increment_pct_bp / 100, arrears: mask(actor, rs(r.arrears_paise)), status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, version: r.version, masked: !seesPay(actor), can: { ...flow.can(actor, r) } };
    if (detail) { o.breakup = seesPay(actor) ? b : null; Object.assign(o.can, flow.approveInfo(actor, r)); o.history = flow.history(actor, r.id); o.overrides = seesPay(actor) ? JSON.parse(r.overrides_json) : null;
      o.previous = r.previous_id ? (() => { const p = db.prepare('SELECT id, doc_no, ctc_annual_paise, gross_monthly_paise, effective_from FROM pay_assignments WHERE id = ?').get(r.previous_id); return p ? { id: p.id, docNo: p.doc_no, ctcAnnual: mask(actor, rs(p.ctc_annual_paise)), grossMonthly: mask(actor, rs(p.gross_monthly_paise)), effectiveFrom: p.effective_from } : null; })() : null;
      o.arrearLines = seesPay(actor) ? db.prepare('SELECT arrear_month, component_code, days_factor, old_paise, new_paise, amount_paise, arrear_status FROM pay_arrears WHERE assignment_id = ? AND deleted_at IS NULL ORDER BY arrear_month, component_code').all(r.id).map((a) => ({ month: a.arrear_month, code: a.component_code, factor: a.days_factor, old: rs(a.old_paise), new: rs(a.new_paise), amount: rs(a.amount_paise), status: a.arrear_status })) : null; }
    return o;
  };
  const editable = (actor, id) => { const r = flow.row(actor, id, 'pay.assignment.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or a returned assignment is changed.'); return r; };
  const validate = (actor, b, self = null) => {
    const c = actor.companyId; const e = empOf(c, b.employeeId); const problems = [];
    if (!e || e.record_status !== 'APPROVED' || e.employment_status === 'SEPARATED') problems.push({ field: 'employeeId', message: 'Choose an approved, current employee.' });
    const s = b.structureId ? db.prepare("SELECT * FROM pay_structures WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(Number(b.structureId), c) : null; if (!s || (s.structure_status !== 'ACTIVE' && s.id !== self?.structure_id)) problems.push({ field: 'structureId', message: 'Choose a current salary structure.' });
    if (e && b.effectiveFrom < e.doj) problems.push({ field: 'effectiveFrom', message: `The employee joined on ${e.doj}.` });
    const prev = e ? current(e.id) : null; if (prev && b.effectiveFrom <= prev.effective_from) problems.push({ field: 'effectiveFrom', message: `The current assignment starts on ${prev.effective_from}; a revision starts after it.` });
    if (problems.length) throw badRequest('Correct the highlighted fields', problems);
    const br = breakupOf(c, s, e.id, b.ctcAnnual, b.overrides ?? {}, b.effectiveFrom);
    if (s && JSON.parse(s.components_json).some((l) => compRows(c).find((x) => x.code === l.code)?.calc_method === 'BALANCE') && Math.abs(br.ctcAnnual - b.ctcAnnual) > 12) throw badRequest('Correct the highlighted fields', [{ field: 'ctcAnnual', message: `The components come to ₹${br.ctcAnnual} a year, not ₹${b.ctcAnnual}; lower the fixed amounts or raise the CTC.` }]);
    if (br.lines.some((l) => l.type === 'EARNING' && l.amount < 0)) throw badRequest('Correct the highlighted fields', [{ field: 'ctcAnnual', message: 'The CTC does not cover the fixed components and contributions.' }]);
    return { e, s, prev, br };
  };
  const assignments = {
    flow, current, breakupOf,
    list(actor, query) { need(actor, 'pay.assignment.view', 'see pay assignments'); return runList(db, assignmentList, parseListRequest(assignmentList, query), { select: 'x.*', scopeSql: 'x.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get(actor, id) { return view(actor, flow.row(actor, id), true); },
    /** The employees the payroll team assigns pay to, with their current assignment. */
    /** @param {any} actor @param {any} [q0] */
    employees(actor, { q } = /** @type {any} */ ({})) { need(actor, 'pay.assignment.view', 'see pay assignments'); return db.prepare(`SELECT id, emp_code, full_name, grade, doj FROM hr_employees WHERE company_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED' AND employment_status <> 'SEPARATED'${q ? ' AND (full_name LIKE ? OR emp_code LIKE ?)' : ''} ORDER BY emp_code LIMIT 200`).all(actor.companyId, ...(q ? [`%${q}%`, `%${q}%`] : []))
      .map((e) => { const a = current(e.id); return { id: e.id, code: e.emp_code, name: e.full_name, grade: e.grade, doj: e.doj, current: a ? { id: a.id, docNo: a.doc_no, ctcAnnual: mask(actor, rs(a.ctc_annual_paise)), from: a.effective_from, structureId: a.structure_id } : null }; }); },
    create(actor, b) {
      need(actor, 'pay.assignment.create', 'assign pay'); const { e, prev, br } = validate(actor, b); const kind = b.kind ?? (prev ? 'REVISION' : 'NEW'); if (kind === 'NEW' && prev) throw badRequest('Correct the highlighted fields', [{ field: 'kind', message: 'The employee has an assignment: this is a revision.' }]);
      const inc = prev ? Math.round(((b.ctcAnnual * 100 - prev.ctc_annual_paise) / prev.ctc_annual_paise) * 10000) : null;
      let id; try { id = Number(db.prepare("INSERT INTO pay_assignments (company_id, doc_no, employee_id, structure_id, assignment_kind, ctc_annual_paise, component_values_json, overrides_json, gross_monthly_paise, effective_from, reason, previous_id, rating, increment_pct_bp, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, flow.next(actor), e.id, Number(b.structureId), kind, paise(b.ctcAnnual), JSON.stringify(br), JSON.stringify(b.overrides ?? {}), paise(br.fullGross), b.effectiveFrom, b.reason, prev?.id ?? null, b.rating ?? (kind === 'REVISION' ? latestRating(e.id) : null), inc, actor.user).lastInsertRowid); } catch (x) { if (/UNIQUE/.test(String(x.message))) throw conflict('The employee already has an assignment in progress.'); throw x; }
      audit(actor, 'pay_assignments', id, 'create', actor.companyId, { newValues: { employeeId: e.id, kind, ctcAnnual: b.ctcAnnual, effectiveFrom: b.effectiveFrom } }); return assignments.get(actor, id);
    },
    update(actor, id, b) { const r = editable(actor, id); if (b.version != null && b.version !== r.version) throw conflict('Someone changed this assignment: reload it.'); const m = { employeeId: r.employee_id, structureId: b.structureId ?? r.structure_id, ctcAnnual: b.ctcAnnual ?? rs(r.ctc_annual_paise), effectiveFrom: b.effectiveFrom ?? r.effective_from, overrides: b.overrides ?? JSON.parse(r.overrides_json) };
      const prevOk = r.previous_id; const { br } = validate(actor, m, r); void prevOk;
      db.prepare('UPDATE pay_assignments SET structure_id = ?, ctc_annual_paise = ?, effective_from = ?, overrides_json = ?, component_values_json = ?, gross_monthly_paise = ?, reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(Number(m.structureId), paise(m.ctcAnnual), m.effectiveFrom, JSON.stringify(m.overrides), JSON.stringify(br), paise(br.fullGross), b.reason ?? r.reason, actor.user, nowIso(), r.id);
      audit(actor, 'pay_assignments', r.id, 'update', r.company_id, { oldValues: { ctcAnnual: rs(r.ctc_annual_paise), effectiveFrom: r.effective_from }, newValues: { ctcAnnual: m.ctcAnnual, effectiveFrom: m.effectiveFrom } }); return assignments.get(actor, r.id); },
    remove: (actor, id) => flow.remove(actor, id),
    submit(actor, id) { flow.submit(actor, id); return assignments.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return assignments.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return assignments.get(actor, id); },
    history: (actor, id) => flow.history(actor, id),
    /** The arrears not yet paid (24.02 reads them for its run). */
    /** @param {any} actor @param {any} [q0] */
    arrears(actor, { employeeId, status = 'PENDING' } = /** @type {any} */ ({})) { need(actor, 'pay.assignment.view', 'see arrears'); return db.prepare(`SELECT a.*, e.emp_code, e.full_name, p.doc_no FROM pay_arrears a JOIN hr_employees e ON e.id = a.employee_id JOIN pay_assignments p ON p.id = a.assignment_id WHERE a.company_id = ? AND a.deleted_at IS NULL AND a.arrear_status = ?${employeeId ? ' AND a.employee_id = ?' : ''} ORDER BY e.emp_code, a.arrear_month`).all(actor.companyId, status, ...(employeeId ? [Number(employeeId)] : []))
      .map((a) => ({ id: a.id, employeeId: a.employee_id, employee: `${a.emp_code} ${a.full_name}`, assignment: a.doc_no, month: a.arrear_month, code: a.component_code, factor: a.days_factor, amount: mask(actor, rs(a.amount_paise)), status: a.arrear_status })); },
    print(actor, id) { const r = flow.row(actor, id, 'pay.assignment.print'); if (!seesPay(actor)) throw forbidden('You may not see salaries (permission pay.salary.view).'); const x = view(actor, r, true); audit(actor, 'pay_assignments', r.id, 'print', r.company_id);
      return { contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `${x.docNo} · ${x.employee} · ${x.kind} from ${x.effectiveFrom}`, columns: [{ key: 'c', label: 'Component', type: 'text' }, { key: 't', label: 'Type', type: 'text' }, { key: 'm', label: 'Monthly' }, { key: 'y', label: 'Annual' }], rows: x.breakup.lines.filter((l) => l.amount || l.full).map((l) => ({ c: `${l.code} ${l.name}`, t: l.type, m: l.full ?? l.amount, y: r2((l.full ?? l.amount) * 12) })), footer: [`CTC ₹${x.ctcAnnual} a year; gross ₹${x.grossMonthly} a month; ${x.reason}`] }) }; },
    exportCsv(actor, query = {}) { need(actor, 'pay.assignment.export', 'export pay assignments'); const l = assignments.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'pay_assignments', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: 'pay-assignments.csv', buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Assignment', 'Employee', 'Kind', 'From', 'Structure', 'CTC', 'Gross monthly', 'Arrears', 'Status'], l.data.map((x) => [x.docNo, x.employee, x.kind, x.effectiveFrom, x.structure, x.ctcAnnual ?? '', x.grossMonthly ?? '', x.arrears ?? '', x.statusLabel]))}`, 'utf8') }; },
    /** D-361: an approved appraisal rating: the payroll team is told a revision may be prepared (the rating fills the revision). */
    onRating(e) { const d = e.data ?? e.payload ?? e; const companyId = e.companyId ?? e.company_id; if (!companyId || !on(companyId)) return; const emp = empOf(companyId, d.employeeId); if (!emp) return;
      notify(companyId, 'pay.alert', ['permission:pay.assignment.create'], emp.emp_code, 'rating approved', `${emp.emp_code} ${emp.full_name}: the appraisal ${d.docNo} is approved with rating ${d.finalRating} (${d.band}); prepare the pay revision.`, `/payroll/assignments?employeeId=${emp.id}`, `${d.docNo}-rating`); },
  };
  return { components, structures, statutoryParams, calendar, assignments, paramsAt, contextOf, wageRuleAt, compRows, structComps, applyApproved, on };
}
