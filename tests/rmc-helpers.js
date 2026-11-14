import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';

// Shared fixture of the batching plant tests (M20): the quality fixture with the RMC roles added and helpers for items, plants and mix designs.
export { fill, as, key };
export const R = '/api/v1/rmc';
export const U = { ...QU, plm2: as('PLANTMGR', 'plm2'), plmX: as('PLANTMGR', 'plmx', '2'), acc: as('ACCMGR', 'acc1'), cfo: as('CFO', 'cfo1'), cfo2: as('CFO', 'cfo2'), qce3: as('QCE', 'qce3'), pm2: as('PM', 'pm2'), se2: as('SE', 'se2'), cm2: as('CM', 'cm2'), op: as('PMSUP', 'pmsup2') };
export async function ready(opened) {
  const r = await qaReady(opened, { users: Object.values(U) });
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${R}${path}`, { ...who, headers: k, body });
  const setParam = (k, value, type = 'string') => { r.d.prepare('DELETE FROM core_parameters WHERE key = ? AND company_id = 1').run(k); return r.d.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, ?, ?, ?, 'company', 1, '2020-01-01', 'test', 'test')").run(k, String(value), type); };
  return { ...r, call, setParam, qcall: r.call };
}
let n = 0;
export const itemOf = (r, code, name = code) => fill(r.d, 'mdm_items', { company_id: 1, code: `${code}${(n += 1)}`, name, base_uom: 'KG', item_status: 'ACTIVE' });
/** The standard M25 mix per m3: absolute volumes add up to about 1 m3 with 1% air. */
export const M25 = (items, o = {}) => [{ component: 'CEMENT', itemId: items.cement, qty: 340 }, { component: 'FLY_ASH', itemId: items.flyAsh, qty: 60 }, { component: 'WATER', qty: 160 }, { component: 'SAND', itemId: items.sand, qty: 700 }, { component: 'AGG_20', itemId: items.agg20, qty: 700 }, { component: 'AGG_10', itemId: items.agg10, qty: 450 }, { component: 'ADMIXTURE', itemId: items.adm, qty: 4 }].map((l) => ({ ...l, ...(o[l.component] ?? {}) }));
export function items(r) { return { cement: itemOf(r, 'CEM', 'Cement OPC 53'), flyAsh: itemOf(r, 'FLY', 'Fly ash'), sand: itemOf(r, 'SND', 'River sand'), agg20: itemOf(r, 'A20', '20 mm aggregate'), agg10: itemOf(r, 'A10', '10 mm aggregate'), adm: itemOf(r, 'ADM', 'Superplasticiser') }; }
export const plantBody = (r, o = {}) => ({ code: `BP${(n += 1)}`, name: 'Batching plant 1', projectId: r.A, siteId: r.site, capacityM3h: 60, ownership: 'OWN', costCentre: 'CC-BP1', budgetHead: 'RMC', projectIds: [r.A, r.B], crew: [{ name: 'Mahesh', role: 'Operator', phone: '9000000001' }], ...o });
/** An approved plant, made by the plant in-charge and approved by the project manager. */
export async function approvedPlant(r, o = {}) {
  const c = await r.call(U.plm, 'POST', '/plants', plantBody(r, o)); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id;
  const s = await r.call(U.plm, 'POST', `/plants/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); const a = await r.act(U.pm, r.wf('bp_plants', id)); assert.equal(a.status, 200, JSON.stringify(a.json));
  return (await r.call(U.plm, 'GET', `/plants/${id}`)).json.data;
}
export const mixBody = (r, plant, it, o = {}) => ({ plantId: plant.rootId, grade: 'M25', slumpMm: 100, proportions: M25(it), trials: [{ date: '2026-10-01', slumpMm: 100, cube7: 20, cube28: 36 }, { date: '2026-10-02', slumpMm: 105, cube7: 21, cube28: 35 }], effectiveFrom: '2026-01-01', effectiveTo: null, ...o });
export async function approvedMix(r, plant, it, o = {}) {
  const c = await r.call(U.plm, 'POST', '/mix-designs', mixBody(r, plant, it, o)); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id;
  const s = await r.call(U.plm, 'POST', `/mix-designs/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); const wf = r.wf('bp_mix_designs', id);
  assert.equal((await r.act(U.qce, wf)).status, 200); assert.equal((await r.act(U.qcm, wf)).status, 200);
  return (await r.call(U.plm, 'GET', `/mix-designs/${id}`)).json.data;
}
export const stamp = (h = 0) => new Date(Date.now() + 5.5 * 3600_000 + h * 3_600_000).toISOString().slice(0, 16);
/** A plant with a silo for each material (levels in kg), approved, and an approved M25 mix design. */
export async function readyPlant(r, { levels = {} } = {}) {
  const it = items(r); const plant = await approvedPlant(r); const L = { cement: 60_000, flyAsh: 20_000, sand: 200_000, agg20: 200_000, agg10: 150_000, adm: 2_000, ...levels };
  for (const [k, item] of Object.entries(it)) { const s = await r.call(U.plm, 'POST', `/plants/${plant.rootId}/silos`, { code: `S-${k}`, itemId: item, capacity: 1_000_000, level: L[k] }); assert.equal(s.status, 201, JSON.stringify(s.json)); }
  const mix = await approvedMix(r, plant, it); return { it, plant, mix };
}
export function pourCard(r, o = {}) { return fill(r.d, 'qa_pour_cards', { company_id: 1, org_project_id: r.A, org_site_id: r.site, grade: 'M25', fck_mpa: 25, status: 'APPROVED', pour_status: 'PLANNED', planned_volume: 20000, ...o }); }
export const reqBody = (r, o = {}) => ({ projectId: r.A, siteId: r.site, grade: 'M25', qty: 10, requiredAt: stamp(5), pumpRequired: true, ...o });
/** An approved requisition scheduled on the plant. */
export async function scheduledReq(r, plant, o = {}) {
  const c = await r.call(U.se, 'POST', '/requisitions', reqBody(r, o)); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id; assert.equal((await r.call(U.se, 'POST', `/requisitions/${id}/submit`)).status, 202); assert.equal((await r.act(U.cm, r.wf('bp_requisitions', id))).status, 200);
  const sch = await r.call(U.plm, 'POST', `/requisitions/${id}/schedule`, { plantId: plant.rootId, slotFrom: stamp(4), slotTo: stamp(9) }); assert.equal(sch.status, 200, JSON.stringify(sch.json)); return sch.json.data;
}
