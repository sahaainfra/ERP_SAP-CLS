import { z } from 'zod';
import { CONNECTOR_TYPES, ENVIRONMENTS } from '../../../platform/integrations/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { parse } from '../../../platform/validation/index.js';

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const code = z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,40}$/, 'Use 3 to 41 characters: lower-case letters, digits, dot, dash and underscore, starting with a letter');
const secretKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'Use lower-case letters, digits and underscores');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const parseId = (v) => parse(z.coerce.number().int().positive(), v);
export const parseCode = (v) => parse(z.string().regex(/^[a-z][a-z0-9_.-]{2,40}$/), v);

const settings = {
  name: z.string().trim().min(2).max(100),
  provider: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/),
  environment: z.enum(ENVIRONMENTS),
  config: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean()])).refine((c) => Object.keys(c).length <= 30, 'At most 30 settings'),
  timeoutMs: z.number().int().min(100).max(120_000),
  maxRetries: z.number().int().min(0).max(10),
  retryBackoffMs: z.number().int().min(0).max(60_000),
  rateLimitPerMinute: z.number().int().min(1).max(100_000),
  breakerThreshold: z.number().int().min(1).max(100),
  breakerResetSeconds: z.number().int().min(1).max(3600),
  retentionDays: z.number().int().min(7).max(3650),
  enabled: z.boolean(),
};

const secrets = z.record(secretKey, z.string().min(4, 'A credential is at least 4 characters').max(4000)).refine((s) => Object.keys(s).length <= 10, 'At most 10 credentials');
const expiries = z.record(secretKey, date).optional();

export const parseCreate = (b) =>
  parse(
    z.object({
      code,
      type: z.enum(CONNECTOR_TYPES),
      name: settings.name,
      provider: settings.provider,
      environment: settings.environment.default('development'),
      config: settings.config.default({}),
      timeoutMs: settings.timeoutMs.optional(),
      maxRetries: settings.maxRetries.optional(),
      retryBackoffMs: settings.retryBackoffMs.optional(),
      rateLimitPerMinute: settings.rateLimitPerMinute.optional(),
      breakerThreshold: settings.breakerThreshold.optional(),
      breakerResetSeconds: settings.breakerResetSeconds.optional(),
      retentionDays: settings.retentionDays.optional(),
      enabled: settings.enabled.default(false),
      secrets: secrets.default({}),
      secretExpiry: expiries,
      reason,
    }).strict(),
    b,
  );

export const parseChange = (b) =>
  parse(
    z.object({
      changes: z.object(Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, v.optional()]))).strict().default({}),
      secrets: secrets.default({}),
      secretExpiry: expiries,
      reason,
    }).strict(),
    b,
  );

export const parseDisable = (b) => parse(z.object({ reason }).strict(), b);

export const parseConnectorList = (q) => parseListQuery(q, { sortable: ['code', 'type', 'status', 'last_health_at', 'name'], filterable: ['type', 'status', 'environment'], defaultSort: [{ column: 'code', dir: 'asc' }] });
export const parseLogList = (q) => parseListQuery(q, { sortable: ['created_at', 'duration_ms', 'status'], filterable: ['connector', 'status', 'direction'], defaultSort: [{ column: 'created_at', dir: 'desc' }] });
