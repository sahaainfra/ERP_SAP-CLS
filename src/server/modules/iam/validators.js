import { z } from 'zod';
import { parseListQuery } from '../../platform/pagination/index.js';
import { parse } from '../../platform/validation/index.js';

const reason = z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500);
const device = {
  deviceId: z.string().min(8).max(100).optional(),
  deviceName: z.string().trim().max(80).optional(),
  platform: z.string().trim().max(40).optional(),
  deviceToken: z.string().max(100).nullish(),
  rememberDevice: z.boolean().optional(),
};
const challengeToken = z.string().min(20).max(2000);
const newPassword = z.string().min(1, 'Choose a new password').max(128, 'Use at most 128 characters');

export const parsePublicId = (v) => parse(z.string().regex(/^[0-9a-f]{32}$/, 'Not a session ID'), v);
export const parseId = (v) => parse(z.coerce.number().int().positive(), v);
export const parseUsername = (v) => parse(z.string().trim().min(2).max(100), v);

export const parseLogin = (b) =>
  parse(z.object({ username: z.string().trim().min(1, 'Enter your username, email or mobile number').max(200), password: z.string().min(1, 'Enter your password').max(200), captchaToken: z.string().max(2000).optional(), captchaAnswer: z.union([z.string().max(20), z.number()]).optional(), ...device }).strict(), b);
export const parseCaptcha = (b) => parse(z.object({ username: z.string().trim().min(1).max(200) }).strict(), b);
export const parseMfaVerify = (b) =>
  parse(z.object({ challengeToken, method: z.enum(['totp', 'backup', 'sms', 'whatsapp']), code: z.string().trim().min(4).max(20), factorId: z.number().int().optional(), ...device }).strict(), b);
export const parseMfaSend = (b) => parse(z.object({ challengeToken, factorId: z.number().int().positive() }).strict(), b);
export const parseEnrolBegin = (b) => parse(z.object({ challengeToken }).strict(), b);
export const parseEnrolConfirm = (b) => parse(z.object({ challengeToken, code: z.string().trim().min(6).max(8), ...device }).strict(), b);
export const parseRequiredChange = (b) => parse(z.object({ challengeToken, newPassword, ...device }).strict(), b);
export const parseForgot = (b) => parse(z.object({ identifier: z.string().trim().min(2).max(200) }).strict(), b);
export const parseReset = (b) => parse(z.object({ identifier: z.string().trim().min(2).max(200), code: z.string().trim().min(6).max(20), newPassword }).strict(), b);
export const parseChange = (b) => parse(z.object({ currentPassword: z.string().min(1, 'Enter your current password').max(200), newPassword }).strict(), b);
export const parseRefresh = (b) => parse(z.object({ refreshToken: z.string().min(20).max(200).optional() }).strict(), b ?? {});
export const parsePinUnlock = (b) => parse(z.object({ deviceToken: z.string().min(20).max(100), pin: z.string().regex(/^\d{4,8}$/, 'A PIN is 4 to 8 digits'), ...device }).strict(), b);
export const parsePin = (b) => parse(z.object({ pin: z.string().regex(/^\d{4,8}$/, 'A PIN is 4 to 8 digits') }).strict(), b);
export const parseCode = (b) => parse(z.object({ code: z.string().trim().min(6).max(8) }).strict(), b);
export const parsePhone = (b) => parse(z.object({ phone: z.string().trim().min(10).max(16), channel: z.enum(['sms', 'whatsapp']) }).strict(), b);
export const parsePhoneConfirm = (b) => parse(z.object({ channel: z.enum(['sms', 'whatsapp']), code: z.string().trim().min(6).max(8) }).strict(), b);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b);

const int = (min, max) => z.number().int().min(min).max(max);
const policyChanges = z
  .object({
    password: z.object({ minLength: int(10, 128), expiryDays: int(0, 730), historyCount: int(5, 24), breachedCheck: z.enum(['off', 'local', 'hibp']) }).partial().strict(),
    lockout: z.object({ threshold: int(3, 20), baseDelayMinutes: int(1, 60), maxDelayMinutes: int(1, 1440), captchaAfter: int(1, 20) }).partial().strict(),
    mfa: z.object({ enforced: z.boolean(), requiredRoles: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,20}$/)).max(30), rememberDeviceDays: int(0, 30), rememberForPrivileged: z.boolean(), challengeMinutes: int(2, 15) }).partial().strict(),
    session: z.object({ idleMinutes: int(5, 480), absoluteHours: int(1, 72), maxConcurrent: int(1, 20), accessMinutes: int(2, 60) }).partial().strict(),
    alerts: z.object({ newDevice: z.boolean(), newCountry: z.boolean(), impossibleTravelHours: int(0, 48) }).partial().strict(),
    sso: z.object({ enabled: z.boolean(), providers: z.array(z.object({ id: z.string().max(31), type: z.enum(['oidc', 'saml']), issuer: z.string().max(300), clientId: z.string().max(200), label: z.string().max(60).optional() }).strict()).max(5) }).partial().strict(),
    notify: z.object({ connector: z.string().max(41), smsConnector: z.string().max(41), whatsappConnector: z.string().max(41) }).partial().strict(),
  })
  .partial()
  .strict()
  .refine((c) => Object.keys(c).length > 0 && Object.values(c).every((v) => Object.keys(v).length > 0), 'Name at least one setting to change');
export const parsePolicyChange = (b) => parse(z.object({ changes: policyChanges, reason }).strict(), b);

export const parseSessionList = (q) => parseListQuery(q, { sortable: ['last_seen_at'], filterable: ['user'], defaultSort: [] });
export const parseEventList = (q) => parseListQuery(q, { sortable: ['at', 'result'], filterable: ['user', 'result'], defaultSort: [{ column: 'at', dir: 'desc' }] });
export const parseUserList = (q) => parseListQuery(q, { sortable: [], filterable: [], defaultSort: [] });
