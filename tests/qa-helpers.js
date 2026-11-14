import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';

// Shared fixture of the quality tests (M18): a company, a project with a site and an activity, one user per role, and helpers for calls, workflow tasks and events.
export const Q = '/api/v1/qa'; export const W = '/api/v1/workflow';
let seq = 0; export const nextSeq = () => (seq += 1);
export const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `qa-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
export const as = (roles, user, company = '1') => ({ roles, user, company });
export const U = { qce: as('QCE', 'qce1'), qce2: as('QCE', 'qce2'), qcm: as('QCMGR', 'qcm1'), hsee: as('HSEE', 'hsee1'), hseo: as('HSEO', 'hseo1'), pmsup: as('PMSUP', 'pmsup1'), plm: as('PLANTMGR', 'plm1'), sk: as('SK', 'sk1'), stm: as('STOREMGR', 'stm1'), stm2: as('STOREMGR', 'stm2'), prm: as('PROCMGR', 'prm1'), se: as('SE', 'se1'), pm: as('PM', 'pm1'), pd: as('PD', 'pd1'), dir: as('DIR', 'dir1'), aud: as('AUD', 'aud1'), cm: as('CM', 'cm1'), xcon: as('X-CON', 'xcon1'), other: as('QCMGR', 'qcmx', '2') };
export function fill(d, table, vals) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all(); const sql = d.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name === 'doc_no' && !('doc_no' in vals)) { names.push('doc_no'); params.push(`T/${table}/${(seq += 1)}`); continue; } if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `x${(seq += 1)}`)); } }
  return Number(d.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
export async function ready(opened, { users = Object.values(U) } = {}) {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db; d.exec('PRAGMA foreign_keys = OFF');
  for (const u of users) { if (u.company !== '1') continue; d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u.user, u.user, JSON.stringify([u.roles]), `${u.user}@example.com`); }
  const proj = (code) => Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE')").run(code, `Tower ${code}`).lastInsertRowid); const A = proj('QA1'); const B = proj('QB1');
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'QS1', 'Site 1')").run(A).lastInsertRowid);
  const sch = fill(d, 'plan_schedules', { company_id: 1, org_project_id: A, status: 'APPROVED', doc_no: 'SCH/QA1' }); const act = fill(d, 'plan_activities', { company_id: 1, schedule_id: sch, code: 'QA-1', name: 'Footing concrete', duration_days: 5 }); const act2 = fill(d, 'plan_activities', { company_id: 1, schedule_id: sch, code: 'QA-2', name: 'Column concrete', duration_days: 5 });
  const call = (who, method, path, body, k = key()) => api.call(method, `${Q}${path}`, { ...who, headers: k, body });
  const tasksOf = async (who) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows;
  const act_ = async (who, instanceId, action = 'approve') => { const task = (await tasksOf(who)).find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of ${instanceId}`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, ...(action === 'approve' ? {} : { comment: 'Please check this again' }) } }); };
  const events = (type) => d.prepare('SELECT payload FROM core_outbox WHERE event_type = ? ORDER BY id').all(type).map((x) => { const j = JSON.parse(x.payload); return j.data ?? j; });
  const wf = (table, id) => d.prepare(`SELECT workflow_instance_id AS w FROM ${table} WHERE id = ?`).get(id).w;
  return { api, d, A, B, site, sch, a1: act, a2: act2, call, act: act_, events, wf, tasksOf, drain: () => runtimeOf(d).bus.drain() };
}
export const sections = () => [{ code: 'S1', title: 'Formwork and steel', questions: [
  { code: 'Q1', text: 'Cover blocks placed', type: 'YESNO', weight: 1 },
  { code: 'Q2', text: 'Cover to steel (mm)', type: 'NUMERIC', target: 40, tolPlus: 5, tolMinus: 0, unit: 'mm', weight: 2, autoFail: true },
  { code: 'Q3', text: 'Rebar condition photo', type: 'YESNO', photoRequired: true, weight: 1 },
  { code: 'Q4', text: 'Remarks', type: 'TEXT' },
] }];
/** Makes a checklist template and takes it through its approval, so it is in force. */
export async function activeTemplate(r, o = {}) {
  const code = o.code ?? `CT-${nextSeq()}`; const c = await r.call(U.qce, 'POST', '/templates', { code, name: 'Pre-pour check', module: o.module ?? 'QUALITY', sections: o.sections ?? sections(), scoring: { passPct: 80 } }); assert.equal(c.status, 201, JSON.stringify(c.json));
  const id = c.json.data.id; assert.equal((await r.call(U.qce, 'POST', `/templates/${id}/submit`)).status, 202); const w = r.wf('qa_checklist_templates', id); const approvers = { HSE: U.hseo, PLANT: U.plm, STORES: U.stm };
  if (approvers[o.module]) assert.equal((await r.act(approvers[o.module], w)).status, 200); assert.equal((await r.act(U.qcm, w)).status, 200); return { id, code };
}
/** An approved ITP applied to the first activity of the project; the second activity follows it. Returns the planned points. */
export async function plannedPoints(r) {
  const c = await r.call(U.qce, 'POST', '/itps', { code: `ITP-${nextSeq()}`, title: 'RCC footing', activityType: 'RCC', steps: [{ code: 'S1', seq: 1, description: 'Check formwork and cover', pointType: 'HOLD' }, { code: 'S2', seq: 2, description: 'Witness slump', pointType: 'WITNESS' }] }); assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.equal((await r.call(U.qce, 'POST', `/itps/${c.json.data.id}/submit`)).status, 202); assert.equal((await r.act(U.qcm, r.wf('qa_itps', c.json.data.id))).status, 200);
  assert.equal((await r.call(U.qce, 'POST', `/itps/${c.json.data.id}/apply`, { projectId: r.A, activityIds: [r.a1] })).status, 201);
  fill(r.d, 'plan_dependencies', { company_id: 1, schedule_id: r.sch, pred_id: r.a1, succ_id: r.a2 });
  return (await r.call(U.qce, 'GET', `/planned-points?projectId=${r.A}&activityId=${r.a1}`)).json.data;
}
/** A posted receipt of cement that waits in the inspection stock (16.03): returns the receipt, its line, the item and the store. */
export async function receiveForInspection(r, qty = 100) {
  const d = r.d; const I = '/api/v1/inv'; const ic = (who, method, path, body) => r.api.call(method, `${I}${path}`, { ...who, headers: key(), body });
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, ?, 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(`CEM${nextSeq()}`).lastInsertRowid);
  const item = Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked, batch_tracked) VALUES (1, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1, 0)").run(`CEM-${nextSeq()}`, cat).lastInsertRowid);
  const vendor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, ?, 'Cement Ltd', 'Cement', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run(`V-${nextSeq()}`).lastInsertRowid);
  const po = Number(d.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, po_site_id, vendor_id, status, requested_by, created_by) VALUES (1, ?, '2026-11-01', ?, ?, ?, 'APPROVED', 'xic1', 'test')").run(`PO/QA/${nextSeq()}`, r.A, r.site, vendor).lastInsertRowid);
  const pol = Number(d.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, rate, balance_qty, created_by) VALUES (1, ?, 1, ?, 'Line', ?, 'bag', 4000, ?, 'test')").run(po, item, qty * 1000, qty * 1000).lastInsertRowid);
  const sc = await ic(U.stm, 'POST', '/stores', { code: `QS${nextSeq()}`, name: 'Quality store', type: 'SITE_STORE', projectId: r.A, siteId: r.site, keepers: ['sk1'] }); assert.equal(sc.status, 201, JSON.stringify(sc.json)); const ss = await ic(U.stm, 'POST', `/stores/${sc.json.data.id}/submit`); assert.equal((await r.act(U.stm2, ss.json.data.workflowInstanceId)).status, 200);
  const g = await ic(U.sk, 'POST', '/grns', { storeId: sc.json.data.id, poId: po, lines: [{ poLineId: pol, receivedQty: qty, inspectionRequired: true }] }); assert.equal(g.status, 201, JSON.stringify(g.json)); const sub = await ic(U.sk, 'POST', `/grns/${g.json.data.id}/submit`); assert.equal((await r.act(U.stm, sub.json.data.workflowInstanceId)).status, 200);
  const full = (await ic(U.stm, 'GET', `/grns/${g.json.data.id}`)).json.data; return { grnId: full.id, lineId: full.lines[0].id, itemId: item, categoryId: cat, vendorId: vendor, storeId: sc.json.data.id };
}
export const stockOf = (r, itemId) => ({ ...r.d.prepare('SELECT COALESCE(SUM(qty_on_hand), 0) AS onHand, COALESCE(SUM(qty_inspection), 0) AS inspection FROM inv_balances WHERE item_id = ?').get(itemId) });
/** A subcontractor of the company. */
export const partnerOf = (r, name = 'Sub Builders') => Number(r.d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run(`P-${nextSeq()}`, name, name).lastInsertRowid);
/** An inspection of a one-question checklist, answered and (when `approve`) approved: result PASS or FAIL as asked. */
export async function simpleInspection(r, { pass = true, approve = true } = {}) {
  const t = await activeTemplate(r, { code: `SI-${nextSeq()}`, sections: [{ code: 'S', title: 'Check', questions: [{ code: 'A', text: 'Surface is sound', type: 'YESNO', critical: true }] }] });
  const c = await r.call(U.qce, 'POST', '/inspections', { templateId: t.id, projectId: r.A, siteId: r.site, activityId: r.a1, answers: [{ questionCode: 'A', answer: pass ? 'YES' : 'NO' }], signatures: [{ role: 'INSPECTOR', name: 'QC Engineer' }] }); assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.equal((await r.call(U.qce, 'POST', `/inspections/${c.json.data.id}/submit`)).status, 202); if (approve) assert.equal((await r.act(U.qcm, r.wf('qa_inspections', c.json.data.id))).status, 200); return c.json.data.id;
}
