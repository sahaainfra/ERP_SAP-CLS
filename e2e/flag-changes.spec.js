import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Audit AUD-DEF-009: in staging and production a flag change waits for a second person. The test installation applies changes at once, so a
// waiting change is put in place as staging would record it; the requester sees it and may cancel, an IT administrator approves it.
test('a flag change waiting for approval: the requester cannot approve it, an IT administrator applies it', async ({ page }, info) => {
  // company 1, as the other flag specs; the change switches on the page's own flag (already on), so no other spec is affected
  const company = 1; const docNo = `FLG/E2E-${info.project.name === 'mobile' ? 'M' : 'D'}`;
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  let id;
  try {
    db.prepare('DELETE FROM core_flag_changes WHERE company_id = ? AND doc_no = ?').run(company, docNo);
    id = Number(db.prepare("INSERT INTO core_flag_changes (company_id, doc_no, flag_key, scope_level, scope_company_id, enabled, area, reason, status, requested_by, created_by, source_type) VALUES (?, ?, 'ff.prog.p0002', 'company', ?, 1, 'GENERAL', 'Keep the flag page on for the pilot', 'PENDING', 'sys-flags', 'sys-flags', 'e2e')").run(company, docNo, company).lastInsertRowid);
  } finally { db.close(); }
  const as = async (user, roles) => { await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) }); await page.goto('/admin/feature-flags'); };
  await as('sys-flags', 'SYSADM');
  const row = page.getByTestId('flag-change').filter({ hasText: docNo });
  await expect(row).toHaveAttribute('data-status', 'PENDING');
  await expect(row.getByTestId('flag-change-approve')).toHaveCount(0);
  await expect(row.getByTestId('flag-change-cancel')).toBeVisible();
  await as('it-flags', 'ITADM');
  await row.getByTestId('flag-change-approve').click();
  await expect(row).toHaveAttribute('data-status', 'APPLIED');
  const check = new DatabaseSync('data/e2e.sqlite', { readOnly: true });
  try { expect(check.prepare("SELECT enabled FROM core_feature_flags WHERE key = 'ff.prog.p0002' AND company_id = ? AND project_id IS NULL").get(company)?.enabled).toBe(1); expect(check.prepare('SELECT decided_by FROM core_flag_changes WHERE id = ?').get(id).decided_by).toBe('it-flags'); } finally { check.close(); }
});
