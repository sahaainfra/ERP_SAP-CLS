import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { STEP_MODES } from '../../platform/workflow/definition.js';

// Inputs of the workflow API (part 04.01). The engine checks the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const text = (max) => z.string().trim().max(max);
export const parseId = (v) => parse(id, v);
export const parseDocType = (v) => parse(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/), v);
export const parseDocId = (v) => parse(z.string().trim().min(1).max(60), v);

const context = z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).refine((o) => Object.keys(o).length <= 40, 'At most 40 context fields');
export const parseSubmit = (b) => parse(z.object({
  docType: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/),
  docId: z.union([z.string().trim().min(1).max(60), z.number().int()]).transform(String),
  context: context.optional(),
  amendsDocId: z.union([z.string().trim().min(1).max(60), z.number().int()]).transform(String).optional(),
  comment: text(1000).optional(),
}).strict(), b);
export const parseAct = (b) => parse(z.object({
  action: z.enum(['approve', 'reject', 'return', 'clarify', 'answer', 'delegate']),
  comment: text(2000).optional(),
  attachments: z.array(id).max(10).optional(),
  checked: z.array(text(120)).max(12).optional(),
  returnToStep: z.string().regex(/^(originator|[A-Za-z][A-Za-z0-9_]{0,23})$/).optional(),
  delegateTo: text(60).optional(),
  version: z.number().int().min(1).optional(),
}).strict(), b);
export const parseComment = (b) => parse(z.object({ comment: text(2000).optional(), context: context.optional() }).strict(), b ?? {});
export const parseCancel = (b) => parse(z.object({ reason: text(2000).min(5, 'Give a reason of at least 5 characters') }).strict(), b);
export const parseAssign = (b) => parse(z.object({ user: text(60).optional(), role: z.string().regex(/^[A-Z][A-Z0-9_|]{1,40}$/).optional(), comment: text(1000).optional() }).strict().refine((v) => v.user || v.role, { message: 'Choose a person or a role', path: ['user'] }), b);
export const parseTaskQuery = (q) => parse(z.object({
  mine: z.enum(['assigned', 'delegated', 'watching', 'started', 'admin']).default('assigned'),
  status: z.enum(['OPEN', 'DONE', 'ADMIN_QUEUE']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
}).strict(), q);
export const parseInstanceQuery = (q) => parse(z.object({
  docType: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/).optional(),
  status: z.enum(['RUNNING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'WITHDRAWN']).optional(),
  q: text(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['recent', 'oldest']).default('recent'),
}).strict(), q);
export const parseMonitorQuery = (q) => parse(z.object({
  docType: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
}).strict(), q);
export const parseDefinitionQuery = (q) => parse(z.object({
  docType: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/).optional(),
  status: z.enum(['DRAFT', 'PENDING', 'ACTIVE', 'RETIRED', 'REJECTED']).optional(),
  q: text(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
}).strict(), q);
export const parseDraftFrom = (b) => parse(z.object({ docType: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/) }).strict(), b);
export const parseDefinitionUpdate = (b) => parse(z.object({ definition: z.record(z.string(), z.any()), version: z.number().int().min(1).optional() }).strict(), b);
export const parseDefinitionCreate = (b) => parse(z.record(z.string(), z.any()), b);
export { STEP_MODES };

// the sample document type
const rupees = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use an amount such as 1250000.00');
export const parseSampleDoc = (b) => parse(z.object({ title: text(120).min(3), amount: rupees, projectId: id.optional(), version: z.number().int().min(1).optional() }).strict(), b);
export const parseSampleQuery = (q) => parse(z.object({ status: z.enum(['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED']).optional(), q: text(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);

// ---- part 04.02: the approval matrix, authority limits, delegations, escalation and SLA ----
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-11-30').refine((v) => !Number.isNaN(Date.parse(v)), 'Not a real date');
const docTypeCode = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/);
const roleCode = z.string().regex(/^(MANAGER|[A-Z][A-Z0-9_-]{1,19}(\|[A-Z][A-Z0-9_-]{1,19})*)$/, 'a role code such as PM or ITADM|DIR');
const condition = z.object({ field: z.string().regex(/^[A-Za-z][A-Za-z0-9_.]{0,59}$/), op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']), value: z.union([z.string().max(100), z.number(), z.boolean(), z.array(z.union([z.string().max(100), z.number()])).max(30)]) }).strict();
const ruleStep = z.object({
  code: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,23}$/).optional(), name: text(80).optional(), role: roleCode, authority: z.boolean().optional(), group: z.string().max(20).optional(),
  groupMode: z.enum(['all', 'any']).optional(), slaHours: z.number().int().min(1).max(720).nullable().optional(), when: condition.nullable().optional(), requireAttachment: z.boolean().optional(), checklist: z.array(text(120)).max(12).optional(),
}).strict();
const matrixRule = z.object({ priority: z.number().int().min(1).max(10000), name: text(100).min(2), conditions: z.array(condition).max(12).default([]), steps: z.array(ruleStep).min(1).max(12) }).strict();
export const parseMatrixQuery = (q) => parse(z.object({ docType: docTypeCode.optional(), status: z.enum(['DRAFT', 'PENDING', 'ACTIVE', 'RETIRED', 'REJECTED']).optional(), scopeType: z.enum(['COMPANY', 'DEPARTMENT', 'PROJECT']).optional(), q: text(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseMatrixCreate = (b) => parse(z.object({ docType: docTypeCode, scopeType: z.enum(['COMPANY', 'DEPARTMENT', 'PROJECT']).default('COMPANY'), scopeId: z.number().int().min(0).default(0), name: text(120).optional(), copyOf: id.optional(), rules: z.array(matrixRule).min(1).max(60).optional() }).strict(), b);
export const parseMatrixUpdate = (b) => parse(z.object({ name: text(120).optional(), rules: z.array(matrixRule).min(1).max(60), version: z.number().int().min(1).optional() }).strict(), b);
export const parseActivate = (b) => parse(z.object({ effectiveFrom: date }).strict(), b);
export const parseSimulate = (b) => parse(z.object({ docType: docTypeCode, context: context.default({}), projectId: id.nullable().optional(), departmentId: id.nullable().optional(), date: date.optional(), matrixId: id.nullable().optional() }).strict(), b);
export const parseLimitChanges = (b) => parse(z.object({
  changes: z.array(z.object({ role: z.string().regex(/^[A-Z][A-Z0-9_-]{1,19}$/), docType: docTypeCode, maxAmount: z.union([z.string().regex(/^\d{1,13}(\.\d{1,2})?$/), z.number().min(0)]).nullable() }).strict()).min(1).max(100),
  effectiveFrom: date, reason: text(500).min(5),
}).strict(), b);
export const parseLimitHistory = (q) => parse(z.object({ docType: docTypeCode.optional(), role: z.string().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseDelegationQuery = (q) => parse(z.object({ scope: z.enum(['mine', 'all']).default('mine'), status: z.enum(['PENDING', 'ACTIVE', 'REVOKED', 'REJECTED']).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseDelegation = (b) => parse(z.object({
  delegate: text(60).min(2), docTypes: z.array(docTypeCode).max(40).default([]), from: date, to: date, reason: text(500).min(5), maxAmount: z.union([z.string().regex(/^\d{1,13}(\.\d{1,2})?$/), z.number().min(0)]).nullable().optional(), onBehalfOf: text(60).optional(),
}).strict(), b);
export const parseRevoke = (b) => parse(z.object({ reason: text(500).min(5) }).strict(), b);
export const parsePathChange = (b) => parse(z.object({
  scopeType: z.enum(['COMPANY', 'DEPARTMENT', 'PROJECT']).default('COMPANY'), scopeId: z.number().int().min(0).default(0),
  levels: z.array(z.object({ level: text(40).min(2), roles: z.array(z.string().regex(/^[A-Z][A-Z0-9_-]{1,19}$/)).min(1).max(8) }).strict()).min(2).max(8), effectiveFrom: date, reason: text(500).min(5),
}).strict(), b);
export const parseSlaChange = (b) => parse(z.object({
  settings: z.array(z.object({ docType: z.union([docTypeCode, z.literal('*')]), hours: z.number().int().min(1).max(720), remindPct: z.number().int().min(1).max(100), escalatePct: z.number().int().min(50).max(1000), secondPct: z.number().int().min(100).max(2000) }).strict()).min(1).max(60), effectiveFrom: date, reason: text(500).min(5),
}).strict(), b);

// ---- part 04.03: the approval inbox ----
export const parseInboxQuery = (q) => parse(z.object({
  docType: docTypeCode.optional(), projectId: id.optional(), sla: z.enum(['ON_TRACK', 'DUE_SOON', 'OVERDUE']).optional(), q: text(80).optional(), bulk: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sort: z.enum(['urgency', 'age', 'amount']).default('urgency'), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0),
}).strict(), q);
export const parseSubmissionsQuery = (q) => parse(z.object({ kind: z.enum(['submitted', 'watching']).default('submitted'), status: z.enum(['RUNNING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'WITHDRAWN']).optional(), q: text(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseBulkAct = (b) => parse(z.object({ taskIds: z.array(id).min(1).max(50), action: z.literal('approve').default('approve'), comment: text(1000).optional() }).strict(), b);
export const parseLinkIssue = (b) => parse(z.object({ channel: z.enum(['SELF']).default('SELF') }).strict(), b ?? {});
export const parseLinkToken = (v) => parse(z.string().regex(/^[A-Za-z0-9_-]{40,64}$/, 'Not a valid link'), v);
export const parseLinkDecide = (b) => parse(z.object({ action: z.enum(['approve', 'reject']), comment: text(1000).optional() }).strict().refine((v) => v.action === 'approve' || (v.comment ?? '').length >= 5, { message: 'Give a comment of at least 5 characters when you reject', path: ['comment'] }), b);
export const parsePolicyChange = (b) => parse(z.object({
  policies: z.array(z.object({ docType: docTypeCode, bulkEligible: z.boolean(), bulkMaxAmount: z.number().min(0).nullable(), linkEligible: z.boolean(), linkReauthAmount: z.number().min(0).nullable(), linkExpiryMinutes: z.number().int().min(5).max(1440) }).strict()).min(1).max(60),
  effectiveFrom: date, reason: text(500).min(5),
}).strict(), b);

// ---- part 04.04: the Protocol & Control Engine ----
const STAGE = z.enum(['PLAN', 'VERIFY', 'APPROVE', 'EXECUTE', 'RECORD', 'MONITOR', 'RECONCILE', 'CLOSE']);
const MODE = z.enum(['OFF', 'OBSERVE', 'WARN', 'ENFORCE']);
const ENFORCEMENT = z.enum(['BLOCK', 'EXCEPTION', 'WARN', 'MONITOR']);
const ACTION = z.enum(['cancel', 'reject', 'return', 'reverse', 'deviate', 'override']);
const controlCode = z.string().regex(/^CP-[A-Z]{2,8}-\d{2,3}$/, 'Use the form CP-<MODULE>-nn, for example CP-PROC-05');
const ownerCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'A role code such as PM');
const thresholds = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), z.union([z.number(), z.string().max(60), z.boolean()])).refine((o) => Object.keys(o).length <= 20, 'At most 20 thresholds');
const rule = z.object({ field: z.string().regex(/^[A-Za-z][A-Za-z0-9_.]{0,59}$/), op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'ne', 'in']), threshold: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/).optional(), value: z.union([z.string().max(60), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional() }).strict()
  .refine((r) => r.threshold !== undefined || r.value !== undefined, { message: 'Give a value or the name of a threshold', path: ['value'] });
export const parseControlCode = (v) => parse(controlCode, v);
export const parseControlQuery = (q) => parse(z.object({ module: z.string().regex(/^[a-z][a-z0-9_]{1,19}$/).optional(), mode: MODE.optional(), stage: STAGE.optional(), q: text(80).optional() }).strict(), q);
export const parseControlCreate = (b) => parse(z.object({
  code: controlCode, module: z.string().regex(/^[a-z][a-z0-9_]{1,19}$/, 'Lower-case letters, such as proc'), stage: STAGE, description: text(300).min(10), enforcement: ENFORCEMENT, rule, thresholds: thresholds.optional(),
  evidenceRequired: z.boolean().default(false), escalationLevel: z.number().int().min(1).max(3).default(1), ownerRole: ownerCode, emergencyAllowed: z.boolean().default(false),
}).strict(), b);
export const parseControlUpdate = (b) => parse(z.object({
  mode: MODE.optional(), enforcement: ENFORCEMENT.optional(), thresholds: thresholds.optional(), evidenceRequired: z.boolean().optional(), escalationLevel: z.number().int().min(1).max(3).optional(), ownerRole: ownerCode.optional(),
  emergencyAllowed: z.boolean().optional(), description: text(300).min(10).optional(), version: z.number().int().min(1).optional(), reason: text(500).optional(),
}).strict(), b);
export const parseReasonQuery = (q) => parse(z.object({ actionType: ACTION.optional(), all: z.enum(['true', 'false']).transform((v) => v === 'true').optional() }).strict(), q);
export const parseReasonSave = (b) => parse(z.object({
  actionType: ACTION, code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Capital letters, digits and underscores, such as WRONG_ACCOUNT'), label: text(120).min(3), requiresEvidence: z.boolean().default(false), needsText: z.boolean().default(false),
  sortOrder: z.number().int().min(1).max(999).optional(), active: z.boolean().default(true), version: z.number().int().min(1).optional(),
}).strict(), b);
export const parseExceptionQuery = (q) => parse(z.object({
  status: z.enum(['OPEN', 'DRAFT', 'PENDING', 'APPROVED', 'USED', 'REJECTED', 'RETURNED', 'CANCELLED']).optional(), control: controlCode.optional(), projectId: id.optional(), minValue: z.coerce.number().min(0).optional(), maxValue: z.coerce.number().min(0).optional(),
  raisedBy: text(60).optional(), emergency: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), q: text(80).optional(), sort: z.enum(['newest', 'oldest', 'value', 'status']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0),
}).strict(), q);
export const parseExceptionExport = (q) => parse(z.object({
  status: z.enum(['OPEN', 'DRAFT', 'PENDING', 'APPROVED', 'USED', 'REJECTED', 'RETURNED', 'CANCELLED']).optional(), control: controlCode.optional(), projectId: id.optional(), q: text(80).optional(), format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx'),
}).strict(), q);
export const parseExceptionCreate = (b) => parse(z.object({
  controlCode, entity: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), entityId: z.union([z.string().trim().min(1).max(60), z.number().int()]).transform(String), entityRef: text(80).optional(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), justification: text(2000).min(20, 'Justify in at least 20 characters: the approvers read it'), emergency: z.boolean().default(false),
}).strict(), b);
export const parseExceptionUpdate = (b) => parse(z.object({ reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), justification: text(2000).min(20, 'Justify in at least 20 characters: the approvers read it'), version: z.number().int().min(1).optional() }).strict(), b);
export const parseDashboardQuery = (q) => parse(z.object({ projectId: id.optional(), days: z.coerce.number().int().min(7).max(365).default(90) }).strict(), q);
export const parseCycleTarget = (p) => parse(z.object({ entity: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), id: z.string().trim().min(1).max(60) }).strict(), p);
export const parseSampleImport = (b) => parse(z.object({ rows: z.array(z.object({ title: text(120).min(3), amount: rupees, projectId: id.optional() }).strict()).min(1).max(200) }).strict(), b);
