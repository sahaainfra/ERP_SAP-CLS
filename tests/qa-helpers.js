import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';

// Shared fixture of the quality tests (M18): a company, a project with a site and an activity, one user per role, and helpers for calls, workflow tasks and events.
export const Q = '/api/v1/qa'; export const W = '/api/v1/workflow';
let seq = 0; export const nextSeq = () => (seq += 1);
export const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `qa-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
export const as = (roles, user, company = '1') => ({ roles, user, company });
export const U = { qce: as('QCE', 'qce1'), qce2: as('QCE', 'qce2'), qcm: as('QCMGR', 'qcm1'), hsee: as('HSEE', 'hsee1'), hseo: as('HSEO', 'hseo1'), pmsup: as('PMSUP', 'pmsup1'), plm: as('PLANTMGR', 'plm1'), sk: as('SK', 'sk1'), stm: as('STOREMGR', 'stm1'), se: as('SE', 'se1'), pm: as('PM', 'pm1'), pd: as('PD', 'pd1'), dir: as('DIR', 'dir1'), aud: as('AUD', 'aud1'), cm: as('CM', 'cm1'), xcon: as('X-CON', 'xcon1'), other: as('QCMGR', 'qcmx', '2') };
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
