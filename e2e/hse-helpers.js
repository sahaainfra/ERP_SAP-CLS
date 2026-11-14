import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Shared pieces of the HSE browser tests (M19): development-header sign-in, a company set-up, a project with a site, and raw row inserts for what the pages do not create.
export const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
export function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|ERR_INTERNET_DISCONNECTED|Cannot reach the server|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
export const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
export const api = async (request, c, roles, user, method, path, data) => { const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data }); expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
export async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') }); const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' }); return id;
}
export const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use; const context = await browser.newContext({ baseURL, viewport, hasTouch, acceptDownloads: true }); const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) }); await page.goto(path); return { page, context };
};
export const iso = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
export const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
export const jpeg = (tag) => Buffer.concat([JPEG, Buffer.from(String(tag))]);
export const db = () => { const d = new DatabaseSync('data/e2e.sqlite'); d.exec('PRAGMA busy_timeout = 8000;'); d.exec('PRAGMA foreign_keys = OFF;'); return d; };
let seq = 0;
/** Inserts a row, filling every required column that is not given (the first value of a CHECK list, zero or text). */
export function fill(d, table, vals) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all(); const sql = d.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name === 'doc_no' && !('doc_no' in vals)) { names.push('doc_no'); params.push(`E/${table}/${(seq += 1)}-${Date.now().toString(36)}`); continue; } if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); const f = first(c.name); params.push(f ?? (/INT|NUM|REAL/i.test(c.type) ? 0 : `x${(seq += 1)}`)); } }
  return Number(d.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
/** A project with a site, users for the roles, and the company's HSE set-up shared by the HSE browser tests. */
export function world(c, t, roles) {
  const d = db(); for (const [n, r] of roles) d.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify([r]), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const A = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, `${T}-A`, 'Tower A').lastInsertRowid);
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (?, ?, ?, 'Main site')").run(c, A, `${T}-S1`).lastInsertRowid);
  d.close(); return { u: (k) => `${t}-${k}`, T, A, site };
}
/** An approved, working contract worker with a QR badge. */
export function worker(c, name, code) {
  const d = db(); const partner = fill(d, 'mdm_partners', { company_id: c, code: `P-${code}`, legal_name: `Contractor ${code}`, partner_status: 'ACTIVE' }); const id = fill(d, 'lab_workers', { company_id: c, worker_code: code, name, status: 'APPROVED', worker_status: 'ACTIVE', contractor_id: partner });
  const token = `tok${id}${code}`.toLowerCase(); d.prepare('UPDATE lab_workers SET root_id = id, qr_token = ? WHERE id = ?').run(token, id); d.close(); return { id, code, badge: `LAB:${token}` };
}
export function certify(c, workerId, type, until) {
  const d = db(); if (!d.prepare('SELECT 1 FROM trn_cert_types WHERE company_id = ? AND code = ?').get(c, type)) fill(d, 'trn_cert_types', { company_id: c, code: type, name: type });
  fill(d, 'trn_certifications', { company_id: c, person_type: 'WORKER', person_id: workerId, cert_type: type, valid_from: '2026-01-01', valid_until: until, cert_status: 'ACTIVE' }); d.close();
}
export function location(c, A, code, name) { const d = db(); const id = fill(d, 'proj_locations', { company_id: c, project_id: A, code, name, loc_type: 'ZONE', loc_status: 'ACTIVE' }); d.close(); return id; }
