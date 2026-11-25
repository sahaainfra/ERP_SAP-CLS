import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { U, attachFile, key, ready } from './qa-helpers.js';

// Part 26.02 (audit AUD-DEF-004): a handover with its checklist and evidence, the client asset register and dossier, the certificate approved
// by the project director and signed by the client (recorded by the project manager), and the event that starts the defects liability period.
const opened = [];
after(async () => { for (const api of opened) { await api.close(); api.db.close(); } });
const C = '/api/v1/close';

test('26.02 handover: checklist evidence, readiness, certificate, client signature, assets and dossier', async () => {
  const r = await ready(opened);
  const call = (who, method, path, body) => r.api.call(method, `${C}${path}`, { ...who, headers: key(), body });
  const okay = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.json)); return res.json.data; };
  const doc = { roles: 'DOC', user: 'doc1', company: '1' };
  r.d.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'doc1', 'doc1', '[\"DOC\"]', 'doc1@example.com')").run();

  assert.equal((await call(U.pm, 'GET', '/handovers')).status, 404, 'off until the part flag is on');
  r.d.prepare("UPDATE core_feature_flags SET default_enabled = 1, enabled = 1 WHERE key IN ('ff.close.p2601', 'ff.close.p2602') AND company_id IS NULL").run();

  // FR-04 an area handover needs its area; a whole-project handover is one per project
  assert.equal((await call(U.pm, 'POST', '/handovers', { projectId: r.A, title: 'Tower A handover', scopeType: 'AREA' })).status, 422);
  const h = okay(await call(U.pm, 'POST', '/handovers', { projectId: r.A, siteId: r.site, title: 'Tower A handover', scopeType: 'PROJECT', dlpMonths: 12 }), 201);
  assert.equal(h.status, 'DRAFT'); assert.ok(h.checklist.length >= 10);
  assert.equal((await call(U.pm, 'POST', '/handovers', { projectId: r.A, title: 'Second', scopeType: 'PROJECT' })).status, 409);
  assert.equal((await call(U.se, 'POST', '/handovers', { projectId: r.B, title: 'Not allowed', scopeType: 'PROJECT' })).status, 403);

  // BR-01 not ready: mandatory items open
  let req = await call(U.pm, 'POST', `/handovers/${h.id}/request`);
  assert.equal(req.status, 422); assert.match(req.json.error.message, /mandatory checklist item/);

  // FR-01 evidence: a mandatory item cannot be set aside; done needs evidence; a commissioning item needs an issued certificate
  const item = (cat) => h.checklist.find((i) => i.category === cat);
  assert.equal((await call(doc, 'POST', `/handover-items/${item('AS_BUILT').id}/record`, { status: 'NOT_APPLICABLE', note: 'Not needed here' })).status, 422);
  assert.equal((await call(doc, 'POST', `/handover-items/${item('AS_BUILT').id}/record`, { status: 'DONE' })).status, 422);
  assert.equal((await call(doc, 'POST', `/handover-items/${item('COMMISSIONING').id}/record`, { status: 'DONE', fileId: attachFile(r, 'ho_checklist_items', item('COMMISSIONING').id) })).status, 422);
  okay(await call(doc, 'POST', `/handover-items/${item('COMMISSIONING').id}/record`, { status: 'NOT_APPLICABLE', note: 'No mechanical systems in this tower' }));
  for (const cat of ['AS_BUILT', 'OM_MANUAL', 'WARRANTY', 'STATUTORY', 'TEST_CERTIFICATE', 'KEYS']) okay(await call(doc, 'POST', `/handover-items/${item(cat).id}/record`, { status: 'DONE', fileId: attachFile(r, 'ho_checklist_items', item(cat).id, `${cat}.pdf`) }));
  okay(await call(U.pm, 'POST', `/handover-items/${item('SNAGS').id}/record`, { status: 'DONE', note: 'Joint walk done' }));
  const extra = okay(await call(U.pm, 'POST', `/handovers/${h.id}/items`, { category: 'OTHER', title: 'Lift licence copy', mandatory: false }), 201);
  assert.equal(extra.checklist.length, h.checklist.length + 1);

  // BR-01 an open class A snag of the site blocks
  const snag = okay(await r.call(U.qce, 'POST', '/snags', { projectId: r.A, siteId: r.site, category: 'MEP', punchClass: 'A', description: 'Fire door does not close', responsibleType: 'OWN_CREW' }), 201);
  req = await call(U.pm, 'POST', `/handovers/${h.id}/request`);
  assert.equal(req.status, 422); assert.match(req.json.error.message, /class A snag/);
  r.d.prepare("UPDATE qa_snags SET status = 'CLOSED' WHERE id = ?").run(snag.id);

  // FR-03 client assets
  okay(await call(U.pm, 'POST', `/handovers/${h.id}/assets`, { tagNo: 'DG-01', description: 'Diesel generator 500 kVA', make: 'Acme', serialNo: 'SN-1', warrantyUntil: '2028-11-30' }), 201);
  assert.equal((await call(U.pm, 'POST', `/handovers/${h.id}/assets`, { tagNo: 'DG-01', description: 'Duplicate tag' })).status, 409);

  // FR-05 the certificate: PM requests, PD approves, PM records the client's signature
  const sub = okay(await call(U.pm, 'POST', `/handovers/${h.id}/request`), 202);
  assert.equal(sub.status, 'SUBMITTED');
  assert.equal((await call(U.pm, 'POST', `/handovers/${h.id}/assets`, { tagNo: 'DG-02', description: 'Second generator' })).status, 409, 'frozen while in approval');
  assert.equal((await r.act(U.pd, sub.workflowInstanceId)).status, 200);
  const file = attachFile(r, 'ho_handovers', h.id, 'handover-signed.pdf');
  assert.equal((await call(U.pd, 'POST', `/handovers/${h.id}/client-sign`, { signatory: 'Client PM', signedOn: '2026-11-24', fileId: file })).status, 403);
  assert.equal((await call(U.pm, 'POST', `/handovers/${h.id}/client-sign`, { signatory: 'Client PM', signedOn: '2999-01-01', fileId: file })).status, 422);
  const issued = okay(await call(U.pm, 'POST', `/handovers/${h.id}/client-sign`, { signatory: 'Client PM', signedOn: '2026-11-24', fileId: file }));
  assert.equal(issued.status, 'ISSUED'); assert.equal(issued.effectiveOn, '2026-11-24'); assert.equal(issued.dlpEndsOn, '2027-11-24');
  const evt = r.events('ho.handover.issued'); assert.equal(evt.length, 1); assert.equal(evt[0].dlpMonths, 12); assert.equal(evt[0].effectiveOn, '2026-11-24');

  // FR-02 dossier and exports; the register
  const dossier = okay(await call(U.pd, 'GET', `/handovers/${h.id}/dossier`));
  assert.ok(dossier.sections.some((s) => s.category === 'AS_BUILT' && s.items[0].evidence.kind === 'FILE'));
  const csv = await r.api.call('GET', `${C}/handovers/${h.id}/dossier/export`, { ...U.pd });
  assert.equal(csv.status, 200);
  assert.equal(okay(await call(U.aud, 'GET', `/client-assets?projectId=${r.A}`)).length, 1);
  assert.equal((await r.api.call('GET', `${C}/client-assets/export`, { ...U.pm })).status, 200);
  assert.equal((await call(U.qce, 'GET', '/client-assets/export')).status, 403);
  assert.equal((await call(U.other, 'GET', `/handovers/${h.id}`)).status, 404);
  assert.equal((await call(U.sk, 'GET', '/handovers')).status, 403);
  assert.equal(okay(await call(U.pd, 'GET', `/handovers?projectId=${r.A}`)).length, 1);
});

test('26.02 the defects liability period ends the same day months later, or on the last day of a shorter month', async () => {
  const { addMonths } = await import('../src/server/modules/close/handover.js');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(addMonths('2026-11-24', 12), '2027-11-24'); assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
});
