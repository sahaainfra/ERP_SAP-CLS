import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { CHANNELS } from '../../../platform/observability/ops.js';

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const code = z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, 'Use lower-case letters, digits and underscores');
const id = z.coerce.number().int().positive();

export const parseId = (v) => parse(id, v);
export const parseKey = (v) => parse(code, v);
export const parseTraceId = (v) => parse(z.string().regex(/^[0-9a-f]{32}$/), v);
export const parseAlertList = (q) => parse(z.object({ status: z.enum(['OPEN', 'RESOLVED']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), q);
export const parseTraceList = (q) => parse(z.object({ status: z.enum(['ok', 'error']).optional(), minMs: z.coerce.number().min(0).optional(), limit: z.coerce.number().int().min(1).max(200).default(30) }), q);
export const parseCorrelation = (q) => parse(z.object({ correlationId: z.string().regex(/^[\w-]{8,64}$/, 'Not a correlation ID') }), q);
export const parseClientList = (q) => parse(z.object({ type: z.enum(['js_error', 'api_failure', 'page_load']).optional(), limit: z.coerce.number().int().min(1).max(200).default(30) }), q);
export const parseClientEvents = (b) =>
  parse(
    z.object({
      events: z
        .array(
          z.object({
            type: z.enum(['js_error', 'api_failure', 'page_load']),
            message: z.string().max(2000).optional(),
            path: z.string().max(300).optional(),
            status: z.number().int().min(0).max(599).optional(),
            correlationId: z.string().regex(/^[\w-]{8,64}$/).optional(),
            durationMs: z.number().min(0).max(600_000).optional(),
          }),
        )
        .min(1)
        .max(20),
    }),
    b,
  );

const sloChanges = z
  .object({
    targetLatencyMs: z.number().int().min(10).max(60_000).optional(),
    latencyPercentile: z.number().int().min(50).max(99).optional(),
    targetAvailabilityBp: z.number().int().min(5000).max(10_000).optional(),
    windowDays: z.number().int().min(1).max(90).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((c) => Object.keys(c).length > 0, 'Name at least one thing to change');
const ruleChanges = z
  .object({
    threshold: z.number().int().min(0).max(10_000_000).optional(),
    windowMinutes: z.number().int().min(1).max(1440).optional(),
    minRequests: z.number().int().min(0).max(100_000).optional(),
    cooldownMinutes: z.number().int().min(1).max(1440).optional(),
    severity: z.enum(['warning', 'critical']).optional(),
    channels: z.array(z.enum(CHANNELS)).max(2).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((c) => Object.keys(c).length > 0, 'Name at least one thing to change');
export const parseSloChange = (b) => parse(z.object({ changes: sloChanges, reason }), b);
export const parseRuleChange = (b) => parse(z.object({ changes: ruleChanges, reason }), b);
