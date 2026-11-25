import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { postSweep } from './a11y-post.js';

// Parts 30.07-30.09 (AC-01, AC-02, AC-07, T-UI-01, T-UI-02) on a 1280 px desktop and a 360 px phone:
//  - Accessibility & Device Validation Results: the committed sweeps (docs/erp/a11y) and device journeys loaded into the company, a screen
//    reader session recorded by hand, the verdict on business pages, the sign-off asked by the UX lead and approved by the QA lead;
//  - Operations Runbooks & Environments: the inventory and parity, the zero-downtime rehearsal (docs/erp/perf/zero-downtime.json) and a
//    pipeline deploy, runbooks synced, submitted and approved by the system administrator on the page, the on-call rota;
//  - Documentation Library: the package generated from the build, the drafts sent to their owners, an owner approving several at once on the
//    page, a field user seeing only their manuals, the screen-change tab.
// Each page: no sideways scroll at 360 px, tables as cards, parameters in a bottom sheet on a phone, labels not clipped at 125 % text.

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
const json = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);

test('Accessibility validation, operations runbooks and the documentation library', async ({ page, request }, info) => {
  test.setTimeout(600_000);
  const phone = info.project.name === 'mobile';
  const suffix = `${phone ? 'm' : 'd'}-${Date.now().toString(36).slice(-5)}`;
  const qa = `qa-lead-${suffix}`; const ux = `ux-lead-${suffix}`; const pd = `pd-${suffix}`; const se = `se-${suffix}`; const l1 = `l1-desk-${suffix}`; const l3 = `l3-vendor-${suffix}`;
  const headers = (roles, company, who) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': who, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `GL-${suffix.toUpperCase()}`, legalName: 'Go-Live Builders', shortName: 'Go-Live' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [u, r] of [[qa, 'ITADM'], [ux, 'SYSADM'], [pd, 'PD'], [se, 'SE'], [l1, 'ITADM'], [l3, 'ITADM']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, u, u, JSON.stringify([r]));
    for (const f of ['ff.qa.p3007', 'ff.qa.p3008', 'ff.qa.p3009', 'ff.admin.p2908']) db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Go-live consoles browser fixture', 0, 1)").run(f, company);
  } finally {
    db.close();
  }
  const api = async (method, path, data, roles = 'ITADM', who = qa, expectOk = true) => { const r = await request.fetch(`/api/v1${path}`, { method, headers: headers(roles, company, who), data }); if (expectOk) expect(r.status(), await r.text()).toBeLessThan(300); return (await r.json()).data; };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket|status of 404|status of 422/.test(message.text())) errors.push(message.text()); });
  const as = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: qa, roles: 'ITADM', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const cardsOnPhone = async (testid) => { if (phone) expect(await page.getByTestId(testid).evaluate((t) => getComputedStyle(t).display)).toBe('block'); };
  const shot = (part, name) => page.screenshot({ path: `docs/erp/screenshots/${part}/${phone ? 'mobile' : 'desktop'}-${name}.png`, fullPage: false });

  // ---- 30.07: the sweeps and device journeys of the build, a screen-reader session, the verdict and the sign-off
  const H = headers('ITADM', company, qa);
  for (const w of [360, 768, 1280, 1920]) {
    const s = json(`docs/erp/a11y/a11y-${w}.json`);
    if (s) await postSweep(request, H, { kind: s.axe ? 'AXE' : 'RESPONSIVE', width: s.width, height: w <= 400 ? 740 : w <= 800 ? 1024 : w <= 1300 ? 800 : 1080, theme: s.theme ?? 'light', language: 'en', network: 'FAST' }, s.results);
  }
  for (const d of json('docs/erp/a11y/devices.json')?.report ?? []) {
    const dev = (await api('GET', '/tst/a11y')).devices.find((x) => x.code === d.device);
    await api('POST', '/tst/a11y/runs', { kind: 'DEVICE', deviceCode: d.device, language: 'en', network: dev?.network ?? 'FAST', final: true, results: d.journeys.map((j) => ({ journey: j.journey, result: j.result, steps: j.steps, loadMs: Math.min(600_000, j.loadMs) })) });
  }
  await page.goto('/admin/accessibility-validation');
  await expect(page.getByTestId('tst-a11y')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Accessibility');
  await expect(page.getByTestId('ax-chart')).toBeVisible();
  await expect(page.getByTestId('ax-tiles')).toBeVisible();
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('30.07', 'accessibility-device-validation-results');
  await checkAppearance(page);
  await cardsOnPhone('ax-table');
  // a screen-reader session by hand on the field home (FR-02)
  await api('POST', '/tst/a11y/manual', { kind: 'SCREEN_READER', assistiveTech: 'NVDA', language: 'en', network: 'FAST', journey: 'Field home: landmarks, headings and the DPR task read in order', route: '/field', result: 'PASS', notes: 'Read with NVDA 2024 on Chrome: one h1, every button named, the offline banner announced.' });
  const verdict = (await api('GET', '/tst/a11y')).verdict;
  if (!verdict.blocked && verdict.swept) {
    // AC-01 the UX lead asks for the sign-off and the QA lead signs
    await as(ux, 'SYSADM'); await page.reload();
    await page.getByTestId('ax-signoff').click();
    await expect(page.getByTestId('ax-signoff-state')).toHaveAttribute('data-status', 'SUBMITTED');
    await as(qa, 'ITADM'); await page.reload();
    await page.getByTestId('ax-approve').click();
    await expect(page.getByTestId('ax-signoff-state')).toHaveAttribute('data-status', 'APPROVED');
  }

  // ---- 30.08: the inventory and parity, the rehearsal and a pipeline deploy, runbooks approved on the page, the rota
  const zd = json('docs/erp/perf/zero-downtime.json');
  if (zd) await api('POST', '/tst/ops/rehearsals', { environment: 'staging', kind: 'ZERO_DOWNTIME', ok: zd.ok, requests: zd.requests, failed: zd.failed, steps: zd.steps.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms, detail: s.detail.slice(0, 300) })) });
  const t0 = new Date(Date.now() - 95_000).toISOString(); const t1 = new Date().toISOString();
  await api('POST', '/tst/ops/deployments', { environment: 'staging', kind: 'DEPLOY', method: 'BLUE_GREEN', buildId: 'b-2026.11.23-1', version: '0.1.0', commitRef: 'b51e960c', artifactSha256: 'c'.repeat(64), pipelineRun: 'ci-4812', status: 'SUCCEEDED', startedAt: t0, finishedAt: t1, slot: 'green' }, 'ITADM', 'pipeline:release');
  await api('POST', '/tst/ops/deployments', { environment: 'production', kind: 'DEPLOY', method: 'BLUE_GREEN', buildId: 'b-2026.11.23-1', version: '0.1.0', commitRef: 'b51e960c', artifactSha256: 'c'.repeat(64), pipelineRun: 'ci-4813', status: 'SUCCEEDED', startedAt: t0, finishedAt: t1, slot: 'blue' }, 'ITADM', 'pipeline:release');
  const refused = await request.post('/api/v1/tst/ops/deployments', { headers: headers('ITADM', company, qa), data: { environment: 'production', kind: 'DEPLOY', status: 'SUCCEEDED', startedAt: t0, finishedAt: t1 } });
  expect(refused.status(), 'BR-01: a person cannot record a production change').toBe(403);
  await api('POST', '/tst/ops/runbooks/sync', {});
  for (const code of ['deploy', 'rollback', 'restore']) await api('POST', `/tst/ops/runbooks/${code}/submit`, { reason: 'Rehearsed in staging; ready for approval' });
  const from = new Date(Date.now() - 3_600_000).toISOString(); const to = new Date(Date.now() + 8 * 3_600_000).toISOString();
  for (const [u, l] of [[l1, 'L1'], [qa, 'L2'], [l3, 'L3']]) await api('POST', '/tst/ops/oncall', { username: u, level: l, fromAt: from, toAt: to });
  await page.goto('/admin/operations-runbooks');
  await expect(page.getByTestId('tst-ops')).toBeVisible();
  await expect(page.getByTestId('op-chart')).toBeVisible();
  await expect(page.getByTestId('op-env')).toHaveCount(5);
  await expect(page.getByTestId('op-env').filter({ hasText: /parity|समान|In parity/i }).first()).toBeVisible();
  if (zd) await expect(page.getByTestId('op-rehearsal')).toContainText(/0/);
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('30.08', 'operations-runbooks');
  await checkAppearance(page);
  await cardsOnPhone('op-env-table');
  // the system administrator approves the deploy runbook on the page
  await as(ux, 'SYSADM');
  await page.goto('/admin/operations-runbooks?tab=runbooks');
  await page.getByTestId('op-approve-deploy').click();
  await expect(page.locator('[data-testid="op-runbook"][data-code="deploy"]')).toHaveAttribute('data-status', 'APPROVED');
  await page.getByTestId('op-open-deploy').click();
  await expect(page.getByTestId('op-runbook-text')).toContainText(/blue|deploy/i);
  await noOverflow();
  await page.goto('/admin/operations-runbooks?tab=oncall');
  await expect(page.getByTestId('op-level')).toHaveCount(3);
  await noOverflow();

  // ---- 30.09: the package from the build, the owners' approval, a field user's library, the screen changes
  await as(qa, 'ITADM');
  await page.goto('/help/documentation');
  await expect(page.getByTestId('tst-docs')).toBeVisible();
  await page.getByTestId('dl-generate').click();
  await expect(page.getByTestId('dl-list')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('dl-row').first()).toBeVisible();
  await page.getByTestId('dl-submit').click();
  await expect(page.getByTestId('dl-submitted')).toBeVisible();
  // two captures: the second changes a screen; the manuals that show it become stale
  const c1 = await api('POST', '/tst/manuals/captures', {});
  await api('POST', `/tst/manuals/captures/${c1.id}/screens`, { screens: [{ route: '/site/dprs', viewport: 'DESKTOP', signature: { title: 'Daily Progress Reports', actions: ['New DPR', 'Export'] } }, { route: '/inv/scrap', viewport: 'DESKTOP', signature: { title: 'Scrap & Disposal', actions: ['New disposal'] } }] });
  await api('POST', `/tst/manuals/captures/${c1.id}/compare`, {}); await api('POST', `/tst/manuals/captures/${c1.id}/accept`, {});
  const c2 = await api('POST', '/tst/manuals/captures', {});
  await api('POST', `/tst/manuals/captures/${c2.id}/screens`, { screens: [{ route: '/site/dprs', viewport: 'DESKTOP', signature: { title: 'Daily Progress Reports', actions: ['New DPR', 'Export', 'Submit all'] } }, { route: '/inv/scrap', viewport: 'DESKTOP', signature: { title: 'Scrap & Disposal', actions: ['New disposal'] } }] });
  await api('POST', `/tst/manuals/captures/${c2.id}/compare`, {});
  // the projects head approves the manuals waiting for them, several at once
  await as(pd, 'PD');
  await page.goto('/help/documentation?status=SUBMITTED&kind=ROLE');
  await expect(page.getByTestId('dl-pick-all')).toBeVisible();
  await page.getByTestId('dl-pick-all').click();
  await page.getByTestId('dl-approve').click();
  await expect(page.getByTestId('dl-decided')).toBeVisible();
  // a field user sees their own manuals only
  await as(se, 'SE');
  await page.goto('/help/documentation');
  await expect(page.getByTestId('dl-row').first()).toBeVisible();
  const codes = await page.getByTestId('dl-row').evaluateAll((rows) => rows.map((r) => r.dataset.code));
  expect(codes.every((c) => /^(role\.SE|quickref\.SE|module\.|exercises\.)/.test(c)), codes.join(', ')).toBe(true);
  await noOverflow();
  // the writer's view for the screenshots: the list, then the screen changes
  await as(qa, 'ITADM');
  await page.goto('/help/documentation');
  await expect(page.getByTestId('dl-row').first()).toBeVisible();
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('30.09', 'documentation-library');
  await checkAppearance(page);
  await cardsOnPhone('dl-table');
  if (phone) { await page.getByTestId('dl-params-open').click(); await expect(page.getByTestId('dl-params')).toBeVisible(); await page.getByTestId('dl-params-close').click(); }
  await page.goto('/help/documentation?tab=drift');
  await expect(page.getByTestId('dl-changed')).toHaveText('1');
  await expect(page.getByTestId('dl-screen')).toHaveCount(1);
  await expect(page.getByTestId('dl-screen')).toContainText('Submit all');
  await noOverflow();
  expect(errors).toEqual([]);
});
