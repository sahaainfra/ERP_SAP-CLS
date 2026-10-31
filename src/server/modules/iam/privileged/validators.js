import { z } from 'zod';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { parse } from '../../../platform/validation/index.js';

const id = z.number().int().positive();
const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const pattern = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.*-]+$/, 'Use letters, digits, dot, dash, underscore and * only');
const SCOPE_TYPES = ['COMPANY', 'BRANCH', 'DEPARTMENT', 'PROJECT', 'SITE', 'OWN'];

export const parseId = (v) => parse(z.coerce.number().int().positive(), v);
export const parseCode = (v) => parse(z.string().regex(/^[A-Za-z0-9-]{3,40}$/, 'Not a campaign code'), v);

// ---- segregation of duties ----
export const parseRuleChange = (b) =>
  parse(
    z.object({
      ruleId: id.optional(),
      rule: z.object({
        code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9-]{2,19}$/, 'Use 3 to 20 capital letters, digits or dashes, such as SOD-11'),
        name: z.string().trim().min(3).max(120),
        description: z.string().trim().max(500).default(''),
        kind: z.enum(['PERMISSION', 'ACTION']),
        setA: z.array(pattern).min(1, 'Name at least one on each side').max(30),
        setB: z.array(pattern).min(1, 'Name at least one on each side').max(30),
        scope: z.enum(['USER', 'DOCUMENT', 'VENDOR', 'PERIOD', 'PROJECT']).default('USER'),
        severity: z.enum(['BLOCK', 'WARN', 'DETECT']),
        conditions: z.object({ minAmountPaise: z.number().int().min(0).max(1_000_000_000_000).optional() }).strict().default({}),
        active: z.boolean().default(true),
      }).strict().refine((r) => r.kind === 'ACTION' || r.scope === 'USER', { message: 'A rule about permissions held applies to the person, not to a document', path: ['scope'] }),
      reason,
    }).strict(),
    b,
  );
export const parseRuleTest = (q) =>
  parse(
    z.object({ userId: z.coerce.number().int().positive(), roleId: z.coerce.number().int().positive().optional(), scopeType: z.enum(/** @type {[string, ...string[]]} */ (SCOPE_TYPES)).optional(), action: z.string().max(80).optional(), subjectType: z.string().max(60).optional(), subjectId: z.string().max(60).optional() }).strict(),
    q,
  );
export const parseViolationResolve = (b) =>
  parse(
    z.object({
      action: z.enum(['REMOVE_ROLE', 'ACCEPT']),
      assignmentId: id.optional(),
      roleCode: z.string().trim().max(30).optional(),
      reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500),
    }).strict(),
    b,
  );
export const parseRuleList = (q) => parseListQuery(q, { sortable: ['code', 'severity', 'open'], filterable: ['severity', 'kind', 'active'], defaultSort: [{ column: 'code', dir: 'asc' }] });
export const parseViolationList = (q) => parseListQuery(q, { sortable: ['detectedAt', 'severity', 'user'], filterable: ['status', 'ruleId', 'severity', 'source', 'outcome'], defaultSort: [{ column: 'detectedAt', dir: 'desc' }] });

// ---- elevation ----
export const parseElevation = (b) =>
  parse(
    z.object({
      roleId: id,
      scopeType: z.enum(/** @type {[string, ...string[]]} */ (SCOPE_TYPES)).default('COMPANY'),
      scopeIds: z.array(id).max(50).default([]),
      hours: z.number().int().min(1, 'At least one hour').max(72, 'At most 72 hours'),
      startAt: z.string().datetime({ offset: true }).optional(),
      reason: z.string().trim().min(10, 'Give a reason of at least 10 characters: what needs doing and why the usual access is not enough').max(500),
    }).strict(),
    b,
  );
export const parseDecision = (b) => parse(z.object({ action: z.enum(['approve', 'reject']), comment: z.string().trim().max(500).optional() }).strict().refine((v) => v.action === 'approve' || (v.comment && v.comment.length >= 5), { message: 'Give a comment of at least 5 characters when you reject', path: ['comment'] }), b);
export const parseRevoke = (b) => parse(z.object({ reason }).strict(), b);
export const parseElevationList = (q) => parseListQuery(q, { sortable: ['createdAt', 'endsAt'], filterable: ['status', 'mine', 'awaiting'], defaultSort: [{ column: 'createdAt', dir: 'desc' }] });

// ---- access reviews ----
export const parseCampaign = (b) =>
  parse(
    z.object({ name: z.string().trim().min(3).max(120), scope: z.enum(['PRIVILEGED', 'DEPARTMENT', 'ALL']), departmentId: id.optional(), dueDate: date }).strict()
      .refine((v) => v.scope !== 'DEPARTMENT' || v.departmentId, { message: 'Choose the department to review', path: ['departmentId'] }),
    b,
  );
export const parseReviewDecision = (b) =>
  parse(
    z.object({ ids: z.array(id).min(1, 'Select at least one line').max(500), decision: z.enum(['CERTIFY', 'REVOKE']), comment: z.string().trim().max(500).optional() }).strict()
      .refine((v) => v.decision === 'CERTIFY' || (v.comment && v.comment.length >= 5), { message: 'Say why the access should be removed (at least 5 characters)', path: ['comment'] }),
    b,
  );
export const parseReassign = (b) => parse(z.object({ reviewId: id, reviewerId: id, reason }).strict(), b);
export const parseCampaignList = (q) => parseListQuery(q, { sortable: ['code', 'dueDate'], filterable: ['status'], defaultSort: [{ column: 'code', dir: 'desc' }] });
export const parseItemList = (q) => parseListQuery(q, { sortable: ['user', 'role'], filterable: ['decision', 'reviewId', 'privileged'], defaultSort: [{ column: 'user', dir: 'asc' }] });
export const parseDormantList = (q) => parseListQuery(q, { sortable: ['days'], filterable: [], defaultSort: [{ column: 'days', dir: 'desc' }] });
