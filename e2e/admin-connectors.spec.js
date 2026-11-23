import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// Part 29.02 (AC-01, T-01, T-UI-01, T-UI-02): business connectors on a 1280 px desktop and a 360 px phone. The connectors with their health;
// the accounts manager fetches a bank statement that reaches 23.06 and matches the payment; IT proposes a device-user mapping and the HR
// manager approves it; the biometric pull stores a punch pulled twice only once; the sync runs list them.

let seq = 0;
function fill(d, table, vals) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all(); const sql = d.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) {
    if (c.name === 'id') continue;
    if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `e2e-${table}-${Date.now()}-${(seq += 1)}`)); }
  }
  return Number(d.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}

async function checkAppearance(page) {
  for (const theme of ['dark', 'high-contrast']) {
    const clipped = await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.fontSize = '125%';
      return [...document.querySelectorAll('main h1, main h2, main button')]
        .filter((element) => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent.trim());
    }, theme);
    expect(clipped, `clipped labels at larger text size in the ${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.removeProperty('font-size'); });
}

test('Business connectors: health, a bank statement sync that matches, an approved mapping and a de-duplicated biometric pull', async ({ page, request }, info) => {
  const phone = info.project.name === 'mobile';
  const suffix = phone ? 'm' : 'd';
  const today = new Date().toISOString().slice(0, 10);
  const users = { it: `bc-it-${suffix}`, acc: `bc-acc-${suffix}`, hr: `bc-hr-${suffix}` };
  // the connected systems
  const at = `${today}T08:01:00+05:30`;
  const srv = createServer((req, res) => { req.on('data', () => {}); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/statements') return res.end(JSON.stringify({ format: 'CSV', content: ['Txn Date,Narration,Ref No,Debit,Credit,Balance', `${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)},NEFT SHREE CEMENT,UTR-${suffix},"1,18,000.00",,"8,82,000.00"`, `${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)},BANK CHARGES,,59.00,,"8,81,941.00"`].join('\n') }));
    if (req.url === '/punches') return res.end(JSON.stringify({ punches: [{ logId: 'L1', userCode: '17', time: at, direction: 'IN', deviceSerial: 'ZK-1' }, { logId: 'L1', userCode: '17', time: at, direction: 'IN', deviceSerial: 'ZK-1' }] }));
    if (req.url === '/health') return res.end('{"ok":true}');
    res.statusCode = 404; return res.end('{}');
  }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const headers = (roles, company, user) => ({ 'x-erp-roles': roles, 'x-erp-company': String(company), 'x-erp-user': user, 'idempotency-key': randomUUID() });
    const created = await request.post('/api/v1/iam/org/companies', { headers: headers('SYSADM', 1, 'setup'), data: { code: `BCX-${suffix.toUpperCase()}`, legalName: 'Connector Demo Infrastructure', shortName: 'Connector Demo' } });
    expect(created.status(), await created.text()).toBe(201);
    const { id: company } = (await created.json()).data;
    const db = new DatabaseSync('data/e2e.sqlite');
    db.exec('PRAGMA busy_timeout = 8000;');
    try {
      for (const [k, r] of [['it', 'ITADM'], ['acc', 'ACCMGR'], ['hr', 'HRMGR']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (?, ?, ?, ?)').run(company, users[k], users[k], JSON.stringify([r]));
      db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2902', ?, 'Connectors browser fixture', 0, 1)").run(company);
      const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Ring road', 'ROAD', 'ACTIVE')").run(company, `BC-${suffix}`).lastInsertRowid);
      const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (?, ?, ?, 'Ring road site')").run(company, project, `BCS-${suffix}`).lastInsertRowid);
      const conn = db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status) VALUES (?, ?, ?, ?, ?, 'development', ?, 'ENABLED')");
      conn.run(company, `bank.sbi-${suffix}-${company}`, 'SBI host-to-host', 'bank', 'bank_http', JSON.stringify({ baseUrl: base }));
      conn.run(company, `bio.gate-${suffix}-${company}`, 'Gate devices', 'biometric', 'biometric_http', JSON.stringify({ baseUrl: base, siteId: site }));
      const gl = fill(db, 'fin_accounts', { company_id: company, code: '1201', name: 'SBI current account', account_type: 'BANK', normal_side: 'DR' });
      const bank = fill(db, 'fin_bank_accounts', { company_id: company, code: 'SBI-CA', name: 'SBI current', bank_name: 'SBI', ifsc: 'SBIN0001234', account_no_enc: 'enc', account_last4: '4321', gl_account_id: gl });
      // the paid payment the statement matches, with its proposal, line and payee (no orphan rows for the Data Health check of a whole run)
      const partner = fill(db, 'mdm_partners', { company_id: company, code: `BC-SC-${suffix}`, legal_name: 'Shree Cement Traders Pvt Ltd', trade_name: 'Shree Cement', constitution: 'PRIVATE_LIMITED', partner_status: 'ACTIVE', steward_role: 'PROCMGR' });
      const proposal = fill(db, 'pmt_proposals', { company_id: company, doc_no: `PP-${suffix}`, bank_account_id: bank, pay_mode: 'NEFT', pay_date: today, status: 'APPROVED', run_status: 'CONFIRMED' });
      const line = fill(db, 'pmt_proposal_lines', { company_id: company, proposal_id: proposal, line_no: 1, line_kind: 'ON_ACCOUNT', partner_id: partner, payee_name: 'Shree Cement', amount_paise: 11_800_000, line_status: 'PAID' });
      fill(db, 'pmt_payments', { company_id: company, doc_no: `PAY-${suffix}`, proposal_id: proposal, line_id: line, partner_id: partner, payee_name: 'Shree Cement', pay_mode: 'NEFT', bank_account_id: bank, amount_paise: 11_800_000, released_on: today, paid_on: today, utr: `UTR-${suffix}`, pay_status: 'PAID' });
      fill(db, 'hr_employees', { company_id: company, emp_code: 'E-101', first_name: 'Ravi', full_name: 'Ravi Kumar', gender: 'MALE', dob: '1990-01-01', mobile: '9000000001', employment_type: 'PERMANENT', doj: '2024-01-01', record_status: 'APPROVED', project_id: project });
    } finally {
      db.close();
    }
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && !/socket\.io|WebSocket/.test(message.text())) errors.push(message.text()); });
    await page.addInitScript((identity) => { if (!localStorage.getItem('erp.dev.identity')) localStorage.setItem('erp.dev.identity', JSON.stringify(identity)); }, { user: users.acc, roles: 'ACCMGR', company: String(company) });
    const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const asUser = async (user, roles) => { await page.evaluate((identity) => localStorage.setItem('erp.dev.identity', JSON.stringify(identity)), { user, roles, company: String(company) }); };

    // FR-07 the connectors with their health; T-01 the accounts manager fetches the statement and it matches the payment
    await page.goto('/admin/connectors');
    await expect(page.getByRole('heading', { name: 'Business Connectors', level: 1 })).toBeVisible();
    const bankCard = page.locator('[data-testid="con-connector"][data-code^="bank.sbi-"]');
    await expect(bankCard).toContainText('Not checked');
    await expect(page.getByTestId('con-tally')).toBeVisible();
    await noOverflow();
    await page.screenshot({ path: `docs/erp/screenshots/29.02/${phone ? 'mobile' : 'desktop'}-business-connectors-with-health.png`, fullPage: true });
    await checkAppearance(page);
    await bankCard.getByTestId('con-fetch').click();
    await expect(bankCard.getByTestId('con-result')).toContainText('1 matched, 1 to reconcile');
    await expect(bankCard).toContainText('Healthy');

    // section 8: IT proposes a device-user mapping; the HR manager approves it
    await asUser(users.it, 'ITADM');
    await page.goto('/admin/connectors?tab=mappings');
    await page.getByRole('combobox', { name: 'Connector', exact: true }).selectOption({ label: 'Gate devices' });
    await page.getByLabel('What is mapped').selectOption('biometric_user');
    await page.getByLabel('Our value').fill('E-101');
    await page.getByLabel('Their value').fill('17');
    await page.getByLabel('Reason').fill('Enrolled on the gate device');
    await page.getByTestId('con-m-send').click();
    await expect(page.getByTestId('con-map').first()).toContainText('Waiting for approval');
    await expect(page.getByTestId('con-m-approve')).toHaveCount(0);
    await asUser(users.hr, 'HRMGR');
    await page.goto('/admin/connectors?tab=mappings');
    await page.getByTestId('con-m-approve').click();
    await expect(page.getByTestId('con-map').first()).toContainText('In use');

    // FR-03 BR-01 the biometric pull goes through attendance; the punch pulled twice is stored once
    await page.goto('/admin/connectors');
    const bio = page.locator('[data-testid="con-connector"][data-code^="bio.gate-"]');
    await bio.getByTestId('con-pull').click();
    await expect(bio.getByTestId('con-result')).toContainText('1 already stored');
    await page.getByRole('tab', { name: 'Sync runs' }).click();
    await expect(page.getByTestId('con-run')).toHaveCount(2);
    await expect(page.getByTestId('con-run').first()).toContainText('Biometric punches');
    await noOverflow();
    expect(errors).toEqual([]);
  } finally {
    srv.close();
  }
});
