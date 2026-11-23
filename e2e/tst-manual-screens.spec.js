import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { trackPageRequests } from './page-requests.js';
import { allRegisteredPages } from './pages.js';
import { TEMPLATE_PERMISSIONS } from '../src/server/platform/authz/templates.js';
import { FIELD_ROLES } from '../src/shared/device/breakpoints.js';

// Part 30.09 FR-01 FR-03: the screens of the build for the manuals and the drift check. Every registered page is opened (desktop 1280 × 800;
// the pages a field role can open also at 360 × 740), in a company with every feature on, by a user holding every internal role. Of each
// screen the spec reads its signature — the title, tabs, actions, form labels, headings and table columns — and takes a JPEG, which goes to the
// document service (04.10) on the capture. The capture is then compared with the accepted baseline; MAN_ACCEPT=1 accepts it as the new
// baseline and MAN_PACKAGE=1 generates the package from it. MAN_ROUTES limits it to a file of routes, MAN_COMPANY reuses a company.
// The summary is written to docs/erp/manuals/capture.json.
const only = process.env.MAN_ROUTES ? new Set(readFileSync(process.env.MAN_ROUTES, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)) : null;
const pages = allRegisteredPages().filter((p) => !p.onboardingOnly && !p.route.includes(':') && (!only || only.has(p.route)));
const ROLES = Object.keys(TEMPLATE_PERMISSIONS).filter((c) => !/^(X-.*|GUARD|EMP|SUBCO)$/.test(c)).join(',');
const FIELD_PERMS = new Set(FIELD_ROLES.flatMap((r) => TEMPLATE_PERMISSIONS[r] ?? []));
const H = (company, user, roles = 'ITADM') => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'idempotency-key': randomUUID() });

const readSignature = () => {
  const main = document.querySelector('main') ?? document.body;
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const text = (e) => (e?.getAttribute('aria-label') || e?.textContent || '').replace(/\s+/g, ' ').trim();
  const all = (sel) => [...main.querySelectorAll(sel)].filter(visible).map(text).filter(Boolean);
  return {
    title: text(main.querySelector('h1') ?? document.querySelector('h1')),
    tabs: all('[role="tab"]'),
    // actions outside the table rows: a row's own buttons depend on the data, not on the screen
    actions: [...main.querySelectorAll('button, a.btn, [role="button"]')].filter((e) => visible(e) && !e.closest('tbody, [role="tab"], nav[aria-label] li')).map(text).filter(Boolean),
    fields: all('label'),
    headings: all('h2, h3'),
    columns: all('thead th'),
  };
};

test('FR-01 FR-03 the screens of the build: signature and image of every page, compared with the baseline', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'the capture runs once, from the desktop project');
  test.setTimeout(7_200_000);
  let company = Number(process.env.MAN_COMPANY) || null;
  if (!company) {
    const code = `MAN${Date.now().toString(36).slice(-5).toUpperCase()}`;
    const created = await request.post('/api/v1/iam/org/companies', { headers: { ...H(1, 'man-setup', 'SYSADM'), 'content-type': 'application/json' }, data: { code, legalName: 'Manuals Infra Pvt Ltd', shortName: code } });
    expect(created.status(), await created.text()).toBeLessThan(300);
    company = (await created.json()).data.id;
    expect((await request.put('/api/v1/core/company-settings', { headers: { ...H(company, 'man-setup', 'SYSADM'), 'content-type': 'application/json' }, data: { legalName: 'Manuals Infra Pvt Ltd', reason: 'initial set-up' } })).status()).toBe(200);
    const db = new DatabaseSync('data/e2e.sqlite');
    db.exec('PRAGMA busy_timeout = 8000;');
    try { for (const { key } of db.prepare('SELECT DISTINCT key FROM core_feature_flags WHERE company_id IS NULL').all()) db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'Manual screens', 0, 1)").run(key, company); } finally { db.close(); }
  }
  const api = (method, path, data) => request[method](`/api/v1/tst/manuals${path}`, { headers: { ...H(company, 'tech-writer'), 'content-type': 'application/json' }, data });
  const cap = await api('post', '/captures', {});
  expect(cap.status(), await cap.text()).toBe(201);
  const capture = (await cap.json()).data;

  const shots = [];
  for (const [viewport, size, list] of [['DESKTOP', { width: 1280, height: 800 }, pages], ['MOBILE', { width: 360, height: 740 }, pages.filter((p) => p.permission && FIELD_PERMS.has(p.permission))]]) {
    const phone = viewport === 'MOBILE';
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: size, hasTouch: phone, isMobile: phone, deviceScaleFactor: 1 });
    await context.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' })); }, { user: 'man-reader', roles: ROLES, company: String(company) });
    const page = await context.newPage();
    const settled = trackPageRequests(page, { dataOnly: true });
    const batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const res = await api('post', `/captures/${capture.id}/screens`, { screens: batch.splice(0) });
      expect(res.status(), await res.text()).toBe(200);
    };
    for (const p of list) {
      try {
        await page.goto(p.route);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.getByTestId('page-loading')).toHaveCount(0, { timeout: 30_000 }).catch(() => {});
        await expect.poll(settled, { timeout: 30_000 }).toEqual([]).catch(() => {});
        await page.waitForTimeout(150);
        const signature = await page.evaluate(readSignature);
        const jpeg = await page.screenshot({ type: 'jpeg', quality: 55 });
        const up = await request.post('/api/v1/core/files', { headers: H(company, 'tech-writer'), multipart: { entity: 'man_captures', entityId: String(capture.id), file: { name: `${p.route.replace(/\//g, '_').slice(1) || 'home'}-${viewport.toLowerCase()}.jpg`, mimeType: 'image/jpeg', buffer: jpeg } } });
        // a screen identical to one already uploaded (an empty page shown twice) keeps its signature without a second image
        const fileId = up.status() === 201 ? (await up.json()).data.id : undefined;
        // the API takes at most 60 items of 200 characters a list (a label that wraps a whole list of options is cut)
        const cut = (a, n = 60) => a.slice(0, n).map((x) => x.slice(0, 200));
        batch.push({ route: p.route, viewport, signature: { title: signature.title.slice(0, 300), tabs: cut(signature.tabs), actions: cut(signature.actions, 120), fields: cut(signature.fields, 120), headings: cut(signature.headings), columns: cut(signature.columns) }, ...(fileId ? { fileId } : {}) });
        shots.push({ route: p.route, viewport, title: signature.title, actions: signature.actions.length, image: Boolean(fileId) });
      } catch (err) {
        shots.push({ route: p.route, viewport, error: String(err.message ?? err).slice(0, 200) });
      }
      if (batch.length >= 20) await flush();
    }
    await flush();
    await context.close();
  }
  const cmp = await api('post', `/captures/${capture.id}/compare`, {});
  expect(cmp.status(), await cmp.text()).toBe(200);
  const compared = (await cmp.json()).data;
  if (process.env.MAN_ACCEPT === '1') expect((await api('post', `/captures/${capture.id}/accept`, {})).status()).toBe(200);
  let pkg = null;
  if (process.env.MAN_PACKAGE === '1') {
    const g = await api('post', '/packages', { captureId: capture.id });
    expect(g.status(), await g.text()).toBe(202);
    const id = (await g.json()).data.id;
    await expect.poll(async () => (await (await request.get(`/api/v1/tst/manuals/packages/${id}`, { headers: H(company, 'tech-writer') })).json()).data.status, { timeout: 1_800_000, intervals: [5000] }).toMatch(/READY|APPROVED|FAILED/);
    pkg = (await (await request.get(`/api/v1/tst/manuals/packages/${id}`, { headers: H(company, 'tech-writer') })).json()).data;
    expect(pkg.status).not.toBe('FAILED');
  }
  mkdirSync('docs/erp/manuals', { recursive: true });
  writeFileSync('docs/erp/manuals/capture.json', `${JSON.stringify({ at: new Date().toISOString(), company, capture: { ...compared, removedRoutes: compared.removedRoutes?.length ?? 0 }, package: pkg && { packageNo: pkg.packageNo, buildId: pkg.buildId, manuals: pkg.manuals, files: pkg.files, zipBytes: pkg.zipBytes, zipSha256: pkg.zipSha256, status: pkg.status }, errors: shots.filter((s) => s.error), screens: shots.length }, null, 1)}\n`);
  info.annotations.push({ type: 'capture', description: `${shots.length} screens (${shots.filter((s) => s.error).length} errors); changed ${compared.changed}, new ${compared.added}, removed ${compared.removed}${pkg ? `; package ${pkg.packageNo}: ${pkg.manuals} manuals, ${pkg.zipBytes} bytes` : ''}` });
  expect(shots.filter((s) => s.error).length, JSON.stringify(shots.filter((s) => s.error).slice(0, 5))).toBeLessThan(Math.max(5, shots.length * 0.02));
});
