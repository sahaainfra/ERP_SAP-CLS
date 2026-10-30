import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { parseBusinessDate } from '../../../../shared/dates.js';

const realDate = z.string().refine((d) => {
  try {
    parseBusinessDate(d);
    return true;
  } catch {
    return false;
  }
}, 'must be a real date written YYYY-MM-DD');
const projectCode = z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'Use up to 20 letters, digits or "-"').optional();

export const parseId = (v) => parse(z.coerce.number().int().positive(), v);
export const parseSampleList = (q) => parseListQuery(q, {});
export const parseCreate = (b) =>
  parse(z.object({ title: z.string().trim().min(2).max(200), docDate: realDate, projectId: z.number().int().positive().optional(), projectCode }), b);
export const parseSubmit = (b) => parse(z.object({ version: z.number().int().positive(), projectCode }), b);
export const parseCancel = (b) => parse(z.object({ version: z.number().int().positive(), reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500) }), b);
export const parsePreview = (q) => parse(z.object({ docDate: realDate, projectId: z.coerce.number().int().positive().optional(), projectCode }), q);
