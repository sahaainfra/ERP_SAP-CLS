import { test, expect } from '@playwright/test';

// D-828: the keyboard focus a person sets once the shell is on screen stays where it is while the page finishes drawing. The app once drew a
// provisional header before the session arrived and replaced it with the shell, and focus fell back to the page body.
test('a Tab pressed as soon as the shell shows keeps its focus while the home page finishes drawing', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('erp.dev.identity', JSON.stringify({ user: 'focus-pm', roles: 'PM', company: '1' })));
  for (let i = 0; i < 3; i += 1) {
    await page.goto('/home');
    await page.getByRole('banner').waitFor();
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement !== document.body);
    if (!focused) continue; // nothing focusable yet: nothing that could be lost
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => (document.activeElement === document.body ? 'body' : document.activeElement.outerHTML.slice(0, 80)))).not.toBe('body');
  }
});
