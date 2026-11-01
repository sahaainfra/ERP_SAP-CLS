import { parameterRegistry } from '../parameters/index.js';
import { PERMISSIONS_02_04, PERMISSIONS_02_05, PERMISSIONS_02_06, PERMISSIONS_02_07, PERMISSIONS_03_01, PERMISSIONS_03_03, PERMISSIONS_03_05, SENSITIVE_ACTIONS } from './templates.js';

// What modules declare to the authorisation engine (part 02.04): permission keys, sensitive fields, the records the explainer can
// look up, and which entities let a manager see their reportees' records. Declared once when a module loads; the engine seeds the
// permission registry table from here and the effective-permission viewer reads it.

const KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** { module, entity, action } of a permission key: org.view -> org / org / view; core.fy.configure -> core / fy / configure. */
export function parseKey(key) {
  const parts = key.split('.');
  return { module: parts[0], entity: parts.length > 2 ? parts.slice(1, -1).join('.') : parts[0], action: parts.at(-1) };
}

export const isSensitiveKey = (key) => SENSITIVE_ACTIONS.includes(parseKey(key).action);

function createPermissionRegistry() {
  const map = new Map();
  const api = {
    /** @param {string | { key: string, description?: string, sensitive?: boolean }} entry */
    register(entry) {
      const e = typeof entry === 'string' ? { key: entry } : entry;
      if (!KEY.test(e.key)) throw new Error(`Permission key "${e.key}" must look like module.entity.action`);
      const p = parseKey(e.key);
      const sensitive = e.sensitive ?? isSensitiveKey(e.key);
      map.set(e.key, { key: e.key, ...p, sensitive, description: e.description ?? `${p.action.replace(/_/g, ' ')} ${p.entity === p.module ? p.module : p.entity.replace(/\./g, ' ')} (${p.module})` });
      return api;
    },
    registerAll(list) {
      for (const e of list) api.register(e);
      return api;
    },
    get: (key) => map.get(key),
    list: () => [...map.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
  return api;
}
export const permissionRegistry = createPermissionRegistry();
permissionRegistry.registerAll(PERMISSIONS_02_04);
permissionRegistry.registerAll(PERMISSIONS_02_05);
permissionRegistry.registerAll(PERMISSIONS_02_06);
permissionRegistry.registerAll(PERMISSIONS_02_07);
permissionRegistry.registerAll(PERMISSIONS_03_01);
permissionRegistry.registerAll(PERMISSIONS_03_03);
permissionRegistry.registerAll(PERMISSIONS_03_05);

const RULES = ['hide', 'partial', 'show'];
export const MASK_RULES = RULES;

/** A partial mask of a value: its shape stays recognisable, its content does not. */
const FORMATS = {
  mobile: (v) => (v ? `${String(v).slice(0, 3)}${'•'.repeat(Math.max(0, String(v).length - 7))}${String(v).slice(-4)}` : v),
  pan: (v) => (v ? `${String(v).slice(0, 2)}${'*'.repeat(6)}${String(v).slice(-2)}` : v),
  tail4: (v) => (v ? `${'•'.repeat(Math.max(0, String(v).length - 4))}${String(v).slice(-4)}` : v),
  amount: () => '•••',
};

function createFieldRegistry() {
  const fields = new Map(); // `${entity}.${field}` -> def
  const api = {
    /** A sensitive field of an entity. `defaultRule` is what a role with no mask row of its own gets. */
    register({ entity, field, label = field, defaultRule = 'partial', format = 'tail4', description = '' }) {
      if (!RULES.includes(defaultRule)) throw new Error(`Mask rule must be one of ${RULES.join(', ')}`);
      if (!FORMATS[format]) throw new Error(`Unknown mask format ${format}`);
      fields.set(`${entity}.${field}`, Object.freeze({ entity, field, label, defaultRule, format, description }));
      return api;
    },
    forEntity: (entity) => [...fields.values()].filter((f) => f.entity === entity),
    get: (entity, field) => fields.get(`${entity}.${field}`),
    list: () => [...fields.values()].sort((a, b) => `${a.entity}.${a.field}`.localeCompare(`${b.entity}.${b.field}`)),
    format: (name, value) => FORMATS[name](value),
  };
  return api;
}
export const fieldRegistry = createFieldRegistry();
fieldRegistry
  .register({ entity: 'iam_user', field: 'mobile', label: 'Mobile number', format: 'mobile', description: 'Shown in full to those who manage users' })
  .register({ entity: 'org_company', field: 'pan', label: 'PAN', format: 'pan', description: 'Shown in full to those who manage companies' })
  .register({ entity: 'employee', field: 'salary', label: 'Salary', defaultRule: 'hide', format: 'amount', description: 'Declared now so a role can be set up before the employee master (07.01) exists' })
  .register({ entity: 'ui_sample_request', field: 'total', label: 'Request total (commercial value)', format: 'amount', description: 'Shown in full to the commercial roles (part 03.03); masked in lists, totals and exports for the others' })
  .register({ entity: 'employee', field: 'bank_account', label: 'Bank account number', format: 'tail4', description: 'Declared for the employee master (07.01)' });

function createRecordResolvers() {
  const map = new Map();
  return {
    /** resolve(db, id) -> { companyId, projectId?, siteId?, branchId?, departmentId?, ownerUserId?, confidentiality?, label? } or null */
    register(type, resolve) {
      map.set(type, resolve);
    },
    get: (type) => map.get(type),
    types: () => [...map.keys()].sort(),
  };
}
export const recordResolvers = createRecordResolvers();

function createHierarchyRegistry() {
  const map = new Map();
  return {
    /** An entity whose records carry an owner; managers may see their reportees' when the parameter says so (FR-08). */
    register(entity, { defaultOn = true } = {}) {
      map.set(entity, { entity, defaultOn });
      // the switch is a system parameter, so each company can turn it on or off (Parameters page)
      const key = `iam.hierarchy.reportees_${entity.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
      if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'boolean', default: defaultOn, scopes: ['system', 'company'], description: `Managers see the ${entity} records of the people in the departments they head` });
    },
    list: () => [...map.values()],
    get: (entity) => map.get(entity),
  };
}
export const hierarchyRegistry = createHierarchyRegistry();
