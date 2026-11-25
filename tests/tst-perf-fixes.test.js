import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// Part 30.06 FR-03: what the load test found and fixed.
// The employee master export of more than 1,000 people (the 02.07 personal-data threshold) failed with a server error: the list export
// service had no approval engine, and it also ignored the guard's answer. It now raises the approval request, refuses the export until the
// HR manager or a director approves, runs once with the approved request, and the approval cannot be used twice.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'idempotency-key': `fix-${Date.now().toString(36)}-${(seq += 1)}` });
const hr = { roles: 'SYSADM,HRMGR', user: 'hrexp' }; const dir = { roles: 'DIR', user: 'dirx' };

test('FR-03 a bulk personal-data export asks for approval instead of failing, runs once approved, and only once', async () => {
  const api = await startApi(); opened.push(api); await setupCompany(api);
  const d = api.db; d.exec('PRAGMA foreign_keys = OFF');
  for (const [u, r] of [['hrexp', ['SYSADM', 'HRMGR']], ['dirx', ['DIR']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u, u, JSON.stringify(r), `${u}@example.com`);
  const ins = d.prepare("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, grade, employment_type, doj, location_type, employment_status, record_status, created_by, source_type) VALUES (1, ?, 'L', ?, ?, 'MALE', '1990-01-01', ?, 'G1', 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', 's', 'p')");
  d.exec('BEGIN'); for (let i = 0; i < 1050; i += 1) ins.run(`E${i}`, `Employee ${i}`, `e${i}`, `93${String(i).padStart(8, '0')}`); d.exec('COMMIT');
  const first = await api.raw('GET', '/api/v1/hr/employees/export?format=csv', hr);
  assert.equal(first.status, 422, first.buffer.toString('utf8').slice(0, 300)); assert.match(first.json.error.message, /needs the approval/);
  const reqId = Number(first.json.error.details[0].message);
  assert.equal((await api.raw('GET', '/api/v1/hr/employees/export?format=csv', hr)).json.error.details[0].message, String(reqId), 'the same request, not a second one');
  assert.equal((await api.raw('GET', `/api/v1/hr/employees/export?format=csv&approvalId=${reqId}`, hr)).status, 422, 'not before it is approved');
  const ok = await api.call('POST', `/api/v1/core/change-requests/${reqId}/act`, { ...dir, headers: key(), body: { action: 'approve', comment: 'Needed for the statutory return' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const file = await api.raw('GET', `/api/v1/hr/employees/export?format=csv&approvalId=${reqId}`, hr);
  assert.equal(file.status, 200, file.buffer.toString('utf8').slice(0, 300)); assert.ok(file.buffer.toString('utf8').split('\n').length > 1000);
  assert.equal((await api.raw('GET', `/api/v1/hr/employees/export?format=csv&approvalId=${reqId}`, hr)).status, 422, 'an approval is used once');
});
