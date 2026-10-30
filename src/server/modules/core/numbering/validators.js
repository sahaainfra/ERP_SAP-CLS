import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { parseBusinessDate } from '../../../../shared/dates.js';

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const realDate = z.string().refine((d) => {
  try {
    parseBusinessDate(d);
    return true;
  } catch {
    return false;
  }
}, 'must be a real date written YYYY-MM-DD');
const intId = z.coerce.number().int().positive();
const code = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,31}$/, 'Use 2 to 32 capital letters, digits or underscores, starting with a letter');
const optText = (max) => z.string().trim().max(max).nullable().optional();
const RETENTION = ['permanent', 'statutory', 'standard', 'short'];
const ASSIGN = ['create', 'submit', 'approval'];
const branch = z.string().trim().regex(/^[A-Za-z0-9-]{1,12}$/, 'Use up to 12 letters, digits or "-"');

export const parseId = (v) => parse(intId, v);

export const parseDocTypeCreate = (b) =>
  parse(
    z.object({
      code,
      name: z.string().trim().min(2).max(120),
      module: z.string().trim().regex(/^[a-z][a-z0-9_]{1,19}$/, 'Use a lower-case module code such as fin'),
      templateId: optText(80).transform((v) => v || null),
      workflowCode: optText(80).transform((v) => v || null),
      retentionClass: z.enum(RETENTION).default('standard'),
      statutory: z.boolean().default(false),
      assignAt: z.enum(ASSIGN).default('create'),
      reason,
    }),
    b,
  );

export const parseDocTypeUpdate = (b) =>
  parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      templateId: optText(80),
      workflowCode: optText(80),
      retentionClass: z.enum(RETENTION).optional(),
      statutory: z.boolean().optional(),
      assignAt: z.enum(ASSIGN).optional(),
      isActive: z.boolean().optional(),
      version: z.number().int().positive(),
      reason,
    }),
    b,
  );

const prefix = z.string().trim().max(12).regex(/^[A-Za-z0-9/-]*$/, 'Use letters, digits, "/" and "-"');
const format = z.string().trim().min(3).max(60);
const resetRule = z.enum(['never', 'financial_year', 'monthly']);
const seqStart = z.number().int().min(1).max(1_000_000_000);
const projectId = z.number().int().positive();

export const parseSeriesCreate = (b) =>
  parse(
    z.object({
      docType: code,
      name: z.string().trim().min(2).max(120),
      prefix,
      format,
      gapFree: z.boolean().default(false),
      resetRule: resetRule.default('financial_year'),
      seqStart: seqStart.default(1),
      branchCode: branch.nullable().optional().transform((v) => v || null),
      projectId: projectId.nullable().optional().transform((v) => v ?? null),
      reason,
    }),
    b,
  );

export const parseSeriesUpdate = (b) =>
  parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      prefix: prefix.optional(),
      format: format.optional(),
      gapFree: z.boolean().optional(),
      resetRule: resetRule.optional(),
      seqStart: seqStart.optional(),
      branchCode: branch.nullable().optional(),
      projectId: projectId.nullable().optional(),
      isActive: z.boolean().optional(),
      version: z.number().int().positive(),
      reason,
    }),
    b,
  );

export const parseSeriesChange = (b) =>
  parse(
    z.object({
      changes: z
        .object({
          prefix: prefix.optional(),
          format: format.optional(),
          gapFree: z.boolean().optional(),
          resetRule: resetRule.optional(),
          seqStart: seqStart.optional(),
          branchCode: branch.nullable().optional(),
          projectId: projectId.nullable().optional(),
        })
        .strict()
        .refine((c) => Object.keys(c).length > 0, 'Name at least one thing to change'),
      reason,
    }),
    b,
  );

export const parseSeriesFilter = (q) => parse(z.object({ docType: code.optional() }), q);

const numberingContext = {
  docType: code,
  date: realDate.optional(),
  projectId: intId.optional(),
  projectCode: z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/).optional(),
  branchCode: z.string().trim().regex(/^[A-Za-z0-9-]{1,12}$/).optional(),
};
export const parsePreview = (q) => parse(z.object(numberingContext), q);
export const parseNext = (b) =>
  parse(
    z
      .object({
        ...numberingContext,
        projectId: z.number().int().positive().optional(),
        refType: z.string().trim().max(40).optional(),
        refId: z.union([z.string().max(60), z.number()]).optional(),
        point: z.enum(ASSIGN).optional(),
        companyId: z.number().int().positive().optional(),
      })
      .strict(),
    b,
  );
export const parseIssues = (q) => ({ ...parseListQuery(q, {}), seriesId: q.seriesId === undefined ? undefined : parse(intId, q.seriesId) });
