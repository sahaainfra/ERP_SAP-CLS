import { z } from 'zod';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { parse } from '../../../platform/validation/index.js';
import { CONFIDENTIALITY_LEVELS, MASK_RULES } from '../../../platform/authz/index.js';

export const SCOPE_TYPES = ['COMPANY', 'BRANCH', 'DEPARTMENT', 'PROJECT', 'SITE', 'OWN'];
const id = z.number().int().positive();
const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const version = z.number().int().positive();
const key = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'Not a permission key');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (label, max) => z.string().trim().min(1, `Enter ${label}`).max(max, `Use at most ${max} characters`);

export const parseId = (v) => parse(z.coerce.number().int().positive(), v);

export const parseRoleCreate = (b) =>
  parse(
    z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{1,19}$/, 'Use 2 to 20 capital letters, digits, dash or underscore, starting with a letter'),
      name: text('a name', 80),
      description: z.string().trim().max(400).default(''),
      cloneFromId: id.optional(),
      departmentId: id.nullish().transform((v) => v ?? null),
      clearance: z.enum(/** @type {[string, ...string[]]} */ (CONFIDENTIALITY_LEVELS)).default('internal'),
    }).strict(),
    b,
  );

export const parseRolePatch = (b) =>
  parse(
    z.object({ name: text('a name', 80).optional(), description: z.string().trim().max(400).optional(), departmentId: id.nullish().optional(), version })
      .strict()
      .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Send at least one field to change'),
    b,
  );

export const parseRoleChange = (b) =>
  parse(
    z.object({
      permissions: z.object({ allow: z.array(key).max(1000), deny: z.array(key).max(1000).default([]) }).strict().optional(),
      masks: z.array(z.object({ entity: z.string().min(1).max(60), field: z.string().min(1).max(60), rule: z.enum(/** @type {[string, ...string[]]} */ (MASK_RULES)) }).strict()).max(200).optional(),
      clearance: z.enum(/** @type {[string, ...string[]]} */ (CONFIDENTIALITY_LEVELS)).optional(),
      activate: z.boolean().optional(),
      retire: z.boolean().optional(),
      reason,
    }).strict()
      .refine((v) => !(v.activate && v.retire), 'A role cannot be activated and retired together')
      .refine((v) => v.permissions || v.masks || v.clearance || v.activate || v.retire, 'Say what should change'),
    b,
  );

export const parseAssignment = (b) =>
  parse(
    z.object({
      userId: id,
      roleId: id,
      scopeType: z.enum(/** @type {[string, ...string[]]} */ (SCOPE_TYPES)).default('COMPANY'),
      scopeIds: z.array(id).max(200).default([]),
      effectiveFrom: date.nullish().transform((v) => v ?? null),
      effectiveTo: date.nullish().transform((v) => v ?? null),
      reason,
    }).strict(),
    b,
  );
export const parseEnd = (b) => parse(z.object({ reason }).strict(), b);

export const parseEffective = (q) =>
  parse(z.object({ userId: z.coerce.number().int().positive(), recordType: z.string().max(40).optional(), recordId: z.coerce.number().int().positive().optional() }).strict(), q);
export const parseCompare = (q) => parse(z.object({ a: z.coerce.number().int().positive(), b: z.coerce.number().int().positive() }).strict(), q);

export const parseRoleList = (q) => parseListQuery(q, { sortable: ['code', 'name', 'status', 'holders'], filterable: ['kind', 'status', 'category'], defaultSort: [{ column: 'code', dir: 'asc' }] });
export const parseAssignmentList = (q) => parseListQuery(q, { sortable: ['user', 'role', 'effectiveFrom'], filterable: ['userId', 'roleId', 'status', 'scopeType'], defaultSort: [{ column: 'user', dir: 'asc' }] });
export const parseComparisonList = (q) => parseListQuery(q, { sortable: ['user', 'result'], filterable: ['result'], defaultSort: [{ column: 'user', dir: 'asc' }] });
