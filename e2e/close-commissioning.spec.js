import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Part 26.01 (audit AUD-DEF-004): the commissioning lead builds a system with a tag, passes its class A check sheet and requests the
// mechanical completion certificate, which goes for approval; the register and the certificates list show it.
test('commissioning: a system, its check sheet and the MC certificate request', async ({ page }, info) => {
  const company = 1; const code = `E2E-SYS-${info.project.name === 'mobile' ? 'M' : 'D'}`;
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  let project;
  try {
    db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.close.p2601', ?, 'E2E: commissioning', 0, 1)").run(company);
    db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.close.p2601' AND company_id = ? AND project_id IS NULL").run(company);
    const pcode = `E2E-TNC-${info.project.name === 'mobile' ? 'M' : 'D'}`;
    db.prepare("INSERT OR IGNORE INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(company, pcode, `Commissioning tower ${pcode}`);
    project = db.prepare('SELECT id, code FROM org_projects WHERE company_id = ? AND code = ?').get(company, pcode);
    const old = db.prepare('SELECT id FROM tnc_systems WHERE company_id = ? AND code = ?').all(company, code).map((r) => r.id);
    for (const id of old) {
      db.prepare('DELETE FROM tnc_certificates WHERE system_id = ?').run(id);
      db.prepare('DELETE FROM tnc_checksheets WHERE tag_id IN (SELECT id FROM tnc_tags WHERE system_id = ?)').run(id);
      db.prepare('DELETE FROM tnc_tags WHERE system_id = ?').run(id);
      db.prepare('DELETE FROM tnc_systems WHERE id = ?').run(id);
    }
  } finally { db.close(); }
  expect(project, 'the E2E company has a project').toBeTruthy();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: 'qce-tnc', roles: 'QCE', company: String(company) });
  await page.goto('/close/commissioning');
  await expect(page.getByTestId('close-commissioning')).toBeVisible();
  await page.getByTestId('cm-add').click();
  await page.getByTestId('ns-project').selectOption(String(project.id));
  await page.getByTestId('ns-code').fill(code);
  await page.getByTestId('ns-name').fill('Fire water system');
  await page.getByTestId('ns-disc').selectOption('FIRE');
  await page.getByTestId('ns-save').click();
  await expect(page.getByTestId('close-system')).toHaveAttribute('data-stage', 'CONSTRUCTION');
  await expect(page.getByTestId('sys-ready-MC')).toHaveAttribute('data-ready', 'no');
  await page.getByTestId('tag-no').fill('FWP-01');
  await page.getByTestId('tag-desc').fill('Fire water pump');
  await page.getByTestId('tag-add').click();
  const sheetA = page.getByTestId('sys-sheet').filter({ has: page.locator('td', { hasText: /^A$/ }) });
  await expect(sheetA).toHaveAttribute('data-status', 'OPEN');
  await sheetA.getByRole('button', { name: 'Pass' }).click();
  await expect(sheetA).toHaveAttribute('data-status', 'PASSED');
  await expect(page.getByTestId('sys-ready-MC')).toHaveAttribute('data-ready', 'yes');
  await page.getByTestId('sys-request-MC').click();
  await expect(page.getByTestId('sys-ready-MC')).toContainText('In approval');
  await page.goto('/close/certificates');
  await expect(page.getByTestId('ce-row').filter({ hasText: code })).toHaveAttribute('data-status', 'SUBMITTED');
  await page.goto('/close/commissioning');
  await expect(page.getByTestId('cm-row').filter({ hasText: code })).toBeVisible();
});

// Parts 26.02-26.04: the handover, defects liability and closeout pages open with their data for the project manager; a new handover starts
// with its checklist; a lesson is written as a draft seen by its author.
test('closeout pages: a handover with its checklist, the defects liability overview, a closeout and a lesson', async ({ page }, info) => {
  const company = 1; const tag = info.project.name === 'mobile' ? 'M' : 'D';
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  let project;
  try {
    for (const key of ['ff.close.p2602', 'ff.close.p2603', 'ff.close.p2604']) {
      db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'E2E: closeout', 0, 1)").run(key, company);
      db.prepare('UPDATE core_feature_flags SET enabled = 1 WHERE key = ? AND company_id = ? AND project_id IS NULL').run(key, company);
    }
    // a project of its own per profile, so the one-handover and one-closeout rules do not meet earlier runs
    const code = `E2E-CLS-${tag}`;
    db.prepare("INSERT OR IGNORE INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(company, code, `Closeout tower ${tag}`);
    project = db.prepare('SELECT id, code FROM org_projects WHERE company_id = ? AND code = ?').get(company, code);
    for (const t of ['kb_benchmarks', 'cls_checklist_items']) db.prepare(`DELETE FROM ${t} WHERE ${t === 'kb_benchmarks' ? 'org_project_id = ?' : 'closure_id IN (SELECT id FROM cls_closures WHERE org_project_id = ?)'}`).run(project.id);
    db.prepare('DELETE FROM cls_closures WHERE org_project_id = ?').run(project.id);
    db.prepare('DELETE FROM kb_lessons WHERE org_project_id = ?').run(project.id);
    db.prepare('DELETE FROM ho_client_assets WHERE org_project_id = ?').run(project.id);
    db.prepare('DELETE FROM ho_checklist_items WHERE handover_id IN (SELECT id FROM ho_handovers WHERE org_project_id = ?)').run(project.id);
    db.prepare('DELETE FROM ho_handovers WHERE org_project_id = ?').run(project.id);
  } finally { db.close(); }
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: 'pm-close', roles: 'PM', company: String(company) });

  await page.goto('/close/handovers');
  await expect(page.getByTestId('close-handovers')).toBeVisible();
  await page.getByTestId('ho-add').click();
  await page.getByTestId('nh-project').selectOption(String(project.id));
  await page.getByTestId('nh-title').fill(`Handover of ${project.code}`);
  await page.getByTestId('nh-save').click();
  await expect(page.getByTestId('close-handover')).toHaveAttribute('data-status', 'DRAFT');
  await expect(page.getByTestId('hd-item').first()).toBeVisible();
  await expect(page.getByTestId('hd-ready')).toHaveAttribute('data-ready', 'no');

  await page.goto('/close/dlp');
  await expect(page.getByTestId('close-dlp')).toBeVisible();
  await expect(page.getByTestId('dl-k-active')).toBeVisible();

  await page.goto('/close/closures');
  await expect(page.getByTestId('close-closures')).toBeVisible();
  await page.getByTestId('cl-project').selectOption(String(project.id));
  await page.getByTestId('cl-start').click();
  await expect(page.getByTestId('close-closure')).toHaveAttribute('data-status', 'DRAFT');
  await expect(page.locator('[data-testid="cs-item"][data-code="HANDOVER"]')).toHaveAttribute('data-status', 'OPEN');

  await page.goto('/close/lessons');
  await page.getByTestId('ll-add').click();
  await page.getByTestId('ll-title').fill(`Freeze MEP routes early ${tag}`);
  await page.getByTestId('ll-what').fill('Late changes to MEP routes caused rework of the false ceiling.');
  await page.getByTestId('ll-rec').fill('Freeze the MEP coordination drawings before the ceiling grid is ordered.');
  await page.getByTestId('ll-save').click();
  await expect(page.getByTestId('ll-card').filter({ hasText: `Freeze MEP routes early ${tag}` }).first()).toBeVisible();
  await page.goto('/close/benchmarks');
  await expect(page.getByTestId('close-benchmarks')).toBeVisible();
});
