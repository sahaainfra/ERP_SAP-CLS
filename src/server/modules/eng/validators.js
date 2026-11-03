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

// ---- part 04.05: accountability (RACI) and the action ledger ----
const SCOPE = z.enum(['COMPANY', 'DEPARTMENT', 'PROJECT', 'SITE', 'WBS']);
const processCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'A process code such as PO_ISSUE');
const personRef = z.string().trim().min(2).max(60);
const raciLetter = z.enum(['R', 'A', 'C', 'I']);
const LEDGER_ACTION = z.enum(['created', 'submitted', 'verified', 'approved', 'rejected', 'modified', 'executed', 'recorded', 'reconciled', 'cancelled', 'reversed', 'closed']);
export const parseRaciScope = (q) => parse(z.object({ scopeType: SCOPE.default('COMPANY'), scopeId: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseRaciHistory = (q) => parse(z.object({ scopeType: SCOPE.default('COMPANY'), scopeId: z.coerce.number().int().min(0).default(0), processCode: processCode.optional() }).strict(), q);
export const parseRaciChange = (b) => parse(z.object({
  scopeType: SCOPE, scopeId: z.number().int().min(0).default(0), effectiveFrom: date.optional(), reason: text(500).min(5, 'Give a reason of at least 5 characters'),
  processes: z.array(z.object({ processCode, assignments: z.array(z.object({ user: personRef.optional(), role: z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/).optional(), raci: raciLetter }).strict()).min(1).max(30) }).strict()).min(1).max(40),
}).strict(), b);
export const parseApplyTemplate = (b) => parse(z.object({
  scopeType: SCOPE, scopeId: z.number().int().min(0).default(0), effectiveFrom: date.optional(), reason: text(500).min(5, 'Give a reason of at least 5 characters'),
  processCodes: z.array(processCode).max(40).optional(), people: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/), personRef).default({}),
}).strict(), b);
export const parseGapQuery = (q) => parse(z.object({ projectId: id.optional(), all: z.enum(['true', 'false']).transform((v) => v === 'true').optional() }).strict(), q);
export const parseResolveQuery = (q) => parse(z.object({ processCode, projectId: id.optional(), siteId: id.optional(), departmentId: id.optional(), date: date.optional() }).strict(), q);
export const parseLedgerQuery = (q) => parse(z.object({
  user: personRef.optional(), project: id.optional(), action: LEDGER_ACTION.optional(), entity: text(60).optional(), process: processCode.optional(), outcome: text(30).optional(), from: date.optional(), to: date.optional(), q: text(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0),
}).strict(), q);
export const parseScoreQuery = (q) => parse(z.object({ by: z.enum(['person', 'role', 'project']).default('person'), projectId: id.optional(), processCode: processCode.optional(), from: date.optional(), to: date.optional() }).strict(), q);
export const parseScoreExport = (q) => parse(z.object({ by: z.enum(['person', 'role', 'project']).default('person'), projectId: id.optional(), processCode: processCode.optional(), from: date.optional(), to: date.optional(), format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx') }).strict(), q);
export const parseMeQuery = (q) => parse(z.object({ projectId: id.optional(), from: date.optional(), to: date.optional() }).strict(), q);

// ---- part 04.06: notifications ----
const NTF_CATEGORY = z.enum(['approvals', 'tasks', 'alerts', 'mentions', 'system', 'security', 'statutory']);
const NTF_CHANNEL = z.enum(['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH']);
const NTF_LANG = z.enum(['en', 'hi']);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time such as 22:00');
const templateCode = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'A template code such as workflow.task.assigned');
export const parseNotificationQuery = (q) => parse(z.object({
  state: z.enum(['inbox', 'unread', 'archived']).default('inbox'), category: NTF_CATEGORY.optional(), q: text(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0),
}).strict(), q);
export const parseReadAll = (b) => parse(z.object({ category: NTF_CATEGORY.optional() }).strict(), b ?? {});
export const parsePreferencesBody = (b) => parse(z.object({
  categories: z.partialRecord(NTF_CATEGORY, z.object({ IN_APP: z.boolean().optional(), EMAIL: z.boolean().optional(), SMS: z.boolean().optional(), WHATSAPP: z.boolean().optional(), PUSH: z.boolean().optional() }).strict()).optional(),
  digest: z.enum(['INSTANT', 'HOURLY', 'DAILY']).optional(), quietHours: z.object({ start: hhmm, end: hhmm }).strict().nullable().optional(), version: z.number().int().min(1).optional(),
}).strict(), b);
export const parseTemplateCode = (v) => parse(templateCode, v);
export const parseTemplateQuery = (q) => parse(z.object({ category: NTF_CATEGORY.optional(), q: text(60).optional() }).strict(), q);
export const parseTemplateChange = (b) => parse(z.object({
  code: templateCode, reason: text(500).min(5, 'Give a reason of at least 5 characters'),
  changes: z.array(z.object({ channel: NTF_CHANNEL, lang: NTF_LANG, subject: text(200).optional(), body: text(2000).min(1) }).strict()).min(1).max(10),
}).strict(), b);
export const parseTemplatePreview = (b) => parse(z.object({ code: templateCode.optional(), channel: NTF_CHANNEL, lang: NTF_LANG, subject: text(200).optional(), body: text(2000).min(1), variables: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)).max(30).optional() }).strict(), b);
export const parseDeliveryQuery = (q) => parse(z.object({
  channel: NTF_CHANNEL.optional(), status: z.enum(['PENDING', 'DEFERRED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED']).optional(), user: text(60).optional(), from: date.optional(), to: date.optional(), q: text(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0),
}).strict(), q);
export const parseDeliverySummary = (q) => parse(z.object({ from: date.optional(), to: date.optional() }).strict(), q);
export const parseDeliveryExport = (q) => parse(z.object({ channel: NTF_CHANNEL.optional(), status: z.enum(['PENDING', 'DEFERRED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED']).optional(), from: date.optional(), to: date.optional(), format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx') }).strict(), q);

// ---- part 04.07: the communication gateway ----
const COMM_CHANNEL = z.enum(['EMAIL', 'SMS', 'WHATSAPP', 'PUSH']);
const connectorCode = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,59}$/i, 'A connector code');
export const parseMessageQuery = (q) => parse(z.object({
  channel: COMM_CHANNEL.optional(), status: z.enum(['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED', 'RECEIVED', 'CANCELLED']).optional(), direction: z.enum(['OUT', 'IN']).optional(), purpose: z.enum(['TRANSACTIONAL', 'COMMERCIAL', 'OTP']).optional(),
  entity: text(60).optional(), id: text(60).optional(), contactType: text(30).optional(), contactId: text(60).optional(), address: text(120).optional(), from: date.optional(), to: date.optional(), q: text(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0),
}).strict(), q);
export const parseMessageSummary = (q) => parse(z.object({ from: date.optional(), to: date.optional() }).strict(), q);
export const parseMessageExport = (q) => parse(z.object({ channel: COMM_CHANNEL.optional(), status: z.enum(['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED', 'RECEIVED', 'CANCELLED']).optional(), from: date.optional(), to: date.optional(), q: text(80).optional(), format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx') }).strict(), q);
export const parseChannelChange = (b) => parse(z.object({
  channels: z.array(z.object({ channel: COMM_CHANNEL, primaryConnector: connectorCode.nullable().optional(), secondaryConnector: connectorCode.nullable().optional(), senderId: z.string().regex(/^[A-Za-z0-9]{3,11}$/, 'Three to eleven letters or digits').nullable().optional(), dltEntityId: z.string().regex(/^[0-9]{10,25}$/, 'The DLT entity ID is digits').nullable().optional(), ratePerMinute: z.number().int().min(1).max(6000).default(60), enabled: z.boolean().default(true) }).strict()).max(4).default([]),
  dltTemplates: z.array(z.object({ templateCode: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/), dltTemplateId: z.string().regex(/^[0-9]{10,30}$/, 'The DLT template ID is digits'), senderId: z.string().regex(/^[A-Za-z0-9]{3,11}$/).nullable().optional(), bodyPattern: text(1000).min(5) }).strict()).max(50).default([]),
  reason: text(500).min(5, 'Give a reason of at least 5 characters'),
}).strict().refine((v) => v.channels.length + v.dltTemplates.length > 0, { message: 'Change at least one channel or DLT template' }), b);
export const parseSample = (b) => parse(z.object({ channel: COMM_CHANNEL, to: text(120).min(3) }).strict(), b);
export const parseConsentQuery = (q) => parse(z.object({ channel: COMM_CHANNEL.optional(), status: z.enum(['OPT_IN', 'OPT_OUT']).optional(), contactType: text(30).optional(), source: text(30).optional(), q: text(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
const consentBody = z.object({ contactType: z.enum(['USER', 'EMPLOYEE', 'VENDOR', 'CLIENT', 'SUBCONTRACTOR', 'OTHER']).default('OTHER'), contactId: text(60).optional(), contactName: text(120).optional(), address: text(120).min(3), channel: COMM_CHANNEL, status: z.enum(['OPT_IN', 'OPT_OUT']), source: z.enum(['PORTAL', 'FORM', 'ADMIN', 'API']).optional() }).strict();
export const parseConsent = (b) => parse(consentBody, b);
export const parseConsentImport = (b) => parse(z.object({ rows: z.array(consentBody.omit({ source: true })).min(1).max(500) }).strict(), b);
export const parseOtpSend = (b) => parse(z.object({ purpose: z.enum(['APPROVAL_LINK', 'PAYMENT_CONFIRM', 'OTHER']), channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP']) }).strict(), b);
export const parseOtpVerify = (b) => parse(z.object({ otpId: id, code: z.string().regex(/^[0-9]{6}$/, 'The code is six digits') }).strict(), b);

// Inputs of the task API (part 04.08).
const TASK_PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const TASK_STATUS = z.enum(['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'VERIFIED', 'CLOSED', 'CANCELLED']);
const user = z.string().trim().min(1).max(60);
const recurrence = z.object({ freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']), interval: z.number().int().min(1).max(52).default(1), until: date.optional() }).strict();
const taskBody = {
  title: text(200).min(3, 'Give the task a title of at least 3 characters'), description: text(4000).optional(), entity: text(60).optional(), entityId: text(60).optional(), entityLabel: text(200).optional(),
  projectId: id.optional(), siteId: id.optional(), departmentId: id.optional(), priority: TASK_PRIORITY.optional(), startDate: date.optional(), dueDate: date.optional(),
  watchers: z.array(user).max(20).optional(), checklist: z.array(text(300).min(1)).max(50).optional(), dependsOn: z.array(id).max(20).optional(),
  requiresEvidence: z.boolean().optional(), requiresVerification: z.boolean().optional(),
};
export const parseTskQuery = (q) => parse(z.object({
  view: z.enum(['assigned', 'watching', 'created', 'team', 'all']).default('assigned'), status: z.union([z.literal('open'), z.literal('finished'), TASK_STATUS]).optional(), priority: TASK_PRIORITY.optional(),
  projectId: id.optional(), departmentId: id.optional(), entity: text(60).optional(), entityId: text(60).optional(), origin: z.enum(['manual', 'auto', 'instruction']).optional(), topicCode: text(60).optional(),
  assignee: user.optional(), overdue: z.enum(['1', 'true']).optional().transform((v) => Boolean(v)), from: date.optional(), to: date.optional(), q: text(80).optional(),
  sort: z.enum(['due', 'priority', 'newest']).default('due'), limit: z.coerce.number().int().min(1).max(200).default(25), offset: z.coerce.number().int().min(0).default(0),
}).strict(), q);
export const parseTaskCreate = (b) => parse(z.object({ ...taskBody, assignees: z.array(user).max(10).optional(), requiresAcceptance: z.boolean().optional(), recurrence: recurrence.optional() }).strict(), b);
export const parseInstruction = (b) => parse(z.object({ ...taskBody, topicCode: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, 'Use lower-case words such as safety.ppe').max(60) }).strict(), b);
export const parseRoutePreview = (q) => parse(z.object({ topicCode: text(60).optional(), projectId: id.optional(), siteId: id.optional(), departmentId: id.optional() }).strict(), q);
export const parseTaskUpdate = (b) => parse(z.object({ title: text(200).min(3).optional(), description: text(4000).optional(), priority: TASK_PRIORITY.optional(), startDate: date.optional(), dueDate: date.optional(), requiresEvidence: z.boolean().optional(), requiresVerification: z.boolean().optional(), version: z.number().int().min(1).optional() }).strict(), b);
export const parseTaskAct = (b) => parse(z.object({ reason: text(1000).optional() }).strict(), b ?? {});
export const parseTaskComment = (b) => parse(z.object({ body: text(2000).min(1, 'Write a comment') }).strict(), b);
export const parseTaskChecklist = (b) => parse(z.object({ add: text(300).min(1).optional(), toggle: z.object({ id, done: z.boolean() }).strict().optional(), remove: id.optional() }).strict().refine((v) => Object.keys(v).length === 1, 'Do one thing at a time: add, toggle or remove'), b);
export const parseTaskDepend = (b) => parse(z.object({ add: id.optional(), remove: id.optional() }).strict().refine((v) => Object.keys(v).length === 1, 'Add or remove one dependency'), b);
export const parseTaskPeople = (b) => parse(z.object({ assignees: z.array(user).min(1).max(10).optional(), watchers: z.array(user).max(20).optional() }).strict().refine((v) => Object.keys(v).length > 0, 'Name the people'), b);
export const parseTaskDashboard = (q) => parse(z.object({ projectId: id.optional(), departmentId: id.optional() }).strict(), q);
export const parseRoutingChange = (b) => parse(z.object({
  rows: z.array(z.object({
    topicCode: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, 'Use lower-case words such as safety.ppe').max(60), topicName: text(120).min(3), departmentId: id, role: z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/),
    fallbackUser: user.nullable().optional(), raciProcess: text(60).nullable().optional(), defaultPriority: TASK_PRIORITY.default('MEDIUM'), defaultDueDays: z.number().int().min(0).max(365).default(7),
    requiresEvidence: z.boolean().default(false), requiresVerification: z.boolean().default(false), effectiveFrom: date,
  }).strict()).min(1).max(100),
  reason: text(500).min(5, 'Give a reason of at least 5 characters'),
}).strict(), b);
export const parseTaskExport = (q) => parse(z.object({ view: z.enum(['assigned', 'watching', 'created', 'team', 'all']).default('assigned'), status: z.union([z.literal('open'), z.literal('finished'), TASK_STATUS]).optional(), format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx') }).strict(), q);

// Inputs of the alert rules API (part 04.09).
const alertCondition = z.object({ field: z.string().regex(/^[A-Za-z][A-Za-z0-9_.]{0,59}$/), op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'empty', 'notEmpty']), value: z.union([z.string().max(200), z.number(), z.boolean(), z.null(), z.array(z.union([z.string().max(100), z.number()])).max(50)]).optional() }).strict();
const alertAction = z.object({
  type: z.enum(['notify', 'task', 'escalate', 'webhook', 'flag']), to: z.array(z.string().regex(/^(owner|assignee|assigner|role|role:[A-Z][A-Z0-9_]{1,19}|user:[A-Za-z0-9_.@-]{1,60}|permission:[a-z][a-z0-9_.]{1,60})$/)).max(10).optional(), channels: z.array(z.enum(['EMAIL', 'SMS', 'WHATSAPP'])).max(3).optional(),
  title: text(200).optional(), assignee: text(60).optional(), dueDays: z.number().int().min(0).max(365).optional(), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(), role: z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/).optional(),
  connector: text(60).optional(), path: text(200).optional(), method: z.enum(['POST', 'PUT']).optional(), flag: text(40).optional(),
}).strict();
const ruleBody = {
  code: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, 'Use lower-case words joined by dots, for example task.overdue').max(60), name: text(120).min(3), description: text(500).optional(),
  triggerType: z.enum(['EVENT', 'SCHEDULE']), eventType: text(80).optional(), schedule: text(20).optional(), dataset: text(60).optional(),
  condition: z.object({ all: z.array(alertCondition).max(20).optional(), any: z.array(alertCondition).max(20).optional() }).strict().default({}),
  actions: z.array(alertAction).min(1).max(10), messageTemplate: text(500).min(3), throttleMinutes: z.number().int().min(0).max(525600).default(1440), severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('WARNING'),
  ownerModule: text(40).min(2), ownerRole: z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/).optional(), enabled: z.boolean().default(false),
};
export const parseAlertRule = (b) => parse(z.object({ ...ruleBody, reason: text(500).min(5, 'Give a reason of at least 5 characters'), version: z.number().int().min(1).optional() }).strict(), b);
export const parseAlertDraft = (b) => parse(z.object(ruleBody).strict(), b);
export const parseAdopt = (b) => parse(z.object({ enabled: z.boolean().default(true), reason: text(500).min(5, 'Give a reason of at least 5 characters') }).strict(), b);
export const parseEnable = (b) => parse(z.object({ enabled: z.boolean(), reason: text(500).optional() }).strict(), b);
export const parseRuleCode = (v) => parse(z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/).max(60), v);
export const parseRunsQuery = (q) => parse(z.object({ code: text(60).optional(), onlyErrors: z.enum(['1', 'true']).optional().transform((v) => Boolean(v)), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseAlertQuery = (q) => parse(z.object({ view: z.enum(['mine', 'project', 'all']).default('mine'), status: z.union([z.literal('open'), z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED'])]).optional(), severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(), rule: text(60).optional(), projectId: id.optional(), entity: text(60).optional(), entityId: text(60).optional(), q: text(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseAlertAct = (b) => parse(z.object({ note: text(1000).optional() }).strict(), b ?? {});
export const parseAlertBulk = (b) => parse(z.object({ ids: z.array(id).min(1).max(100), action: z.enum(['ack', 'resolve']), note: text(1000).optional() }).strict(), b);
export const parseAlertExport = (q) => parse(z.object({ view: z.enum(['mine', 'project', 'all']).default('mine'), status: z.union([z.literal('open'), z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED'])]).optional(), format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx') }).strict(), q);

