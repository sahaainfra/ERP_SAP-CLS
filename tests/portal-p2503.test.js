import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlagService } from '../src/server/modules/core/feature-flags/service.js';
import { createPortalService } from '../src/server/modules/portal/service.js';
import { hashToken, newToken } from '../src/server/platform/identity/tokens.js';
import { startApi } from './helpers.js';

test('the subcontractor adapter requires a live partner grant and its company gates and feature flags', async (t) => {
  const { db, close, call } = await startApi();
  t.after(async () => {
    await close();
    db.close();
  });
  const flags = createFlagService({ db, environment: 'test' });
  const service = createPortalService({ db, flags, vaultKey: null });
  const companyId = Number(db.prepare(`INSERT INTO org_companies (code, legal_name, short_name)
    VALUES ('SUB-TEST', 'Subcontractor test company', 'Subcontractor test')`).run().lastInsertRowid);
  const projectId = Number(db.prepare(`INSERT INTO org_projects (company_id, code, name, type)
    VALUES (?, 'SUB-PROJECT', 'Subcontract test project', 'ROAD')`).run(companyId).lastInsertRowid);
  const siteId = Number(db.prepare(`INSERT INTO org_sites (company_id, org_project_id, code, name)
    VALUES (?, ?, 'SUB-SITE', 'Subcontract test site')`).run(companyId, projectId).lastInsertRowid);
  const partnerId = Number(db.prepare(`INSERT INTO mdm_partners
    (company_id, code, legal_name, constitution, steward_role, partner_status)
    VALUES (?, 'SUB-PARTNER', 'Subcontract test partner', 'OTHER', 'COMMGR', 'ACTIVE')`).run(companyId).lastInsertRowid);
  db.prepare(`INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role)
    VALUES (?, ?, 'SUBCONTRACTOR'), (?, ?, 'VENDOR')`).run(companyId, partnerId, companyId, partnerId);
  const contactId = Number(db.prepare(`INSERT INTO mdm_partner_contacts (company_id, partner_id, name, project_id, site_id)
    VALUES (?, ?, 'Subcontract contact', ?, ?)`).run(companyId, partnerId, projectId, siteId).lastInsertRowid);
  const now = Date.now();
  const activeSession = (type, suffix) => {
    const accountId = Number(db.prepare(`INSERT INTO ptl_accounts
      (company_id, partner_id, contact_id, project_id, site_id, portal_type, doc_no, status, terms_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', '2026-11-20')`)
      .run(companyId, partnerId, contactId, projectId, siteId, type, `PTL-${suffix.repeat(32)}`).lastInsertRowid);
    const secret = newToken();
    db.prepare('INSERT INTO ptl_sessions VALUES (?, ?, ?, ?)').run(hashToken(secret), accountId, now + 60_000, now);
    return { accountId, secret };
  };
  const subcontractor = activeSession('X-SUB', 'a');
  const supplier = activeSession('X-SUP', 'b');
  const current = () => service.subcontractorScope(subcontractor.secret);
  const override = db.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES (?, ?, 'Test override', 0, 1)`);
  const sign = db.prepare(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at)
    VALUES (?, ?, ?, 'PASSED', 'test', CURRENT_TIMESTAMP)`);
  override.run('ff.portal.p2501', companyId);
  sign.run(1, 'G1', 'Platform Gate');
  sign.run(1, 'G2', 'Workforce Gate');
  assert.throws(current, { status: 401 }, 'a different company’s sign-offs do not apply');
  sign.run(companyId, 'G1', 'Platform Gate');
  assert.throws(current, { status: 401 }, 'both company gates are required');
  sign.run(companyId, 'G2', 'Workforce Gate');
  assert.throws(current, { status: 404 }, '25.03 is off by default');
  override.run('ff.portal.p2503', 1);
  assert.throws(current, { status: 404 }, 'another company’s opt-in does not apply');
  override.run('ff.portal.p2503', companyId);

  const scope = current();
  assert.deepEqual(scope, { companyId, partnerId, accountId: subcontractor.accountId, projectId, siteId });
  assert.equal(Object.isFrozen(scope), true);
  assert.throws(() => service.subcontractorScope(supplier.secret), { status: 403 });
  assert.throws(() => service.subcontractorScope(newToken()), { status: 401 });
  assert.equal((await call('GET', '/api/v1/portal/subcontractor/work-orders', {
    user: null, company: null, headers: { Authorization: `Bearer ${subcontractor.secret}` },
  })).status, 401, 'the external session cannot fall through to internal authentication');
  assert.equal((await call('GET', '/api/v1/portal/subcontractor/work-orders', {
    user: 'admin-fixture', roles: 'SYSADM', company: String(companyId),
  })).status, 404, 'the adapter has no mounted business route');

  db.prepare('UPDATE mdm_partner_contacts SET site_id = NULL WHERE id = ?').run(contactId);
  assert.throws(current, { status: 401 }, 'a stale grant is invalid after the contact scope changes');
  db.prepare('UPDATE mdm_partner_contacts SET site_id = ? WHERE id = ?').run(siteId, contactId);
  const gateState = db.prepare("UPDATE hr_gates SET status = ? WHERE company_id = ? AND code = 'G2'");
  gateState.run('RETURNED', companyId);
  assert.throws(current, { status: 401 }, 'the current company gate status is checked after sign-in');
  gateState.run('PASSED', companyId);
  const subcontractorRole = db.prepare(`UPDATE mdm_partner_roles SET is_active = ?
    WHERE company_id = ? AND partner_id = ? AND partner_role = 'SUBCONTRACTOR'`);
  subcontractorRole.run(0, companyId, partnerId);
  assert.throws(current, { status: 401 }, 'a live vendor role cannot substitute for the removed subcontractor role');
  subcontractorRole.run(1, companyId, partnerId);
  assert.deepEqual(current(), scope);
  db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE company_id = ? AND key = 'ff.portal.p2501'").run(companyId);
  assert.throws(current, { status: 401 }, 'the framework flag is rechecked');
  db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE company_id = ? AND key = 'ff.portal.p2501'").run(companyId);
  db.prepare("UPDATE ptl_accounts SET status = 'REVOKED' WHERE id = ?").run(subcontractor.accountId);
  assert.throws(current, { status: 401 }, 'the grant is revoked with its account');
});
