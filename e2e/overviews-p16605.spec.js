import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 166.5 in the browser (ff.ui.p16605 is ON in test): the module dashboards as overview pages of cards,
// "View all ›" with the dashboard's filters, "Show as table" on a chart, Home insight cards by role, sizes S/M/L/XL, and on a phone one column,
// no sideways scroll, charts at least 220 px tall and legends readable at a large text size (T-03).
const SHOTS = 'docs/erp/screenshots/166.5';
const shot = (page, info, name, fullPage = true) => page.screenshot({ path: `${SHOTS}/after-${name}-${info.project.name}.png`, fullPage });
const open = async (page, { user, roles, path }) => {
  await page.addInitScript(([v]) => {
    if (sessionStorage.getItem('erp.test.identity-set')) return;
    localStorage.setItem('erp.dev.identity', JSON.stringify(v));
    localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' }));
    sessionStorage.setItem('erp.test.identity-set', '1');
  }, [{ user, roles, company: '1' }]);
  await page.goto(path);
};
function errorsOf(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('FR-02 the QS dashboard is an overview page: cards with a subtitle, the figure and the source; "View all ›" opens the list with the dashboard\'s project', async ({ page }, info) => {
  const errors = errorsOf(page);
  await open(page, { user: 'e2e-ov-dir', roles: 'DIR', path: '/bill/qs-dashboard' });
  await expect(page.getByTestId('overview-ov-qs')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'QS Management Dashboard', level: 1 })).toBeVisible();
  const card = page.getByTestId('widget-ov.qs.unbilled_wip');
  await expect(card.getByRole('heading', { name: 'Unbilled work (WIP)' })).toBeVisible();
  await expect(card.getByTestId('kpi-subtitle')).toContainText('₹ ·');
  await expect(card.getByTestId('kpi-value')).toContainText('₹');
  await expect(card.getByTestId('widget-source')).toHaveText('Source: Billing, QS dashboard service (22.08)');
  // every card has "View all ›"
  const cards = page.locator('[data-testid^="widget-ov."]');
  const n = await cards.count();
  expect(n).toBe(8);
  await expect(page.locator('[data-testid^="widget-ov."] [data-testid="widget-view-all"]')).toHaveCount(n);
  await shot(page, info, 'qs-overview');
  if (info.project.name === 'mobile') {
    expect(await noSidewaysScroll(page)).toBe(true);
    // one column: every card as wide as the grid
    const widths = await page.evaluate(() => { const g = document.querySelector('[data-testid="dashboard-grid"]').getBoundingClientRect().width; return [...document.querySelectorAll('.dash-cell')].map((c) => Math.round(c.getBoundingClientRect().width / g * 100)); });
    expect(widths.every((w) => w >= 98), widths.join(',')).toBe(true);
  }
  await card.getByTestId('widget-view-all').click();
  await expect(page).toHaveURL(/\/bill\/qty-recon/);
  expect(errors).toEqual([]);
});

test('FR-04 T-03 a chart card shows its figures as a table on request; on a phone the chart is at least 220 px tall and the legend stays readable at a large text size', async ({ page }, info) => {
  const errors = errorsOf(page);
  await open(page, { user: 'e2e-ov-proc', roles: 'DIR', path: '/proc/dashboard' });
  await expect(page.getByTestId('overview-ov-proc')).toBeVisible();
  const card = page.getByTestId('widget-ov.proc.single_source');
  await expect(card.locator('svg.ch-svg')).toBeVisible();
  await expect(card.getByTestId('widget-source')).toContainText('Procurement, analytics service (15.10)');
  if (info.project.name === 'mobile') {
    const h = await card.locator('svg.ch-svg').evaluate((s) => s.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(220);
    // text size XL: the browser's text at 125 %; the legend wraps below the chart and stays inside the card
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    const legend = card.locator('.ch-legend');
    await expect(legend).toBeVisible();
    const box = await legend.evaluate((l) => { const r = l.getBoundingClientRect(); const c = l.closest('.wd').getBoundingClientRect(); return { inside: r.right <= c.right + 1 && r.left >= c.left - 1, font: parseFloat(getComputedStyle(l).fontSize), below: r.top >= l.parentElement.querySelector('svg').getBoundingClientRect().bottom - 1 }; });
    expect(box.inside, 'the legend stays inside its card').toBe(true);
    expect(box.below, 'the legend is below the chart').toBe(true);
    expect(box.font).toBeGreaterThanOrEqual(16);
    expect(await noSidewaysScroll(page)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  }
  await card.getByTestId('chart-show-table').click();
  const table = card.getByTestId('chart-table-view');
  await expect(table.getByRole('table')).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'Orders without competition' })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'Emergency requisitions' })).toBeVisible();
  await expect(card.locator('svg.ch-svg')).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  await shot(page, info, 'chart-as-table', false);
  await card.getByTestId('chart-show-table').click();
  await expect(card.locator('svg.ch-svg')).toBeVisible();
  expect(errors).toEqual([]);
});

test('FR-03 Home shows the insight cards of the person\'s role: approvals waiting, then the figures of their work; a stores keeper sees the stores', async ({ page }, info) => {
  const errors = errorsOf(page);
  await open(page, { user: 'e2e-ov-pm', roles: 'PM', path: '/home' });
  const insights = page.getByTestId('home-insights');
  await expect(insights.getByRole('heading', { name: 'Insights for your role', level: 2 })).toBeVisible();
  await expect(insights.getByTestId('widget-ov.todo.mine')).toBeVisible();
  await expect(insights.getByTestId('widget-ov.todo.mine')).toContainText('Nothing is waiting for you');
  await expect(insights.getByTestId('widget-ov.qs.unbilled_wip')).toBeVisible();
  await expect(insights.getByTestId('widget-ov.hse.safe_hours')).toBeVisible();
  await expect(insights.getByTestId('widget-ov.stores.below_reorder')).toHaveCount(0);
  if (info.project.name === 'mobile') expect(await noSidewaysScroll(page)).toBe(true);
  await shot(page, info, 'home-insights-pm');
  // FR-01: in Customise a card takes a size S, M, L or XL (desktop)
  if (info.project.name === 'desktop') {
    await insights.getByTestId('customise').click();
    const sizes = insights.getByRole('group', { name: 'Size of Unbilled work (WIP)' });
    await expect(sizes.getByRole('button', { name: /^Size S/ })).toHaveAttribute('aria-pressed', 'true');
    await sizes.getByRole('button', { name: /^Size M/ }).click();
    await expect(sizes.getByRole('button', { name: /^Size M/ })).toHaveAttribute('aria-pressed', 'true');
    await insights.getByRole('button', { name: 'Cancel' }).click();
  }
  expect(errors).toEqual([]);
});

test('FR-03 a stores keeper\'s Home: approvals, items below reorder level, what waits for approval', async ({ page }, info) => {
  await open(page, { user: 'e2e-ov-sk', roles: 'SK', path: '/home' });
  const insights = page.getByTestId('home-insights');
  await expect(insights.getByTestId('widget-ov.stores.below_reorder')).toBeVisible();
  await expect(insights.getByTestId('widget-ov.stores.below_reorder').getByTestId('widget-source')).toHaveText('Source: Inventory, stores dashboard service (16.01)');
  await expect(insights.getByTestId('widget-ov.qs.unbilled_wip')).toHaveCount(0);
  await shot(page, info, 'home-insights-sk');
});
