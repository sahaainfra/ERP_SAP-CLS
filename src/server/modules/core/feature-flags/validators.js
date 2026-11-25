import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';

const idPart = z.coerce.number().int().positive();

export const listOptions = { sortable: ['key', 'environment', 'changed_at', 'version'], filterable: ['environment', 'key'] };
export const parseList = (query) => parseListQuery(query, listOptions);

const evaluateQuery = z.object({
  keys: z.string().min(1).max(2000),
  company_id: idPart.optional(),
  project_id: idPart.optional(),
});

export function parseEvaluate(query) {
  const q = parse(evaluateQuery, query);
  const keys = [...new Set(q.keys.split(',').map((k) => k.trim()).filter(Boolean))].slice(0, 100);
  return { keys, companyId: q.company_id, projectId: q.project_id };
}

export const parseKey = (value) => parse(z.string().regex(/^ff\.[a-z0-9_.]+$/), value);

const scopeSchema = z.object({
  level: z.enum(['default', 'environment', 'company', 'project']),
  environment: z.enum(['development', 'test', 'staging', 'production']).optional(),
  companyId: idPart.optional(),
  projectId: idPart.optional(),
});

const patchBody = z
  .object({
    scope: scopeSchema,
    enabled: z.boolean(),
    reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
    version: z.number().int().positive().optional(),
  })
  .superRefine((b, ctx) => {
    const s = b.scope;
    const bad = (message, path) => ctx.addIssue({ code: 'custom', message, path: ['scope', path] });
    if (s.level === 'environment' && !s.environment) bad('environment is required for an environment default', 'environment');
    if (s.level === 'company' && !s.companyId) bad('companyId is required for a company override', 'companyId');
    if (s.level === 'project' && (!s.companyId || !s.projectId)) {
      bad('companyId and projectId are required for a project override', 'projectId');
    }
  });

export const parsePatch = (body) => parse(patchBody, body);

// Audit AUD-DEF-009: the checks of a requested flag change
export const parseChangeId = (value) => parse(idPart, value);
export const parseChangeList = (query) => parse(z.object({ status: z.enum(['PENDING', 'APPLIED', 'REJECTED', 'CANCELLED']).optional() }).strict(), query ?? {});
export const parseDecision = (body) => parse(z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().min(5).max(500).optional() }).strict(), body ?? {});
export const parseCancel = (body) => parse(z.object({ reason: z.string().trim().min(5).max(500) }).strict(), body ?? {});
