import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { BID_TYPES, CRITERIA, IMPACTS, PORTALS, RESULTS, SCORE_KEYS, TEAM_KINDS } from './tender-constants.js';

// Inputs of the tender API (part 08.02). The service checks the rules again (the authority, the dates, the stage, the score) and recomputes the bid capacity and the score.
const id = z.coerce.number().int().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const dateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, 'Use a date and time such as 2026-12-01T15:00');
const text = (max) => z.string().trim().max(max);
const optText = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
const reason = z.string().trim().min(5, 'Say why (at least 5 characters)').max(1000);
const money = z.number().min(0).max(1_000_000_000_000);
const clean = (q) => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== '' && v !== undefined));
const version = z.number().int().min(1);
const keys = (o) => /** @type {[string, ...string[]]} */ (Object.keys(o));
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason }).strict(), b ?? {});
export const parseSubmit = (b) => parse(z.object({ comment: text(500).optional() }).strict(), b ?? {});
const tender = {
  clientPartnerId: id, referenceNo: optText(80), portal: z.enum(keys(PORTALS)), portalName: optText(80), nameOfWork: text(300).min(5, 'Give the name of the work'), location: optText(120), region: optText(40),
  estCost: money, emd: money, tenderFee: money, bidType: z.enum(keys(BID_TYPES)), periodMonths: z.number().int().min(1).max(240), publishDate: day.nullish().transform((v) => v || null), prebidDate: day.nullish().transform((v) => v || null),
  submissionAt: dateTime.nullish().transform((v) => v || null), openingAt: dateTime.nullish().transform((v) => v || null), owner: text(60).min(2),
};
const optional = (o) => Object.fromEntries(Object.entries(o).map(([k, s]) => [k, s.optional()]));
export const parseTenderCreate = (b) => parse(z.object({ ...tender, opportunityId: id.optional(), portal: tender.portal.default('OTHER'), bidType: tender.bidType.default('ITEM_RATE'), periodMonths: tender.periodMonths.default(12), estCost: money.default(0), emd: money.default(0), tenderFee: money.default(0), owner: tender.owner.optional(), bcTurnover: money.optional(), bcCommitments: money.optional(), bcFactor: z.number().int().min(1).max(10).optional(), submit: z.boolean().default(false) }).strict(), b);
export const parseTenderUpdate = (b) => parse(z.object({ ...optional(tender), version }).strict(), b);
export const parseTenderAmend = (b) => parse(z.object({ ...optional(tender), version, reason }).strict(), b);
export const parseTenderTrack = (b) => parse(z.object({ owner: text(60).min(2).optional(), bcTurnover: money.nullable().optional(), bcCommitments: money.nullable().optional(), bcFactor: z.number().int().min(1).max(10).optional(), version }).strict(), b);
export const parseEligibilityAdd = (b) => parse(z.object({ criterion: z.enum(keys(CRITERIA)), title: text(160).min(3), requirementText: optText(300), requirement: money.nullish(), our: money.nullish(), ourText: optText(300), notes: optText(300) }).strict(), b);
export const parseEligibilityUpdate = (b) => parse(z.object({ title: text(160).min(3).optional(), requirementText: optText(300).optional(), requirement: money.nullable().optional(), our: money.nullable().optional(), ourText: optText(300).optional(), notes: optText(300).optional(), result: z.enum(keys(RESULTS)).optional(), waiveReason: text(300).optional(), version }).strict(), b);
export const parseAddendum = (b) => parse(z.object({ kind: z.enum(['ADDENDUM', 'CORRIGENDUM']).default('ADDENDUM'), date: day, summary: text(1000).min(5, 'Summarise the addendum'), impact: z.enum(keys(IMPACTS)).default('NONE'), impactNote: optText(500), newPrebidDate: day.optional(), newSubmissionAt: dateTime.optional(), newOpeningAt: dateTime.optional() }).strict(), b);
export const parseQueryAdd = (b) => parse(z.object({ clauseRef: optText(80), query: text(2000).min(5, 'Write the query'), addendumNumber: z.number().int().min(1).optional() }).strict(), b);
export const parseQueryUpdate = (b) => parse(z.object({ clauseRef: optText(80).optional(), query: text(2000).min(5).optional(), version }).strict(), b);
export const parseQueryResponse = (b) => parse(z.object({ response: text(3000).min(3, 'Write the clarification received'), date: day }).strict(), b);
export const parseTeamTask = (b) => parse(z.object({ kind: z.enum(keys(TEAM_KINDS)), title: text(160).min(3), assignee: text(60).min(2), dueDate: day, notes: optText(500) }).strict(), b);
export const parseDocument = (b) => parse(z.object({ title: text(160).min(3), kind: z.enum(['NIT', 'BOQ', 'CONDITIONS', 'DRAWINGS', 'ADDENDUM', 'OTHER']).default('OTHER') }).strict(), b);
const scores = z.object(Object.fromEntries(Object.keys(SCORE_KEYS).map((k) => [k, z.object({ score: z.number().int().min(1).max(5), note: optText(300) }).strict().optional()]))).strict();
export const parseDecisionCreate = (b) => parse(z.object({ tenderId: id, scores, decision: z.enum(['BID', 'NO_BID']), reasons: optText(1000), submit: z.boolean().default(false) }).strict(), b);
export const parseDecisionUpdate = (b) => parse(z.object({ scores: scores.optional(), decision: z.enum(['BID', 'NO_BID']).optional(), reasons: optText(1000).optional(), version }).strict(), b);
export const parseDecisionAmend = (b) => parse(z.object({ scores: scores.optional(), decision: z.enum(['BID', 'NO_BID']).optional(), reasons: optText(1000).optional(), version, reason }).strict(), b);
export const parseCalendar = (q) => parse(z.object({ from: day.optional(), to: day.optional() }).strict(), clean(q));
