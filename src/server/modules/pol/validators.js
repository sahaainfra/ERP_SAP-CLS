import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the policy API (part 05.05). The service checks the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const text = (max) => z.string().trim().max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
export const CATEGORIES = ['HR', 'FINANCE', 'PROCUREMENT', 'HSE', 'QUALITY', 'IT', 'CONDUCT', 'OTHER'];
export const parseId = (v) => parse(id, v);
const applicability = z.object({ all: z.boolean().default(false), departments: z.array(id).max(100).default([]), roles: z.array(z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,19}$/)).max(60).default([]), sites: z.array(id).max(200).default([]), projects: z.array(id).max(100).default([]) }).strict();
const quiz = z.array(z.object({ q: z.string().trim().min(3).max(300), options: z.array(z.string().trim().min(1).max(160)).min(2).max(5), correct: z.number().int().min(0).max(4) }).strict().refine((o) => o.correct < o.options.length, { message: 'The right answer must be one of the options', path: ['correct'] })).max(20);
const content = {
  body: z.string().max(400_000), changeSummary: text(500).default(''), attachments: z.array(id).max(20).default([]), quiz: quiz.default([]), passMark: z.number().int().min(1).max(100).default(100), applicability: applicability.default({ all: false, departments: [], roles: [], sites: [], projects: [] }),
  effectiveFrom: date.nullable().optional(), reviewDue: date.nullable().optional(), ackDueDays: z.number().int().min(1).max(365).default(14),
};
export const parsePolicyCreate = (b) => parse(z.object({ title: text(160).min(3, 'Give the policy a title'), category: z.enum(CATEGORIES), departmentId: id.nullable().optional(), ...content }).strict(), b);
export const parseVersionUpdate = (b) => parse(z.object({ title: text(160).min(3).optional(), category: z.enum(CATEGORIES).optional(), departmentId: id.nullable().optional(), ...content, version: z.number().int().min(1) }).strict(), b);
export const parsePolicyList = (q) => parse(z.object({ q: text(80).optional(), category: z.enum(CATEGORIES).optional(), status: z.enum(['DRAFT', 'PUBLISHED', 'ACTIVE', 'UNDER_REVISION', 'ARCHIVED']).optional(), owner: text(60).optional(), review: z.enum(['due', 'overdue']).optional(), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseCompare = (q) => parse(z.object({ from: id, to: id }).strict(), q);
export const parseArchive = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
export const parsePreview = (b) => parse(z.object({ applicability }).strict(), b);
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});
export const parseAcknowledge = (b) => parse(z.object({ versionId: id, answers: z.array(z.number().int().min(0).max(4)).max(20).default([]) }).strict(), b);
const artifact = z.enum(['CONTROL_POINT', 'APPROVAL_RULE', 'ALERT_RULE']);
export const parseRequirement = (b) => parse(z.object({ versionId: id, clauseRef: text(40).min(1, 'Name the clause, for example 4.2'), requirementText: text(1000).min(5, 'Write the requirement'), artifactType: artifact, config: z.record(z.string(), z.any()).default({}) }).strict(), b);
export const parseRequirementUpdate = (b) => parse(z.object({ clauseRef: text(40).min(1).optional(), requirementText: text(1000).min(5).optional(), artifactType: artifact.optional(), config: z.record(z.string(), z.any()).optional() }).strict(), b);
export const parseRequirementList = (q) => parse(z.object({ versionId: id.optional(), status: z.enum(['TAGGED', 'DRAFTED', 'DISMISSED']).optional() }).strict(), q);
export const parseDraftList = (q) => parse(z.object({ type: artifact.optional(), state: z.enum(['DRAFT', 'PENDING', 'ACTIVE', 'GONE']).optional(), q: text(80).optional() }).strict(), q);
export const parseDismiss = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
export const parseAckReport = (q) => parse(z.object({ versionId: id.optional(), status: z.enum(['PENDING', 'ACKNOWLEDGED', 'OVERDUE']).optional() }).strict(), q);
