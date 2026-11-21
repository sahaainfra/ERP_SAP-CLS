import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlagService } from '../src/server/modules/core/feature-flags/service.js';
import { createPortalService } from '../src/server/modules/portal/service.js';
import { newToken } from '../src/server/platform/identity/tokens.js';
import { counterAt, totpAt } from '../src/server/platform/identity/totp.js';
import { startApi } from './helpers.js';

test('client and consultant grants require a live project assignment and the same company’s flags and gates', async (t) => {
  const { db, call, close } = await startApi();
  t.after(async () => {
    await close();
    db.close();
  });
  const service = createPortalService({ db, flags: createFlagService({ db, environment: 'test' }), vaultKey: null });
  const flag = db.prepare(`SELECT default_enabled, enabled FROM core_feature_flags
    WHERE key = 'ff.portal.p2504' AND company_id IS NULL AND environment IS NULL AND deleted_at IS NULL`).get();
  assert.deepEqual({ ...flag }, { default_enabled: 0, enabled: 0 });
  const insert = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);
  const companyId = insert(`INSERT INTO org_companies (code, legal_name, short_name)
    VALUES ('PORTAL-REVIEW', 'Portal review company', 'Portal review')`);
  const addProject = (code) => insert(`INSERT INTO org_projects (company_id, code, name, type, status)
    VALUES (?, ?, ?, 'ROAD', 'ACTIVE')`, companyId, code, code);
  const projectId = addProject('PORTAL-SHARED');
  const otherProjectId = addProject('PORTAL-OTHER');
  const siteId = insert(`INSERT INTO org_sites (company_id, org_project_id, code, name, status)
    VALUES (?, ?, 'PORTAL-SITE', 'Review site', 'ACTIVE')`, companyId, projectId);
  const partnerId = insert(`INSERT INTO mdm_partners (company_id, code, legal_name, constitution, steward_role, partner_status)
    VALUES (?, 'PORTAL-CLIENT', 'Review client', 'OTHER', 'COMMGR', 'ACTIVE')`, companyId);
  db.prepare(`INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role)
    VALUES (?, ?, 'CLIENT'), (?, ?, 'VENDOR')`).run(companyId, partnerId, companyId, partnerId);
  const contactId = insert(`INSERT INTO mdm_partner_contacts (company_id, partner_id, name, project_id)
    VALUES (?, ?, 'Client representative', ?)`, companyId, partnerId, projectId);
  const stakeholderId = insert(`INSERT INTO proj_stakeholders (company_id, org_project_id, site_id, skind, organisation, name)
    VALUES (?, ?, ?, 'CONSULTANT', 'Review consultant', 'Consultant representative')`, companyId, projectId, siteId);
  const enable = db.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES (?, ?, 'Test fixture override', 0, 1)`);
  const passGate = db.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (?, ?, ?, 'PASSED', 'test', CURRENT_TIMESTAMP)`);
  enable.run('ff.portal.p2501', companyId);
  passGate.run(companyId, 'G1', 'Platform Gate');
  passGate.run(1, 'G2', 'Workforce Gate');
  const base = '/api/v1/portal';
  const invite = (roles, body) => call('POST', `${base}/admin/invitations`, { roles, company: String(companyId), body });
  const clientInput = { portalType: 'X-CLI', contactId, partnerId };
  assert.equal((await invite('PM', clientInput)).status, 404, 'a different company’s G2 cannot enable enrollment');
  passGate.run(companyId, 'G2', 'Workforce Gate');
  const external = { user: null, company: null };
  const enroll = async (roles, input) => {
    const invitation = await invite(roles, input);
    assert.equal(invitation.status, 201);
    const inviteToken = invitation.json.data.token;
    const preparation = await call('POST', `${base}/invitation`, { ...external, body: { token: inviteToken } });
    assert.equal(preparation.status, 200);
    const { account, secret, termsVersion } = preparation.json.data;
    const password = 'Fixture phrase 91 outside common lists!';
    const counter = counterAt(Date.now());
    const activation = await call('POST', `${base}/activation`, {
      ...external, body: { token: inviteToken, password, termsVersion, code: totpAt(secret, counter - 1) },
    });
    assert.equal(activation.status, 200);
    const login = await call('POST', `${base}/session`, {
      ...external, body: { account, password, code: totpAt(secret, counterAt(Date.now())) },
    });
    assert.equal(login.status, 200);
    const { id: accountId } = db.prepare('SELECT id FROM ptl_accounts WHERE company_id = ? AND doc_no = ?').get(companyId, account);
    return { accountId, token: login.json.data.token };
  };
  const client = await enroll('PM', clientInput);
  const consultant = await enroll('PM', { portalType: 'X-CON', stakeholderId });
  const supplier = await enroll('PROCMGR', { portalType: 'X-SUP', contactId, partnerId });
  const clientGrant = () => service.clientConsultantScope(client.token);
  const consultantGrant = () => service.clientConsultantScope(consultant.token);
  enable.run('ff.portal.p2504', 1);
  assert.throws(consultantGrant, { status: 404 }, 'another company’s override does not lift the default-off flag');
  enable.run('ff.portal.p2504', companyId);
  assert.deepEqual(clientGrant(), {
    companyId, projectId, siteId: null, role: 'X-CLI', accountId: client.accountId, partnerId, contactId, stakeholderId: null,
  });
  const siteGrant = consultantGrant();
  assert.deepEqual(siteGrant, {
    companyId, projectId, siteId, role: 'X-CON', accountId: consultant.accountId, partnerId: null, contactId: null, stakeholderId,
  });
  assert.ok(Object.isFrozen(siteGrant));
  assert.throws(() => service.clientConsultantScope(supplier.token), { status: 403 });
  assert.throws(() => service.clientConsultantScope(newToken()), { status: 401 });
  const setGate = db.prepare("UPDATE hr_gates SET status = ? WHERE company_id = ? AND code = 'G2'");
  setGate.run('RETURNED', companyId);
  assert.throws(clientGrant, { status: 401 }, 'a different company’s G2 does not keep an existing session valid');
  setGate.run('PASSED', companyId);

  db.prepare('UPDATE org_sites SET org_project_id = ? WHERE id = ?').run(otherProjectId, siteId);
  assert.throws(consultantGrant, { status: 403 }, 'a site assigned to another project invalidates the grant');
  db.prepare('UPDATE org_sites SET org_project_id = ? WHERE id = ?').run(projectId, siteId);
  db.prepare("UPDATE org_sites SET status = 'INACTIVE' WHERE id = ?").run(siteId);
  assert.throws(consultantGrant, { status: 403 }, 'an inactive site cannot grant access');
  db.prepare("UPDATE org_sites SET status = 'ACTIVE' WHERE id = ?").run(siteId);
  db.prepare("UPDATE proj_stakeholders SET sstatus = 'INACTIVE' WHERE id = ?").run(stakeholderId);
  assert.throws(consultantGrant, { status: 401 }, 'an inactive stakeholder cannot reuse a session');
  db.prepare('UPDATE mdm_partner_contacts SET project_id = ? WHERE id = ?').run(otherProjectId, contactId);
  assert.throws(clientGrant, { status: 401 }, 'a contact reassignment invalidates the old session grant');
  db.prepare('UPDATE mdm_partner_contacts SET project_id = NULL WHERE id = ?').run(contactId);
  db.prepare('UPDATE ptl_accounts SET project_id = NULL WHERE id = ?').run(client.accountId);
  assert.throws(clientGrant, { status: 403 }, 'a company-wide contact cannot enter the project workspace');
  db.prepare('UPDATE mdm_partner_contacts SET project_id = ? WHERE id = ?').run(projectId, contactId);
  db.prepare('UPDATE ptl_accounts SET project_id = ?, status = ? WHERE id = ?').run(projectId, 'REVOKED', client.accountId);
  assert.throws(clientGrant, { status: 401 }, 'a revoked account cannot reuse a session');
});
