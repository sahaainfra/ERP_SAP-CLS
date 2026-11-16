import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { parseListQuery } from '../../platform/pagination/index.js';

const tableSettings = z.record(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/, 'Use a table id such as iam.users'), z.object({
  pageSize: z.number().int().min(10).max(200).optional(),
  columns: z.array(z.string().max(60)).max(60).optional(),
  hidden: z.array(z.string().max(60)).max(60).optional(),
  sort: z.string().max(200).optional(),
  widths: z.record(z.string().max(60), z.number().int().min(40).max(800)).optional(), // column widths of the List Report (part 03.03)
}).strict()).refine((v) => Object.keys(v).length <= 100, 'At most 100 tables');

/** A change to a person's own screen preferences; any field may be left out. */
export const parsePreferences = (b) =>
  parse(
    z.object({
      theme: z.enum(['light', 'dark', 'high-contrast']).optional(),
      density: z.enum(['comfortable', 'compact']).optional(),
      language: z.enum(['en', 'hi', 'te']).optional(),
      startPage: z.string().max(100).regex(/^\/[a-z0-9/_-]*$/, 'Use a page address such as /admin/users').nullable().optional(),
      tableSettings: tableSettings.optional(),
      version: z.number().int().min(0).optional(),
    }).strict().refine((v) => Object.keys(v).some((k) => k !== 'version'), { message: 'Change at least one preference', path: ['theme'] }),
    b,
  );

// ---- part 03.02: drafts, form definitions, duplicate checks, create-from and the reference form ----
export const MAX_DRAFT_BYTES = 256 * 1024;
const formCode = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/, 'Use a form code such as ui.sample_request');
export const parseFormCode = (v) => parse(formCode, v);
export const parseEntityKey = (v) => parse(z.union([z.undefined(), z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Use a record id')]), v) ?? '';

/** Saving a draft: the form's values as they are (not validated: a draft may be half done), a title for the list, and the version. */
export const parseDraftSave = (b) =>
  parse(
    z.object({
      payload: z.record(z.string(), z.unknown()),
      title: z.string().trim().max(160).optional(),
      savedBy: z.enum(['manual', 'autosave', 'blur']).default('manual'),
      projectId: z.number().int().positive().nullable().optional(),
      siteId: z.number().int().positive().nullable().optional(),
      version: z.number().int().min(0).optional(),
    }).strict(),
    b,
  );
export const parseDraftDelete = (b) => parse(z.object({ version: z.number().int().positive().optional() }).strict().optional().default({}), b ?? {});
export const parseDraftBulkDelete = (b) => parse(z.object({ ids: z.array(z.number().int().positive()).min(1, 'Select at least one draft').max(200) }).strict(), b);
export const parseDraftList = (q) => parseListQuery(q, { sortable: ['savedAt', 'formCode', 'title'], filterable: ['formCode'], defaultSort: [{ column: 'savedAt', dir: 'desc' }], maxPageSize: 100 });

export const parseDuplicateCheck = (b) => parse(z.object({ fields: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])) }).strict(), b);
export const parseCreateFrom = (q) => parse(z.object({ source: z.string().regex(/^[a-z]+\.[a-z_]+$/, 'Name the source, such as core.sample_document'), id: z.coerce.number().int().positive() }).strict(), q);

export const parseRequestAction = (b) => parse(z.object({ version: z.number().int().positive(), reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/, 'Choose a reason').optional(), reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500).optional() }).strict(), b);
export const parseDecision = (b) => parse(z.object({ action: z.enum(['approve', 'reject', 'return']), version: z.number({ error: 'Send the version of the approval you saw' }).int().positive(), reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/, 'Choose a reason').optional(), comment: z.string().trim().max(500).optional() }).strict(), b);
export const parseId = (v) => parse(z.coerce.number().int().positive(), v);
