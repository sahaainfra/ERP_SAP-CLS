import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100).
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const api = async (request, c, roles, user, method, path, data) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()).data;
};
async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' });
  return id;
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

const OUT = 'docs/erp/screenshots/award';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked it' });
};
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['dir', ['DIR']], ['est', ['EST']], ['est2', ['EST']], ['acc', ['ACCMGR']], ['cfo', ['CFO']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, n, JSON.stringify(roles), `${t}-${n}@example.com`);
  const nhai = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 'e2e', 'e2e')").run(c, `${t.toUpperCase()}C1`, 'National Highways Authority', 'national highways authority').lastInsertRowid);
  db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, 'CLIENT')").run(c, nhai);
  db.close();
  return { nhai, u: (k) => `${t}-${k}` };
}
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

// Part 08.03: from a tender ready for submission to its award. The estimation manager adds a completion certificate to the credentials library and asks finance for the EMD from the tender; a colleague, the accounts manager and the CFO approve; the accounts manager records the
// bank guarantee. The estimation manager prepares the submission (checklist, the estimate entered by hand, the final bid, the credentials package), the director approves it, and its upload on the portal is recorded. The opening results are entered and ranked (T-01),
// a negotiation round and the award (letter of acceptance, value) are recorded and the director accepts it: the tender is awarded and the EMD refund falls due; the accounts manager sees it in the ageing and records the refund. The competitor analysis shows the rivals.
// On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 credentials, EMD, submission, opening results, award and EMD refund, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'AWM' : 'AWD');
  const t = phone ? 'awm' : 'awd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const E = ['EST', c, g.u('est')]; const E2 = ['EST', c, g.u('est2')]; const D = ['DIR', c, g.u('dir')]; const A = ['ACCMGR', c, g.u('acc')]; const F = ['CFO', c, g.u('cfo')];
  const call = (who, method, path, data) => api(request, who[1], who[0], who[2], method, path, data);
  const approve = (who, id) => decide(request, who[1], who[0], who[2], id);
  // a tender ready for submission (part 08.02, by the API)
  let tn = await call(E, 'post', '/bd/tenders', { clientPartnerId: g.nhai, referenceNo: `NHAI/2027/${t}`, portal: 'CPPP', nameOfWork: 'Four-laning of NH-48, package 3', location: 'Pune', region: 'WEST', estCost: 1000000000, emd: 20000000, tenderFee: 25000, bidType: 'ITEM_RATE', periodMonths: 24, publishDate: day(-5), prebidDate: day(6), submissionAt: `${day(20)}T15:00`, openingAt: `${day(20)}T16:00` });
  const sent = await call(E, 'post', `/bd/tenders/${tn.id}/submit`, {}); await approve(E2, sent.workflowInstanceId);
  tn = await call(E, 'get', `/bd/tenders/${tn.id}`);
  await call(E, 'post', `/bd/tenders/${tn.id}/track`, { bcTurnover: 4000000000, bcCommitments: 1000000000, version: tn.rowVersion });
  const scores = Object.fromEntries(['STRATEGIC_FIT', 'MARGIN', 'RISK', 'CAPACITY', 'COMPETITION'].map((k) => [k, { score: 4, note: `${k.toLowerCase()} noted` }]));
  const d = await call(E, 'post', '/bd/bid-decisions', { tenderId: tn.id, scores, decision: 'BID' }); const ds = await call(E, 'post', `/bd/bid-decisions/${d.id}/submit`, {}); await approve(E2, ds.workflowInstanceId); await approve(D, ds.workflowInstanceId);
  tn = await call(E, 'get', `/bd/tenders/${tn.id}`);
  for (const e of tn.eligibility.rows.filter((r) => r.result !== 'PASS')) await call(E, 'patch', `/bd/eligibility/${e.id}`, e.auto ? { requirement: 100000000, our: 200000000, version: e.rowVersion } : { result: 'PASS', version: e.rowVersion });
  await call(E, 'post', `/bd/tenders/${tn.id}/ready`, {});

  // FR-01: the credentials library
  const est = await open(browser, info, c, 'EST', g.u('est'), '/bd/credentials');
  const errors = watch(est.page);
  await expect(est.page.getByTestId('credentials')).toBeVisible();
  await est.page.getByRole('button', { name: 'Add credential' }).first().click();
  await est.page.getByTestId('cr-type').selectOption('COMPLETION_CERTIFICATE'); await est.page.getByTestId('cr-name').fill('Completion certificate, NH-52 widening, 42 km');
  await est.page.getByTestId('cr-client').fill('National Highways Authority'); await est.page.getByTestId('cr-sector').selectOption('ROADS'); await est.page.getByTestId('cr-value').fill('850000000'); await est.page.getByTestId('cr-completed').fill(day(-400));
  await est.page.getByTestId('cr-save').click();
  await expect(est.page.getByTestId('cr-note')).toContainText('added'); await expect(est.page.getByTestId('cr-detail')).toContainText('NH-52');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '01-credentials');

  // FR-02: the EMD asked from the tender
  await est.page.goto(`/bd/tender?id=${tn.id}`);
  await est.page.getByTestId('td-request-emd').click();
  await expect(est.page.getByTestId('emd-new')).toBeVisible(); await expect(est.page.getByTestId('emd-amount')).toHaveValue('20000000');
  await est.page.getByTestId('emd-mode').selectOption('BG'); await est.page.getByTestId('emd-payee').fill('NHAI, PIU Pune'); await est.page.getByTestId('emd-needed').fill(day(10));
  await est.page.getByTestId('emd-send').click();
  await expect(est.page.getByTestId('emd')).toHaveAttribute('data-status', 'SUBMITTED');
  const emdId = Number(new URL(est.page.url()).searchParams.get('id'));
  const emd = await call(E, 'get', `/bd/emd/${emdId}`);
  await approve(E2, emd.workflowInstanceId); await approve(A, emd.workflowInstanceId); await approve(F, emd.workflowInstanceId);
  const fee = await call(E, 'post', '/bd/emd', { tenderId: tn.id, kind: 'FEE', mode: 'ONLINE', submit: true });
  await approve(E2, fee.workflowInstanceId); await approve(A, fee.workflowInstanceId); await approve(F, fee.workflowInstanceId);
  await call(A, 'post', `/bd/emd/${fee.id}/issue`, { instrumentNo: 'UTR778812345', bank: 'State Bank of India', issueDate: day(0) });
  // accounts records the bank guarantee
  const acc = await open(browser, info, c, 'ACCMGR', g.u('acc'), `/bd/emd/record?id=${emdId}`);
  const accErrors = watch(acc.page);
  await expect(acc.page.getByTestId('emd')).toHaveAttribute('data-status', 'APPROVED');
  await acc.page.getByTestId('emd-instrument-no').fill('BG/SBI/2027/0091'); await acc.page.getByTestId('emd-bank').fill('State Bank of India'); await acc.page.getByTestId('emd-valid').fill(day(200));
  await acc.page.getByTestId('emd-issue-save').click();
  await expect(acc.page.getByTestId('emd-instrument')).toContainText('BG/SBI/2027/0091');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, '02-emd-instrument');

  // FR-03: the submission (checklist, estimate by hand, final bid, credentials package), approved by the director, recorded on the portal
  await est.page.goto(`/bd/submission?tenderId=${tn.id}`);
  await est.page.getByTestId('sub-start').click();
  await expect(est.page.getByTestId('submission')).toHaveAttribute('data-status', 'DRAFT');
  await expect(est.page.getByTestId('sub-sec-EMD')).toContainText('••••0091'); await expect(est.page.getByTestId('sub-sec-FEE')).toContainText('2345');
  for (const code of ['TECH_ENVELOPE', 'FIN_ENVELOPE', 'SIGNED_DOCS', 'DSC', 'EMD_PROOF', 'PQ_DOCS']) { await est.page.getByTestId(`sub-item-${code}`).click(); await expect(est.page.getByTestId(`sub-item-${code}`)).toBeChecked(); }
  await expect(est.page.getByTestId('sub-progress')).toHaveText('6/6');
  await est.page.getByTestId('sub-estimate').fill('980000000'); await est.page.getByTestId('sub-estimate-ref').fill('EST-0007'); await est.page.getByTestId('sub-bid-amount').fill('975000000');
  await est.page.getByTestId('sub-adjustment-reason').fill('Steel prices eased since the estimate; director agreed to sharpen by 0.5%');
  await est.page.getByTestId('sub-save').click(); await expect(est.page.getByTestId('sub-adjustment')).toBeVisible();
  await expect(est.page.getByTestId('sub-cred').locator('option', { hasText: 'NH-52' })).toHaveCount(1); await est.page.getByTestId('sub-cred').selectOption(await est.page.getByTestId('sub-cred').locator('option', { hasText: 'NH-52' }).getAttribute('value')); await est.page.getByTestId('sub-link').click();
  await expect(est.page.getByTestId('sub-package')).toContainText('NH-52');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '03-submission');
  await est.page.getByTestId('sub-submit').click();
  await expect(est.page.getByTestId('submission')).toHaveAttribute('data-status', 'SUBMITTED');
  const sub = await call(E, 'get', `/bd/tenders/${tn.id}/submission`);
  await approve(E2, sub.workflowInstanceId); await approve(D, sub.workflowInstanceId);
  await est.page.reload();
  await est.page.getByTestId('sub-at').fill(`${day(0)}T11:30`); await est.page.getByTestId('sub-ref').fill('CPPP/ACK/2027/55102');
  await est.page.getByTestId('sub-record-save').click();
  await expect(est.page.getByTestId('sub-submitted')).toContainText('CPPP/ACK/2027/55102');

  // FR-04, T-01: the opening results, ranked
  await est.page.goto(`/bd/bid-results?tenderId=${tn.id}`);
  await expect(est.page.getByTestId('bid-results')).toBeVisible();
  await est.page.getByTestId('res-quoted-0').fill('975000000');
  await est.page.getByTestId('res-name-1').fill('Ashoka Buildcon'); await est.page.getByTestId('res-quoted-1').fill('990000000');
  await est.page.getByTestId('res-name-2').fill('Dilip Buildcon'); await est.page.getByTestId('res-quoted-2').fill('1010000000');
  await expect(est.page.getByTestId('res-rank-0')).toHaveText('L1'); await expect(est.page.getByTestId('res-rank-2')).toHaveText('L3'); await expect(est.page.getByTestId('res-diff-1')).toHaveText('1.54%');
  await est.page.getByTestId('res-save').click();
  await expect(est.page.getByTestId('res-note')).toBeVisible(); await expect(est.page.getByTestId('res-our-rank')).toContainText('L1');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '04-opening-results');

  // FR-06: negotiation and the award, accepted by the director
  await est.page.goto(`/bd/award?tenderId=${tn.id}`);
  await expect(est.page.getByTestId('award')).toHaveAttribute('data-status', 'NEW');
  await est.page.getByTestId('aw-neg-offer').fill('972000000'); await est.page.getByTestId('aw-neg-notes').fill('Client asked for a rebate; offered 0.3% on the quoted price');
  await est.page.getByTestId('aw-neg-save').click(); await expect(est.page.getByTestId('aw-negotiations')).toContainText('Round 1');
  await est.page.getByTestId('aw-outcome-WON').check(); await est.page.getByTestId('aw-loa').fill('NHAI/LOA/2027/118'); await est.page.getByTestId('aw-loa-date').fill(day(0)); await est.page.getByTestId('aw-value').fill('972000000');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '05-award');
  await est.page.getByTestId('aw-send').click();
  await expect(est.page.getByTestId('award')).toHaveAttribute('data-status', 'SUBMITTED');
  const awd = await call(E, 'get', `/bd/tenders/${tn.id}/award`);
  await approve(E2, awd.workflowInstanceId); await approve(D, awd.workflowInstanceId);
  expect((await call(E, 'get', `/bd/tenders/${tn.id}`)).stage).toBe('AWARDED');

  // BR-02: the EMD refund falls due; accounts sees the ageing and records the refund
  await acc.page.goto('/bd/emd');
  await expect(acc.page.getByTestId('emd-due')).toContainText('1'); await expect(acc.page.getByTestId('emd-bucket-0-30')).toContainText('1');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, '06-emd-register');
  await acc.page.goto(`/bd/emd/record?id=${emdId}`);
  await expect(acc.page.getByTestId('emd')).toHaveAttribute('data-refund', 'DUE');
  await acc.page.getByTestId('emd-refund-REFUNDED').click(); await acc.page.getByTestId('emd-refund-ref').fill('BG released, SBI letter 4471');
  await acc.page.getByTestId('emd-refund-save').click();
  await expect(acc.page.getByTestId('emd')).toHaveAttribute('data-refund', 'REFUNDED');

  // FR-05: the competitor analysis
  await est.page.goto('/bd/competitors');
  await expect(est.page.getByTestId('comp-row')).toHaveCount(2);
  await est.page.getByRole('button', { name: 'Ashoka Buildcon' }).click(); await expect(est.page.getByTestId('comp-detail')).toContainText('L2');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '07-competitors');
  await est.page.goto('/bd/awards'); await expect(est.page.getByText(phone ? 'Four-laning of NH-48, package 3' : 'NHAI/LOA/2027/118').first()).toBeVisible();
  if (phone) await noOverflow(est.page);
  await shot(est.page, '08-awards');
  expect(errors).toEqual([]); expect(accErrors).toEqual([]);
});
