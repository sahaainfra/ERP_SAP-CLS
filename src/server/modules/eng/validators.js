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
