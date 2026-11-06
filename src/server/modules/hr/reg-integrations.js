import { createHash } from 'node:crypto';
import { registerImportType } from '../eng/excel.js';
import { punchesOf } from './punches.js';
import { registerOf } from './att-register.js';

// The device file import of the attendance register (part 07.06, FR-06). A biometric or card device exports its log as a file: one row per event with the person code, the site code, in or out and the time on the device.
// Each row goes through the same punch service as a phone punch (geo-fence aside), so the rules of 07.05 apply and a duplicate is recognised: the id of a punch is made from the device, the person, the type and the time,
// so loading the same file twice, or two files that overlap, store each event once. Rows are counted as new, duplicate or rejected, and the register recomputes the days touched.
const cache = new WeakMap();
const clientUuid = (device, code, type, time) => {
  const h = createHash('sha256').update(`${String(device).toLowerCase()}|${String(code).toLowerCase()}|${type}|${time}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const timeOf = (v) => {
  const s = String(v ?? '').trim(); if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s); if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? '00'}Z`) - 19_800_000; // the device clock is India time
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
registerImportType({
  code: 'ATT_DEVICE_PUNCH', label: 'Device punches (biometric or card file)', module: 'hr',
  description: 'Each row is one event of an attendance device: the person code, the site code, IN or OUT and the time on the device (India time, such as 2026-12-01 09:03:00). A row already loaded, from this file or an earlier one, is counted as a duplicate and stored once. Rows go through the same rules as a phone punch.',
  permission: 'att.device.import', exportPermission: 'att.register.export', onExisting: ['ERROR', 'SKIP'], chunked: true,
  columns: [
    { key: 'employee', label: 'Employee code', type: 'text', required: true, maxLength: 30 }, { key: 'site', label: 'Site code', type: 'text', required: true, maxLength: 30 },
    { key: 'punchType', label: 'In or out', type: 'text', required: true, maxLength: 3, help: 'IN or OUT' }, { key: 'time', label: 'Device time', type: 'text', required: true, maxLength: 20 },
    { key: 'device', label: 'Device serial', type: 'text', required: true, maxLength: 80 },
  ],
  keys: ['employee', 'punchType', 'time', 'device'],
  findExisting(ctx, row) {
    const iso = timeOf(row.time); const type = String(row.punchType ?? '').toUpperCase();
    if (!iso || !['IN', 'OUT'].includes(type)) return null;
    const hit = ctx.db.prepare('SELECT id FROM att_punches WHERE company_id = ? AND client_uuid = ?').get(ctx.companyId, clientUuid(row.device, row.employee, type, iso));
    return hit ? { id: hit.id } : null;
  },
  validateRow(ctx, row) {
    const out = []; const c = ctx.companyId;
    const emp = ctx.db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND emp_code = ? COLLATE NOCASE AND deleted_at IS NULL AND record_status = 'APPROVED'").get(c, row.employee);
    if (!emp) out.push({ column: 'employee', message: `${row.employee} is not an employee` });
    const site = ctx.db.prepare('SELECT id FROM org_sites WHERE company_id = ? AND code = ? COLLATE NOCASE AND is_active = 1').all(c, row.site);
    if (site.length === 0) out.push({ column: 'site', message: `${row.site} is not a site` }); else if (site.length > 1) out.push({ column: 'site', message: `${row.site} names more than one site` });
    if (!['IN', 'OUT'].includes(String(row.punchType ?? '').toUpperCase())) out.push({ column: 'punchType', message: 'Use IN or OUT' });
    if (!timeOf(row.time)) out.push({ column: 'time', message: 'Use a date and time such as 2026-12-01 09:03:00' });
    else if (Date.parse(timeOf(row.time)) > Date.now() + 300_000) out.push({ column: 'time', message: 'The time is in the future' });
    return out;
  },
  commitRow(ctx, { row }) {
    const c = ctx.companyId; const type = String(row.punchType).toUpperCase(); const iso = timeOf(row.time);
    const emp = ctx.db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND emp_code = ? COLLATE NOCASE AND deleted_at IS NULL AND record_status = 'APPROVED'").get(c, row.employee);
    const site = ctx.db.prepare('SELECT id FROM org_sites WHERE company_id = ? AND code = ? COLLATE NOCASE AND is_active = 1').get(c, row.site);
    const r = punchesOf(ctx.db).recordDeviceSync(ctx.actor, { personId: emp.id, siteId: site.id, punchType: type, deviceTime: iso, deviceId: row.device, clientUuid: clientUuid(row.device, row.employee, type, iso), offline: true, imported: true });
    const seen = cache.get(ctx) ?? { created: 0, duplicates: 0, touched: new Set() }; cache.set(ctx, seen);
    if (r.replayed) seen.duplicates += 1; else { seen.created += 1; seen.touched.add(`${emp.id}|${iso}`); }
    if (!r.replayed) registerOf(ctx.db)?.queueChange(c, emp.id, new Date(Date.parse(iso) + 19_800_000).toISOString().slice(0, 10));
    return { id: r.id, ref: r.replayed ? 'duplicate: stored once' : `punch ${r.id} (${r.result})` };
  },
});
