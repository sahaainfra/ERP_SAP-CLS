import { lookupRegistry } from '../../platform/lookups/index.js';
import { registerImportType } from '../eng/excel.js';
import { projectsOf } from './project.js';

// Part 10.01 for the rest of the ERP: the lookups of the wizard (clients, consultants and funding agencies from the partner master) and the Excel import (04.13) of milestones into the key dates register of a project.
const lookup = (name, label, role) => lookupRegistry.register({
  module: 'proj', name, label, permission: 'proj.project.view', columns: [{ key: 'status', label: 'Status' }],
  search(db, actor, q) {
    const where = ["p.company_id = ? AND p.deleted_at IS NULL AND p.partner_status IN ('PROSPECT', 'PENDING', 'ACTIVE')", ...(role ? ["EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = '" + role + "' AND r.deleted_at IS NULL)"] : [])]; const args = [actor.companyId];
    if (q.ids) { where.push(`p.id IN (${q.ids.map(() => '?').join(',')})`); args.push(...q.ids); }
    if (q.text) { where.push('(p.code LIKE ? OR p.legal_name LIKE ? OR p.trade_name LIKE ?)'); args.push(`${q.text}%`, `%${q.text}%`, `%${q.text}%`); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM mdm_partners p WHERE ${where.join(' AND ')}`).get(...args).n;
    const rows = db.prepare(`SELECT p.id, p.code, p.legal_name, p.partner_status FROM mdm_partners p WHERE ${where.join(' AND ')} ORDER BY p.legal_name LIMIT ? OFFSET ?`).all(...args, q.ids ? 200 : q.limit, q.ids ? 0 : q.offset);
    return { rows: rows.map((r) => ({ id: r.id, code: r.code, name: r.legal_name, extra: { status: r.partner_status } })), total };
  },
});
lookup('clients', 'Clients', 'CLIENT'); lookup('consultants', 'Consultants and engineers', 'CONSULTANT'); lookup('funders', 'Funding agencies', null);
lookupRegistry.register({
  module: 'proj', name: 'people', label: 'People of the company', permission: 'proj.project.view', columns: [{ key: 'roles', label: 'Roles' }],
  search(db, actor, q) {
    const all = db.prepare('SELECT id, username, display_name, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1 ORDER BY display_name, username').all(actor.companyId).filter((u) => !q.text || `${u.username} ${u.display_name ?? ''}`.toLowerCase().includes(q.text.toLowerCase()));
    const rows = q.ids ? all.filter((u) => q.ids.includes(u.id)) : all.slice(q.offset, q.offset + q.limit);
    return { rows: rows.map((u) => ({ id: u.id, code: u.username, name: u.display_name || u.username, extra: { roles: (() => { try { return JSON.parse(u.roles_json ?? '[]').join(', '); } catch { return ''; } })() } })), total: all.length };
  },
});
registerImportType({
  code: 'PROJ_MILESTONE', label: 'Project milestones (key dates)', module: 'project master',
  description: 'Each row adds a milestone to the key dates register of a project (give its code). A contractual milestone of a live project changes only by an approved amendment.',
  permission: 'proj.milestone.manage', exportPermission: 'proj.project.view', onExisting: ['ERROR'], chunked: false,
  columns: [{ key: 'projectCode', label: 'Project', type: 'text', required: true, maxLength: 30 }, { key: 'code', label: 'Milestone code', type: 'text', required: true, maxLength: 30 }, { key: 'name', label: 'Milestone', type: 'text', required: true, maxLength: 200 }, { key: 'plannedDate', label: 'Planned date', type: 'date', required: true }, { key: 'contractual', label: 'Contractual', type: 'bool' }, { key: 'paymentLinked', label: 'Payment linked', type: 'bool' }],
  keys: ['projectCode', 'code'], findExisting: () => null,
  validateRow() { return []; },
  commitRow(ctx, { row }) { return projectsOf(ctx.db).milestones.importRow(ctx.actor, { projectCode: row.projectCode, row: { code: row.code, name: row.name, plannedDate: row.plannedDate, contractual: Boolean(row.contractual), paymentLinked: Boolean(row.paymentLinked) } }); },
});
