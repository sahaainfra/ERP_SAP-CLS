import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 30.10 (AC-02, AC-07, T-UI-01, T-UI-02): Go-Live Readiness on a 1280 px desktop and a 360 px phone. The programme manager evaluates
// the checklist (the board: one column at a time with pills on a phone, a criterion moved through its menu), generates the UAT scripts, a
// business user fails a script and raises a defect, the defect is triaged; the dry run of the cut-over runs its automatic steps and the owners
// complete theirs; a NO-GO decision is recorded and approved along PCMGR → CFO → DIR.

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main .kpi-label, main .kpi-value, main .tabs button, main .ph-actions button')]
        .filter((element) => element.getClientRects().length && getComputedStyle(element).overflow !== 'visible' && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}

test('Go-live readiness board, UAT, dry run and the go/no-go decision', async ({ page, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const suffix = `${phone ? 'm' : 'd'}-${Date.now().toString(36).slice(-5)}`;
  const pm = `prog-mgr-${suffix}`; const it = `it-${suffix}`; const se = `se-${suffix}`; const pm2 = `prog-mgr2-${suffix}`; const cfo = `cfo-${suffix}`; const dir = `dir-${suffix}`;
  const headers = (roles, company, who) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': who, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `GO-${suffix.toUpperCase()}`, legalName: 'Go-Live Readiness Builders', shortName: 'Readiness' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [u, r] of [[pm, 'PCMGR'], [it, 'ITADM'], [se, 'SE'], [pm2, 'PCMGR'], [cfo, 'CFO'], [dir, 'DIR']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, u, u, JSON.stringify([r]));
    for (const f of ['ff.qa.p3010', 'ff.admin.p2906']) db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Go-live browser fixture', 0, 1)").run(f, company);
  } finally {
    db.close();
  }
  const api = async (method, path, data, roles, who) => { const r = await request.fetch(`/api/v1${path}`, { method, headers: headers(roles, company, who), data }); expect(r.status(), await r.text()).toBeLessThan(300); return (await r.json()).data; };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket|status of 404|status of 422/.test(message.text())) errors.push(message.text()); });
  const as = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: pm, roles: 'PCMGR', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // the readiness board, evaluated from the records
  await page.goto('/admin/go-live');
  await expect(page.getByTestId('tst-golive')).toBeVisible();
  await expect(page.getByTestId('tst-golive')).toHaveAttribute('data-ready', 'no');
  await expect(page.getByTestId('gl-board')).toBeVisible();
  if (phone) {
    await expect(page.getByTestId('gl-column')).toHaveCount(1);
    await page.getByTestId('gl-columns').getByRole('tab').first().click();
    await expect(page.getByTestId('gl-column')).toHaveAttribute('data-status', 'OPEN');
  } else {
    await expect(page.getByTestId('gl-column')).toHaveCount(4);
  }
  // a manual criterion moved through its menu, with its evidence
  if (phone) await page.getByTestId('gl-columns').getByRole('tab').first().click();
  await page.getByTestId('gl-move-SUPPORT_MODEL').locator('summary').click();
  await page.getByTestId('gl-ev-SUPPORT_MODEL').fill('docs/erp/runbooks/support-model.md');
  await page.getByTestId('gl-to-MET-SUPPORT_MODEL').click();
  if (phone) await page.getByTestId('gl-columns').getByRole('tab').nth(2).click();
  await expect(page.getByTestId('gl-item-SUPPORT_MODEL')).toBeVisible();
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/30.10/${phone ? 'mobile' : 'desktop'}-go-live-readiness-checklist.png`, fullPage: false });
  await checkAppearance(page);

  // UAT: the scripts from the build, a business user fails one and raises a defect; the defect is taken into triage
  await page.goto('/admin/go-live?tab=uat');
  await page.getByTestId('gl-generate').click();
  await expect(page.getByTestId('gl-uat-chart')).toBeVisible();
  await expect(page.getByTestId('gl-module').first()).toBeVisible();
  const script = (await api('GET', '/tst/golive?module=site&pageSize=5', undefined, 'PCMGR', pm)).uat.scripts.rows[0];
  await api('POST', `/tst/golive/uat/scripts/${script.id}/run`, { result: 'FAIL', defect: { title: 'The DPR photo is not attached on 2G', severity: 'S2' } }, 'SE', se);
  await page.reload();
  await expect(page.locator('[data-testid="gl-defect"][data-severity="S2"]')).toHaveCount(1);
  await page.locator('[data-testid^="gl-triage-"]').first().click();
  await expect(page.locator('[data-testid="gl-defect"][data-status="TRIAGED"]')).toHaveCount(1);
  if (phone) expect(await page.getByTestId('gl-module-table').evaluate((t) => getComputedStyle(t).display)).toBe('block');
  await noOverflow();

  // the dry run: the automatic steps run; ITADM and the programme manager complete theirs
  await page.goto('/admin/go-live?tab=cutover');
  await page.getByTestId('gl-plan-dry').click();
  await page.getByTestId('gl-start').click();
  await expect(page.locator('[data-testid="gl-step"][data-code="FREEZE_LEGACY"]')).toHaveAttribute('data-status', 'RUNNING');
  await as(it, 'ITADM'); await page.reload();
  await page.getByTestId('gl-step-note-FREEZE_LEGACY').fill('Legacy frozen; final extracts taken.');
  await page.getByTestId('gl-done-FREEZE_LEGACY').click();
  await expect(page.locator('[data-testid="gl-step"][data-code="BUSINESS_CHECK"]')).toHaveAttribute('data-status', 'RUNNING');
  await as(pm, 'PCMGR'); await page.reload();
  await page.getByTestId('gl-step-note-BUSINESS_CHECK').fill('Key figures agree with the legacy reports.');
  await page.getByTestId('gl-done-BUSINESS_CHECK').click();
  await expect(page.locator('[data-testid="gl-step"][data-code="LIFT_FREEZE"]')).toHaveAttribute('data-status', 'DONE');
  await expect(page.getByTestId('gl-run')).toContainText(/Completed|पूर्ण/);
  await noOverflow();

  // the go/no-go meeting: NO-GO (the gates G5-G7 are not passed), approved along the chain
  await page.goto('/admin/go-live?tab=decision');
  await page.getByTestId('gl-attendees').fill('Programme manager, CFO, Director, IT lead');
  await page.getByTestId('gl-minutes').fill('Gates G5 to G7 are not passed and UAT is not signed for every module; meet again in two weeks.');
  await page.getByTestId('gl-submit-decision').click();
  await expect(page.getByTestId('gl-decision')).toBeVisible();
  for (const [u, r] of [[pm2, 'PCMGR'], [cfo, 'CFO']]) { await as(u, r); await page.reload(); await page.getByTestId('gl-approve').click(); await expect(page.getByTestId('gl-approve')).toHaveCount(0); }
  await as(dir, 'DIR'); await page.reload();
  await expect(page.getByTestId('gl-decision')).toBeVisible();
  await page.getByTestId('gl-approve').click();
  await expect(page.getByTestId('gl-decision')).toContainText(/Approved|अनुमोदित/);
  await noOverflow();
  expect(errors).toEqual([]);
});
