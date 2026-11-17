import { test, expect } from '@playwright/test';
import { userMenu } from './shell-helpers.js';

// Development-header mode (port 3100). Part 03.09: the field screens in Hindi with no missing text (T-01, AC-01), the Translations page (a change of
// wording is a request another administrator approves; the workbook for translators), and a person's number and hour format.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const as = async (browser, info, company, roles, user, path, { language = 'en' } = {}) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(([v, lang]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); if (lang !== 'en') localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: lang })); }, [{ user, roles, company: String(company) }, language]);
  await page.goto(path);
  return page;
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

async function company(request, code) {
  const post = async (path, data) => {
    const res = await request.post(`/api/v1${path}`, { headers: H('SYSADM', 1, 'e2e-setup'), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  return (await post('/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
}

test('T-01 AC-01 the field screens, the shell and the palette in Hindi: every text is Hindi, none is missing, and English comes back', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const c = await company(request, pick(info, 'I18D', 'I18M'));
  const page = await as(browser, info, c, 'SE', pick(info, 'e2e-se-d', 'e2e-se-m'), '/field');
  const errors = watch(page);
  // part 166.3 (ff.field.p16603 ON in test): the field home's heading is the greeting; "Field Home" is the line in the band
  await expect(page.getByTestId('field-title')).toHaveText('Field Home');
  await expect(page.getByTestId('field-online')).toContainText('Online');
  await (await userMenu(page)).getByLabel('Language').selectOption('hi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.getByTestId('field-title')).toHaveText('फ़ील्ड होम');
  await expect(page.getByTestId('field-band').getByRole('heading', { level: 1 })).toContainText(/सुप्रभात|नमस्कार|शुभ संध्या/);
  await expect(page.getByTestId('field-online')).toContainText('ऑनलाइन');
  await expect(page.getByTestId('sync-count')).toContainText('भेजने के लिए कुछ भी बाकी नहीं है');
  await expect(page.getByTestId('location-notice')).toContainText('आपकी स्थिति बटन दबाने पर एक बार पढ़ी जाती है');
  await expect(page.getByRole('link', { name: 'सामग्री अनुरोध पर जाएँ' })).toHaveCount(0);
  await expect(page.locator('a.skip')).toHaveText('सीधे मुख्य सामग्री पर जाएँ');
  await expect(page.getByTestId('search-trigger')).toContainText('खोजें या कहीं जाएँ');
  // the palette
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette')).toHaveAttribute('aria-label', 'खोजें या कहीं जाएँ');
  await expect(page.getByTestId('palette')).toContainText('कार्यों के लिए >');
  await page.getByTestId('palette').getByRole('combobox').fill('qqzzxx');
  await expect(page.getByTestId('palette')).toContainText('से मेल खाता कोई ऐसा रिकॉर्ड नहीं');
  await page.keyboard.press('Escape');
  // the scan page
  if (info.project.name === 'mobile') await page.getByTestId('bottom-scan').click(); else await page.goto('/field/scan');
  await expect(page.getByRole('heading', { name: 'स्कैन', level: 1 })).toBeVisible();
  await expect(page.getByTestId('scan-camera')).toContainText('कैमरे से स्कैन करें');
  await expect(page.getByTestId('no-scans')).toHaveText('इस सत्र में अभी कुछ स्कैन नहीं हुआ।');
  await page.getByTestId('scan-typed').fill('ZZ/none');
  await page.getByRole('button', { name: 'खोजें' }).last().click();
  await expect(page.getByTestId('scan-error')).toContainText('के लिए कुछ नहीं मिला');
  // a page the role cannot open
  await page.goto('/admin/users');
  await expect(page.getByTestId('no-permission')).toContainText('देखने की आपको अनुमति नहीं है');
  // not one text was asked for without a Hindi version
  expect(await page.evaluate(() => [...window.__erpMissingKeys])).toEqual([]);
  await noOverflow(page);
  // and back to English
  await (await userMenu(page)).getByLabel('भाषा').selectOption('en');
  await expect(page.getByTestId('no-permission')).toContainText('You do not have access');
  expect(errors).toEqual([]);
});

test('AC-05 FR-02 the Translations page: a change of wording is a request another administrator approves; the workbook for translators', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const c = await company(request, pick(info, 'TRD', 'TRM'));
  const first = pick(info, 'e2e-sys-1d', 'e2e-sys-1m');
  const second = pick(info, 'e2e-sys-2d', 'e2e-sys-2m');
  const page = await as(browser, info, c, 'SYSADM', first, '/admin/translations');
  const errors = watch(page);
  await expect(page.getByRole('heading', { name: 'Translations', level: 1 })).toBeVisible();
  await expect(page.getByTestId('tr-coverage')).toContainText('Nothing is missing');
  await page.getByRole('searchbox', { name: 'Search' }).fill('field.title');
  const row = page.getByRole('row', { name: /field\.title/ });
  await expect(row).toContainText('फ़ील्ड होम');
  await row.getByRole('button', { name: 'Change field.title' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('हिन्दी (Hindi)').fill('साइट होम');
  await dialog.getByLabel('Reason').fill('Clearer for the site team');
  await dialog.getByRole('button', { name: 'Request change' }).click();
  await expect(page.getByTestId('tr-notice')).toContainText('Another system administrator must approve it');
  await expect(page.getByRole('table', { name: 'Changes waiting for approval' })).toContainText('Waiting for another administrator');
  // not in force yet
  const probe = await as(browser, info, c, 'SE', pick(info, 'e2e-se-td', 'e2e-se-tm'), '/field', { language: 'hi' });
  await expect(probe.getByTestId('field-title')).toHaveText('फ़ील्ड होम');
  // a second administrator approves it
  const other = await as(browser, info, c, 'SYSADM', second, '/admin/translations');
  const pending = other.getByRole('table', { name: 'Changes waiting for approval' });
  await pending.getByLabel(/^Comment for request/).fill('Checked');
  await pending.getByRole('button', { name: 'Approve' }).click();
  await expect(pending).toHaveCount(0);
  // in force for the people of the company, without a new build
  await probe.reload();
  await expect(probe.getByTestId('field-title')).toHaveText('साइट होम');
  // the first administrator sees it marked as changed, with its history, and can ask for the standard wording back
  await page.reload();
  await page.getByRole('searchbox', { name: 'Search' }).fill('field.title');
  await expect(page.getByRole('row', { name: /field\.title/ })).toContainText('(changed)');
  // the workbook
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export for translators/ }).click();
  expect((await download).suggestedFilename()).toBe('translations.xlsx');
  // a file that is not a workbook is refused with a message, not a crash
  await page.getByLabel('Translated workbook').setInputFiles({ name: 'bad.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a workbook') });
  await expect(page.getByRole('alert').filter({ hasText: 'could not be read' })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
  // a person without the right
  const denied = await as(browser, info, c, 'PM', pick(info, 'e2e-pm-td', 'e2e-pm-tm'), '/admin/translations');
  await expect(denied.getByTestId('no-permission')).toBeVisible();
});
