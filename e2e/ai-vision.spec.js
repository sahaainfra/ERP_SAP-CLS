import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Part 28.05 (AC-01, T-01, T-UI-01, T-UI-02): Vision Suggestions on a 1280 px desktop and a 360 px phone. A site engineer attaches a photograph
// to the daily progress report; the connected model (here a local endpoint) finds a person, a missing helmet and a slab cast; the copy shown
// has the face blurred; the HSE engineer confirms the PPE suggestion into a safety observation and marks the slab-cast cue wrong.

const sharp = createRequire(import.meta.url)('sharp');
async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main button, main .kpi-label, main .kpi-value')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}
const photo = () => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#8a8d91"/><rect y="250" width="640" height="170" fill="#b8b2a7"/>
  <rect x="80" y="70" width="90" height="230" fill="#3d4a5c"/><circle cx="125" cy="80" r="30" fill="#c79b7b"/><rect x="380" y="140" width="200" height="16" fill="#555"/>
  <path d="M410 300 L440 320 L470 310 L500 335" stroke="#222" stroke-width="3" fill="none"/></svg>`)).png().toBuffer();

let model;
test.beforeAll(async () => {
  model = createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ model: 'ppe-defect-v3', detections: [
      { label: 'PERSON', confidence: 0.93, box: [0.12, 0.1, 0.15, 0.62] }, { label: 'FACE', confidence: 0.88, box: [0.15, 0.12, 0.09, 0.14] },
      { label: 'NO_HELMET', confidence: 0.79, box: [0.14, 0.1, 0.11, 0.17] }, { label: 'SLAB_CAST', confidence: 0.61, box: [0, 0.6, 1, 0.4] }, { label: 'CRACK', confidence: 0.58, box: [0.63, 0.7, 0.16, 0.1] }] })); }); });
  await new Promise((r) => model.listen(0, '127.0.0.1', r));
});
test.afterAll(() => model?.close());

test('Vision Suggestions: a DPR photograph analysed on upload, faces blurred, a suggestion confirmed into an observation and one marked wrong', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const users = { se: `cv-se-${suffix}`, hse: `cv-hse-${suffix}` };
  const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
  const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `CVX-${suffix.toUpperCase()}`, legalName: 'Vision Demo Infrastructure', shortName: 'Vision Demo' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: company } = (await created.json()).data;
  expect((await request.put('/api/v1/core/company-settings', { headers: headers('SYSADM', company, 'setup'), data: { legalName: 'Vision Demo Infrastructure', reason: 'Set up the vision fixture' } })).ok()).toBe(true);
  let dpr; let site; let project;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  try {
    for (const [k, r] of [['se', 'SE'], ['hse', 'HSEE']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
    db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.ai.p2805', ?, 'Vision browser fixture', 0, 1)").run(company);
    const gate = db.prepare("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (?, ?, ?, 'PASSED', 'e2e', CURRENT_TIMESTAMP)");
    gate.run(company, 'G1', 'Platform Gate'); gate.run(company, 'G2', 'Workforce Gate');
    project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, 'VX-01', 'Metro depot', 'BUILDING', 'ACTIVE')").run(company).lastInsertRowid);
    site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (?, ?, 'VX-S1', 'Depot site')").run(company, project).lastInsertRowid);
    db.prepare("INSERT INTO proj_projects (company_id, project_id, status, lifecycle_state, pm_user, contract_value, start_date, scheduled_completion, created_by) VALUES (?, ?, 'APPROVED', 'EXECUTION', 'pm', 100000000, '2026-01-01', '2027-12-31', 'e2e')").run(company, project);
    dpr = Number(db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status) VALUES (?, ?, ?, ?, '2026-11-20', ?, 'DRAFT')").run(company, `DPR/VX/${suffix}`, project, site, users.se).lastInsertRowid);
    db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status) VALUES (?, ?, 'PPE and defect model', 'ai', 'vision_http', 'development', ?, 'ENABLED')").run(company, `ai.vision-${suffix}`, JSON.stringify({ baseUrl: `http://127.0.0.1:${model.address().port}`, model: 'ppe-defect-v3' }));
    db.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (?, 'ai.cv.detector', ?, 'string', 'company', ?, '2020-01-01', 'e2e', 'test')").run(company, `ai.vision-${suffix}`, company);
  } finally {
    db.close();
  }
  // FR-01: the site engineer attaches the photograph to the DPR; it is analysed when the virus scan clears it
  const f = await request.post('/api/v1/core/files', { headers: headers('SE', company, users.se), multipart: { entity: 'site_dpr', entityId: String(dpr), file: { name: 'pier-p12-morning.png', mimeType: 'image/png', buffer: await photo() } } });
  expect(f.status(), await f.text()).toBe(201);
  await expect.poll(async () => (await (await request.get('/api/v1/ai/vision', { headers: headers('HSEE', company, users.hse) })).json()).data?.total, { timeout: 30_000 }).toBe(1);

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user: users.hse, roles: 'HSEE', company: String(company) });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await page.goto('/ai/vision');
  await expect(page.getByRole('heading', { name: 'Vision Suggestions', level: 1 })).toBeVisible();
  await expect(page.getByTestId('cv-row')).toHaveCount(1);
  await expect(page.getByTestId('cv-row')).toContainText('No helmet');
  await page.getByTestId('cv-row').getByRole('link').click();
  const detail = page.getByTestId('cv-detail');
  await expect(detail).toContainText('Faces blurred');
  await expect(page.getByTestId('cv-figure').locator('img')).toBeVisible();
  await expect.poll(() => page.getByTestId('cv-figure').locator('img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.getByTestId('cv-figure').locator('rect')).toHaveCount(3);
  await expect(page.getByTestId('cv-sug')).toHaveCount(3);
  await noOverflow();
  await page.screenshot({ path: `docs/erp/screenshots/28.05/${phone ? 'mobile' : 'desktop'}-vision-suggestions-review.png`, fullPage: true });
  await checkAppearance(page);
  // FR-02: confirm the missing helmet into a safety observation (naming nobody); the slab-cast cue is wrong (FR-04)
  const ppe = page.getByTestId('cv-sug').filter({ hasText: 'No helmet' });
  await ppe.getByTestId('cv-confirm').click();
  await ppe.getByLabel('Description (optional)').fill('Worker at the pier P12 cap without a helmet; crew to be briefed.');
  await ppe.getByTestId('cv-confirm-go').click();
  await expect(page.getByTestId('cv-sug').filter({ hasText: 'No helmet' })).toContainText('Confirmed');
  await expect(page.getByTestId('cv-sug').filter({ hasText: 'No helmet' }).getByRole('link')).toBeVisible();
  const slab = page.getByTestId('cv-sug').filter({ hasText: 'Slab cast' });
  await slab.getByTestId('cv-wrong').click();
  await slab.getByLabel('What is wrong *').fill('Formwork only, not cast yet');
  await slab.getByTestId('cv-wrong-go').click();
  await expect(page.getByTestId('cv-sug').filter({ hasText: 'Slab cast' })).toContainText('Wrong');
  const check = new DatabaseSync('data/e2e.sqlite');
  try { expect(check.prepare("SELECT obs_type FROM hse_observations WHERE company_id = ? ORDER BY id DESC LIMIT 1").get(company).obs_type).toBe('UNSAFE_CONDITION'); } finally { check.close(); }
  await noOverflow();
  expect(errors).toEqual([]);
});
