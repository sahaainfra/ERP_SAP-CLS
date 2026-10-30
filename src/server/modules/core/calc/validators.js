import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { INPUT_TYPES, OUTPUT_TYPES } from '../../../../shared/calc.js';
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
const code = z.string().trim().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'Use module.name in lower case, for example boq.line_amount');
const versionNo = z.coerce.number().int().positive();
const name = z.string().trim().regex(/^[a-z][a-z0-9_]*$/, 'Use lower-case letters, digits and underscores');
const scalar = z.union([z.string(), z.number(), z.boolean()]);

const inputDef = z
  .object({
    name,
    type: z.enum(INPUT_TYPES),
    label: z.string().trim().max(80).optional(),
    required: z.boolean().optional(),
    default: scalar.optional(),
    min: z.string().trim().max(30).optional(),
    max: z.string().trim().max(30).optional(),
    allowed: z.array(z.string().trim().max(40)).max(20).optional(),
  })
  .strict();
const outputDef = z.object({ name, type: z.enum(OUTPUT_TYPES), label: z.string().trim().max(80).optional() }).strict();
const testCase = z.object({ inputs: z.record(z.string(), scalar), expect: z.record(z.string(), z.string()) }).strict();

const body = {
  description: z.string().trim().min(5).max(300),
  expression: z.string().min(1).max(4000),
  inputs: z.array(inputDef).max(30),
  outputs: z.array(outputDef).min(1).max(30),
  roundingPolicy: z.enum(['half_up', 'bankers', 'down', 'up']),
  effectiveFrom: realDate,
  tests: z.array(testCase).max(50),
};

export const parseCode = (v) => parse(code, v);
export const parseVersion = (v) => parse(versionNo, v);
export const parseId = (v) => parse(z.coerce.number().int().positive(), v);
export const parseFormulaList = (q) => parseListQuery(q, { filterable: ['owner_module', 'status'], sortable: ['code'], defaultSort: [{ column: 'code', dir: 'asc' }] });
export const parseCreateFormula = (b) => parse(z.object({ code, ownerModule: z.string().trim().regex(/^[a-z][a-z0-9_]{1,19}$/), financial: z.boolean().default(false), ...body, reason }), b);
export const parseCreateVersion = (b) => parse(z.object({ ...body, baseVersion: versionNo.optional(), reason }).partial({ description: true, expression: true, inputs: true, outputs: true, roundingPolicy: true, effectiveFrom: true, tests: true }), b);
export const parseUpdateVersion = (b) => parse(z.object({ ...body, version: z.number().int().positive(), reason }).partial({ description: true, expression: true, inputs: true, outputs: true, roundingPolicy: true, effectiveFrom: true, tests: true }), b);
export const parseTest = (b) =>
  parse(
    z.object({
      version: versionNo.optional(),
      date: realDate.optional(),
      inputs: z.record(z.string(), scalar),
      draft: z.object({ expression: body.expression, inputs: body.inputs, outputs: body.outputs, roundingPolicy: body.roundingPolicy }).optional(),
    }),
    b,
  );
export const parseReasonBody = (b) => parse(z.object({ reason }), b);
export const parseActivation = (b) => parse(z.object({ reason }), b);
export const parseCompare = (b) =>
  parse(
    z.object({
      baselineVersion: versionNo,
      candidateVersion: versionNo,
      cases: z.array(z.record(z.string(), scalar)).max(500).default([]),
      useRecent: z.number().int().min(0).max(200).default(0),
    }),
    b,
  );
export const parseShadowSummary = (q) => parse(z.object({ candidate: versionNo.optional() }), q);
export const parseTraceQuery = (q) => parse(z.object({ entity: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/), entityId: z.coerce.number().int().positive() }), q);
export const parseConvert = (b) =>
  parse(z.object({ quantity: z.union([z.string(), z.number()]), from: z.string().trim().min(1).max(12), to: z.string().trim().min(1).max(12), itemCode: z.string().trim().max(40).optional() }), b);
export const parseUomCreate = (b) =>
  parse(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,12}$/, 'Use 1 to 12 capital letters or digits'), name: z.string().trim().min(2).max(60), dimension: z.enum(['count', 'mass', 'length', 'area', 'volume', 'time', 'other']), reason }), b);
export const parseConversionCreate = (b) =>
  parse(
    z.object({
      from: z.string().trim().toUpperCase().min(1).max(12),
      to: z.string().trim().toUpperCase().min(1).max(12),
      factor: z.string().trim().regex(/^(?!0+(\.0+)?$)\d{1,12}(\.\d{1,10})?$/, 'A positive number with up to 10 decimal places'),
      itemCode: z.string().trim().max(40).optional(),
      reason,
    }),
    b,
  );
export const parseConversionList = (q) => parse(z.object({ itemCode: z.string().trim().max(40).optional() }), q);
