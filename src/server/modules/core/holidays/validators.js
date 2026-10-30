import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseBusinessDate } from '../../../../shared/dates.js';
import { HOLIDAY_TYPES } from './service.js';

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
const state = z.string().regex(/^[0-9]{2}$/, 'Use the 2-digit GST state code, for example 27');

export const parseId = (v) => parse(intId, v);
export const parseCalendarCreate = (b) =>
  parse(
    z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{1,19}$/, 'Use 2 to 20 capital letters, digits, "_" or "-"'),
      name: z.string().trim().min(2).max(120),
      stateCode: state.nullable().optional().transform((v) => v || null),
      siteId: z.number().int().positive().nullable().optional().transform((v) => v ?? null),
      reason,
    }),
    b,
  );
export const parseCalendarUpdate = (b) =>
  parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      stateCode: state.nullable().optional(),
      siteId: z.number().int().positive().nullable().optional(),
      isActive: z.boolean().optional(),
      version: z.number().int().positive(),
      reason,
    }),
    b,
  );
export const parseRange = (q) =>
  parse(z.object({ from: realDate.default('1900-01-01'), to: realDate.default('2999-12-31') }), q);
export const parseHolidayCreate = (b) => parse(z.object({ date: realDate, name: z.string().trim().min(2).max(120), type: z.enum(HOLIDAY_TYPES).default('company') }), b);
export const parseHolidayUpdate = (b) => parse(z.object({ name: z.string().trim().min(2).max(120).optional(), type: z.enum(HOLIDAY_TYPES).optional(), version: z.number().int().positive() }), b);
// Rows are checked one by one in the service so a bad row is reported with its row number.
export const parseImport = (b) => parse(z.object({ rows: z.array(z.object({ date: z.string(), name: z.string().trim(), type: z.string().default('company') })).max(1000) }), b);
export const parseCheck = (q) => parse(z.object({ date: realDate, stateCode: state.optional(), siteId: intId.optional() }), q);
