import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readCommissioningPunchEvidence } from '../src/server/modules/close/punches.js';
import { createFlagService } from '../src/server/modules/core/feature-flags/service.js';
import { U, attachFile, fill, ready } from './qa-helpers.js';

const opened = [];
after(async () => {
  for (const api of opened) {
    await api.close();
    api.db.close();
  }
});

test('commissioning punch evidence uses the live QA status, scope, flags and company sign-offs', async () => {
  const r = await ready(opened);
  const flags = createFlagService({ db: r.d, environment: 'test' });
  const actor = { user: U.qce.user, roles: ['QCE'], companyId: 1 };
  const raise = async (punchClass, projectId, siteId) => {
    const result = await r.call(U.qce, 'POST', '/snags', {
      projectId, siteId, category: 'MEP', punchClass, description: 'Confirm equipment alignment', responsibleType: 'OWN_CREW',
    });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    return result.json.data;
  };
  const classA = await raise('A', r.A, r.site);
  const classB = await raise('B', r.A, r.site);
  const otherSite = fill(r.d, 'org_sites', { company_id: 1, org_project_id: r.A, code: 'QS2', name: 'Site 2' });
  const otherCompanyId = fill(r.d, 'org_companies', { code: 'CLOSE-OTHER', legal_name: 'Other project company', short_name: 'Other' });
  const unrelated = await raise('A', r.B, null);
  const input = { projectId: r.A, siteId: r.site, snagIds: [classA.id, classB.id, classA.id] };
  const read = (selection = input, who = actor) => readCommissioningPunchEvidence({ db: r.d, flags }, who, selection);
  const seed = r.d.prepare(`SELECT default_enabled, enabled FROM core_feature_flags
    WHERE key = 'ff.close.p2601' AND company_id IS NULL AND environment IS NULL`).get();
  assert.deepEqual({ ...seed }, { default_enabled: 0, enabled: 0 });
  const sign = r.d.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (?, ?, ?, 'PASSED', 'test', CURRENT_TIMESTAMP)`);
  sign.run(1, 'G1', 'Platform Gate');
  sign.run(otherCompanyId, 'G2', 'Workforce Gate');
  assert.throws(read, { status: 404 }, 'the commissioning flag defaults to off');
  r.d.prepare("UPDATE core_feature_flags SET default_enabled = 1 WHERE key = 'ff.close.p2601'").run();
  assert.throws(read, { status: 404 }, 'a different company’s G2 cannot enable commissioning');
  sign.run(1, 'G2', 'Workforce Gate');

  assert.deepEqual(read(), {
    projectId: r.A, siteId: r.site, blockingPunchIds: [classA.id],
    punches: [classA, classB].map(({ id, docNo, siteId, punchClass, status }) => ({ id, docNo, siteId, punchClass, status })),
  });
  assert.throws(() => read({ ...input, snagIds: [unrelated.id] }), { status: 404 });
  assert.throws(() => read({ ...input, siteId: otherSite }), { status: 404 });
  assert.throws(() => read(input, { user: U.sk.user, roles: ['SK'], companyId: 1 }), { status: 404 });
  sign.run(otherCompanyId, 'G1', 'Platform Gate');
  assert.throws(() => read(input, { user: U.other.user, roles: ['QCMGR'], companyId: otherCompanyId }), { status: 404 });
  assert.throws(() => read(input, null), { status: 404 });
  assert.throws(() => read({ ...input, snagIds: [] }), { status: 400 });
  const qaOverride = r.d.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES ('ff.qa.p1806', 1, 'Disable QA in the fixture', 0, 0)`).run().lastInsertRowid;
  assert.throws(read, { status: 404 }, 'an unavailable QA module cannot provide evidence');
  r.d.prepare('DELETE FROM core_feature_flags WHERE id = ?').run(qaOverride);

  const fileId = attachFile(r, 'qa_snags', classA.id, 'after.jpg');
  const rectified = await r.call(U.se, 'POST', `/snags/${classA.id}/rectify`, { fileId, note: 'Equipment alignment corrected' });
  assert.equal(rectified.status, 200, JSON.stringify(rectified.json));
  assert.deepEqual(read().blockingPunchIds, [classA.id], 'rectification still needs verification');
  const closed = await r.call(U.qce, 'POST', `/snags/${classA.id}/close`, { note: 'Alignment verified on site' });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  assert.equal(read().punches[0].status, 'CLOSED');
  assert.deepEqual(read().blockingPunchIds, []);
});
