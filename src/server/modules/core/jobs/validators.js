import { z } from 'zod';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery } from '../../../platform/pagination/index.js';

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const id = z.coerce.number().int().positive();

export const parseId = (v) => parse(id, v);
export const parseJobList = (q) => parseListQuery(q, { filterable: ['status', 'type'], sortable: ['id', 'startedAt'], defaultSort: [{ column: 'id', dir: 'desc' }] });
export const parseJobAction = (b) => parse(z.object({ reason: reason.optional() }), b ?? {});
export const parseCronPreview = (q) => parse(z.object({ cron: z.string().trim().min(1).max(100), count: z.coerce.number().int().min(1).max(10).default(5) }), q);
export const parseScheduleChange = (b) =>
  parse(
    z.object({
      changes: z
        .object({ cron: z.string().trim().min(1).max(100).optional(), enabled: z.boolean().optional() })
        .strict()
        .refine((c) => Object.keys(c).length > 0, 'Name at least one thing to change'),
      reason,
    }),
    b,
  );
