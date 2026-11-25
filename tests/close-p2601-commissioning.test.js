import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { U, attachFile, key, ready } from './qa-helpers.js';

// Part 26.01 (audit AUD-DEF-004): systems, tags, check sheets, test packs, punch items, and the MC, RFC and RFSU certificates with
// their readiness (BR-01), approvals (QCMGR, then PM) and the client's signature recorded by the project manager.
const opened = [];
after(async () => { for (const api of opened) { await api.close(); api.db.close(); } });
const C = '/api/v1/close/commissioning';

test('26.01 commissioning: readiness, certificates through the workflow and the client, scope and flag', async () => {
  const r = await ready(opened);
  const call = (who, method, path, body) => r.api.call(method, `${C}${path}`, { ...who, headers: key(), body });
  const okay = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.json)); return res.json.data; };

  // the part is off until its flag is on
  assert.equal((await call(U.qce, 'GET', '/systems')).status, 404);
  r.d.prepare("UPDATE core_feature_flags SET default_enabled = 1, enabled = 1 WHERE key = 'ff.close.p2601' AND company_id IS NULL").run();

  // FR-01 a system and its tags with check sheets of the three classes
  const sys = okay(await call(U.qce, 'POST', '/systems', { projectId: r.A, siteId: r.site, code: 'SYS-HVAC-01', name: 'Chilled water system', discipline: 'HVAC' }), 201);
  assert.equal(sys.stage, 'CONSTRUCTION');
  assert.equal((await call(U.qce, 'POST', '/systems', { projectId: r.A, code: 'SYS-HVAC-01', name: 'Duplicate code' })).status, 409);
  assert.equal((await call(U.se, 'POST', '/systems', { projectId: r.A, code: 'SYS-X', name: 'Not allowed' })).status, 403, 'a site engineer only sees');
  let full = okay(await call(U.qce, 'POST', `/systems/${sys.id}/tags`, { tagNo: 'CHP-01', description: 'Chilled water pump 1', sheets: [{ sheetClass: 'A', title: 'Pump installation check' }, { sheetClass: 'B', title: 'Pre-commissioning check' }, { sheetClass: 'C', title: 'Run test' }] }), 201);
  const sheets = full.tags[0].sheets; const byClass = Object.fromEntries(sheets.map((s) => [s.sheetClass, s]));
  assert.equal(sheets.length, 3);

  // BR-01 nothing passed: MC refused with its reasons
  let mc = await call(U.qce, 'POST', `/systems/${sys.id}/certificates`, { kind: 'MC' });
  assert.equal(mc.status, 422); assert.match(mc.json.error.message, /class A check sheet/);

  // FR-04 an open class A punch item from the snag list blocks MC
  const snag = okay(await r.call(U.qce, 'POST', '/snags', { projectId: r.A, siteId: r.site, category: 'MEP', punchClass: 'A', description: 'Pump base bolts missing', responsibleType: 'OWN_CREW' }), 201);
  okay(await call(U.qce, 'POST', `/systems/${sys.id}/punches`, { snagId: snag.id }));
  assert.equal((await call(U.qce, 'POST', `/systems/${sys.id}/punches`, { snagId: snag.id })).status, 409);
  const otherProjectSnag = okay(await r.call(U.qce, 'POST', '/snags', { projectId: r.B, category: 'MEP', punchClass: 'B', description: 'Another project snag', responsibleType: 'OWN_CREW' }), 201);
  assert.equal((await call(U.qce, 'POST', `/systems/${sys.id}/punches`, { snagId: otherProjectSnag.id })).status, 404);

  // FR-02 recording a sheet: a failure needs a note; only who may record tests records
  assert.equal((await call(U.qce, 'POST', `/sheets/${byClass.A.id}/record`, { result: 'FAILED' })).status, 400);
  assert.equal((await call(U.pm, 'POST', `/sheets/${byClass.A.id}/record`, { result: 'PASSED' })).status, 403);
  okay(await call(U.qce, 'POST', `/sheets/${byClass.A.id}/record`, { result: 'PASSED', note: 'Aligned and grouted' }));
  mc = await call(U.qce, 'POST', `/systems/${sys.id}/certificates`, { kind: 'MC' });
  assert.equal(mc.status, 422); assert.match(mc.json.error.message, /punch/);
  // close the punch through QA (rectified is still open)
  r.d.prepare("UPDATE qa_snags SET status = 'CLOSED' WHERE id = ?").run(snag.id);

  // FR-05 MC requested, approved by QCMGR and PM, then the client signs
  const cert = okay(await call(U.qce, 'POST', `/systems/${sys.id}/certificates`, { kind: 'MC' }), 201);
  assert.equal(cert.status, 'SUBMITTED');
  assert.equal((await call(U.qce, 'POST', `/systems/${sys.id}/certificates`, { kind: 'MC' })).status, 409, 'one MC in progress at a time');
  const file = attachFile(r, 'tnc_certificates', cert.id, 'mc-signed.pdf');
  assert.equal((await call(U.pm, 'POST', `/certificates/${cert.id}/client-sign`, { signatory: 'Client Engineer', signedOn: '2026-11-20', fileId: file })).status, 409, 'not approved yet');
  assert.equal((await r.act(U.qcm, cert.workflowInstanceId)).status, 200);
  assert.equal((await r.act(U.pm, cert.workflowInstanceId)).status, 200);
  let certs = okay(await call(U.qce, 'GET', '/certificates?kind=MC'));
  assert.equal(certs.find((c) => c.id === cert.id).status, 'APPROVED');
  assert.equal((await call(U.qce, 'POST', `/certificates/${cert.id}/client-sign`, { signatory: 'Client Engineer', signedOn: '2026-11-20', fileId: file })).status, 403, 'the project manager records the client signature');
  assert.equal((await call(U.pm, 'POST', `/certificates/${cert.id}/client-sign`, { signatory: 'Client Engineer', signedOn: '2999-01-01', fileId: file })).status, 422);
  const issued = okay(await call(U.pm, 'POST', `/certificates/${cert.id}/client-sign`, { signatory: 'Client Engineer', signedOn: '2026-11-20', fileId: file }));
  assert.equal(issued.status, 'ISSUED');
  assert.equal(okay(await call(U.qce, 'GET', `/systems/${sys.id}`)).stage, 'MC');
  const evt = r.events('tnc.certificate.issued'); assert.equal(evt.length, 1); assert.equal(evt[0].kind, 'MC'); assert.equal(evt[0].systemCode, 'SYS-HVAC-01');

  // RFSU needs an issued RFC first, every class C sheet and every test pack passed
  let rfsu = await call(U.qce, 'POST', `/systems/${sys.id}/certificates`, { kind: 'RFSU' });
  assert.equal(rfsu.status, 422); assert.match(rfsu.json.error.message, /RFC certificate is not issued/); assert.match(rfsu.json.error.message, /No test pack/);
  okay(await call(U.qce, 'POST', `/sheets/${byClass.B.id}/record`, { result: 'PASSED' }));
  const rfc = okay(await call(U.qce, 'POST', `/systems/${sys.id}/certificates`, { kind: 'RFC' }), 201);
  // a rejection ends the certificate; a new one may then be requested
  assert.equal((await r.act(U.qcm, rfc.workflowInstanceId, 'reject')).status, 200);
  certs = okay(await call(U.qce, 'GET', '/certificates?kind=RFC'));
  assert.equal(certs.find((c) => c.id === rfc.id).status, 'REJECTED');
  const rfc2 = okay(await call(U.qce, 'POST', `/systems/${sys.id}/certificates`, { kind: 'RFC' }), 201);
  assert.equal((await r.act(U.qcm, rfc2.workflowInstanceId)).status, 200); assert.equal((await r.act(U.pm, rfc2.workflowInstanceId)).status, 200);
  okay(await call(U.pm, 'POST', `/certificates/${rfc2.id}/client-sign`, { signatory: 'Client Engineer', signedOn: '2026-11-21', fileId: file }));

  // FR-03 a test pack: number, witness, date not in the future
  const pack = okay(await call(U.qce, 'POST', `/systems/${sys.id}/test-packs`, { packType: 'HYDROTEST', procedureRef: 'PROC-HT-01' }), 201);
  assert.match(pack.docNo, /\S/); assert.equal(pack.status, 'PLANNED');
  assert.equal((await call(U.qce, 'POST', `/test-packs/${pack.id}/record`, { result: 'PASSED', witnessedBy: 'Consultant', testedOn: '2999-01-01' })).status, 422);
  okay(await call(U.qce, 'POST', `/test-packs/${pack.id}/record`, { result: 'PASSED', witnessedBy: 'Consultant engineer', witnessParty: 'PMC', testedOn: '2026-11-22' }));
  rfsu = await call(U.qce, 'POST', `/systems/${sys.id}/certificates`, { kind: 'RFSU' });
  assert.equal(rfsu.status, 422); assert.match(rfsu.json.error.message, /class C/);
  okay(await call(U.qce, 'POST', `/sheets/${byClass.C.id}/record`, { result: 'PASSED' }));
  const rfsuCert = okay(await call(U.qce, 'POST', `/systems/${sys.id}/certificates`, { kind: 'RFSU' }), 201);
  assert.equal((await r.act(U.qcm, rfsuCert.workflowInstanceId)).status, 200); assert.equal((await r.act(U.pm, rfsuCert.workflowInstanceId)).status, 200);
  // readiness is checked again when the client signs: a class B punch opened since blocks RFSU
  const late = okay(await r.call(U.qce, 'POST', '/snags', { projectId: r.A, siteId: r.site, category: 'MEP', punchClass: 'B', description: 'Insulation damaged at valve', responsibleType: 'OWN_CREW' }), 201);
  okay(await call(U.qce, 'POST', `/systems/${sys.id}/punches`, { snagId: late.id }));
  const blocked = await call(U.pm, 'POST', `/certificates/${rfsuCert.id}/client-sign`, { signatory: 'Client Engineer', signedOn: '2026-11-23', fileId: file });
  assert.equal(blocked.status, 422); assert.match(blocked.json.error.message, /no longer ready/);
  r.d.prepare("UPDATE qa_snags SET status = 'CLOSED' WHERE id = ?").run(late.id);
  okay(await call(U.pm, 'POST', `/certificates/${rfsuCert.id}/client-sign`, { signatory: 'Client Engineer', signedOn: '2026-11-23', fileId: file }));

  // FR-06 the dashboard
  const dash = okay(await call(U.pd, 'GET', `/dashboard?projectId=${r.A}`));
  assert.equal(dash.totals.systems, 1); assert.equal(dash.totals.byStage.RFSU, 1); assert.deepEqual(dash.totals.sheetsPassedPct, { A: 100, B: 100, C: 100 });
  assert.equal(dash.totals.packsPassed, 1);
  full = okay(await call(U.aud, 'GET', `/systems/${sys.id}`));
  assert.equal(full.certificates.filter((c) => c.status === 'ISSUED').length, 3); assert.equal(full.can.manage, false);
  assert.equal(okay(await call(U.qce, 'GET', '/test-packs')).length, 1);
  const opts = okay(await call(U.qce, 'GET', `/options?projectId=${r.A}`));
  assert.ok(opts.projects.some((p) => p.id === r.A)); assert.ok(opts.snags.some((s) => s.id === snag.id));

  // another company sees nothing; a role without the permission is refused
  assert.equal((await call(U.other, 'GET', `/systems/${sys.id}`)).status, 404);
  assert.equal((await call(U.sk, 'GET', '/systems')).status, 403);
});
