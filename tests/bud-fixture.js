import assert from 'node:assert/strict';
import { setupCompany, startApi } from './helpers.js';

// Shared fixture of the project budget tests (parts 12.01 and 12.02): a project with an approved baseline pack, a contract BOQ with norms and WBS split, and the roles of the budget.
export const B = '/api/v1/bud';
export const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
export const key = () => ({ ...json, 'idempotency-key': `bd-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
export const as = (roles, user, company = '1') => ({ roles, user, company });
export const qs = as('QS', 'bqs1'); export const pcm = as('PCMGR', 'bpcm1'); export const pm = as('PM', 'bpm1'); export const pd = as('PD', 'bpd1'); export const dir = as('DIR', 'bdir1'); export const se = as('SE', 'bse1'); export const qs2 = as('QS', 'bqs1', '2');
export const opened = [];
export const R = (paise) => (paise / 100).toFixed(2);

export async function setup({ contract = 1_000_000_000 } = {}) {
  const api = await startApi(); opened.push(api); await setupCompany(api);
  for (const [n, r] of [['bqs1', ['QS']], ['bpcm1', ['PCMGR']], ['bpcm2', ['PCMGR']], ['bpm1', ['PM']], ['bpm2', ['PM']], ['bpd1', ['PD']], ['bdir1', ['DIR']], ['bse1', ['SE']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  const d = api.db;
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (1, 'BDA', 'Alpha towers', 'BUILDING')").run().lastInsertRowid);
  d.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (1, ?, 'bpm1', ?, '2026-01-01', '2026-12-31', 'test')").run(pid, contract);
  const wbs = (code, name, parent, ca) => Number(d.prepare('INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, is_control_account, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(pid, parent, code, name, parent ? 2 : 1, ca, 'test').lastInsertRowid);
  const w1 = wbs('W1', 'Superstructure', null, 1); const w11 = wbs('W1.1', 'Columns', w1, 0); const w2 = wbs('W2', 'Foundations', null, 1);
  const wp = Number(d.prepare("INSERT INTO proj_work_packages (company_id, project_id, code, name, wbs_ids_json, created_by) VALUES (1, ?, 'WP1', 'Concrete works', ?, 'test')").run(pid, JSON.stringify([w11, w2])).lastInsertRowid);
  const snapshot = {
    boq: [
      { itemNo: '1.1', description: 'M25 concrete', uom: 'cum', qty: '100', costRate: '4842', norms: { lines: [{ type: 'MATERIAL', description: 'Cement', uom: 'bag', rate: '380' }, { type: 'LABOUR', description: 'Mason', uom: 'day', rate: '900' }] } },
      { itemNo: '1.2', description: 'Excavation in soil', uom: 'cum', qty: '200', costRate: '150', norms: { lines: [] } },
    ],
    boqCost: '484200.00', indirects: [{ category: 'Site overhead', description: 'Site office and staff', basis: 'LS', amount: '100000.00' }], commercials: { contingency: '50000.00', risk: '30000.00' },
  };
  d.prepare("INSERT INTO proj_baseline_packs (company_id, doc_no, doc_date, pack_no, project_id, contract_value, snapshot_json, status, created_by) VALUES (1, 'BP/1', '2026-01-02', 1, ?, ?, ?, 'APPROVED', 'test')").run(pid, contract, JSON.stringify(snapshot));
  const ver = Number(d.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status, created_by) VALUES (1, 'BQ/1', ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED', 'test')").run(pid).lastInsertRowid);
  const item = (code, desc, uom, qty) => Number(d.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount, created_by) VALUES (1, ?, 'ITEM', ?, ?, ?, ?, 0, 0, 'test')").run(ver, code, desc, uom, qty).lastInsertRowid);
  const i1 = item('1.1', 'M25 concrete', 'cum', 100_000); const i2 = item('1.2', 'Excavation in soil', 'cum', 200_000);
  const split = (line, w, qty) => d.prepare('INSERT INTO proj_boq_line_wbs (company_id, line_id, wbs_id, qty, created_by) VALUES (1, ?, ?, ?, ?)').run(line, w, qty, 'test');
  split(i1, w11, 60_000); split(i1, w2, 40_000); split(i2, w11, 200_000);
  const norm = (type, desc, uom, q, wst) => d.prepare('INSERT INTO proj_boq_line_norms (company_id, line_id, norm_type, description, uom, qty_per_unit, wastage_pct, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(i1, type, desc, uom, q, wst, 'test');
  norm('MATERIAL', 'Cement', 'bag', 8000, 50_000); norm('LABOUR', 'Mason', 'day', 1500, 0);
  const call = (who, method, path, body, k = key()) => api.call(method, `${B}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const risk = Number(d.prepare("INSERT INTO proj_risks (company_id, doc_no, org_project_id, rtype, title, category, owner_user, probability, status, created_by) VALUES (1, 'RSK/1', ?, 'RISK', 'Rock in the foundation', 'TECHNICAL', 'bpm1', 3, 'OCCURRED', 'test')").run(pid).lastInsertRowid);
  const opp = Number(d.prepare("INSERT INTO proj_risks (company_id, doc_no, org_project_id, rtype, title, category, owner_user, probability, status, created_by) VALUES (1, 'RSK/2', ?, 'OPPORTUNITY', 'Cheaper steel', 'COMMERCIAL', 'bpm1', 3, 'OPEN', 'test')").run(pid).lastInsertRowid);
  return { api, call, act, pid, w1, w11, w2, wp, risk, opp };
}
export const generate = async (t, over = {}) => { const g = await t.call(qs, 'POST', '/generate', { projectId: t.pid, ...over }); assert.equal(g.status, 201, JSON.stringify(g.json)); return g.json.data; };
export const phased = async (t, id) => { const p = await t.call(qs, 'POST', `/budgets/${id}/phasing/generate`, { method: 'SCURVE', profile: 'SCURVE' }); assert.equal(p.status, 200, JSON.stringify(p.json)); return p.json.data; };
export const approve = async (t, id, { director = false } = {}) => {
  const s = await t.call(qs, 'POST', `/budgets/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); const inst = s.json.data.workflowInstanceId;
  await t.act(pcm, inst); await t.act(pm, inst); await t.act(pd, inst); if (director) await t.act(dir, inst);
  return (await t.call(qs, 'GET', `/budgets/${id}`)).json.data;
};

