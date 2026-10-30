import { metrics } from '../observability/metrics.js';
import { dec } from '../../../shared/decimal.js';
import { parseBusinessDate } from '../../../shared/dates.js';
import { badRequest } from '../http/errors.js';

// Typed system parameters (FR-05). A parameter is declared once (key, type, default, limits, allowed scopes) and
// its values live in core_parameters with a scope and an effective date range. Changing a value never rewrites
// history: it closes the old row and adds a new one (BR-03).

export const DATA_TYPES = ['string', 'integer', 'decimal', 'boolean', 'date', 'json'];
export const SCOPE_TYPES = ['system', 'company', 'project', 'site'];
const SPECIFICITY = { site: 0, project: 1, company: 2, system: 3 };

export function createParameterRegistry() {
  const defs = new Map();
  return {
    define(def) {
      if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(def.key)) throw new Error(`Parameter key "${def.key}" must look like module.area.name`);
      if (!DATA_TYPES.includes(def.dataType)) throw new Error(`Unknown data type "${def.dataType}"`);
      const scopes = def.scopes ?? ['system', 'company'];
      for (const s of scopes) if (!SCOPE_TYPES.includes(s)) throw new Error(`Unknown scope "${s}"`);
      defs.set(def.key, Object.freeze({ ...def, scopes, description: def.description ?? '' }));
      // The default must itself be a valid value.
      coerce(defs.get(def.key), def.default);
    },
    get: (key) => defs.get(key),
    list: () => [...defs.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** The application's parameter registry; modules define their parameters when they load. */
export const parameterRegistry = createParameterRegistry();

/**
 * Validate `raw` against a definition and return the canonical text stored in the database.
 * Throws a 400 with the field "value" when it does not fit.
 */
export function coerce(def, raw) {
  const fail = (message) => {
    throw badRequest(`${def.key}: ${message}`, [{ field: 'value', message }]);
  };
  const text = typeof raw === 'string' ? raw.trim() : raw;
  let canonical;
  switch (def.dataType) {
    case 'integer': {
      if (!/^-?\d+$/.test(String(text))) fail('must be a whole number');
      const n = Number(text);
      if (!Number.isSafeInteger(n)) fail('is too large');
      if (def.min !== undefined && n < def.min) fail(`must be at least ${def.min}`);
      if (def.max !== undefined && n > def.max) fail(`must be at most ${def.max}`);
      canonical = String(n);
      break;
    }
    case 'decimal': {
      let d;
      try {
        d = dec(String(text));
      } catch {
        fail('must be a decimal number such as 12.50');
      }
      if (def.min !== undefined && d.lt(String(def.min))) fail(`must be at least ${def.min}`);
      if (def.max !== undefined && d.gt(String(def.max))) fail(`must be at most ${def.max}`);
      canonical = d.toString();
      break;
    }
    case 'boolean':
      if (text !== true && text !== false && text !== 'true' && text !== 'false') fail('must be true or false');
      canonical = String(text);
      break;
    case 'date':
      try {
        parseBusinessDate(String(text));
      } catch {
        fail('must be a real date written YYYY-MM-DD');
      }
      canonical = String(text);
      break;
    case 'json':
      try {
        canonical = JSON.stringify(typeof text === 'string' ? JSON.parse(text) : text);
      } catch {
        fail('must be valid JSON');
      }
      if (canonical.length > 2000) fail('is too long (2000 characters at most)');
      break;
    default:
      if (typeof text !== 'string' || text.length === 0 || text.length > 500) fail('must be text of 1 to 500 characters');
      canonical = text;
  }
  if (def.allowed && !def.allowed.includes(canonical)) fail(`must be one of ${def.allowed.join(', ')}`);
  return canonical;
}

/** The typed value for stored text. */
export function typed(dataType, text) {
  switch (dataType) {
    case 'integer': return Number(text);
    case 'decimal': return dec(text);
    case 'boolean': return text === 'true';
    case 'json': return JSON.parse(text);
    default: return text; // string and date
  }
}

/**
 * Parameter store: resolves the value in force for a context (the most specific scope wins, then the latest
 * effective date) and caches it. Any write must call invalidate(), which empties the cache at once.
 */
export function createParameterStore(db, registry = parameterRegistry) {
  const cache = new Map();
  let generation = 0;
  let prepared = null; // prepared on first use, so mounting works on a database older than the table
  const stmt = { get: (p) => (prepared ??= db.prepare(STMT_SQL)).get(p) };
  const STMT_SQL =
    `SELECT * FROM core_parameters
     WHERE key = :key AND is_active = 1 AND deleted_at IS NULL
       AND effective_from <= :date AND (effective_to IS NULL OR effective_to >= :date)
       AND (scope_type = 'system'
            OR (scope_type = 'company' AND scope_id = :company)
            OR (scope_type = 'project' AND scope_id = :project AND company_id = :company)
            OR (scope_type = 'site' AND scope_id = :site AND company_id = :company))
     ORDER BY CASE scope_type WHEN 'site' THEN 0 WHEN 'project' THEN 1 WHEN 'company' THEN 2 ELSE 3 END, effective_from DESC
     LIMIT 1`;
  return {
    /** { value, source } where source is the scope that supplied it, or 'default'. */
    resolve(key, { companyId = null, projectId = null, siteId = null, date }) {
      const def = registry.get(key);
      if (!def) throw new Error(`Unknown parameter "${key}"`);
      const ck = `${key}|${companyId}|${projectId}|${siteId}|${date}`;
      const hit = cache.get(ck);
      if (hit && hit.generation === generation) {
        metrics.counter('cache.parameters.hit');
        return hit.out;
      }
      metrics.counter('cache.parameters.miss');
      const row = stmt.get({ key, date, company: companyId ?? -1, project: projectId ?? -1, site: siteId ?? -1 });
      const out = row
        ? { value: typed(def.dataType, row.value), source: row.scope_type, text: row.value, effectiveFrom: row.effective_from }
        : { value: typed(def.dataType, coerce(def, def.default)), source: 'default', text: coerce(def, def.default), effectiveFrom: null };
      cache.set(ck, { generation, out });
      return out;
    },
    get(key, ctx) {
      return this.resolve(key, ctx).value;
    },
    invalidate() {
      generation += 1;
      cache.clear();
    },
    cacheSize: () => cache.size,
  };
}

export const specificity = (scopeType) => SPECIFICITY[scopeType];
