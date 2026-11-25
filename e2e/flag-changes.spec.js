import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Audit AUD-DEF-009: in staging and production a flag change waits for a second person. The test installation applies changes at once, so a
// waiting change is put in place as staging would record it; the requester sees it and may cancel, an IT administrator approves it.
test('a flag change waiting for approval: the requester cannot approve it, an IT administrator applies it', async ({ page }, info) => {
  const company = info.project.name === 'mobile' ? 802 : 801;
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000; PRAGMA foreign_keys = OFF;');
  let id;
  try {
    db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by) VALUES (?, ?, 'Flag Checkers Pvt Ltd', 'Flags', 'e2e')").run(company, `FLAGS${company}`);
    for (const f of ['ff.prog.p0002']) db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'e2e', 0, 1)").run(f, company);
    db.prepare("DELETE FROM core_feature_flags WHERE key = 'ff.ui.p0304' AND company_id = ? AND project_id IS NULL").run(company);
    id = Number(db.prepare("INSERT INTO core_flag_changes (company_id, doc_no, flag_key, scope_level, scope_company_id, enabled, area, reason, status, requested_by, created_by, source_type) VALUES (?, 'FLG/00001', 'ff.ui.p0304', 'company', ?, 1, 'GENERAL', 'Switch on for the pilot company', 'PENDING', 'sys-flags', 'sys-flags', 'e2e')").run(company, company).lastInsertRowid);
  } finally { db.close(); }
  const as = async (user, roles) => { await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) }); await page.goto('/admin/feature-flags'); };
  await as('sys-flags', 'SYSADM');
  const row = page.getByTestId('flag-change').filter({ hasText: 'FLG/00001' });
  await expect(row).toHaveAttribute('data-status', 'PENDING');
  await expect(row.getByTestId('flag-change-approve')).toHaveCount(0);
  await expect(row.getByTestId('flag-change-cancel')).toBeVisible();
  await as('it-flags', 'ITADM');
  await row.getByTestId('flag-change-approve').click();
  await expect(row).toHaveAttribute('data-status', 'APPLIED');
  const check = new DatabaseSync('data/e2e.sqlite', { readOnly: true });
  try { expect(check.prepare("SELECT enabled FROM core_feature_flags WHERE key = 'ff.ui.p0304' AND company_id = ? AND project_id IS NULL").get(company)?.enabled).toBe(1); expect(check.prepare('SELECT decided_by FROM core_flag_changes WHERE id = ?').get(id).decided_by).toBe('it-flags'); } finally { check.close(); }
});
