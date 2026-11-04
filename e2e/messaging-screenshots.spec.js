import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100). Part 05.01: the Messages app: a direct conversation started from the New page, messages with a file and a record card, the other person's list with an unread count, a reply
// that arrives without a reload, the three-pane layout on a computer and the single pane on a phone, the pop-out window and the dock over another page.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
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
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/number-series', { docType: 'SAMPLE_DOC', name: 'Sample documents', prefix: 'SMP', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' });
  return id;
}
// the people of the company: written straight into the throw-away database of the run (the dev-header mode has no sign-in to make them)
function people(c, list) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [name, roles, display] of list) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, name, display, JSON.stringify(roles), `${name}@example.com`);
  db.close();
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

// Screenshots of the 05.02 pages for docs/erp/screenshots/messaging. Only with SHOTS=1 (npm run shots:messaging); the normal run skips it.
test.skip(!process.env.SHOTS, 'screenshots are taken on request only');
const OUT = 'docs/erp/screenshots/messaging';

test('screenshots of the messaging feature pages', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const phone = info.project.name === 'mobile';
  const tag = phone ? 'M' : 'D';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, `SH${tag}`);
  const pd = `shot-pd${tag.toLowerCase()}`;
  const pm = `shot-pm${tag.toLowerCase()}`;
  people(c, [[pd, ['PD'], 'Pooja Director'], [pm, ['PM'], 'Meera Manager']]);
  const conv = await api(request, c, 'PD', pd, 'post', '/msg/conversations', { type: 'DIRECT', members: [pm] });
  const say = (who, roles, body) => api(request, c, roles, who, 'post', `/msg/conversations/${conv.id}/messages`, { body });
  const m1 = await say(pd, 'PD', 'Cube test result for the raft is ready');
  await say(pm, 'PM', 'Thanks, I will check the 28 day strength and reply today');
  const m3 = await say(pd, 'PD', 'Please also send the slump readings from the pour');
  await api(request, c, 'PM', pm, 'post', `/msg/conversations/${conv.id}/read`, {});
  await api(request, c, 'PD', pd, 'post', `/msg/messages/${m1.id}/star`, {});
  await api(request, c, 'PD', pd, 'post', `/msg/messages/${m3.id}/pin`, {});
  const a = await open(browser, info, c, 'PD', pd, '/collab/messages');
  await a.page.getByTestId(`conv-${conv.id}`).click();
  await expect(a.page.getByTestId('msg').filter({ hasText: 'slump readings' })).toBeVisible();
  await a.page.waitForTimeout(800);
  await a.page.screenshot({ path: `${OUT}/01-conversation-receipts-pins${sfx}.png` });
  if (!phone) {
    await a.page.getByTestId('msg-details').click().catch(() => {});
    await a.page.waitForTimeout(500);
    await a.page.screenshot({ path: `${OUT}/02-details-gallery-calls.png` });
  }
  if (phone) await a.page.getByTestId('msg-back').click();
  await a.page.locator('#msg-q').fill('raft');
  await expect(a.page.getByTestId('search-hit').first()).toBeVisible({ timeout: 15_000 });
  await a.page.screenshot({ path: `${OUT}/03-search-results${sfx}.png` });
  const s = await open(browser, info, c, 'SYSADM', `shot-sys${tag.toLowerCase()}`, '/admin/messaging');
  await expect(s.page.getByRole('heading', { name: 'Messaging Settings', level: 1 })).toBeVisible();
  await s.page.screenshot({ path: `${OUT}/04-messaging-settings${sfx}.png` });
  await s.page.getByTestId('ms-editWindowMinutes').fill('30');
  await s.page.getByTestId('ms-reason').fill('Longer window agreed with the director');
  await s.page.getByTestId('ms-submit').click();
  await expect(s.page.getByTestId('ms-pending')).toBeVisible();
  await s.page.screenshot({ path: `${OUT}/05-messaging-settings-pending${sfx}.png` });
  const call = await api(request, c, 'PD', pd, 'post', `/msg/conversations/${conv.id}/calls`, { type: 'AUDIO' });
  const k = await open(browser, info, c, 'PD', pd, '/collab/messages');
  // a headless browser has no microphone or camera: give the page a silent tone and a blank picture so the in-call screen can be shown
  await k.page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async (want) => {
      const ctx = new AudioContext(); const dest = ctx.createMediaStreamDestination(); ctx.createOscillator().connect(dest);
      const stream = new MediaStream(dest.stream.getAudioTracks());
      if (want?.video) { const cv = document.createElement('canvas'); cv.width = 320; cv.height = 240; cv.getContext('2d').fillRect(0, 0, 320, 240); cv.captureStream().getVideoTracks().forEach((t) => stream.addTrack(t)); }
      return stream;
    };
  });
  await k.page.goto(`/collab/call?call=${call.call.id}`);
  await k.page.waitForTimeout(2500);
  await k.page.screenshot({ path: `${OUT}/06-call-screen${sfx}.png` });
});
