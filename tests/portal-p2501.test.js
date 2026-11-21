import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createFlagService } from '../src/server/modules/core/feature-flags/service.js';
import { bindGates, createGateService } from '../src/server/modules/hr/gates.js';
import { portalPrerequisitesMet } from '../src/server/modules/portal/prerequisites.js';
import { hashToken, newToken } from '../src/server/platform/identity/tokens.js';
import { counterAt, totpAt } from '../src/server/platform/identity/totp.js';
import { memoryDb, startApi } from './helpers.js';

test('portal prerequisites require the flag and both active sign-offs for the same company', (t) => {
  const db = memoryDb();
  t.after(() => db.close());
  const flags = createFlagService({ db, environment: 'test' });
  const eligible = (companyId) => portalPrerequisitesMet({ db, flags, companyId });

  assert.equal(eligible(1), false);
  db.prepare("UPDATE core_feature_flags SET default_enabled = 1 WHERE key = 'ff.portal.p2501'").run();
  assert.equal(eligible(1), false, 'an unavailable gate service fails closed');

  bindGates(db, createGateService({ db }));
  assert.equal(eligible(1), false, 'missing gate rows fail closed');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hr_gates').get().count, 0);

  const sign = db.prepare(`
    INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1, ?, ?, 'PASSED', 'test', '2026-11-20T00:00:00Z')
  `);
  sign.run('G1', 'Platform Gate');
  assert.equal(eligible(1), false, 'one sign-off is insufficient');
  sign.run('G2', 'Workforce-First Gate');
  assert.equal(eligible(1), true);
  assert.equal(eligible(2), false, 'sign-offs cannot be shared across companies');
  assert.equal(eligible(null), false);

  db.prepare("UPDATE hr_gates SET is_active = 0 WHERE code = 'G2'").run();
  assert.equal(eligible(1), false);
  db.prepare("UPDATE hr_gates SET is_active = 1, deleted_at = passed_at WHERE code = 'G2'").run();
  assert.equal(eligible(1), false);
  db.prepare("UPDATE hr_gates SET deleted_at = NULL WHERE code = 'G2'").run();

  db.prepare("UPDATE core_feature_flags SET default_enabled = 0 WHERE key = 'ff.portal.p2501'").run();
  assert.equal(eligible(1), false, 'sign-offs cannot enable a disabled flag');
});

test('external invitation, MFA, session isolation and revocation use live partner records', async (t) => {
  const storagePath = mkdtempSync(join(tmpdir(), 'erp-portal-'));
  const api = await startApi({}, { storagePath });
  t.after(async () => {
    await api.close();
    rmSync(storagePath, { recursive: true, force: true });
  });
  const { db } = api;
  const path = '/api/v1/portal';
  const admin = { roles: 'SYSADM' };
  db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)')
    .run('portal-reviewer', 'Portal reviewer', JSON.stringify(['SYSADM']), 'portal-reviewer@example.com');
  const buyer = { roles: 'PROCMGR' };
  const anonymous = { user: null, company: null };
  db.prepare("UPDATE core_feature_flags SET default_enabled = 1 WHERE key = 'ff.portal.p2501'").run();
  const sign = db.prepare(`INSERT INTO hr_gates
    (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1, ?, ?, 'PASSED', 'test', '2026-11-20T00:00:00Z')`);
  sign.run('G1', 'Platform Gate');
  sign.run('G2', 'Workforce-First Gate');
  const addPartner = db.prepare(`INSERT INTO mdm_partners
    (company_id, code, legal_name, constitution, steward_role, partner_status)
    VALUES (1, ?, ?, 'OTHER', 'PROCMGR', 'ACTIVE')`);
  const A = Number(addPartner.run('P-A', 'First partner').lastInsertRowid);
  const B = Number(addPartner.run('P-B', 'Second partner').lastInsertRowid);
  const addRole = db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (1, ?, 'VENDOR')");
  addRole.run(A);
  addRole.run(B);
  const addContact = db.prepare('INSERT INTO mdm_partner_contacts (company_id, partner_id, name) VALUES (1, ?, ?)');
  const contactA = Number(addContact.run(A, 'First contact').lastInsertRowid);
  const contactB = Number(addContact.run(B, 'Second contact').lastInsertRowid);
  const invite = (who, partnerId, contactId) => api.call('POST', `${path}/admin/invitations`, {
    ...who, body: { partnerId, contactId, portalType: 'X-SUP' },
  });

  assert.equal((await invite(admin, A, contactA)).status, 403);
  assert.equal((await invite(buyer, A, contactB)).status, 404);
  const invitation = await invite(buyer, A, contactA);
  assert.equal(invitation.status, 201, JSON.stringify(invitation.json));
  assert.equal((await invite(buyer, A, contactA)).status, 409);
  const invitationToken = invitation.json.data.token;
  const prepared = await api.call('POST', `${path}/invitation`, { ...anonymous, body: { token: invitationToken } });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.json));
  const { account, secret, termsVersion } = prepared.json.data;
  const setupCounter = counterAt(Date.now());
  const password = 'Fixture phrase 91 outside common lists!';
  const activate = () => api.call('POST', `${path}/activation`, {
    ...anonymous, body: { token: invitationToken, password, code: totpAt(secret, setupCounter - 1), termsVersion },
  });
  assert.equal((await activate()).status, 200);
  assert.equal((await activate()).status, 401);
  const login = (counter) => api.call('POST', `${path}/session`, {
    ...anonymous, body: { account, password, code: totpAt(secret, counter) },
  });
  assert.equal((await login(setupCounter - 1)).status, 401, 'activation code cannot be reused');
  const signedIn = await login(setupCounter);
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  const headers = { authorization: `Bearer ${signedIn.json.data.token}` };
  const readProfile = (query = '') => api.call('GET', `${path}/profile${query}`, { ...anonymous, headers });
  const profile = await readProfile(`?partnerId=${B}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.json.data.partnerName, 'First partner');
  assert.equal(profile.json.data.contactName, 'First contact');
  assert.equal((await api.call('GET', `${path}/profile`, admin)).status, 401);
  assert.equal((await api.call('GET', `${path}/admin/accounts`, { ...anonymous, headers })).status, 401);
  assert.equal((await api.call('GET', '/api/v1/core/about', { ...anonymous, headers })).status, 401);
  const list = await api.call('GET', `${path}/admin/accounts`, admin);
  assert.equal(list.status, 200);
  const row = list.json.data[0];
  assert.equal(row.status, 'ACTIVE');
  assert.ok(!JSON.stringify(list.json).includes(invitationToken));
  const exportQuery = new URLSearchParams({ format: 'csv', 'filter[status]': 'ACTIVE' });
  const accountExport = await api.raw('GET', `${path}/admin/accounts/export?${exportQuery}`, admin);
  assert.equal(accountExport.status, 200, accountExport.buffer.toString('utf8').slice(0, 200));
  assert.match(accountExport.buffer.toString('utf8'), new RegExp(account));
  assert.ok(!accountExport.buffer.toString('utf8').includes(invitationToken));
  assert.equal((await api.call('GET', `${path}/admin/accounts/export?${exportQuery}`, buyer)).status, 403);

  const privateRequest = { ...anonymous, headers };
  const requestDetails = { subject: 'Updated business name', body: 'Please review our updated trading name.' };
  const sendRequest = (body) => api.call('POST', `${path}/profile/requests`, {
    ...privateRequest, headers: { ...headers, 'idempotency-key': 'portal-request-fixture-1' }, body,
  });
  const request = await sendRequest(requestDetails);
  assert.equal(request.status, 201, JSON.stringify(request.json));
  const alert = db.prepare(`SELECT user_ref, body FROM ntf_notifications
    WHERE template_code = 'portal.profile.requested'`).get();
  assert.equal(alert?.user_ref, 'portal-reviewer');
  assert.ok(alert.body.includes(request.json.data.reference));
  assert.deepEqual((await sendRequest(requestDetails)).json, request.json);
  assert.equal((await sendRequest({ ...requestDetails, subject: 'Different subject' })).status, 409);
  const requestList = await api.call('GET', `${path}/admin/accounts/${row.id}/requests`, admin);
  assert.equal(requestList.json.data.length, 1);
  const notice = await api.call('POST', `${path}/admin/accounts/${row.id}/requests/${request.json.data.id}/close`, {
    ...admin, body: { version: requestList.json.data[0].version, response: 'The partner steward will review the change.' },
  });
  assert.equal(notice.status, 200, JSON.stringify(notice.json));
  const inbox = (await api.call('GET', `${path}/messages`, privateRequest)).json.data;
  const response = inbox.find((item) => item.kind === 'NOTICE');
  assert.equal(response.status, 'UNREAD');
  assert.equal((await api.call('POST', `${path}/messages/${response.id}/read`, privateRequest)).status, 200);

  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Issued project document');
  const source = await pdf.save();
  mkdirSync(join(storagePath, 'files'), { recursive: true });
  writeFileSync(join(storagePath, 'files', 'partner-document.pdf'), source);
  const documentId = Number(db.prepare(`INSERT INTO doc_documents
    (company_id, doc_no, title, doc_type, status, owner_user_ref)
    VALUES (1, 'PORTAL-PDF', 'Issued partner document', 'TEST', 'ISSUED', 'tester')`).run().lastInsertRowid);
  const versionId = Number(db.prepare(`INSERT INTO doc_versions
    (company_id, document_id, revision, revision_no, status) VALUES (1, ?, 'A', 1, 'ISSUED')`).run(documentId).lastInsertRowid);
  const fileId = Number(db.prepare(`INSERT INTO core_files
    (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id)
    VALUES (1, 'partner-document.pdf', 'partner-document.pdf', 'pdf', 'application/pdf', 'document', ?, ?, 'CLEAN', 'doc_version', ?)`)
    .run(source.length, createHash('sha256').update(source).digest('hex'), versionId).lastInsertRowid);
  db.prepare('UPDATE doc_versions SET file_id = ? WHERE id = ?').run(fileId, versionId);
  db.prepare('UPDATE doc_documents SET current_version_id = ? WHERE id = ?').run(versionId, documentId);
  const share = await api.call('POST', `${path}/admin/accounts/${row.id}/shares`, { ...admin, body: { versionId } });
  assert.equal(share.status, 201, JSON.stringify(share.json));
  const shareId = share.json.data.id;
  const otherAccountId = Number(db.prepare(`INSERT INTO ptl_accounts
    (company_id, doc_no, partner_id, contact_id, portal_type, status, terms_version, terms_accepted_at)
    VALUES (1, 'PTL-22222222222222222222222222222222', ?, ?, 'X-SUP', 'ACTIVE', ?, CURRENT_TIMESTAMP)`).run(B, contactB, termsVersion).lastInsertRowid);
  const otherToken = newToken();
  db.prepare('INSERT INTO ptl_sessions VALUES (?, ?, ?, ?)').run(hashToken(otherToken), otherAccountId, Date.now() + 60000, Date.now());
  const other = { ...anonymous, headers: { authorization: `Bearer ${otherToken}` } };
  assert.equal((await api.call('GET', `${path}/profile`, other)).json.data.partnerName, 'Second partner');
  assert.deepEqual((await api.call('GET', `${path}/messages`, other)).json.data, []);
  assert.equal((await api.call('POST', `${path}/messages/${response.id}/read`, other)).status, 404);
  assert.deepEqual((await api.call('GET', `${path}/documents`, other)).json.data, []);
  assert.equal((await api.call('GET', `${path}/documents/${shareId}/ticket`, other)).status, 404);
  const docs = await api.call('GET', `${path}/documents`, privateRequest);
  assert.deepEqual(docs.json.data.map((item) => item.title), ['Issued partner document']);
  assert.equal((await api.call('GET', `${path}/documents/${shareId}/content`, privateRequest)).status, 401);
  const ticket = await api.call('GET', `${path}/documents/${shareId}/ticket`, privateRequest);
  assert.equal(ticket.status, 200, JSON.stringify(ticket.json));
  const downloadRequest = { ...privateRequest, headers: { ...headers, 'x-portal-download': ticket.json.data.ticket } };
  const file = await api.raw('GET', `${path}/documents/${shareId}/content`, downloadRequest);
  assert.equal(file.status, 200, file.buffer.toString('utf8').slice(0, 200));
  assert.match(file.headers.get('content-type'), /^application\/pdf/);
  assert.equal((await PDFDocument.load(file.buffer)).getPageCount(), 1);
  assert.ok(!file.buffer.equals(Buffer.from(source)), 'the returned file has the added watermark');
  assert.equal((await api.call('GET', `${path}/documents/${shareId + 1}/content`, privateRequest)).status, 404);
  db.prepare("UPDATE core_files SET scan_status = 'INFECTED' WHERE id = ?").run(fileId);
  assert.equal((await api.call('GET', `${path}/documents/${shareId}/content`, downloadRequest)).status, 404);
  assert.deepEqual((await api.call('GET', `${path}/documents`, privateRequest)).json.data, []);

  const revoke = (version) => api.call('POST', `${path}/admin/accounts/${row.id}/revoke`, { ...admin, body: { version } });
  assert.equal((await revoke(row.version - 1)).status, 409);
  assert.equal((await revoke(row.version)).status, 200);
  assert.equal((await readProfile()).status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM core_audit_log WHERE entity = 'ptl_accounts' AND entity_id = ?").get(String(row.id)).count, 15);
  const batch = await api.call('POST', `${path}/admin/accounts/revoke`, { ...admin, body: { ids: [row.id, 99999] } });
  assert.deepEqual(batch.json.data.results, [{ id: row.id, ok: true }, { id: 99999, ok: false, message: 'Account unavailable.' }]);

  const projectId = Number(db.prepare(`INSERT INTO org_projects (company_id, code, name, type)
    VALUES (1, 'PORTAL-SITE', 'Portal entitlement project', 'ROAD')`).run().lastInsertRowid);
  const stakeholderId = Number(db.prepare(`INSERT INTO proj_stakeholders
    (company_id, org_project_id, skind, organisation, name)
    VALUES (1, ?, 'CONSULTANT', 'Project Consultant', 'Project representative')`).run(projectId).lastInsertRowid);
  const inviteStakeholder = (portalType) => api.call('POST', `${path}/admin/invitations`, {
    roles: 'PM', body: { stakeholderId, portalType },
  });
  assert.equal((await inviteStakeholder('X-CLI')).status, 404);
  const consultant = await inviteStakeholder('X-CON');
  assert.equal(consultant.status, 201, JSON.stringify(consultant.json));
  const consultantInfo = await api.call('POST', `${path}/invitation`, {
    ...anonymous, body: { token: consultant.json.data.token },
  });
  assert.equal(consultantInfo.status, 200);
  db.prepare("UPDATE proj_stakeholders SET sstatus = 'INACTIVE' WHERE id = ?").run(stakeholderId);
  assert.equal((await api.call('POST', `${path}/invitation`, {
    ...anonymous, body: { token: consultant.json.data.token },
  })).status, 401);
});

test('vendor self-registration uses both partner approvers and allows a scoped correction', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  const { db } = api;
  const path = '/api/v1/portal/registrations';
  const anon = { user: null, company: null };
  const procurement = { user: 'portal-buyer', roles: 'PROCMGR' };
  const accounts = { user: 'portal-accountant', roles: 'ACCMGR' };
  for (const actor of [procurement, accounts]) {
    db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)')
      .run(actor.user, actor.user, JSON.stringify([actor.roles]), `${actor.user}@example.com`);
  }
  db.prepare("UPDATE core_feature_flags SET default_enabled = 1 WHERE key = 'ff.portal.p2501'").run();
  const sign = db.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (1, ?, ?, 'PASSED', 'test', '2026-11-20T00:00:00Z')`);
  sign.run('G1', 'Platform Gate');
  sign.run('G2', 'Workforce-First Gate');
  const { code: companyCode } = db.prepare('SELECT code FROM org_companies WHERE id = 1').get();
  const receipt = 'B'.repeat(43);
  const details = { companyCode, legalName: 'Independent Steel Products', constitution: 'OTHER', pan: 'AAACO4312Q',
    contactName: 'Steel sales representative', email: 'sales@example.com', address: 'Unit 18, industrial estate', stateCode: 'MH' };
  const submit = () => api.call('POST', path, { ...anon, headers: { 'idempotency-key': receipt }, body: details });
  const status = (value = receipt) => api.call('POST', `${path}/status`, { ...anon, body: { receipt: value } });
  const submitted = await submit();
  assert.equal(submitted.status, 202, JSON.stringify(submitted.json));
  assert.equal(submitted.json.data.status, 'PENDING');
  assert.deepEqual((await submit()).json, submitted.json);
  assert.equal((await status('A'.repeat(43))).status, 404);
  const partner = db.prepare('SELECT id, workflow_instance_id AS instance FROM mdm_partners WHERE code = ?').get(submitted.json.data.reference);
  const assigned = async (actor) => (await api.call('GET', '/api/v1/workflow/tasks?mine=assigned', actor))
    .json.data.rows.find((row) => row.instance.id === partner.instance);
  const act = async (actor, action, key) => {
    const task = await assigned(actor);
    assert.ok(task, `${actor.roles} has the task`);
    const result = await api.call('POST', `/api/v1/workflow/tasks/${task.id}/act`, {
      ...actor, headers: { 'idempotency-key': key }, body: { action, comment: 'Reviewed vendor registration details' },
    });
    assert.equal(result.status, 200, JSON.stringify(result.json));
  };

  assert.equal(await assigned(accounts), undefined);
  await act(procurement, 'return', 'portal-vendor-return');
  const returned = await status();
  assert.equal(returned.json.data.status, 'RETURNED');
  const revise = (value) => api.call('POST', `${path}/revise`, {
    ...anon, headers: { authorization: `Bearer ${value}` },
    body: { ...details, address: 'Unit 20, industrial estate', version: returned.json.data.version },
  });
  assert.equal((await revise('A'.repeat(43))).status, 404);
  assert.equal((await revise(receipt)).status, 202);
  await act(procurement, 'approve', 'portal-vendor-procurement');
  assert.equal((await status()).json.data.status, 'PENDING');
  await act(accounts, 'approve', 'portal-vendor-accounts');
  assert.equal((await status()).json.data.status, 'ACTIVE');
  assert.equal((await revise(receipt)).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ptl_accounts WHERE partner_id = ?').get(partner.id).count, 0);
});
