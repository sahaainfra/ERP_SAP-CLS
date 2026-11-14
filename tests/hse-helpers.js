import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, nextSeq, attachFile, partnerOf, U as QU } from './qa-helpers.js';

// Shared fixture of the HSE tests (M19): the quality fixture (a company, two projects, a site, an activity, a user per role) with the HSE API and the HSE roles added.
export { fill, attachFile, partnerOf, as, key, nextSeq };
export const H = '/api/v1/hse';
export const U = { ...QU, secsup: as('SECSUP', 'secsup1'), secmgr: as('SECMGR', 'secmgr1'), hsee2: as('HSEE', 'hsee2'), hrm: as('HRMGR', 'hrm1'), csup: as('CSUP', 'csup1'), hseo2: as('HSEO', 'hseo2'), pm2: as('PM', 'pm2'), hseoX: as('HSEO', 'hseox', '2'), guard: as('GUARD', 'guard1'), subco: as('SUBCO', 'subco1'), wsup: as('WSUP', 'wsup1'), wsup2: as('WSUP', 'wsup2') };
export async function ready(opened) {
  const r = await qaReady(opened, { users: Object.values(U) });
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${H}${path}`, { ...who, headers: k, body });
  const setParam = (k, value, type = 'string') => { r.d.prepare('DELETE FROM core_parameters WHERE key = ? AND company_id = 1').run(k); return r.d.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, ?, ?, ?, 'company', 1, '2020-01-01', 'test', 'test')").run(k, String(value), type); };
  return { ...r, call, setParam, qcall: r.call };
}
/** An approved, working contract worker with a QR badge. */
export function workerOf(r, name = 'Ramesh Kumar', code = null) {
  const c = code ?? `W${nextSeq()}`; const id = fill(r.d, 'lab_workers', { company_id: 1, worker_code: c, name, status: 'APPROVED', worker_status: 'ACTIVE', contractor_id: partnerOf(r, `Contractor ${c}`) });
  const token = `tok${id}x${c}`.toLowerCase(); r.d.prepare('UPDATE lab_workers SET root_id = id, qr_token = ? WHERE id = ?').run(token, id); return { id, code: c, badge: `LAB:${token}` };
}
export const QUIZ = [{ q: 'Is a helmet worn on site?', options: ['Always', 'Sometimes'], correct: 0 }, { q: 'Who stops unsafe work?', options: ['Only the engineer', 'Anyone'], correct: 1 }];
export async function content(r, o = {}) {
  const c = await r.call(U.hseo, 'POST', '/induction-content', { code: `IC${nextSeq()}`, title: 'Site safety induction', body: 'Rules of the site: helmets, harness, housekeeping.', quiz: QUIZ, passPct: 50, validityDays: 365, projectId: r.A, ...o }); assert.equal(c.status, 201, JSON.stringify(c.json)); return c.json.data;
}
export const hiraBody = (r, o = {}) => ({ projectId: r.A, siteId: r.site, activityType: 'RCC', title: 'Footing excavation and concreting', hazards: [{ activity: 'Excavation', hazard: 'Collapse of sides', consequence: 'Burial', c: 4, l: 3, controls: 'Shoring and a ladder every 15 m', rc: 2, rl: 2, owner: 'Site engineer' }], ...o });
/** A HIRA taken through its approval. */
export async function approvedHira(r, o = {}) {
  const c = await r.call(U.hsee, 'POST', '/hira', hiraBody(r, o)); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id;
  assert.equal((await r.call(U.hsee, 'POST', `/hira/${id}/submit`)).status, 202); const w = r.wf('hse_hira', id); assert.equal((await r.act(U.pm, w)).status, 200); if (c.json.data.riskLevel === 'HIGH' || c.json.data.riskLevel === 'EXTREME') assert.equal((await r.act(U.hseo, w)).status, 200); return id;
}
