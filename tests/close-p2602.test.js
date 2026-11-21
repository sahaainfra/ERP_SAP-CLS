import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readHandoverDocumentEvidence } from '../src/server/modules/close/dossier.js';
import { createFlagService } from '../src/server/modules/core/feature-flags/service.js';
import { fill, ready } from './qa-helpers.js';

const opened = [];
after(async () => {
  for (const api of opened) {
    await api.close();
    api.db.close();
  }
});

test('handover evidence indexes only current, issued and eligible revisions within the requested scope', async () => {
  const r = await ready(opened);
  const { d } = r;
  const flags = createFlagService({ db: d, environment: 'test' });
  const actor = { companyId: 1, roles: ['DOC'], user: 'handover-controller' };
  const secondCompany = fill(d, 'org_companies', { code: 'HO-OTHER', legal_name: 'Other company', short_name: 'Other' });
  const secondSite = fill(d, 'org_sites', { company_id: 1, org_project_id: r.A, code: 'HO-OTHER', name: 'Other site' });
  const title = 'Issued as-built plan';
  const documentId = fill(d, 'doc_documents', {
    company_id: 1, project_id: r.A, site_id: r.site, title, doc_type: 'DRAWING',
    status: 'ISSUED', confidentiality: 'INTERNAL', owner_user_ref: 'author',
  });
  const revisionId = fill(d, 'doc_versions', { company_id: 1, document_id: documentId, revision: 'A', revision_no: 1, status: 'ISSUED' });
  const fileId = fill(d, 'core_files', {
    company_id: 1, storage_key: 'handover-fixture.pdf', original_name: 'as-built.pdf', category: 'document',
    extension: 'pdf', mime: 'application/pdf', size_bytes: 1024, scan_status: 'CLEAN', linked_entity: 'doc_version', linked_id: revisionId,
  });
  d.prepare('UPDATE doc_versions SET file_id = ? WHERE id = ?').run(fileId, revisionId);
  d.prepare('UPDATE doc_documents SET current_version_id = ? WHERE id = ?').run(revisionId, documentId);

  const input = { projectId: r.A, siteId: r.site, revisionIds: [revisionId, revisionId] };
  const read = (selection = input, user = actor) => readHandoverDocumentEvidence({ db: d, flags }, user, selection);
  const seed = d.prepare(`SELECT default_enabled, enabled FROM core_feature_flags
    WHERE key = 'ff.close.p2602' AND company_id IS NULL AND environment IS NULL`).get();
  assert.deepEqual({ ...seed }, { default_enabled: 0, enabled: 0 });
  const sign = d.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (?, ?, ?, 'PASSED', 'test', CURRENT_TIMESTAMP)`);
  sign.run(1, 'G1', 'Platform Gate');
  sign.run(secondCompany, 'G2', 'Workforce Gate');
  assert.throws(read, { status: 404 });
  d.prepare("UPDATE core_feature_flags SET default_enabled = 1 WHERE key = 'ff.close.p2602'").run();
  assert.throws(read, { status: 404 }, 'G2 must be passed in the document company');
  sign.run(1, 'G2', 'Workforce Gate');
  sign.run(secondCompany, 'G1', 'Platform Gate');

  assert.deepEqual(read(), [{ documentId, revisionId, title, revision: 'A', extension: 'pdf', size: 1024 }]);
  assert.throws(() => read({ ...input, siteId: secondSite }), { status: 404 }, 'another site in the same project');
  assert.throws(() => read({ ...input, projectId: r.B, siteId: null }), { status: 404 }, 'another project in the same company');
  assert.throws(() => read(input, { companyId: secondCompany, user: actor.user, roles: ['DOC'] }), { status: 404 });
  assert.throws(() => read(input, { companyId: 1, user: 'viewer', roles: ['PM'] }), { status: 404 }, 'viewing is insufficient to add share evidence');
  assert.throws(() => read({ ...input, revisionIds: [] }), { status: 400 });
  const sourceOverride = d.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES ('ff.eng.p0410', 1, 'Disable document service for the fixture', 0, 0)`).run().lastInsertRowid;
  assert.throws(read, { status: 404 }, 'a disabled source service cannot provide evidence');
  d.prepare('DELETE FROM core_feature_flags WHERE id = ?').run(sourceOverride);

  d.prepare("UPDATE core_files SET scan_status = 'PENDING' WHERE id = ?").run(fileId);
  assert.throws(read, { status: 404 }, 'a pending scan blocks the revision');
  d.prepare("UPDATE core_files SET scan_status = 'CLEAN' WHERE id = ?").run(fileId);
  d.prepare("UPDATE doc_documents SET confidentiality = 'CONFIDENTIAL' WHERE id = ?").run(documentId);
  assert.throws(read, { status: 404 }, 'document controllers cannot add confidential revisions to the client dossier');
  d.prepare("UPDATE doc_documents SET confidentiality = 'INTERNAL' WHERE id = ?").run(documentId);
  const revised = fill(d, 'doc_versions', { company_id: 1, document_id: documentId, revision: 'B', revision_no: 2, status: 'ISSUED' });
  d.prepare('UPDATE doc_documents SET current_version_id = ? WHERE id = ?').run(revised, documentId);
  assert.throws(read, { status: 404 }, 'a superseded selection cannot be used in a new dossier');
});
