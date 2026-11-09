import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the attendance punch API (part 07.05). What the phone says is checked for shape here and judged by the service (BR-01).
const id = z.coerce.number().int().min(1);
const iso = z.string().refine((v) => Number.isFinite(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v), 'Use an ISO date and time such as 2026-11-06T09:02:00Z');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const uuid = z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9._:-]+$/, 'Letters, digits and . _ : -');
const loc = { lat: z.number().min(-90).max(90).nullish().transform((v) => v ?? null), lng: z.number().min(-180).max(180).nullish().transform((v) => v ?? null), accuracyM: z.number().min(0).max(100000).nullish().transform((v) => v ?? null), mockLocation: z.boolean().default(false) };
const dataUrl = z.string().max(600_000).nullish().transform((v) => v || null);
const clean = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== '' && v !== undefined));
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason: z.string().trim().min(5).max(500) }).strict(), b ?? {});
export const parsePunch = (b, header) => parse(z.object({ siteId: id, punchType: z.enum(['IN', 'OUT']), deviceTime: iso, ...loc, deviceId: z.string().trim().max(80).nullish().transform((v) => v || null), clientUuid: uuid.optional(), selfie: dataUrl, offline: z.boolean().default(false), reason: z.string().trim().max(300).nullish().transform((v) => v || null), faceMatchScore: z.number().min(0).max(100).nullish().transform((v) => v ?? null) }).strict()
  .transform((v) => ({ ...v, clientUuid: v.clientUuid ?? header })).refine((v) => !!v.clientUuid, { message: 'Send an Idempotency-Key header (or clientUuid): the same one is the same punch', path: ['clientUuid'] }), b);
export const parseCrewPunch = (b) => parse(z.object({ crewId: id, punchType: z.enum(['IN', 'OUT']), deviceTime: iso, personIds: z.array(id).max(200).default([]), workerIds: z.array(id).max(200).default([]), photo: dataUrl, groupUuid: uuid, ...loc, deviceId: z.string().trim().max(80).nullish().transform((v) => v || null), offline: z.boolean().default(false) }).strict(), b);
export const parseKiosk = (b, header) => parse(z.object({ siteId: id, badge: z.string().trim().min(1).max(40), punchType: z.enum(['IN', 'OUT']), deviceTime: iso, selfie: dataUrl, ...loc, deviceId: z.string().trim().max(80).nullish().transform((v) => v || null), clientUuid: uuid.optional() }).strict()
  .transform((v) => ({ ...v, clientUuid: v.clientUuid ?? header })).refine((v) => !!v.clientUuid, { message: 'Send an Idempotency-Key header (or clientUuid)', path: ['clientUuid'] }), b);
export const parseDevicePunch = (b) => parse(z.object({ siteId: id, employeeCode: z.string().trim().min(1).max(40), punchType: z.enum(['IN', 'OUT']), deviceTime: iso, deviceSerial: z.string().trim().min(1).max(80), clientUuid: uuid, offline: z.boolean().default(false) }).strict(), b);
export const parseToday = (q) => parse(z.object({ siteId: id, date: day.optional() }).strict(), clean(q));
export const parsePunchList = (q) => parse(z.object({ siteId: id.optional(), date: day.optional(), personId: id.optional(), result: z.enum(['ACCEPTED', 'FLAGGED', 'REJECTED', 'PENDING']).optional(), limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional() }).strict(), clean(q));
export const parseAnomalyList = (q) => parse(z.object({ status: z.enum(['OPEN', 'PENDING_APPROVAL', 'ACCEPTED', 'REJECTED', 'ALL']).optional(), type: z.string().max(40).optional(), siteId: id.optional(), limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional() }).strict(), clean(q));
export const parseReview = (b) => parse(z.object({ decision: z.enum(['ACCEPT', 'REJECT']), note: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500), version: z.number().int().min(1).optional() }).strict(), b);
export const parseBulkReview = (b) => parse(z.object({ ids: z.array(id).min(1).max(100), decision: z.enum(['ACCEPT', 'REJECT']), note: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500) }).strict(), b);
export const parseReport = (q) => parse(z.object({ date: day.optional(), projectId: id.optional(), siteId: id.optional() }).strict(), clean(q));
export const parseSettings = (b) => parse(z.object({ selfieMode: z.enum(['NONE', 'OPTIONAL', 'REQUIRED']), flagAccuracyM: z.number().int().min(5).max(1000).nullish().transform((v) => v ?? null), rejectAccuracyM: z.number().int().min(10).max(5000).nullish().transform((v) => v ?? null), toleranceM: z.number().int().min(0).max(100).nullish().transform((v) => v ?? null), kioskEnabled: z.boolean().default(true), version: z.number().int().min(0).default(0) }).strict(), b);
