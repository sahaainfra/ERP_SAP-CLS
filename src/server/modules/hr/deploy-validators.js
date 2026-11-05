import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the deployment API (part 07.03). The service checks the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optId = id.nullish().transform((v) => v ?? null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(500);
const flag = z.coerce.boolean();
const person = z.enum(['EMPLOYEE', 'WORKER']);
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});
export const parseListQuery = (q) => q;

const depBody = {
  personType: person.default('EMPLOYEE'), personId: id, projectId: id, siteId: optId, crewId: optId, siteRole: optText(80), accessRole: optText(20), fromDate: day, toDate: day.nullish().transform((v) => v || null),
  isPrimary: z.boolean().default(true), defaultWbsId: optId, defaultCostCodeId: optId,
};
export const parseDepCreate = (b) => parse(z.object({ ...depBody, remarks: optText(500), submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseDepUpdate = (b) => parse(z.object({ ...depBody, version: z.number().int().min(1) }).strict(), b);
export const parseDepAmend = (b) => parse(z.object({ reason, changes: z.object({ projectId: id, siteId: optId, crewId: optId, siteRole: optText(80), accessRole: optText(20), fromDate: day, toDate: day.nullish().transform((v) => v || null), isPrimary: z.boolean(), defaultCostCodeId: optId }).partial().strict().optional() }).strict(), b);
export const parseMove = (b) => parse(z.object({ crewId: optId, comment: text(500).optional() }).strict(), b ?? {});
export const parseDepPlanCheck = (q) => parse(z.object({ personId: id, projectId: id, siteId: optId, date: day.optional() }).strict(), { ...q, siteId: q?.siteId || undefined });
export const parseEligibility = (q) => parse(z.object({ personType: person.default('EMPLOYEE'), personId: id, siteId: id, date: day.optional() }).strict(), q);
export const parseBoard = (q) => parse(z.object({ date: day.optional(), projectId: id.optional(), siteId: id.optional() }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v !== undefined)));
export const parseSitePlan = (b) => parse(z.object({ siteId: id, designationId: id, planned: z.number().int().min(0).max(100000), validFrom: day }).strict(), b);
export const parseSitePlanQuery = (q) => parse(z.object({ siteId: id.optional(), projectId: id.optional() }).strict(), Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v !== undefined)));

const crewBody = { siteId: id, code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dots, dashes and underscores'), name: text(80).min(2), trade: optText(60), supervisorId: optId, labourContractorId: optId };
export const parseCrewCreate = (b) => parse(z.object(crewBody).strict(), b);
export const parseCrewUpdate = (b) => parse(z.object({ ...crewBody, active: z.boolean().default(true), version: z.number().int().min(1) }).strict(), b);
export const parseMember = (b) => parse(z.object({ personType: person.default('EMPLOYEE'), personId: id, fromDate: day, toDate: day.nullish().transform((v) => v || null) }).strict(), b);
export const parseMemberEnd = (b) => parse(z.object({ toDate: day }).strict(), b);

const trfBody = { employeeId: id, kind: z.enum(['TRANSFER', 'SECONDMENT']).default('TRANSFER'), toProjectId: id, toSiteId: optId, toCrewId: optId, siteRole: optText(80), relieveDate: day, joinDate: day, returnDate: day.nullish().transform((v) => v || null), reason, travelRequired: flag.default(false), accommodationRequired: flag.default(false) };
export const parseTrfCreate = (b) => parse(z.object({ ...trfBody, submit: z.boolean().default(false), comment: text(500).optional() }).strict(), b);
export const parseTrfUpdate = (b) => parse(z.object({ ...trfBody, version: z.number().int().min(1) }).strict(), b);
export const parseTrfAmend = (b) => parse(z.object({ reason }).strict(), b);
export const parseHandover = (b) => parse(z.object({ items: z.array(z.object({ code: z.string().trim().min(1).max(30), done: z.boolean(), note: optText(300) }).strict()).min(1).max(40) }).strict(), b);
