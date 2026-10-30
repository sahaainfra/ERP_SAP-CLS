// Event catalogue (FR-03): every event type a module publishes is declared once, with a version and a schema for the
// `data` part of the envelope. Publishing validates against it, so a consumer can rely on the shape it was built for.

const TYPE_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const JSON_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];

/** A deliberately small JSON-schema subset: type, required, properties, enum, nullable and items. Returns problems. */
export function validateAgainst(schema, value, path = 'data') {
  const problems = [];
  if (value === null || value === undefined) {
    if (!schema.nullable) problems.push(`${path} is required`);
    return problems;
  }
  const actual = Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  const okType = !schema.type || actual === schema.type || (schema.type === 'number' && actual === 'integer');
  if (!okType) return [`${path} must be ${schema.type}, not ${actual}`];
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${path} must be one of ${schema.enum.join(', ')}`);
  if (schema.type === 'object' || (!schema.type && actual === 'object')) {
    for (const key of schema.required ?? []) if (value[key] === undefined) problems.push(`${path}.${key} is required`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (value[key] !== undefined) problems.push(...validateAgainst(sub, value[key], `${path}.${key}`));
    }
  }
  if (schema.type === 'array' && schema.items) value.forEach((v, i) => problems.push(...validateAgainst(schema.items, v, `${path}[${i}]`)));
  return problems;
}

function checkSchema(schema, path = 'schema') {
  if (typeof schema !== 'object' || schema === null) throw new Error(`${path} must be an object`);
  if (schema.type && !JSON_TYPES.includes(schema.type)) throw new Error(`${path}.type "${schema.type}" is not supported`);
  for (const [k, sub] of Object.entries(schema.properties ?? {})) checkSchema(sub, `${path}.properties.${k}`);
  if (schema.items) checkSchema(schema.items, `${path}.items`);
}

export class EventSchemaError extends Error {
  constructor(type, problems) {
    super(`The event ${type} has an invalid payload: ${problems.join('; ')}`);
    this.type = type;
    this.problems = problems;
  }
}

export function createEventTypeRegistry() {
  /** @type {Map<string, { type: string, version: number, schema: any, owner: string, description: string }>} */
  const latest = new Map();
  return {
    /** Declare an event type. A new version of an existing type must be higher than the current one. */
    define({ type, version = 1, schema = { type: 'object' }, owner, description = '' }) {
      if (!TYPE_PATTERN.test(type ?? '')) throw new Error(`Event type "${type}" must look like module.entity.past_tense_verb`);
      if (!Number.isInteger(version) || version < 1) throw new Error(`Event ${type}: version must be a whole number from 1`);
      if (!owner) throw new Error(`Event ${type}: name the owning module`);
      checkSchema(schema);
      const current = latest.get(type);
      if (current && version <= current.version) throw new Error(`Event ${type} is already defined at version ${current.version}`);
      latest.set(type, { type, version, schema, owner, description });
    },
    get: (type) => latest.get(type) ?? null,
    list: () => [...latest.values()].sort((a, b) => a.type.localeCompare(b.type)),
    /** Problems with a payload for a registered type; an empty list when valid or when the type is not registered. */
    validate(type, data) {
      const def = latest.get(type);
      return def ? validateAgainst(def.schema, data) : [];
    },
  };
}

export const eventTypes = createEventTypeRegistry();

/** Write the in-code catalogue to core_event_types so administrators can read it. Idempotent. */
export function syncEventTypes(db, registry = eventTypes) {
  const up = db.prepare(
    `INSERT INTO core_event_types (type, version, schema_json, owner_module, description) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (type, version) DO UPDATE SET schema_json = excluded.schema_json, owner_module = excluded.owner_module, description = excluded.description, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  );
  for (const d of registry.list()) up.run(d.type, d.version, JSON.stringify(d.schema), d.owner, d.description);
}
