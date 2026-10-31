import { z } from 'zod';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { parse } from '../../../platform/validation/index.js';
import { settingsSchema } from '../../../platform/security/settings.js';

export const parseRouteList = (q) => parseListQuery(q, { sortable: ['path', 'module', 'result'], filterable: ['module', 'guard', 'result', 'method', 'rate'], defaultSort: [{ column: 'path', dir: 'asc' }], maxPageSize: 200 });
export const parseSettingsChange = (b) => parse(z.object({ settings: settingsSchema, reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500) }).strict(), b);
