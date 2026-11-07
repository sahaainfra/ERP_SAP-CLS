import { lookupRegistry } from '../../platform/lookups/index.js';
import { registerImportType } from '../eng/excel.js';
import { projectsOf } from './project.js';
import { boqOf } from './boq.js';
import { structureOf } from './structure.js';

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

// Part 10.03: the Excel import (04.13) of the WBS and of the location breakdown. Parents are listed before their children; a baselined WBS is changed by a change request, not by import.
registerImportType({
  code: 'PROJ_WBS', label: 'Project WBS (work breakdown structure)', module: 'project structure',
  description: 'Each row adds a WBS node to a project (give its code): the node code, its parent code (empty at the top), the name, the weight in % among its siblings, the discipline, the person responsible and whether it is a control account. List parents before their children. A baselined WBS is changed by a change request, not by import.',
  permission: 'proj.wbs.import', exportPermission: 'proj.wbs.view', onExisting: ['ERROR'], chunked: false,
  columns: [{ key: 'projectCode', label: 'Project', type: 'text', required: true, maxLength: 30 }, { key: 'code', label: 'WBS code', type: 'text', required: false, maxLength: 40 }, { key: 'parentCode', label: 'Parent code', type: 'text', maxLength: 40 }, { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 200 }, { key: 'weight', label: 'Weight %', type: 'text', maxLength: 12 }, { key: 'discipline', label: 'Discipline', type: 'text', maxLength: 30 }, { key: 'responsibleUser', label: 'Responsible (user name)', type: 'text', maxLength: 60 }, { key: 'controlAccount', label: 'Control account', type: 'bool' }],
  keys: ['projectCode', 'code'], findExisting: () => null,
  validateRow() { return []; },
  commitRow(ctx, { row }) { return structureOf(ctx.db).wbs.importRow(ctx.actor, { projectCode: row.projectCode, row: { code: row.code, parentCode: row.parentCode, name: row.name, weight: row.weight, discipline: row.discipline, responsibleUser: row.responsibleUser, controlAccount: Boolean(row.controlAccount) } }); },
});
registerImportType({
  code: 'PROJ_LOCATION', label: 'Project locations (location breakdown)', module: 'project structure',
  description: 'Each row adds a location to a project: the code, its parent code (empty at the top), the type (BLOCK, BUILDING, FLOOR, ZONE, ROOM, CHAINAGE, STRUCTURE), the name, the chainage from and to in metres for chainage segments and structures, and the map reference. List parents before their children.',
  permission: 'proj.wbs.import', exportPermission: 'proj.wbs.view', onExisting: ['ERROR'], chunked: false,
  columns: [{ key: 'projectCode', label: 'Project', type: 'text', required: true, maxLength: 30 }, { key: 'code', label: 'Location code', type: 'text', required: true, maxLength: 40 }, { key: 'parentCode', label: 'Parent code', type: 'text', maxLength: 40 }, { key: 'type', label: 'Type', type: 'text', required: true, maxLength: 20 }, { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 200 }, { key: 'chainageFrom', label: 'Chainage from (m)', type: 'number' }, { key: 'chainageTo', label: 'Chainage to (m)', type: 'number' }, { key: 'lat', label: 'Latitude', type: 'number' }, { key: 'lng', label: 'Longitude', type: 'number' }],
  keys: ['projectCode', 'code'], findExisting: () => null,
  validateRow() { return []; },
  commitRow(ctx, { row }) { return structureOf(ctx.db).locations.importRow(ctx.actor, { projectCode: row.projectCode, row: { code: row.code, parentCode: row.parentCode, type: String(row.type ?? '').toUpperCase(), name: row.name, chainageFrom: row.chainageFrom ?? null, chainageTo: row.chainageTo ?? null, lat: row.lat ?? null, lng: row.lng ?? null } }); },
});

// Part 10.04: the Excel import (04.13) of BOQ items into a draft BOQ version (give its number); the bill and section are made from their names.
registerImportType({
  code: 'PROJ_BOQ_LINE', label: 'BOQ items (client bill of quantities)', module: 'project BOQ',
  description: 'Each row adds an item to a draft BOQ version (give its number): the bill and section names, the client item code, the description, the unit, the quantity and the rate; a sub-item gives the code of its parent item. A frozen version is not changed by import.',
  permission: 'proj.boq.import', exportPermission: 'proj.version.view', onExisting: ['ERROR'], chunked: false,
  columns: [{ key: 'versionNo', label: 'BOQ version', type: 'text', required: true, maxLength: 30 }, { key: 'bill', label: 'Bill', type: 'text', maxLength: 200 }, { key: 'section', label: 'Section', type: 'text', maxLength: 200 }, { key: 'itemCode', label: 'Item code', type: 'text', required: true, maxLength: 60 }, { key: 'description', label: 'Description', type: 'text', required: true, maxLength: 4000 }, { key: 'uom', label: 'Unit', type: 'text', required: true, maxLength: 20 }, { key: 'qty', label: 'Quantity', type: 'text', required: true, maxLength: 20 }, { key: 'rate', label: 'Rate', type: 'text', maxLength: 20 }, { key: 'parentCode', label: 'Parent item code', type: 'text', maxLength: 60 }],
  keys: ['versionNo', 'itemCode'], findExisting: () => null,
  validateRow() { return []; },
  commitRow(ctx, { row }) { return boqOf(ctx.db).importer.importRow(ctx.actor, { versionNo: row.versionNo, row: { bill: row.bill, section: row.section, itemCode: row.itemCode, description: row.description, uom: row.uom, qty: row.qty, rate: row.rate, parentCode: row.parentCode } }); },
});
