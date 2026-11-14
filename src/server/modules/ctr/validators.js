import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the contracts API (part 21.01 on). The services check every rule again.
export const id = z.coerce.number().int().min(1);
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
export const text = (max) => z.string().trim().max(max);
export const opt = (max) => z.string().trim().max(max).nullish().transform((v) => v || null);
export const oid = id.nullish().transform((v) => v ?? null);
const oday = day.nullish().transform((v) => v || null);
export const defined = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
export { z, parse };
export const parseId = (v) => parse(id, v);
export const parseReason = (b) => parse(z.object({ reason: text(1000).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});
export const TYPES = ['ITEM_RATE', 'LUMP_SUM', 'EPC', 'HAM', 'COST_PLUS', 'PERCENTAGE_RATE'];
const pct = z.number().min(0).max(100);
const rupees = z.number().min(0).max(1e13);
const payment = z.object({ billFrequency: z.enum(['MONTHLY', 'FORTNIGHTLY', 'MILESTONE', 'QUARTERLY']).default('MONTHLY'), certificationDays: z.number().int().min(0).max(365).default(0), paymentDays: z.number().int().min(0).max(365).default(0), minBillPaise: z.number().min(0).optional() }).strict();
const advance = z.object({ mobilisationPct: pct.default(0), machineryPct: pct.default(0), interestPct: pct.default(0), recoveryStartPct: pct.default(0), recoveryEndPct: pct.default(0), note: text(500).default('') }).strict();
const insurance = z.array(z.object({ kind: text(80).min(2), coverage: text(200).default(''), renewEvery: z.enum(['NONE', 'YEARLY']).default('YEARLY') }).strict()).max(20);
const security = z.object({ performancePct: pct.default(0), validityMonths: z.number().int().min(0).max(240).default(0), form: text(80).default('') }).strict();
const terms = {
  title: text(200).min(3), clientPartnerId: oid, contractNo: text(60).min(2), loaNo: opt(60), loaDate: oday, agreementNo: opt(60), agreementDate: oday, contractType: z.enum(TYPES), original: rupees, scopeSummary: opt(4000), startDate: oday, completionDate: oday, dlpMonths: z.number().int().min(0).max(120),
  paymentTerms: payment, retentionPct: pct, retentionCapPct: pct, advanceTerms: advance, pvcApplicable: z.boolean(), pvcRef: opt(120), ldRatePct: pct, ldBasis: z.enum(['PER_DAY', 'PER_WEEK', 'PER_MONTH']), ldCapPct: pct, bonusClause: opt(1000), insurance, security, disputeResolution: opt(1000),
};
export const parseContractCreate = (b) => parse(z.object({ projectId: id, siteId: oid, importClauses: z.boolean().default(true), ...Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, ['title', 'contractNo', 'contractType', 'original'].includes(k) ? v : v.optional()])) }).strict(), b ?? {});
export const parseContractUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const CATS = ['NOTICE', 'TIME_BAR', 'VARIATION', 'PAYMENT', 'TERMINATION', 'LD', 'PVC', 'DISPUTE', 'INSURANCE', 'SECURITY', 'OTHER'];
export const parseClause = (b) => parse(z.object({ clauseNo: text(30).min(1), title: text(200).min(2), category: z.enum(CATS), summary: text(4000).min(5, 'Give a plain-language summary'), textRef: opt(200), timeBarDays: z.number().int().min(0).max(3650).nullish().transform((v) => v ?? null), tags: opt(200) }).strict(), b ?? {});
export const parseClauseUpdate = (b) => defined(parse(z.object({ title: text(200).min(2).optional(), category: z.enum(CATS).optional(), summary: text(4000).min(5).optional(), textRef: opt(200).optional(), timeBarDays: z.number().int().min(0).max(3650).nullish().transform((v) => v ?? null).optional(), tags: opt(200).optional() }).strict(), b ?? {}));
const REC = ['NONE', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];
export const parseObligation = (b) => parse(z.object({ clauseId: oid, description: text(500).min(5), party: z.enum(['CONTRACTOR', 'CLIENT', 'CONSULTANT']).default('CONTRACTOR'), ownerUser: text(80).min(2), dueDate: day, recurrence: z.enum(REC).default('NONE'), remindDays: z.number().int().min(0).max(365).default(7) }).strict(), b ?? {});
export const parseObligationUpdate = (b) => defined(parse(z.object({ description: text(500).min(5).optional(), ownerUser: text(80).min(2).optional(), dueDate: day.optional(), recurrence: z.enum(REC).optional(), remindDays: z.number().int().min(0).max(365).optional(), party: z.enum(['CONTRACTOR', 'CLIENT', 'CONSULTANT']).optional() }).strict(), b ?? {}));
export const parseDone = (b) => parse(z.object({ note: text(1000).min(3, 'Say what was done'), doneOn: oday }).strict(), b ?? {});
export const parseMilestone = (b) => parse(z.object({ code: text(30).min(1), name: text(200).min(2), dueDate: oday, paymentLinked: z.boolean().default(false), amount: rupees.default(0), sortOrder: z.number().int().min(0).max(9999).default(0) }).strict(), b ?? {});
export const parseMilestoneUpdate = (b) => defined(parse(z.object({ name: text(200).min(2).optional(), dueDate: oday.optional(), paymentLinked: z.boolean().optional(), amount: rupees.optional(), sortOrder: z.number().int().min(0).max(9999).optional() }).strict(), b ?? {}));
export const parseAchieve = (b) => parse(z.object({ achievedOn: day, evidence: text(1000).min(3, 'Say what shows it is achieved') }).strict(), b ?? {});
const amTerms = z.object({ dlpMonths: z.number().int().min(0).max(120).optional(), retentionPct: pct.optional(), ldRatePct: pct.optional(), ldCapPct: pct.optional(), paymentTerms: payment.optional() }).strict();
export const parseAmendCreate = (b) => parse(z.object({ contractId: id, kind: z.enum(['AMENDMENT', 'SUPPLEMENTARY']).default('AMENDMENT'), description: text(2000).min(5), referenceNo: opt(60), signedDate: oday, valueChange: z.number().min(-1e13).max(1e13).default(0), newCompletion: oday, terms: amTerms.default({}) }).strict(), b ?? {});
export const parseAmendUpdate = (b) => defined(parse(z.object({ kind: z.enum(['AMENDMENT', 'SUPPLEMENTARY']).optional(), description: text(2000).min(5).optional(), referenceNo: opt(60).optional(), signedDate: oday.optional(), valueChange: z.number().min(-1e13).max(1e13).optional(), newCompletion: oday.optional(), terms: amTerms.optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseCalendarQ = (q) => parse(z.object({ projectId: id.optional(), contractId: id.optional(), from: day.optional(), to: day.optional(), owner: text(80).optional(), state: z.enum(['OPEN', 'OVERDUE', 'DUE_SOON', 'DONE', 'ALL']).optional() }).passthrough(), q ?? {});
export const parsePrefillQ = (q) => parse(z.object({ projectId: id }).passthrough(), q ?? {});
// securities (21.02)
const money = z.number().positive().max(1e13);
export const BG_TYPES = ['PERFORMANCE', 'ADVANCE', 'EMD', 'RETENTION', 'SECURITY_DEPOSIT', 'FINANCIAL', 'OTHER'];
const bgTerms = { bgNo: text(60).min(2), direction: z.enum(['GIVEN', 'RECEIVED']), bgType: z.enum(BG_TYPES), contractId: oid, partnerId: oid, advanceId: oid, bankId: oid, bankName: text(120).min(2), amount: money, issueDate: day, expiryDate: day, claimExpiry: oday, linkedType: z.enum(['CONTRACT', 'WORK_ORDER', 'PURCHASE_ORDER', 'TENDER', 'OTHER']).default('CONTRACT'), linkedId: oid, linkedRef: opt(80), marginPct: z.number().min(0).max(100).default(0), commissionPct: z.number().min(0).max(100).default(0) };
export const parseBgCreate = (b) => parse(z.object({ projectId: id, siteId: oid, ...bgTerms }).strict().refine((v) => v.expiryDate > v.issueDate, 'The expiry is not after the issue date').refine((v) => !v.claimExpiry || v.claimExpiry >= v.expiryDate, 'The claim period ends before the expiry'), b ?? {});
export const parseBgUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(bgTerms).filter(([k]) => !['direction'].includes(k)).map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseBgRequest = (b) => parse(z.object({ kind: z.enum(['EXTEND', 'REDUCE', 'RELEASE', 'INVOKE']), newExpiry: oday, newClaimExpiry: oday, newAmount: money.nullish().transform((v) => v ?? null), referenceNo: opt(80), reason: text(1000).min(5, 'Say why (at least 5 characters)') }).strict(), b ?? {});
export const parseBgDecide = (b) => parse(z.object({ approve: z.boolean(), note: opt(500) }).strict(), b ?? {});
export const parseLetterQ = (q) => parse(z.object({ eventId: id.optional() }).passthrough(), q ?? {});
export const POLICY_TYPES = ['CAR', 'EAR', 'WORKMEN_COMP', 'THIRD_PARTY', 'VEHICLE', 'MARINE', 'FIRE', 'OTHER'];
const insTerms = { contractId: oid, policyType: z.enum(POLICY_TYPES), policyNo: text(60).min(2), insurer: text(120).min(2), sumInsured: money, premium: z.number().min(0).max(1e12).default(0), validFrom: day, validTo: day, coverage: opt(1000) };
export const parseInsCreate = (b) => parse(z.object({ projectId: id, siteId: oid, ...insTerms }).strict().refine((v) => v.validTo > v.validFrom, 'The policy ends before it starts'), b ?? {});
export const parseInsUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(insTerms).map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseClaim = (b) => parse(z.object({ claimNo: text(60).min(2), incidentRef: opt(80), incidentDate: day, description: text(1000).min(5), claimed: money }).strict(), b ?? {});
export const parseClaimUpdate = (b) => parse(z.object({ status: z.enum(['INTIMATED', 'SURVEY', 'SETTLED', 'REJECTED', 'CLOSED']), settled: z.number().min(0).max(1e13).default(0), settledOn: oday }).strict(), b ?? {});
export const parseLimit = (b) => parse(z.object({ bankName: text(120).min(2), limitKind: z.enum(['BG', 'LC', 'FUND_BASED', 'OTHER']).default('BG'), limit: money, validTo: oday, marginPct: z.number().min(0).max(100).default(0) }).strict(), b ?? {});
export const parseExposureQ = (q) => parse(z.object({ projectId: id.optional(), contractId: id.optional(), within: z.coerce.number().int().min(1).max(730).optional(), state: text(20).optional() }).passthrough(), q ?? {});
