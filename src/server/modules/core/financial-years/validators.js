import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { parseBusinessDate } from '../../../../shared/dates.js';
import { PERIOD_MODULES } from './service.js';

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const date = z.string().refine((d) => {
  try {
    parseBusinessDate(d);
    return true;
  } catch {
    return false;
  }
}, 'must be a real date written YYYY-MM-DD');
const id = z.coerce.number().int().positive();

export const parseYearList = (query) => parseListQuery(query, {});
export const parseId = (v) => parse(id, v);
export const parseCreate = (body) => parse(z.object({ startDate: date, reason: reason.optional() }), body);
export const parseStatus = (body) =>
  parse(z.object({ module: z.enum(PERIOD_MODULES), status: z.enum(['Open', 'Soft-closed', 'Closed']), reason, version: z.number().int().positive() }), body);
export const parseClose = (body) => parse(z.object({ reason, version: z.number().int().positive() }), body);
export const parseReopen = (body) =>
  parse(z.object({ periodId: id, module: z.enum(PERIOD_MODULES), targetStatus: z.enum(['Open', 'Soft-closed']), reason }), body);
