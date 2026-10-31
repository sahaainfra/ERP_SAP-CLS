// What each organisation entity is (part 02.02): its table, its fields, how it is listed and what may block its deactivation. The
// service, the validators and the routes are all driven by this one description, so a field exists in exactly one place.

/** A field: `col` is the column, `kind` the type, `ref` the entity a number points to. */
const f = (col, kind, extra = {}) => ({ col, kind, ...extra });

export const PROJECT_TYPES = ['BUILDING', 'ROAD', 'BRIDGE', 'INDUSTRIAL', 'EPC', 'WATER', 'RAIL', 'OTHER'];
export const SITE_TYPES = ['SITE', 'CAMP', 'STORE', 'PLANT', 'OFFICE'];
export const LOCATION_TYPES = ['OFFICE', 'CENTRAL_WAREHOUSE', 'BATCHING_PLANT', 'LABOUR_CAMP'];
export const PROJECT_STATUSES = ['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED'];

export const ENTITIES = {
  companies: {
    table: 'org_companies', noun: 'company', event: 'company', permission: 'org.company.manage', scope: 'global',
    fields: {
      code: f('code', 'code', { required: true }), legalName: f('legal_name', 'text', { required: true, max: 200 }), shortName: f('short_name', 'text', { required: true, max: 60 }),
      gstinPrimary: f('gstin_primary', 'gstin'), pan: f('pan', 'pan'),
    },
    sortable: { code: 't.code', name: 't.legal_name', status: 't.status' }, filterable: { status: 't.status' }, search: ['t.code', 't.legal_name', 't.short_name'],
    extra: "(SELECT COUNT(*) FROM org_projects p WHERE p.company_id = t.id AND p.is_active = 1) AS project_count, (SELECT COUNT(*) FROM org_branches b WHERE b.company_id = t.id AND b.is_active = 1) AS branch_count",
    block: [
      ['active branches', 'SELECT COUNT(*) AS n FROM org_branches WHERE company_id = :id AND status = \'ACTIVE\' AND is_active = 1', 'Deactivate the branches first.'],
      ['active projects', "SELECT COUNT(*) AS n FROM org_projects WHERE company_id = :id AND status NOT IN ('CLOSED') AND is_active = 1", 'Close the projects first.'],
      ['active users', "SELECT COUNT(*) AS n FROM iam_users WHERE company_id = :id AND status = 'ACTIVE' AND is_active = 1", 'Disable the users first.'],
    ],
  },
  branches: {
    table: 'org_branches', noun: 'branch', event: 'branch', permission: 'org.company.manage', parent: true,
    fields: {
      kind: f('kind', 'enum', { values: ['BRANCH', 'REGION'], default: 'BRANCH' }), code: f('code', 'code', { required: true }), name: f('name', 'text', { required: true, max: 120 }),
      parentId: f('parent_id', 'ref', { ref: 'branches' }), stateCode: f('state_code', 'state'), address: f('address', 'text', { max: 400 }), gstin: f('gstin', 'gstin'),
    },
    sortable: { code: 't.code', name: 't.name', status: 't.status' }, filterable: { status: 't.status', kind: 't.kind', stateCode: 't.state_code', parentId: 't.parent_id' }, search: ['t.code', 't.name', 't.address'],
    extra: "(SELECT code FROM org_branches x WHERE x.id = t.parent_id) AS parent_code",
    block: [
      ['active child branches', "SELECT COUNT(*) AS n FROM org_branches WHERE parent_id = :id AND status = 'ACTIVE' AND is_active = 1", 'Deactivate or move them first.'],
      ['active departments', "SELECT COUNT(*) AS n FROM org_departments WHERE branch_id = :id AND status = 'ACTIVE' AND is_active = 1", 'Move or deactivate the departments first.'],
      ['open projects', "SELECT COUNT(*) AS n FROM org_projects WHERE branch_id = :id AND status != 'CLOSED' AND is_active = 1", 'Move or close the projects first.'],
    ],
  },
  departments: {
    table: 'org_departments', noun: 'department', event: 'department', permission: 'org.hr.manage', parent: true,
    fields: {
      kind: f('kind', 'enum', { values: ['DIVISION', 'DEPARTMENT'], default: 'DEPARTMENT' }), code: f('code', 'code', { required: true }), name: f('name', 'text', { required: true, max: 120 }),
      parentId: f('parent_id', 'ref', { ref: 'departments' }), branchId: f('branch_id', 'ref', { ref: 'branches' }),
      headUserId: f('head_user_id', 'user', { assigned: 'HEAD' }),
    },
    sortable: { code: 't.code', name: 't.name', status: 't.status' }, filterable: { status: 't.status', kind: 't.kind', parentId: 't.parent_id', branchId: 't.branch_id' }, search: ['t.code', 't.name'],
    extra: "(SELECT code FROM org_departments x WHERE x.id = t.parent_id) AS parent_code, (SELECT name FROM org_branches x WHERE x.id = t.branch_id) AS branch_name, (SELECT username FROM iam_users x WHERE x.id = t.head_user_id) AS head_username, (SELECT display_name FROM iam_users x WHERE x.id = t.head_user_id) AS head_name",
    block: [
      ['active sub-departments', "SELECT COUNT(*) AS n FROM org_departments WHERE parent_id = :id AND status = 'ACTIVE' AND is_active = 1", 'Deactivate or move them first.'],
      ['active cost centres linked to it', "SELECT COUNT(*) AS n FROM org_cost_centres WHERE linked_type = 'DEPARTMENT' AND linked_id = :id AND status = 'ACTIVE' AND is_active = 1", 'Deactivate or relink the cost centres first.'],
    ],
  },
  designations: {
    table: 'org_designations', noun: 'designation', event: 'designation', permission: 'org.hr.manage',
    fields: { code: f('code', 'code', { required: true }), name: f('name', 'text', { required: true, max: 120 }), grade: f('grade', 'text', { max: 20 }), level: f('level', 'int', { min: 1, max: 20, default: 1 }) },
    sortable: { code: 't.code', name: 't.name', level: 't.level', status: 't.status' }, filterable: { status: 't.status', grade: 't.grade' }, search: ['t.code', 't.name', 't.grade'],
    extra: '', block: [],
  },
  projects: {
    table: 'org_projects', noun: 'project', event: 'project', permission: 'org.project.manage', controlled: true,
    fields: {
      code: f('code', 'code', { required: true }), name: f('name', 'text', { required: true, max: 160 }), type: f('type', 'enum', { values: PROJECT_TYPES, required: true }),
      branchId: f('branch_id', 'ref', { ref: 'branches' }), clientName: f('client_name', 'text', { max: 160 }), startDate: f('start_date', 'date'), endDate: f('end_date', 'date'),
      pmUserId: f('pm_user_id', 'user', { assigned: 'PROJECT_MANAGER' }),
    },
    sortable: { code: 't.code', name: 't.name', status: 't.status', startDate: 't.start_date', type: 't.type' }, filterable: { status: 't.status', type: 't.type', branchId: 't.branch_id' }, search: ['t.code', 't.name', 't.client_name'],
    extra: "(SELECT name FROM org_branches x WHERE x.id = t.branch_id) AS branch_name, (SELECT username FROM iam_users x WHERE x.id = t.pm_user_id) AS pm_username, (SELECT display_name FROM iam_users x WHERE x.id = t.pm_user_id) AS pm_name, (SELECT COUNT(*) FROM org_sites s WHERE s.org_project_id = t.id AND s.is_active = 1) AS site_count",
    block: [
      ['active sites', "SELECT COUNT(*) AS n FROM org_sites WHERE org_project_id = :id AND status = 'ACTIVE' AND is_active = 1", 'Deactivate the sites first.'],
      ['active cost centres linked to it', "SELECT COUNT(*) AS n FROM org_cost_centres WHERE linked_type = 'PROJECT' AND linked_id = :id AND status = 'ACTIVE' AND is_active = 1", 'Deactivate or relink the cost centres first.'],
    ],
  },
  sites: {
    table: 'org_sites', noun: 'site', event: 'site', permission: 'org.site.manage', controlled: true,
    fields: {
      projectId: f('org_project_id', 'ref', { ref: 'projects', required: true, immutable: true }), code: f('code', 'code', { required: true }), name: f('name', 'text', { required: true, max: 160 }),
      siteType: f('site_type', 'enum', { values: SITE_TYPES, default: 'SITE' }), address: f('address', 'text', { max: 400 }),
      latitude: f('latitude', 'num', { min: -90, max: 90, geofence: true }), longitude: f('longitude', 'num', { min: -180, max: 180, geofence: true }),
      geofenceType: f('geofence_type', 'enum', { values: ['NONE', 'CIRCLE', 'POLYGON'], default: 'NONE', geofence: true }), geofenceRadiusM: f('geofence_radius_m', 'int', { geofence: true }),
      geofencePolygon: f('geofence_polygon_json', 'json', { geofence: true }),
      workingStart: f('working_start', 'time'), workingEnd: f('working_end', 'time'), timezone: f('timezone', 'text', { max: 60, default: 'Asia/Kolkata' }),
      inChargeUserId: f('in_charge_user_id', 'user', { assigned: 'IN_CHARGE' }),
    },
    sortable: { code: 't.code', name: 't.name', status: 't.status', type: 't.site_type' }, filterable: { status: 't.status', siteType: 't.site_type', projectId: 't.org_project_id' }, search: ['t.code', 't.name', 't.address'],
    extra: "(SELECT code FROM org_projects x WHERE x.id = t.org_project_id) AS project_code, (SELECT name FROM org_projects x WHERE x.id = t.org_project_id) AS project_name, (SELECT username FROM iam_users x WHERE x.id = t.in_charge_user_id) AS in_charge_username, (SELECT display_name FROM iam_users x WHERE x.id = t.in_charge_user_id) AS in_charge_name",
    block: [
      ['active users assigned to the site', "SELECT COUNT(*) AS n FROM iam_users WHERE site_id = :id AND status = 'ACTIVE' AND is_active = 1", 'Move those users to another site first.'],
      ['active cost centres linked to it', "SELECT COUNT(*) AS n FROM org_cost_centres WHERE linked_type = 'SITE' AND linked_id = :id AND status = 'ACTIVE' AND is_active = 1", 'Deactivate or relink the cost centres first.'],
      ['site holiday calendars', "SELECT COUNT(*) AS n FROM core_holiday_calendars WHERE site_id = :id AND is_active = 1", 'Remove or move the site holiday calendar first.'],
      ['open approval requests', "SELECT COUNT(*) AS n FROM core_change_requests WHERE target_type = 'org_site' AND target_id = :id AND status IN ('SUBMITTED', 'RETURNED') AND is_active = 1", 'Decide or withdraw the request first.'],
    ],
  },
  locations: {
    table: 'org_locations', noun: 'location', event: 'location', permission: 'org.company.manage',
    fields: {
      type: f('type', 'enum', { values: LOCATION_TYPES, required: true }), code: f('code', 'code', { required: true }), name: f('name', 'text', { required: true, max: 160 }),
      stateCode: f('state_code', 'state'), address: f('address', 'text', { max: 400 }), latitude: f('latitude', 'num', { min: -90, max: 90 }), longitude: f('longitude', 'num', { min: -180, max: 180 }),
    },
    sortable: { code: 't.code', name: 't.name', type: 't.type', status: 't.status' }, filterable: { status: 't.status', type: 't.type', stateCode: 't.state_code' }, search: ['t.code', 't.name', 't.address'],
    extra: '', block: [],
  },
  'cost-centres': {
    table: 'org_cost_centres', noun: 'cost centre', event: 'cost_centre', permission: 'org.costcentre.manage', parent: true,
    fields: {
      code: f('code', 'code', { required: true }), name: f('name', 'text', { required: true, max: 160 }), type: f('type', 'enum', { values: ['COST', 'PROFIT'], default: 'COST' }),
      parentId: f('parent_id', 'ref', { ref: 'cost-centres' }), linkedType: f('linked_type', 'enum', { values: ['DEPARTMENT', 'PROJECT', 'SITE'] }), linkedId: f('linked_id', 'int', { min: 1 }),
    },
    sortable: { code: 't.code', name: 't.name', type: 't.type', status: 't.status' }, filterable: { status: 't.status', type: 't.type', parentId: 't.parent_id', linkedType: 't.linked_type' }, search: ['t.code', 't.name'],
    extra: "(SELECT code FROM org_cost_centres x WHERE x.id = t.parent_id) AS parent_code, CASE t.linked_type WHEN 'DEPARTMENT' THEN (SELECT name FROM org_departments x WHERE x.id = t.linked_id) WHEN 'PROJECT' THEN (SELECT name FROM org_projects x WHERE x.id = t.linked_id) WHEN 'SITE' THEN (SELECT name FROM org_sites x WHERE x.id = t.linked_id) END AS linked_name",
    block: [['active child cost centres', "SELECT COUNT(*) AS n FROM org_cost_centres WHERE parent_id = :id AND status = 'ACTIVE' AND is_active = 1", 'Deactivate or move them first.']],
  },
};

export const ENTITY_KEYS = Object.keys(ENTITIES);
/** The singular key used by blockers and events, e.g. 'cost_centre'. */
export const blockerKey = (key) => ENTITIES[key].event;
