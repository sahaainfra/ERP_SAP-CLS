// UI v3: screenshots of the home page and a list report on desktop and phone, for the design review.
import { test, expect } from '@playwright/test';
import { company } from './hse-helpers.js';

test('UI v3 look: home and list report', async ({ page, request }, info) => {
  const c = await company(request, `UIV${info.project.name === 'mobile' ? 'M' : 'D'}${Date.now().toString(36).slice(-4).toUpperCase()}`);
  await page.addInitScript(([co]) => { localStorage.setItem('erp.dev.identity', JSON.stringify({ user: 'asha.menon', roles: 'SYSADM', company: String(co) })); }, [c]);
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `docs/erp/screenshots/ui-v3/${info.project.name}-home.png`, fullPage: true });
  await page.goto('/admin/users');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `docs/erp/screenshots/ui-v3/${info.project.name}-users.png`, fullPage: true });
});
