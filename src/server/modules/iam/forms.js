import { authzOf } from '../../platform/authz/index.js';
import { companyScope } from '../../platform/db/scope.js';
import { duplicateChecks } from '../../platform/forms/index.js';
import { lookupRegistry } from '../../platform/lookups/index.js';

// What forms can look up from the organisation and the people of a company (part 03.02, FR-01, FR-05), inside the person's data
// scope (02.04): a project manager of one project sees that project, its sites and their cost centres only. Also the duplicate
// checks for people and projects (FR-08).
const cid = (actor) => companyScope(actor).params._company_scope;
const page = (db, base, params, order, { limit, offset }) => ({
  total: db.prepare(`SELECT COUNT(*) AS n FROM ${base}`).get(params).n,
  rows: db.prepare(`SELECT * FROM ${base} ORDER BY ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit, offset }),
});
const idFilter = (ids, col = 't.id') => (ids ? `${col} IN (${ids.map(Number).join(',')})` : '1 = 1');

lookupRegistry.register({
  module: 'iam', name: 'projects', label: 'Projects', permission: 'org.view',
  columns: [{ key: 'type', label: 'Type' }, { key: 'status', label: 'Status' }],
  search(db, actor, q) {
    const scope = authzOf(db).scopeFilter(actor, 'org.view', { project: 't.id' }).sql;
    const base = `org_projects t WHERE t.company_id = :c AND t.is_active = 1 AND t.status != 'CLOSED' AND ${scope} AND ${idFilter(q.ids)} AND (t.code LIKE :q ESCAPE '\\' OR t.name LIKE :q ESCAPE '\\')`;
    const r = page(db, base, { c: cid(actor), q: q.like }, 't.code', q);
    return { total: r.total, rows: r.rows.map((p) => ({ id: p.id, code: p.code, name: p.name, extra: { type: p.type, status: p.status } })) };
  },
});

lookupRegistry.register({
  module: 'iam', name: 'sites', label: 'Sites', permission: 'org.view',
  columns: [{ key: 'project', label: 'Project' }, { key: 'type', label: 'Type' }],
  search(db, actor, q) {
    const scope = authzOf(db).scopeFilter(actor, 'org.view', { project: 't.org_project_id', site: 't.id' }).sql;
    const base = `org_sites t JOIN org_projects p ON p.id = t.org_project_id WHERE t.company_id = :c AND t.is_active = 1 AND t.status != 'INACTIVE' AND ${scope} AND ${idFilter(q.ids)} AND (:parent IS NULL OR t.org_project_id = :parent) AND (t.code LIKE :q ESCAPE '\\' OR t.name LIKE :q ESCAPE '\\')`;
    const params = { c: cid(actor), q: q.like, parent: q.parent };
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${base}`).get(params).n;
    const rows = db.prepare(`SELECT t.id, t.code, t.name, t.site_type, t.org_project_id, p.code AS project_code FROM ${base} ORDER BY t.code LIMIT :limit OFFSET :offset`).all({ ...params, limit: q.limit, offset: q.offset });
    return { total, rows: rows.map((s) => ({ id: s.id, code: s.code, name: s.name, extra: { project: s.project_code, projectId: s.org_project_id, type: s.site_type } })) };
  },
});

lookupRegistry.register({
  module: 'iam', name: 'cost-centres', label: 'Cost centres', permission: 'org.view',
  columns: [{ key: 'type', label: 'Type' }, { key: 'linked', label: 'Linked to' }],
  // parent is a site: its own cost centres first, then those of its project
  search(db, actor, q) {
    const parentClause = q.parent === null ? '1 = 1' : "((t.linked_type = 'SITE' AND t.linked_id = :parent) OR (t.linked_type = 'PROJECT' AND t.linked_id = (SELECT org_project_id FROM org_sites WHERE id = :parent)))";
    const base = `org_cost_centres t WHERE t.company_id = :c AND t.is_active = 1 AND t.status = 'ACTIVE' AND ${idFilter(q.ids)} AND ${parentClause} AND (t.code LIKE :q ESCAPE '\\' OR t.name LIKE :q ESCAPE '\\')`;
    const params = { c: cid(actor), q: q.like, ...(q.parent === null ? {} : { parent: q.parent }) };
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${base}`).get(params).n;
    const rows = db.prepare(`SELECT t.id, t.code, t.name, t.type, t.linked_type, t.linked_id FROM ${base} ORDER BY CASE t.linked_type WHEN 'SITE' THEN 0 ELSE 1 END, t.code LIMIT :limit OFFSET :offset`).all({ ...params, limit: q.limit, offset: q.offset });
    return { total, rows: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, extra: { type: r.type, linked: r.linked_type ? `${r.linked_type.toLowerCase()} ${r.linked_id}` : 'company' } })) };
  },
});

lookupRegistry.register({
  module: 'iam', name: 'departments', label: 'Departments', permission: 'org.view',
  columns: [{ key: 'kind', label: 'Kind' }],
  search(db, actor, q) {
    const base = `org_departments t WHERE t.company_id = :c AND t.is_active = 1 AND t.status = 'ACTIVE' AND ${idFilter(q.ids)} AND (:parent IS NULL OR t.parent_id = :parent) AND (t.code LIKE :q ESCAPE '\\' OR t.name LIKE :q ESCAPE '\\')`;
    const r = page(db, base, { c: cid(actor), q: q.like, parent: q.parent }, 't.code', q);
    return { total: r.total, rows: r.rows.map((d) => ({ id: d.id, code: d.code, name: d.name, extra: { kind: d.kind } })) };
  },
});

lookupRegistry.register({
  module: 'iam', name: 'users', label: 'People', permission: 'org.view',
  columns: [{ key: 'department', label: 'Department' }],
  // parent is a department
  search(db, actor, q) {
    const base = `iam_users t LEFT JOIN iam_user_profiles p ON p.user_id = t.id LEFT JOIN org_departments d ON d.id = p.department_id WHERE t.company_id = :c AND t.status = 'ACTIVE' AND t.is_active = 1 AND ${idFilter(q.ids)} AND (:parent IS NULL OR p.department_id = :parent) AND (t.username LIKE :q ESCAPE '\\' OR t.display_name LIKE :q ESCAPE '\\')`;
    const params = { c: cid(actor), q: q.like, parent: q.parent };
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${base}`).get(params).n;
    const rows = db.prepare(`SELECT t.id, t.username, t.display_name, d.name AS department FROM ${base} ORDER BY t.display_name LIMIT :limit OFFSET :offset`).all({ ...params, limit: q.limit, offset: q.offset });
    return { total, rows: rows.map((u) => ({ id: u.id, code: u.username, name: u.display_name, extra: { department: u.department ?? '' } })) };
  },
});

const digits = (v) => String(v ?? '').replace(/\D/g, '').slice(-10);

duplicateChecks.register({
  name: 'iam.user', label: 'People', permission: 'iam.user.view',
  check(db, actor, f) {
    const out = [];
    const c = cid(actor);
    const exclude = Number(f.excludeId) || 0;
    const email = String(f.email ?? '').trim().toLowerCase();
    if (email) for (const u of db.prepare('SELECT id, display_name, username FROM iam_users WHERE company_id = ? AND lower(email) = ? AND id != ? LIMIT 5').all(c, email, exclude)) out.push({ id: u.id, label: `${u.display_name} (${u.username})`, reason: 'Same email address', link: `/admin/users?open=${u.id}` });
    const mobile = digits(f.mobile);
    if (mobile.length === 10) for (const u of db.prepare("SELECT id, display_name, username, mobile FROM iam_users WHERE company_id = ? AND mobile IS NOT NULL AND mobile != '' AND id != ? LIMIT 2000").all(c, exclude)) if (digits(u.mobile) === mobile && !out.some((o) => o.id === u.id)) out.push({ id: u.id, label: `${u.display_name} (${u.username})`, reason: 'Same mobile number', link: `/admin/users?open=${u.id}` });
    const name = String(f.displayName ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (name.length >= 3) for (const u of db.prepare('SELECT id, display_name, username FROM iam_users WHERE company_id = ? AND lower(display_name) = ? AND id != ? LIMIT 5').all(c, name, exclude)) if (!out.some((o) => o.id === u.id)) out.push({ id: u.id, label: `${u.display_name} (${u.username})`, reason: 'Same name', link: `/admin/users?open=${u.id}` });
    return out;
  },
});

duplicateChecks.register({
  name: 'iam.project', label: 'Projects', permission: 'org.view',
  check(db, actor, f) {
    const name = String(f.name ?? '').trim().toLowerCase();
    const code = String(f.code ?? '').trim().toUpperCase();
    if (name.length < 3 && !code) return [];
    return db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND is_active = 1 AND id != ? AND (lower(name) = ? OR upper(code) = ?) LIMIT 5").all(cid(actor), Number(f.excludeId) || 0, name, code)
      .map((p) => ({ id: p.id, label: `${p.code} ${p.name}`, reason: p.code.toUpperCase() === code ? 'Same code' : 'Same name', link: `/admin/projects?open=${p.id}` }));
  },
});
