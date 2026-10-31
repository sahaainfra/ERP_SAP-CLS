import { z } from 'zod';

// The security settings (part 02.07): the built-in values below, with the one row of overrides in core_security_settings laid over
// them. Changed only through an approved request (type security_settings_change).
const csp = (extra = '') => `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'${extra}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`;
export const RATE_CLASSES = ['auth', 'otp', 'export', 'write', 'read', 'webhook'];

export const DEFAULT_SETTINGS = Object.freeze({
  rateLimits: {
    auth: { ipPerMinute: 60, userPerMinute: 30 }, // the sign-in routes also keep their own 30 a minute per address (iam), so this is the ceiling over all of them
    otp: { ipPerMinute: 60, userPerMinute: 30 },
    export: { ipPerMinute: 20, userPerMinute: 10 },
    write: { ipPerMinute: 900, userPerMinute: 600 },
    read: { ipPerMinute: 3000, userPerMinute: 1800 },
    webhook: { ipPerMinute: 600, userPerMinute: 600 },
  },
  headers: {
    csp: csp(),
    hstsMaxAgeDays: 365,
    hstsIncludeSubDomains: true,
    referrerPolicy: 'no-referrer',
    permissionsPolicy: 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()',
  },
  cors: { allowedOrigins: [] },
  exports: { personalApprovalThreshold: 1000 },
});

const perMinute = z.number().int().min(1).max(100_000);
const limit = z.object({ ipPerMinute: perMinute, userPerMinute: perMinute }).strict();
const headerText = (max) => z.string().min(1).max(max).regex(/^[\x20-\x7E]+$/, 'Use plain printable characters on one line');
export const settingsSchema = z.object({
  rateLimits: z.object(Object.fromEntries(RATE_CLASSES.map((c) => [c, limit]))).strict(),
  headers: z.object({
    csp: headerText(2000).refine((v) => /(^|;\s*)frame-ancestors\s/.test(v), 'The policy must say who may frame the application (frame-ancestors)').refine((v) => /default-src\s/.test(v), 'The policy must have a default-src').refine((v) => !/script-src[^;]*'unsafe-(inline|eval)'/.test(v), 'Inline or eval scripts cannot be allowed'),
    hstsMaxAgeDays: z.number().int().min(1).max(730),
    hstsIncludeSubDomains: z.boolean(),
    referrerPolicy: z.enum(['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin']),
    permissionsPolicy: headerText(400),
  }).strict(),
  cors: z.object({ allowedOrigins: z.array(z.string().url().max(200).refine((v) => new URL(v).origin === v, 'Use the origin only, such as https://erp.example.com')).max(20) }).strict(),
  exports: z.object({ personalApprovalThreshold: z.number().int().min(1).max(1_000_000) }).strict(),
}).strict();

const merge = (base, over) => {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  return out;
};

/** The effective settings of a database: defaults with the stored overrides, cached until a change is applied. */
export function createSecuritySettings(db) {
  let cache = null;
  const has = () => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'core_security_settings'").get());
  const load = () => {
    const row = has() ? db.prepare('SELECT version, settings_json, updated_by, updated_at FROM core_security_settings WHERE id = 1').get() : null;
    return { version: row?.version ?? 0, updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? null, settings: merge(DEFAULT_SETTINGS, row ? JSON.parse(row.settings_json) : null) };
  };
  return {
    get() {
      if (cache) return cache;
      try {
        return (cache = load());
      } catch {
        // the database cannot answer: the built-in values apply, so health routes can still report the outage; not remembered
        return { version: 0, updatedBy: null, updatedAt: null, settings: DEFAULT_SETTINGS };
      }
    },
    invalidate() { cache = null; },
    /** Replace the stored settings (inside the approver's transaction). */
    write(settings, by) {
      const now = new Date().toISOString();
      db.prepare('INSERT INTO core_security_settings (id, version, settings_json, updated_by, updated_at) VALUES (1, 1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET version = version + 1, settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
        .run(JSON.stringify(settings), by, now);
      cache = null;
    },
  };
}

const instances = new WeakMap();
/** The security settings of a database, created once. */
export function securitySettingsOf(db) {
  let s = instances.get(db);
  if (!s) { s = createSecuritySettings(db); instances.set(db, s); }
  return s;
}
