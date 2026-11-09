import { lookupRegistry } from '../../platform/lookups/index.js';
import { registerImportType } from '../eng/excel.js';
import { deploymentsOf } from './deployments.js';

// Deployments for the rest of the ERP (part 07.03): the lookup of crews for forms (a site's crews: the parent is the site) and the Excel import of deployments (04.13, FR-07): each row is a deployment sent for approval,
// like one typed on the form, so an import approves nothing (AC-04); the person, project, site, crew and cost code are given by their codes.
lookupRegistry.register({
  module: 'hr', name: 'crews', label: 'Crews and gangs', permission: 'hr.crew.view', columns: [{ key: 'trade', label: 'Trade' }, { key: 'site', label: 'Site' }],
  search(db, actor, q) {
    const where = ['c.company_id = :c', 'c.deleted_at IS NULL', 'c.active = 1']; const params = { c: actor.companyId, q: q.like };
    if (q.parent) { where.push('c.crew_site_id = :p'); params.p = q.parent; }
    if (q.ids) where.push(`c.id IN (${q.ids.map((n) => Number(n)).join(',')})`);
    where.push("(c.code LIKE :q ESCAPE '\\' OR c.name LIKE :q ESCAPE '\\')");
    const total = db.prepare(`SELECT COUNT(*) AS n FROM hr_crews c WHERE ${where.join(' AND ')}`).get(params).n;
    const rows = db.prepare(`SELECT c.id, c.code, c.name, c.trade, s.name AS site, s.org_project_id AS project_id FROM hr_crews c JOIN org_sites s ON s.id = c.crew_site_id WHERE ${where.join(' AND ')} ORDER BY c.code LIMIT :l OFFSET :o`).all({ ...params, l: q.ids ? 200 : q.limit, o: q.ids ? 0 : q.offset });
    const svc = deploymentsOf(db);
    const seen = svc ? rows.filter((r) => svc.may(actor, 'hr.crew.view', { projectId: r.project_id })) : [];
    return { total: seen.length === rows.length ? total : seen.length, rows: seen.map((r) => ({ id: r.id, code: r.code, name: r.name, extra: { trade: r.trade ?? '', site: r.site } })) };
  },
});

const find = (table, extra = '') => (ctx, v) => ctx.db.prepare(`SELECT id, code FROM ${table} WHERE company_id = ? AND code = ? COLLATE NOCASE AND is_active = 1 ${extra}`).all(ctx.companyId, v);
const codes = (table, extra = '') => (ctx) => ctx.db.prepare(`SELECT code FROM ${table} WHERE company_id = ? AND is_active = 1 ${extra}`).all(ctx.companyId).map((r) => r.code);
const yes = (v) => v !== false;
/** What earlier rows of the same file hold (the engine hands one ctx to every row of a file): two primary postings of one person that overlap are caught before anything is saved. */
const inFile = new WeakMap();
function bodyOf(ctx, row) {
  const db = ctx.db; const c = ctx.companyId;
  const emp = row.employee ? db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND emp_code = ? COLLATE NOCASE AND deleted_at IS NULL").get(c, row.employee)?.id ?? null : null;
  const project = row.project ? db.prepare('SELECT id FROM org_projects WHERE company_id = ? AND code = ? COLLATE NOCASE AND is_active = 1').get(c, row.project)?.id ?? null : null;
  const site = row.site && project ? db.prepare('SELECT id FROM org_sites WHERE company_id = ? AND org_project_id = ? AND code = ? COLLATE NOCASE AND is_active = 1').get(c, project, row.site)?.id ?? null : null;
  const crew = row.crew ? db.prepare('SELECT id FROM hr_crews WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(c, row.crew)?.id ?? null : null;
  const cost = row.costCode ? db.prepare('SELECT id FROM fin_cost_codes WHERE company_id = ? AND code = ? COLLATE NOCASE').get(c, row.costCode)?.id ?? null : null;
  return { personType: 'EMPLOYEE', personId: emp, projectId: project, siteId: site, crewId: crew, siteRole: row.siteRole ?? null, accessRole: row.accessRole ? String(row.accessRole).toUpperCase() : null, fromDate: row.fromDate, toDate: row.toDate ?? null, isPrimary: yes(row.primary), defaultWbsId: null, defaultCostCodeId: cost };
}
registerImportType({
  code: 'HR_DEPLOYMENT', label: 'Deployments (bulk deploy, sent for approval)', module: 'hr',
  description: 'Each row deploys an employee to a project and site (and a crew) between two dates and sends it for approval by the project manager. Employee by employee code; project, site, crew and cost code by their codes. A person has one primary posting at a time; a deployment outside the plan also goes to the project director.',
  permission: 'hr.deployment.import', exportPermission: 'hr.deployment.export', onExisting: ['ERROR'], chunked: true,
  columns: [
    { key: 'employee', label: 'Employee code', type: 'text', required: true, maxLength: 30 },
    { key: 'project', label: 'Project code', type: 'lookup', required: true, lookup: { noun: 'project', resolve: find('org_projects'), list: codes('org_projects') } },
    { key: 'site', label: 'Site code', type: 'text', maxLength: 30 }, { key: 'crew', label: 'Crew code', type: 'text', maxLength: 20 },
    { key: 'siteRole', label: 'Role on site', type: 'text', maxLength: 80 }, { key: 'fromDate', label: 'From', type: 'date', required: true }, { key: 'toDate', label: 'To', type: 'date' },
    { key: 'primary', label: 'Primary posting', type: 'bool', help: 'Yes (the default) for the main posting; No for an additional one.' },
    { key: 'accessRole', label: 'Site access role', type: 'text', maxLength: 20, help: 'A role code the deployment gives at the site, such as SE or WSUP; leave empty for none.' },
    { key: 'costCode', label: 'Default cost code', type: 'text', maxLength: 30 },
  ],
  keys: ['employee', 'project', 'fromDate'],
  findExisting: () => null,
  validateRow(ctx, row) {
    const s = deploymentsOf(ctx.db);
    const b = bodyOf(ctx, row);
    const out = [];
    if (!b.personId) out.push({ column: 'employee', message: `${row.employee} is not an employee` });
    if (row.site && !b.siteId) out.push({ column: 'site', message: `${row.site} is not a site of ${row.project}` });
    if (row.crew && !b.crewId) out.push({ column: 'crew', message: `${row.crew} is not a crew` });
    if (row.costCode && !b.defaultCostCodeId) out.push({ column: 'costCode', message: `${row.costCode} is not a cost code` });
    if (out.length || !b.projectId) return out;
    const col = { personId: 'employee', projectId: 'project', siteId: 'site', crewId: 'crew', fromDate: 'fromDate', toDate: 'toDate', accessRole: 'accessRole', defaultCostCodeId: 'costCode' };
    for (const p of s.deployments.validate(ctx.actor, b)) out.push({ column: col[p.field] ?? 'employee', message: p.message });
    const seen = inFile.get(ctx) ?? []; inFile.set(ctx, seen);
    if (b.isPrimary && b.personId) {
      const twin = seen.find((x) => x.personId === b.personId && x.fromDate <= (b.toDate ?? '9999-12-31') && (x.toDate ?? '9999-12-31') >= b.fromDate);
      if (twin) out.push({ column: 'fromDate', message: 'The same person has another primary posting in this file for these dates' });
      else seen.push({ personId: b.personId, fromDate: b.fromDate, toDate: b.toDate });
    }
    return out;
  },
  commitRow(ctx, { row }) {
    const r = deploymentsOf(ctx.db).deployments.create(ctx.actor, { ...bodyOf(ctx, row), submit: true, comment: 'Imported from Excel', sourceType: 'excel_import' });
    return { id: r.id, ref: `${r.docNo} (waiting for approval)` };
  },
});
