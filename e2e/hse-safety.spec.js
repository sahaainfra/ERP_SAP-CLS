import { test, expect } from '@playwright/test';
import { api, company, jpeg, noOverflow, open, watch, world, worker } from './hse-helpers.js';

// Part 19.04 in the browser: a supervisor raises an observation card on the phone layout; the responsible party reports the action; the HSE engineer verifies it; the store keeper issues PPE by badge; the equipment register
// and the contractor scorecard show it. Desktop and mobile.
const OUT = 'docs/erp/screenshots/hse-safety';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
test('Safety: observation card, action and verification, PPE issue by QR, equipment register, contractor scorecard', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const t = `s${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = world(c, t, [['se', 'SE'], ['he', 'HSEE'], ['ho', 'HSEO'], ['sk', 'SK'], ['pm', 'PM']]); const w = worker(c, 'Mahesh Gupta', `W${t.slice(-3)}`);
  await api(request, c, 'HSEO', s.u('ho'), 'post', '/hse/ppe-items', { code: 'HELMET', name: 'Safety helmet', replaceDays: 365 });
  const se = await open(browser, info, c, 'SE', s.u('se'), '/hse/observation'); const p = se.page; const errors = watch(p);
  await expect(p.getByTestId('hse-obs-card')).toBeVisible(); await p.getByTestId('hse-project').selectOption(String(s.A)); await p.getByTestId('hse-site').selectOption(String(s.site)); await p.getByTestId('hse-ob-severity').selectOption('HIGH'); await p.getByTestId('hse-ob-what').fill('Open edge on the third floor slab without a guard rail');
  await p.getByTestId('hse-ob-photo').setInputFiles({ name: 'edge.jpg', mimeType: 'image/jpeg', buffer: jpeg('edge') }); await noOverflow(p); await shot(p, '1-card', info); await p.getByTestId('hse-ob-send').click(); await expect(p.getByTestId('hse-obs-object')).toHaveAttribute('data-state', 'OPEN'); const url = p.url().replace(/^https?:\/\/[^/]+/, '');
  await p.getByTestId('hse-ob-act-note').fill('Guard rail fitted on all edges'); await p.getByTestId('hse-ob-act-go').click(); await expect(p.getByTestId('hse-obs-object')).toHaveAttribute('data-state', 'ACTION_DONE'); await expect(p.getByTestId('hse-ob-close')).toHaveCount(0);
  const he = await open(browser, info, c, 'HSEE', s.u('he'), url); await expect(he.page.getByTestId('hse-ob-actionnote')).toContainText('Guard rail'); await noOverflow(he.page); await shot(he.page, '2-verify', info); await he.page.getByTestId('hse-ob-close').click(); await expect(he.page.getByTestId('hse-obs-object')).toHaveAttribute('data-state', 'CLOSED');
  const sk = await open(browser, info, c, 'SK', s.u('sk'), '/hse/ppe-issue'); const k = sk.page; await expect(k.getByTestId('hse-ppe-issue')).toBeVisible(); await k.getByTestId('hse-ppe-site').selectOption(String(s.site)); await k.getByTestId('hse-ppe-item').selectOption({ label: 'Safety helmet' }); await k.getByTestId('hse-ppe-badge').fill(w.badge); await noOverflow(k); await k.getByTestId('hse-ppe-go').click(); await expect(k.getByTestId('hse-ppe-done-row')).toHaveCount(1); await expect(k.getByTestId('hse-ppe-holds')).toContainText('Mahesh Gupta'); await shot(k, '3-ppe', info);
  await k.getByTestId('hse-ppe-badge').fill(w.badge); await k.getByTestId('hse-ppe-go').click(); await expect(k.getByTestId('hse-ppe-done-row')).toHaveCount(2); await expect(k.getByTestId('hse-ppe-done')).toContainText('Replacement');
  const ho = await open(browser, info, c, 'HSEO', s.u('ho'), '/hse/equipment'); const h = ho.page; await expect(h.getByTestId('hse-equipment')).toBeVisible(); await h.getByText('Register equipment').click(); await h.getByTestId('hse-project').selectOption(String(s.A)); await h.getByTestId('hse-site').selectOption(String(s.site)); await h.getByTestId('hse-eq-tag').fill('FE-101'); await h.getByTestId('hse-eq-expiry').fill('2030-01-01'); await h.getByTestId('hse-eq-save').click(); await expect(h.getByTestId('hse-eq-note')).toBeVisible(); await noOverflow(h); await shot(h, '4-equipment', info);
  await h.goto('/hse/ppe-register'); await expect(h.getByTestId('hse-ppe-register')).toBeVisible(); await noOverflow(h); await shot(h, '5-ppe-register', info);
  await h.goto('/hse/observations'); await expect(h.getByTestId('hse-observations')).toBeVisible(); await noOverflow(h);
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/hse/contractor-scores'); await expect(pm.page.getByTestId('hse-contractor-scores')).toBeVisible(); await noOverflow(pm.page); await shot(pm.page, '6-scorecard', info);
  await h.goto('/hse/inspection-schedules'); await expect(h.getByTestId('hse-schedules')).toBeVisible(); await noOverflow(h); expect(errors, errors.join('\n')).toEqual([]);
});
