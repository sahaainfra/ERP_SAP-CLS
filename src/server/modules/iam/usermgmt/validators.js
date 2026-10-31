import { z } from 'zod';
import { parseListQuery } from '../../../platform/pagination/index.js';
import { parse } from '../../../platform/validation/index.js';
import { badRequest } from '../../../platform/http/errors.js';
import { ROLE_CODES } from '../../../platform/auth/index.js';

export const USER_TYPES = ['INTERNAL', 'EXTERNAL_PORTAL', 'SERVICE_ACCOUNT'];
export const LIFECYCLES = ['INVITED', 'ONBOARDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'];
export const LANGUAGES = ['en', 'hi'];
export const CHANNELS = ['email', 'sms', 'whatsapp'];
export const MAX_BULK = 200;
export const MAX_IMPORT_ROWS = 2000;

/** An email in lower case, or null. */
export const normaliseEmail = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s || null;
};
/** An Indian mobile number as +91XXXXXXXXXX (spaces, dashes and a leading 0, 91 or +91 are accepted), another country's as +digits, or null. */
export function normaliseMobile(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/[\s().-]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^(0|91)?[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(-10)}`;
  return undefined; // present but not a valid number
}

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const version = z.number().int().positive();
const text = (label, max) => z.string().trim().min(1, `Enter ${label}`).max(max, `Use at most ${max} characters`);
const optionalText = (max) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const email = z.string().trim().max(200).nullish().refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v), 'Enter a valid email address').transform((v) => normaliseEmail(v));
const mobile = z.string().trim().max(30).nullish().refine((v) => !v || normaliseMobile(v) !== undefined, 'Enter a valid mobile number (10 digits, or with a country code)').transform((v) => normaliseMobile(v) ?? null);
const username = z.string().trim().toLowerCase().min(3, 'Use at least 3 characters').max(60, 'Use at most 60 characters').regex(/^[a-z0-9][a-z0-9._-]*$/, 'Use letters, digits, dot, dash and underscore, starting with a letter or digit');
const id = z.number().int().positive();

export const parseId = (v) => parse(z.coerce.number().int().positive(), v);
export const parseToken = (v) => parse(z.string().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/, 'Not an invitation token'), v);

const profileFields = {
  displayName: text('the name', 120),
  email,
  mobile,
  language: z.enum(LANGUAGES),
  userType: z.enum(USER_TYPES),
  employeeCode: optionalText(40),
  departmentId: id.nullish().transform((v) => v ?? null),
  projectId: id.nullish().transform((v) => v ?? null),
};

export const parseCreate = (b) =>
  parse(
    z
      .object({
        username: username.optional(),
        ...profileFields,
        language: profileFields.language.default('en'),
        userType: profileFields.userType.default('INTERNAL'),
        invite: z.boolean().default(false),
        channel: z.enum(CHANNELS).optional(),
      })
      .strict()
      .refine((v) => v.email || v.mobile, { message: 'Give an email address or a mobile number so the person can be invited', path: ['email'] }),
    b,
  );

export const parsePatch = (b) =>
  parse(
    z
      .object({ ...Object.fromEntries(Object.entries(profileFields).map(([k, v]) => [k, v.optional()])), version, reason: reason.optional() })
      .strict()
      .refine((v) => Object.keys(v).some((k) => !['version', 'reason'].includes(k)), 'Send at least one field to change'),
    b,
  );

export const parseInvite = (b) => parse(z.object({ channel: z.enum(CHANNELS).optional() }).strict(), b ?? {});
export const parseReasonVersion = (b) => parse(z.object({ reason, version: version.optional() }).strict(), b);
export const parseDeactivate = (b) => parse(z.object({ reason, version: version.optional(), successorId: id.optional() }).strict(), b);
export const parseRoleRequest = (b) =>
  parse(z.object({ roles: z.array(z.enum(/** @type {[string, ...string[]]} */ (ROLE_CODES))).min(1, 'Choose at least one role').max(10), reason }).strict(), b);
export const parseRoleRevoke = (b) =>
  parse(z.object({ roles: z.array(z.enum(/** @type {[string, ...string[]]} */ (ROLE_CODES))).min(1, 'Choose at least one role').max(10), reason, version: version.optional() }).strict(), b);
export const parseBulk = (b) =>
  parse(
    z.object({ action: z.enum(['invite', 'suspend']), ids: z.array(id).min(1, 'Select at least one user').max(MAX_BULK, `Select at most ${MAX_BULK} users at a time`), reason: reason.optional() }).strict()
      .refine((v) => v.action !== 'suspend' || v.reason, { message: 'Give a reason for the suspension', path: ['reason'] }),
    b,
  );
export const parseDuplicates = (q) =>
  parse(z.object({ email: z.string().max(200).optional(), mobile: z.string().max(30).optional(), employeeCode: z.string().max(40).optional(), excludeId: z.coerce.number().int().positive().optional() }).strict(), q);
export const parseAccept = (b) => parse(z.object({ password: z.string().min(1, 'Choose a password').max(128, 'Use at most 128 characters') }).strict(), b);
export const parseImport = (q) =>
  parse(z.object({ mode: z.enum(['validate', 'commit']).default('validate'), skipInvalid: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'), invite: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'), channel: z.enum(CHANNELS).optional() }).strict(), q);

const NOTIFY = z.object({ email: z.boolean(), sms: z.boolean(), whatsapp: z.boolean(), inApp: z.boolean() }).partial().strict();
export const parseMePatch = (b) =>
  parse(
    z
      .object({
        displayName: profileFields.displayName.optional(),
        language: profileFields.language.optional(),
        photoFileId: id.nullable().optional(),
        signatureFileId: id.nullable().optional(),
        preferences: z.object({ theme: z.enum(['light', 'dark', 'high-contrast']).optional(), notifications: NOTIFY.optional() }).strict().optional(),
        version,
      })
      .strict()
      .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Send at least one field to change'),
    b,
  );

const SORTABLE = ['displayName', 'username', 'status', 'lastLoginAt', 'createdAt'];
export const parseUserList = (q) => {
  const list = parseListQuery(q, { sortable: SORTABLE, filterable: ['status', 'type', 'departmentId', 'projectId', 'role'], defaultSort: [{ column: 'displayName', dir: 'asc' }] });
  const bad = [];
  if (list.filters.status && !LIFECYCLES.includes(list.filters.status)) bad.push({ field: 'filter[status]', message: `Use one of ${LIFECYCLES.join(', ')}` });
  if (list.filters.type && !USER_TYPES.includes(list.filters.type)) bad.push({ field: 'filter[type]', message: `Use one of ${USER_TYPES.join(', ')}` });
  for (const k of ['departmentId', 'projectId']) if (list.filters[k] && !/^\d+$/.test(list.filters[k])) bad.push({ field: `filter[${k}]`, message: 'Use a number' });
  if (list.filters.role && !ROLE_CODES.includes(list.filters.role)) bad.push({ field: 'filter[role]', message: 'Not a known role' });
  if (bad.length) throw badRequest('Some fields are invalid. Fix them and try again.', bad);
  return list;
};
export const parseHistoryList = (q) => parseListQuery(q, { sortable: ['at'], filterable: ['result'], defaultSort: [{ column: 'at', dir: 'desc' }] });
