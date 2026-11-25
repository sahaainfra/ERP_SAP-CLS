import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

// Parts 30.04-30.06 (AC-01, AC-02, AC-07, T-UI-01, T-UI-02): Test Coverage & Results with the sandbox tab, Security Findings & Remediation
// and Performance Test Results on a 1280 px desktop and a 360 px phone. The QA lead syncs the catalogue and records a run, reads the coverage
// by part; runs the authorisation scan, records a penetration-test finding, marks it fixed; reads a load run against its SLOs. Each page:
// chart first, no sideways scroll at 360 px, tables as cards, the parameters in a bottom sheet on a phone, labels not clipped at 125 % text.

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

const report = () => {
  const file = 'reports/load-load.json';
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const j = (model, journey, sloKind, p95, o = {}) => ({ model, journey, sloKind, requests: 1500, errors: 0, p50: p95 / 4, p95, p99: p95 * 1.5, max: p95 * 3, throughputRps: 6.5, ...o });
  return { profile: 'LOAD', tool: 'NODE', environment: 'perf-lab', machine: 'e2e fixture', startedAt: '2026-11-23T10:00:00.000Z', finishedAt: '2026-11-23T10:04:30.000Z', users: 1000, memory: { startMb: 480, endMb: 700, maxMb: 760, samples: Array.from({ length: 60 }, (_, i) => ({ t: i * 4, rssMb: 480 + Math.min(i * 6, 250) })) },
    results: [j('USERS', 'Sample documents list (20,000 rows)', 'LIST', 180), j('USERS', 'Session check (every page)', 'RECORD', 60), j('PUNCH_BURST', 'Punch in (own phone)', 'BURST', 210, { requests: 2000, throughputRps: 33.4 }), j('DPR_BURST', 'Create a daily progress report', 'SAVE', 120, { requests: 200 }), j('MONTH_END', 'Trial balance', 'REPORT', 400), j('REALTIME', 'Event to screen and notification', 'REALTIME', 1100, { requests: 80 })] };
};

test('Test programme, security findings and performance consoles', async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const user = `qa-lead-${suffix}`; const tester = `pen-tester-${suffix}`;
  const headers = (roles, company, who) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': who, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `QA-${suffix.toUpperCase()}`, legalName: 'Quality Assurance Builders', shortName: 'QA Builders' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [u, r] of [[user, 'ITADM'], [tester, 'AUD']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, u, u, JSON.stringify([r]));
    for (const f of ['ff.qa.p3004', 'ff.qa.p3005', 'ff.qa.p3006']) db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'QA consoles browser fixture', 0, 1)").run(f, company);
  } finally {
    db.close();
  }
  const api = async (method, path, data, roles = 'ITADM', who = user) => { const r = await request.fetch(`/api/v1${path}`, { method, headers: headers(roles, company, who), data }); expect(r.status(), await r.text()).toBeLessThan(300); return (await r.json()).data; };
  // the data the pages show: the catalogue and a run of this part's tests; the authorisation scan and a tester's finding; a load run
  await api('POST', '/tst/tests/sync', {});
  const mine = (await api('GET', '/tst/tests?part=30.04&pageSize=100')).tests.rows;
  await api('POST', '/tst/test-runs', { source: 'CI', suite: 'UNIT_API', results: mine.map((t) => ({ file: t.file, name: t.name, result: 'PASS', durationMs: 900 })) });
  await api('POST', '/tst/security/scans', { kind: 'AUTHZ' });
  const finding = await api('POST', '/tst/security/findings', { source: 'PENTEST', severity: 'HIGH', title: 'Another project\'s DPR photo opens by changing its file id', endpoint: 'GET /api/v1/core/files/:id', cwe: 'CWE-639', description: 'As SE of project A, a photo of project B opens.' }, 'AUD', tester);
  await api('POST', '/tst/perf/runs', report());

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket|status of 404/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user, roles: 'ITADM', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const cardsOnPhone = async (testid) => { if (phone) expect(await page.getByTestId(testid).evaluate((t) => getComputedStyle(t).display)).toBe('block'); };

  // 30.04: the coverage by type and by part, the run, the tests of a part; the sandbox tab says this installation is not a sandbox
  await page.goto('/admin/test-coverage');
  await expect(page.getByTestId('tst-coverage')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Test Coverage');
  await expect(page.getByTestId('tc-chart')).toBeVisible();
  await expect(page.getByTestId('tc-run')).toHaveCount(1);
  await expect(page.getByTestId('tc-workflow')).toContainText('100');
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/30.04/${phone ? 'mobile' : 'desktop'}-test-coverage-results.png`, fullPage: false });
  await checkAppearance(page);
  await page.goto('/admin/test-coverage?part=30.04#tests');
  await expect(page.locator('[data-testid="tc-test"][data-result="PASS"]').first()).toBeVisible();
  await cardsOnPhone('tc-test-table');
  if (phone) { await page.getByTestId('tc-params-open').click(); await expect(page.getByTestId('tc-params')).toBeVisible(); await page.getByTestId('tc-params-close').click(); }
  await page.getByTestId('tc-tabs').getByRole('tab', { name: /Sandbox/ }).click();
  await expect(page.getByTestId('tst-coverage')).toHaveAttribute('data-tab', 'sandbox');
  await expect(page.locator('main')).toContainText('Not a sandbox');
  await noOverflow();

  // 30.05: go-live blocked by the tester's high finding; the lead marks it fixed; the tester re-tests and closes it
  await page.goto('/admin/security-findings');
  await expect(page.getByTestId('tst-security')).toHaveAttribute('data-golive', 'blocked');
  await expect(page.getByTestId('sx-chart')).toBeVisible();
  await expect(page.getByTestId('sx-authz')).toContainText('100');
  await expect(page.getByTestId('sx-blocker')).toHaveCount(1);
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/30.05/${phone ? 'mobile' : 'desktop'}-security-findings-remediation.png`, fullPage: false });
  await checkAppearance(page);
  await cardsOnPhone('sx-table');
  await page.goto(`/admin/security-findings?finding=${finding.id}`);
  await expect(page.getByTestId('sx-panel')).toBeVisible();
  await page.getByTestId('fx-commit').fill('a1b2c3d4e5');
  await page.getByTestId('fx-save').click();
  await expect(page.getByTestId('sx-panel-status')).toHaveAttribute('data-status', 'FIXED');
  await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: tester, roles: 'AUD', company: String(company) });
  await page.reload();
  await page.getByTestId('rt-note').fill('Forty other file ids of project B now answer 404.');
  await page.getByTestId('rt-pass').click();
  await expect(page.getByTestId('sx-panel-status')).toHaveAttribute('data-status', 'CLOSED');
  await expect(page.getByTestId('tst-security')).toHaveAttribute('data-golive', 'clear');
  await noOverflow();

  // 30.06: the latest load run against its SLOs, the memory of the server, the runs
  await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles: 'ITADM', company: String(company) });
  await page.goto('/admin/performance-tests');
  await expect(page.getByTestId('tst-perf')).toBeVisible();
  await expect(page.getByTestId('pf-chart')).toBeVisible();
  await expect(page.getByTestId('pf-result').first()).toBeVisible();
  await expect(page.getByTestId('pf-memory-chart')).toBeVisible();
  await noOverflow();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `docs/erp/screenshots/30.06/${phone ? 'mobile' : 'desktop'}-performance-test-results.png`, fullPage: false });
  await checkAppearance(page);
  await cardsOnPhone('pf-results');
  if (phone) { await page.getByTestId('pf-params-open').click(); await expect(page.getByTestId('pf-params')).toBeVisible(); await page.getByTestId('pf-params-close').click(); }
  expect(errors).toEqual([]);
});
