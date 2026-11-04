import { searchEntities } from '../../platform/search/registry.js';

// Part 03.08: what of the organisation and the people can be searched. Each type is read again from its own table whenever the index needs it;
// a mobile number (masked for most roles) is kept apart as a sensitive value, so only a role that sees it in full can search by it.
const ORG = 'org.view';
const live = (r) => r && r.is_active === 1 && r.deleted_at === null;
const ORG_EVENTS = ['iam.project.*', 'iam.site.*', 'iam.department.*', 'iam.costcentre.*', 'iam.cost_centre.*', 'iam.branch.*', 'iam.location.*'];

searchEntities.register({
  type: 'project', label: 'Projects', labelHi: 'परियोजनाएँ', icon: 'erp.group.projects', order: 10, permission: ORG, table: 'org_projects', dateLabel: 'Start date',
  statuses: ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED'], events: ORG_EVENTS, eventEntity: 'project',
  route: () => '/admin/projects',
  load(db, id) {
    const r = db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
    if (!live(r)) return null;
    return { companyId: r.company_id, projectId: r.id, branchId: r.branch_id, code: r.code, title: r.name, subtitle: [r.client_name, r.type].filter(Boolean).join(' · ') || null, body: [r.client_name, r.type], status: r.status, docDate: r.start_date, permissionKey: ORG, route: `/admin/projects?q=${encodeURIComponent(r.code)}` };
  },
});
searchEntities.register({
  type: 'site', label: 'Sites', labelHi: 'साइटें', icon: 'erp.field.field', order: 20, permission: ORG, table: 'org_sites', statuses: ['DRAFT', 'ACTIVE', 'INACTIVE'], events: ORG_EVENTS, eventEntity: 'site',
  route: () => '/admin/projects',
  load(db, id) {
    const r = db.prepare('SELECT s.*, p.code AS project_code FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ?').get(id);
    if (!live(r)) return null;
    return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.id, code: r.code, title: r.name, subtitle: `Project ${r.project_code}${r.site_type ? ` · ${r.site_type}` : ''}`, body: [r.address, r.project_code], status: r.status, permissionKey: ORG, route: `/admin/projects?q=${encodeURIComponent(r.project_code)}` };
  },
});
const simple = (type, label, labelHi, icon, order, table, route, extra = {}) => searchEntities.register({
  type, label, labelHi, icon, order, permission: ORG, table, statuses: ['ACTIVE', 'INACTIVE'], events: ORG_EVENTS, eventEntity: type, route,
  load(db, id) {
    const r = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!live(r)) return null;
    return { companyId: r.company_id, branchId: type === 'branch' ? r.id : r.branch_id ?? null, departmentId: type === 'department' ? r.id : null, code: r.code, title: r.name, subtitle: extra.subtitle?.(r) ?? null, body: extra.body?.(r) ?? [], status: r.status, permissionKey: ORG };
  },
});
simple('department', 'Departments', 'विभाग', 'erp.group.hr', 30, 'org_departments', () => '/admin/organisation', { subtitle: (r) => r.kind });
simple('branch', 'Branches', 'शाखाएँ', 'erp.group.admin', 40, 'org_branches', () => '/admin/organisation', { subtitle: (r) => [r.kind, r.state_code].filter(Boolean).join(' · '), body: (r) => [r.address, r.gstin] });
simple('cost_centre', 'Cost centres', 'लागत केंद्र', 'erp.group.finance', 50, 'org_cost_centres', () => '/admin/cost-centres', { subtitle: (r) => r.type });
searchEntities.register({
  type: 'user', label: 'People', labelHi: 'लोग', icon: 'erp.group.hr', order: 60, permission: 'iam.user.view', table: 'iam_users', statuses: ['INVITED', 'ONBOARDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'],
  events: ['iam.user.*'], eventEntity: 'user', secretFields: [{ entity: 'iam_user', field: 'mobile' }], route: () => '/admin/users',
  load(db, id) {
    const r = db.prepare('SELECT u.*, p.lifecycle, p.employee_code, p.department_id, d.name AS department FROM iam_users u LEFT JOIN iam_user_profiles p ON p.user_id = u.id LEFT JOIN org_departments d ON d.id = p.department_id WHERE u.id = ?').get(id);
    if (!r || r.deleted_at !== null) return null;
    return {
      companyId: r.company_id, departmentId: r.department_id, code: r.employee_code ?? r.username, title: r.display_name, subtitle: [r.username, r.department].filter(Boolean).join(' · '), body: [r.username, r.email, r.department],
      status: r.lifecycle ?? (r.is_active === 1 ? 'ACTIVE' : 'DEACTIVATED'), permissionKey: 'iam.user.view', route: `/admin/users?q=${encodeURIComponent(r.username)}`, secrets: [{ entity: 'iam_user', field: 'mobile', value: r.mobile }],
    };
  },
});
searchEntities.register({
  type: 'role', label: 'Roles', labelHi: 'भूमिकाएँ', icon: 'erp.admin.rules', order: 70, permission: 'iam.role.view', table: 'iam_roles', statuses: ['ACTIVE', 'INACTIVE'], events: ['iam.role.*'], eventEntity: 'role', route: () => '/admin/roles',
  load(db, id) {
    const r = db.prepare('SELECT * FROM iam_roles WHERE id = ?').get(id);
    if (!live(r) || r.company_id === null) return null; // the system roles belong to no company and are not indexed
    return { companyId: r.company_id, code: r.code, title: r.name, subtitle: r.category, body: [r.description], status: r.status, permissionKey: 'iam.role.view', route: `/admin/roles?q=${encodeURIComponent(r.code)}` };
  },
});
