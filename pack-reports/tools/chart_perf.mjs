#!/usr/bin/env node
/* global window, document */
// PACK-12: times the application's Chart with S-curves of 500, 2,000 and 5,000 points in Chromium, counts its DOM nodes and long tasks,
// and runs axe (WCAG 2.1 A/AA) on it. Needs the harness built first:
//   npx vite build --config pack-reports/tools/chart-perf/vite.config.js
//   node pack-reports/tools/chart_perf.mjs [--out pack-reports/chart-perf.json] [--label before|after] [--flag 0|1]
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = join(root, 'node_modules', '.cache', 'chart-perf-dist');
const args = process.argv.slice(2);
const out = args.includes('--out') ? resolve(root, args[args.indexOf('--out') + 1]) : join(root, 'pack-reports', 'chart-perf.json');
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'run';
const flag = args.includes('--flag') ? args[args.indexOf('--flag') + 1] : '0'; // ff.charts.pack12 as the chart sees it
if (!existsSync(join(dist, 'index.html'))) { console.error('build the harness first (see the header)'); process.exit(2); }
const AXE = readFileSync(join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const p = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
const results = { label, flag, at: new Date().toISOString(), runs: [] };
for (const [w, h, device] of [[1366, 800, 'desktop'], [360, 740, 'phone']]) {
  for (const n of [500, 2000, 5000]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.addInitScript(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); });
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/index.html?n=${n}&flag=${flag}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120_000 });
    const wall = Date.now() - t0;
    const m = await page.evaluate(() => ({ renderMs: window.__renderMs, nodes: document.querySelector('figure')?.querySelectorAll('*').length ?? 0, marks: document.querySelectorAll('figure circle').length, tableRows: document.querySelectorAll('figure tbody tr').length, long: window.__long.slice() }));
    // hovering across the plot: how long the page takes to answer 20 pointer moves
    const svg = await page.locator('figure svg').boundingBox();
    const h0 = Date.now();
    for (let i = 0; i < 20; i += 1) await page.mouse.move(svg.x + (svg.width * (i + 0.5)) / 20, svg.y + svg.height / 2);
    const hoverMs = Date.now() - h0;
    // the tooltip at the centre of the drawing (the svg box can be wider than the drawing, which is centred)
    await page.mouse.move(svg.x + svg.width / 2, svg.y + svg.height / 2);
    const tip = await page.waitForFunction(() => document.querySelector('.ch-tip')?.textContent ?? '', null, { timeout: 2000 }).then((h) => h.jsonValue()).catch(() => '');
    // opening "View as table": every row is there, and how long it takes
    const o0 = Date.now();
    await page.locator('figure details.ch-table > summary').click();
    await page.waitForFunction((k) => document.querySelectorAll('figure tbody tr').length === k, n, { timeout: 60_000 });
    const openTableMs = Date.now() - o0;
    await page.evaluate(AXE);
    const ax = await page.evaluate(() => window.axe.run(document.querySelector('figure'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
    const summary = await page.evaluate(() => document.querySelector('figure svg title')?.textContent ?? '');
    const row = { device, n, wallMs: wall, ...m, longest: Math.max(0, ...m.long), hoverMs, tip, openTableMs, axe: ax.violations.map((v) => `${v.id} (${v.nodes.length})`), summary };
    delete row.long;
    results.runs.push(row);
    console.log(`${device.padEnd(7)} n=${String(n).padStart(4)} render ${String(row.renderMs).padStart(5)} ms  nodes ${String(row.nodes).padStart(6)}  marks ${String(row.marks).padStart(5)}  table rows ${String(row.tableRows).padStart(5)}  longest task ${String(row.longest).padStart(5)} ms  20 hovers ${hoverMs} ms  tip ${tip ? 'yes' : 'NO'}  open table ${openTableMs} ms  axe ${row.axe.length}`);
    await page.close();
  }
}
await browser.close(); server.close();
writeFileSync(out, JSON.stringify(results, null, 1));
console.log(`summary (5,000, desktop): ${results.runs.find((r) => r.n === 5000 && r.device === 'desktop').summary}`);
