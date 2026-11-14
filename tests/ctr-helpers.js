import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';

// Shared fixture of the contract tests (M21): the quality fixture with the commercial roles, a client and a signed-off commercial baseline for project A.
export { fill, as, key };
export const K = '/api/v1/ctr';
export const U = { ...QU, com: as('COMMGR', 'com1'), com2: as('COMMGR', 'com2'), qs: as('QS', 'qs1'), cfo: as('CFO', 'cfo1'), acc: as('ACCMGR', 'acc1'), pd2: as('PD', 'pd2'), comX: as('COMMGR', 'comx', '2') };
export async function ready(opened, { baseline = true } = {}) {
  const r = await qaReady(opened, { users: Object.values(U) });
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${K}${path}`, { ...who, headers: k, body });
  const setParam = (k, value, type = 'string') => { r.d.prepare('DELETE FROM core_parameters WHERE key = ? AND company_id = 1').run(k); return r.d.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, ?, ?, ?, 'company', 1, '2020-01-01', 'test', 'test')").run(k, String(value), type); };
  const client = Number(r.d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'CLI1', 'State Highways Authority', 'SHA', 'GOVERNMENT', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  fill(r.d, 'proj_projects', { company_id: 1, project_id: r.A, status: 'APPROVED', client_partner_id: client, contract_type: 'ITEM_RATE', contract_no: 'SHA/2026/14', contract_value: 50_000_000_000, start_date: '2026-04-01', scheduled_completion: '2028-03-31', dlp_months: 24, retention_pct: 50000, mob_advance_pct: 100000, ld_summary: '0.5% per week up to 10%' });
  if (baseline) fill(r.d, 'proj_baseline_packs', { company_id: 1, project_id: r.A, pack_no: 1, contract_value: 50_000_000_000, status: 'APPROVED', snapshot_hash: 'h', signed_off_at: '2026-03-30', snapshot_json: JSON.stringify({ source: { award: { loaNo: 'LOA/SHA/77', loaDate: '2026-03-15' }, tender: { nameOfWork: 'Four-laning of SH-14, km 0 to 42' } }, clauses: [{ title: 'Time for completion', summary: 'Twenty-four months from the appointed date', ref: '8.2' }, { title: 'Variations', summary: 'Engineer instructs; valued at BOQ rates', ref: '13.1' }] }), clauses_json: '[]' });
  return { ...r, call, setParam, client };
}
/** A contract made from the baseline, ready to send. */
export const contractBody = (r, o = {}) => ({ projectId: r.A, title: 'Four-laning of SH-14', contractNo: `SHA/2026/${Math.random().toString(36).slice(2, 6)}`, contractType: 'ITEM_RATE', original: 500_000_000, clientPartnerId: r.client, loaNo: 'LOA/SHA/77', loaDate: '2026-03-15', agreementNo: 'AGR/14', agreementDate: '2026-03-28', startDate: '2026-04-01', completionDate: '2028-03-31', dlpMonths: 24, paymentTerms: { billFrequency: 'MONTHLY', certificationDays: 14, paymentDays: 28 }, retentionPct: 5, retentionCapPct: 5, advanceTerms: { mobilisationPct: 10, machineryPct: 5, interestPct: 10, recoveryStartPct: 10, recoveryEndPct: 80, note: '' }, pvcApplicable: true, pvcRef: 'Clause 13.8', ldRatePct: 0.5, ldBasis: 'PER_WEEK', ldCapPct: 10, disputeResolution: 'Dispute board, then arbitration in Delhi', security: { performancePct: 5, validityMonths: 48, form: 'Bank guarantee' }, insurance: [{ kind: 'Contractor all risk', coverage: 'Contract value', renewEvery: 'YEARLY' }], ...o });
export async function approvedContract(r, o = {}) {
  const c = await r.call(U.com, 'POST', '/contracts', contractBody(r, o)); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id;
  const s = await r.call(U.com, 'POST', `/contracts/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); const wf = r.wf('ctr_contracts', id);
  for (const who of [U.com2, U.pd, U.dir]) { const a = await r.act(who, wf); assert.equal(a.status, 200, JSON.stringify(a.json)); }
  return (await r.call(U.com, 'GET', `/contracts/${id}`)).json.data;
}
