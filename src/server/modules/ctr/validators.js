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
// work orders (21.03)
export const WO_TYPES = ['ITEM_RATE', 'LABOUR_RATE', 'LUMP_SUM'];
const woItem = z.object({ itemKind: z.enum(['BOQ', 'CUSTOM', 'MILESTONE']).default('BOQ'), boqLineId: oid, description: text(300).min(2), uom: opt(20), qty: z.number().min(0).max(1e10), rate: z.number().min(0).max(1e10), wbsId: oid, clientBoqLineId: oid, dueDate: oday }).strict();
const woFree = z.object({ itemId: id, uom: opt(20), norm: z.number().min(0).max(1e8), wastagePct: pct.default(0), chargeableRate: z.number().min(0).max(1e10).default(0) }).strict();
const woTerms = { woNo: text(60).min(2), woType: z.enum(WO_TYPES), contractId: oid, subcontractorId: id, workPackageId: oid, csId: oid, selectionKind: z.enum(['CS', 'NEGOTIATED']).default('NEGOTIATED'), justification: opt(1000), title: text(200).min(3), scopeText: opt(4000), startDate: day, endDate: day, retentionPct: pct.default(0), sdPct: pct.default(0), advancePct: pct.default(0), advanceRecoveryPct: pct.default(0), tdsSection: opt(20), gstMode: z.enum(['FORWARD', 'RCM', 'EXEMPT']).default('FORWARD'), gstPct: pct.default(18), paymentDays: z.number().int().min(0).max(365).default(30), ldPct: pct.default(0), ldCapPct: pct.default(0), safetyPenalty: z.number().min(0).max(1e10).default(0), terms: z.record(z.string(), z.string().max(500)).default({}), items: z.array(woItem).max(500).default([]), freeIssue: z.array(woFree).max(100).default([]), value: z.number().min(0).max(1e13).optional() };
export const parseWoCreate = (b) => parse(z.object({ projectId: id, siteId: oid, ...woTerms }).strict().refine((v) => v.endDate >= v.startDate, 'The work order ends before it starts'), b ?? {});
export const parseWoUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(woTerms).map(([k, v]) => [k, k === 'items' ? z.array(woItem).max(500).optional() : k === 'freeIssue' ? z.array(woFree).max(100).optional() : k === 'terms' ? z.record(z.string(), z.string().max(500)).optional() : v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseWoAmend = (b) => parse(z.object({ description: text(2000).min(5), newEndDate: oday, changes: z.array(z.union([z.object({ lineNo: z.number().int().min(1), qty: z.number().min(0).max(1e10).optional(), rate: z.number().min(0).max(1e10).optional() }).strict(), z.object({ add: woItem }).strict()])).min(0).max(200).default([]) }).strict(), b ?? {});
export const parseWoAccept = (b) => parse(z.object({ acceptedBy: text(120).min(2), reference: opt(80) }).strict(), b ?? {});
export const parseWoClose = (b) => parse(z.object({ finalBillRef: text(80).min(2), note: opt(500) }).strict(), b ?? {});
export const parseWoProgress = (b) => parse(z.object({ lines: z.array(z.object({ lineNo: z.number().int().min(1), executed: z.number().min(0), billed: z.number().min(0) }).strict()).min(1).max(500) }).strict(), b ?? {});
export const parseMarginQ = (q) => parse(z.object({ projectId: id.optional(), woId: id.optional(), negativeOnly: z.coerce.boolean().optional() }).passthrough(), q ?? {});
// subcontractor workspace (21.04)
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-12');
export const SUB_ITEMS = ['CLRA', 'PF', 'ESI', 'WAGE_REG', 'WC_INSURANCE', 'GST_RETURN', 'BOCW'];
export const parseSubOpen = (b) => parse(z.object({ period, subcontractorId: id.optional(), projectId: id.optional() }).strict(), b ?? {});
export const parseSubItems = (b) => parse(z.object({ items: z.array(z.object({ code: z.enum(SUB_ITEMS), status: z.enum(['OK', 'MISSING', 'NA']), ref: opt(80), validUntil: oday, note: opt(300) }).strict()).min(1).max(20), rowVersion: z.number().int().optional() }).strict(), b ?? {});
export const parseSubVerify = (b) => parse(z.object({ approve: z.boolean(), note: opt(500) }).strict().refine((v) => v.approve || (v.note ?? '').length >= 5, 'Say why it is returned (at least 5 characters)'), b ?? {});
export const parseSubListQ = (q) => parse(z.object({ projectId: id.optional(), subcontractorId: id.optional(), period: period.optional(), state: z.enum(['OPEN', 'SUBMITTED', 'VERIFIED', 'RETURNED', 'HOLD']).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() }).passthrough(), q ?? {});
export const parseWaiverCreate = (b) => parse(z.object({ complianceId: id, items: z.array(z.enum(SUB_ITEMS)).min(1).max(10), reason: text(1000).min(10, 'Say why (at least 10 characters)'), validUntil: day }).strict(), b ?? {});
export const parseWaiverUpdate = (b) => defined(parse(z.object({ items: z.array(z.enum(SUB_ITEMS)).min(1).max(10).optional(), reason: text(1000).min(10).optional(), validUntil: day.optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseManpower = (b) => parse(z.object({ subcontractorId: id, projectId: id, tradeCode: text(40).min(2), committed: z.number().int().min(0).max(100000), fromDate: day, toDate: oday }).strict(), b ?? {});
export const parseStrengthQ = (q) => parse(z.object({ projectId: id, subcontractorId: id.optional(), from: day.optional(), to: day.optional() }).passthrough(), q ?? {});
export const parseWorkspaceQ = (q) => parse(z.object({ subcontractorId: id, projectId: id }).passthrough(), q ?? {});
export const parseRatingRun = (b) => parse(z.object({ period, projectId: id.optional(), subcontractorId: id.optional() }).strict(), b ?? {});
export const parseRatingQ = (q) => parse(z.object({ projectId: id.optional(), subcontractorId: id.optional(), period: period.optional() }).passthrough(), q ?? {});
export const parseGateQ = (q) => parse(z.object({ subcontractorId: id, projectId: id }).passthrough(), q ?? {});
// change and variation management (21.05)
export const CR_SOURCES = ['CLIENT_INSTRUCTION', 'RFI', 'DESIGN_CHANGE', 'INTERNAL', 'QTY_DEVIATION', 'SUBCONTRACT'];
const crBase = { kind: z.enum(['CLIENT', 'SUBCONTRACT']).default('CLIENT'), contractId: oid, workOrderId: oid, originType: z.enum(CR_SOURCES), originRef: opt(120), originId: oid, title: text(200).min(3), description: text(4000).min(10, 'Describe the change (at least 10 characters)') };
export const parseCrCreate = (b) => parse(z.object({ projectId: id, siteId: oid, ...crBase }).strict(), b ?? {});
export const parseCrUpdate = (b) => defined(parse(z.object({ ...Object.fromEntries(Object.entries(crBase).filter(([k]) => k !== 'kind').map(([k, v]) => [k, v.optional()])), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseCrReview = (b) => parse(z.object({ review: text(4000).min(10, 'Give the technical review (scope, drawings, method; at least 10 characters)') }).strict(), b ?? {});
export const parseCrEvaluate = (b) => parse(z.object({ items: z.array(z.object({ boqLineId: oid, woLineNo: z.number().int().min(1).nullish().transform((v) => v ?? null), description: text(300).min(2), uom: opt(20), qtyChange: z.number().min(-1e10).max(1e10), rate: z.number().min(0).max(1e10).nullish().transform((v) => v ?? null), basisKind: z.enum(['CONTRACT', 'SCHEDULE', 'ANALYSIS']), basisRef: opt(200), analysisId: oid, wbsId: oid, costCodeId: oid }).strict()).min(1).max(200), timeDays: z.number().int().min(0).max(3650).default(0), notes: opt(2000), value: z.number().optional() }).strict(), b ?? {});
export const parseCrToClient = (b) => parse(z.object({ submittedOn: day, clientRef: opt(120) }).strict(), b ?? {});
export const parseCrResponse = (b) => parse(z.object({ response: z.enum(['APPROVED', 'REJECTED', 'DISPUTED']), responseOn: day, clientRef: opt(120), approvedValue: z.number().min(0).max(1e13).nullish().transform((v) => v ?? null), approvedDays: z.number().int().min(0).max(3650).nullish().transform((v) => v ?? null), note: opt(1000) }).strict(), b ?? {});
export const parseVoUpdate = (b) => defined(parse(z.object({ title: text(200).min(3).optional(), clientRef: opt(120).optional(), approvedValue: z.number().min(0).max(1e13).optional(), approvedDays: z.number().int().min(0).max(3650).optional(), approvedOn: oday.optional(), rowVersion: z.number().int().optional() }).strict(), b ?? {}));
export const parseVarSummaryQ = (q) => parse(z.object({ projectId: id.optional(), kind: z.enum(['CLIENT', 'SUBCONTRACT']).optional() }).passthrough(), q ?? {});
export const parseGateVoQ = (q) => parse(z.object({ projectId: id, voItemId: id.optional(), voNo: text(60).optional() }).passthrough(), q ?? {});
