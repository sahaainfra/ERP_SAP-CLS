import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { ACCOUNT_TYPES, CONTROL_KINDS, DIMENSIONS, NATURES, REQUIREMENTS, SCHEDULE3, SOURCES } from './service.js';

// Inputs of the finance master API (part 06.05). The service checks the rules again (natures, control accounts, postings, duplicates); these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-12-01');
const why = z.string().trim().min(10, 'Say why (at least 10 characters)').max(500);
const code = (re, hint) => z.string().trim().toUpperCase().regex(re, hint);
const accountCode = code(/^[0-9A-Z][0-9A-Z.-]{1,19}$/, 'An account code has 2 to 20 letters, digits, dots or dashes');
const name = z.string().trim().min(2, 'Give a name').max(120);
const version = z.number().int().min(1);
const dims = z.partialRecord(z.enum(DIMENSIONS), z.enum(REQUIREMENTS));
const accountBody = { code: accountCode, name, groupId: id, type: z.enum(ACCOUNT_TYPES), normalBalance: z.enum(['DR', 'CR']), currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('INR'), isControl: z.boolean().default(false), controlKind: z.enum(Object.keys(CONTROL_KINDS)).nullable().default(null), manualPosting: z.boolean().default(true), dimensions: dims.default({}), contraReason: z.string().trim().max(200).optional(), reason: why };
const partial = (shape) => z.object(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, (/** @type {any} */ (v)).removeDefault?.()?.optional?.() ?? v.optional()])));
export const parseId = (v) => parse(id, v);
export const parseChart = (q) => parse(z.object({ q: z.string().trim().max(60).optional(), status: z.enum(['ACTIVE', 'BLOCKED']).optional(), type: z.enum(ACCOUNT_TYPES).optional(), control: z.enum(['yes', 'no']).optional() }).strict(), q);
export const parseGroupCreate = (b) => parse(z.object({ code: code(/^[0-9A-Z][0-9A-Z.-]{0,19}$/, 'A group code has up to 20 letters, digits, dots or dashes'), name, parentId: id, nature: z.enum(NATURES), schedule3: z.enum(SCHEDULE3.map((s) => s.code)).nullable().default(null), sortOrder: z.number().int().min(0).max(9999).default(0), reason: why }).strict(), b);
export const parseGroupUpdate = (b) => parse(z.object({ name: name.optional(), parentId: id.optional(), schedule3: z.enum(SCHEDULE3.map((s) => s.code)).nullable().optional(), reason: why, version }).strict(), b);
export const parseAccountCreate = (b) => parse(z.object(accountBody).strict(), b);
export const parseAccountUpdate = (b) => parse(partial(accountBody).extend({ reason: why, version }).strict(), b);
export const parseBlock = (b) => parse(z.object({ block: z.boolean(), reason: why }).strict(), b);
export const parseReason = (b) => parse(z.object({ reason: why }).strict(), b);
export const parseDimensionRules = (b) => parse(z.object({ rules: z.array(z.object({ dimension: z.enum(DIMENSIONS), requirement: z.enum(REQUIREMENTS) }).strict()).max(DIMENSIONS.length), reason: why, version: version.optional() }).strict(), b);
export const parseRuleList = (q) => parse(z.object({ accountId: id.optional() }).strict(), q);
const headCode = code(/^\d{1,2}(\.\d{1,3}){0,3}$/, 'A cost head is numbered 1, 1.1, 1.1.2 ...');
export const parseHeadCreate = (b) => parse(z.object({ code: headCode, name, parentId: id.nullable().default(null), accountId: id.nullable().default(null), reason: why }).strict(), b);
export const parseHeadUpdate = (b) => parse(z.object({ name: name.optional(), accountId: id.nullable().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), reason: why, version }).strict(), b);
const costCode = code(/^[A-Z0-9][A-Z0-9.-]{1,19}$/, 'A cost code has 2 to 20 letters, digits, dots or dashes, for example MAT-CEM');
export const parseCodeCreate = (b) => parse(z.object({ code: costCode, name, costHeadId: id, uom: z.string().trim().toUpperCase().max(10).nullable().default(null), reason: why }).strict(), b);
export const parseCodeUpdate = (b) => parse(z.object({ name: name.optional(), costHeadId: id.optional(), uom: z.string().trim().toUpperCase().max(10).nullable().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), reason: why, version }).strict(), b);
export const parseMapping = (b) => parse(z.object({ rows: z.array(z.object({ categoryId: id, inventoryAccountId: id.nullable().default(null), expenseAccountId: id, costCodeId: id.nullable().default(null) }).strict()).min(1).max(500), effectiveFrom: date.optional(), reason: why }).strict(), b);
export const parseChangeList = (q) => parse(z.object({ status: z.enum(['PENDING', 'RETURNED', 'APPLIED', 'REJECTED', 'CANCELLED']).optional(), entity: z.enum(['GROUP', 'ACCOUNT', 'COST_HEAD', 'COST_CODE', 'MAPPING']).optional() }).strict(), q);
const dimValue = z.union([z.coerce.number().int().min(1), z.string().trim().min(1).max(40)]);
export const parsePosting = (b) => parse(z.object({ accountId: id.optional(), accountCode: z.string().trim().max(20).optional(), source: z.enum(SOURCES).default('MANUAL'), dimensions: z.record(z.string().max(20), dimValue.nullable()).default({}) }).strict().refine((x) => x.accountId || x.accountCode, 'Give the account'), b);
const importRows = z.array(z.object({ name: z.string().trim().max(160), parent: z.string().trim().max(120).default(''), code: z.string().trim().toUpperCase().max(20).optional() }).strip()).min(1).max(2000);
export const parseImportPreview = (b) => parse(z.object({ format: z.enum(['TALLY', 'GENERIC']).default('TALLY'), rows: importRows }).strict(), b);
export const parseImportSubmit = (b) => parse(z.object({ format: z.enum(['TALLY', 'GENERIC']).default('TALLY'), rows: importRows, reason: why }).strict(), b);

// ---- part 23.01: journals, recurring journals, the ledger and the trial balance ----
const amount = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'An amount such as 1500.50')]).nullable().optional();
const ref = z.coerce.number().int().min(1).nullable().optional();
const jLine = z.object({ accountId: id, debit: amount, credit: amount, narration: z.string().trim().max(300).nullable().optional(), branchId: ref, projectId: ref, siteId: ref, wbsId: ref, costCentreId: ref, profitCentreId: ref, departmentId: ref, costCodeId: ref, partnerId: ref, employeeId: ref, equipmentId: ref }).strict();
const vType = z.enum(['JV', 'PV', 'RV', 'CV', 'PJ', 'SJ', 'DN', 'CN', 'OB']);
const narration = z.string().trim().min(3, 'Say what the journal is for').max(500);
export const parseJournalCreate = (b) => parse(z.object({ voucherType: vType.default('JV'), voucherDate: date, kind: z.enum(['MANUAL', 'ACCRUAL', 'OPENING']).default('MANUAL'), narration, autoReverseOn: date.nullable().optional(), lines: z.array(jLine).min(1).max(500), total: amount }).strict(), b);
export const parseJournalUpdate = (b) => parse(z.object({ voucherType: vType.optional(), voucherDate: date.optional(), narration: narration.optional(), autoReverseOn: date.nullable().optional(), lines: z.array(jLine).min(1).max(500).optional(), total: amount, version }).strict(), b);
export const parseJournalCheck = (b) => parse(z.object({ kind: z.enum(['MANUAL', 'ACCRUAL', 'OPENING']).default('MANUAL'), lines: z.array(jLine).max(500) }).strict(), b);
export const parseJournalReason = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500) }).strict(), b);
export const parseJournalReverse = (b) => parse(z.object({ date: date.optional(), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
export const parseJournalImport = (b) => parse(z.object({ rows: z.array(z.object({ ref: z.union([z.string(), z.number()]), voucherType: vType.optional(), voucherDate: date, narration: z.string().trim().max(500).optional(), accountCode: z.union([z.string(), z.number()]), debit: amount, credit: amount, projectId: ref, siteId: ref, costCentreId: ref, branchId: ref }).strict()).min(1).max(5000) }).strict(), b);
export const parseRecurring = (b) => parse(z.object({ name: z.string().trim().min(3).max(120), voucherType: z.enum(['JV', 'PV', 'RV', 'CV', 'PJ', 'SJ', 'DN', 'CN']).default('JV'), frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']), nextRunOn: date, endOn: date.nullable().optional(), narration, lines: z.array(jLine).min(2).max(200), version: version.optional() }).strict(), b);
export const parseRecurringStatus = (b) => parse(z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']), reason: z.string().trim().min(5).max(300) }).strict(), b);
const dimQ = { branchId: ref, projectId: ref, siteId: ref, wbsId: ref, costCentreId: ref, profitCentreId: ref, departmentId: ref, costCodeId: ref, partnerId: ref, employeeId: ref, equipmentId: ref };
export const parseLedger = (q) => parse(z.object({ accountId: id, from: date.optional(), to: date.optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(500).optional(), ...dimQ }).strict(), q);
export const parseTrialBalance = (q) => parse(z.object({ asOf: date.optional(), from: date.optional(), ...dimQ }).strict(), q);
export const parseCarryForward = (b) => parse(z.object({ fyId: id }).strict(), b);

// ---- part 23.02: the posting engine ----
const ruleLine = z.object({ side: z.enum(['DR', 'CR']), account: z.string().trim().min(2).max(20), amount: z.string().trim().min(1).max(300), dims: z.record(z.string(), z.string().trim().max(60)).optional(), narration: z.string().trim().max(200).optional() }).strict();
const ruleCond = z.object({ field: z.string().trim().min(1).max(60), op: z.enum(['eq', 'ne', 'in', 'gt', 'gte', 'lt', 'lte', 'empty', 'notempty']), value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional() }).strict();
const ruleBody = { name: z.string().trim().min(3).max(160), eventType: z.string().trim().min(3).max(60), action: z.enum(['POST', 'REVERSE']).default('POST'), reversesEvent: z.string().trim().max(60).nullable().optional(), priority: z.coerce.number().int().min(1).max(999).default(100), conditions: z.array(ruleCond).max(10).default([]), lines: z.array(ruleLine).max(20).default([]), narration: z.string().trim().max(200).default(''), voucherType: z.enum(['JV', 'PV', 'RV', 'CV', 'PJ', 'SJ', 'DN', 'CN']).default('JV'), effectiveFrom: date, reason: z.string().trim().min(5, 'Say why the rule changes (at least 5 characters)').max(500) };
export const parseRulePropose = (b) => parse(z.object({ ...ruleBody, ruleCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, 'A rule code of 2 to 24 letters, digits or dashes').optional(), backdate: z.boolean().optional() }).strict(), b);
export const parseRuleUpdate = (b) => parse(z.object({ name: ruleBody.name.optional(), action: z.enum(['POST', 'REVERSE']).optional(), reversesEvent: z.string().trim().max(60).nullable().optional(), priority: z.coerce.number().int().min(1).max(999).optional(), conditions: z.array(ruleCond).max(10).optional(), lines: z.array(ruleLine).max(20).optional(), narration: z.string().trim().max(200).optional(), voucherType: z.enum(['JV', 'PV', 'RV', 'CV', 'PJ', 'SJ', 'DN', 'CN']).optional(), effectiveFrom: date.optional(), reason: z.string().trim().min(5).max(500).optional(), version }).strict(), b);
export const parseRuleTest = (b) => parse(z.object({ ruleId: id.optional(), rule: z.object({ action: z.enum(['POST', 'REVERSE']).optional(), reversesEvent: z.string().max(60).nullable().optional(), conditions: z.array(ruleCond).max(10).optional(), lines: z.array(ruleLine).max(20).optional(), narration: z.string().max(200).optional(), voucherType: z.string().max(2).optional() }).optional(), eventType: z.string().trim().max(60).optional(), data: z.record(z.string(), z.any()).optional(), outboxId: id.optional() }).strict(), b);
export const parseSamples = (q) => parse(z.object({ eventType: z.string().trim().min(3).max(60) }).strict(), q);
export const parseResolve = (b) => parse(z.object({ outcome: z.enum(['RESOLVED', 'IGNORED']), journalId: id.optional(), note: z.string().trim().min(5, 'Say what was done (at least 5 characters)').max(500) }).strict(), b);
export const parseRepostAll = (b) => parse(z.object({ errorCode: z.string().trim().max(40).optional() }).strict(), b);
export const parseReplayCreate = (b) => parse(z.object({ eventTypes: z.array(z.string().trim().max(60)).min(1).max(20), from: date, to: date }).strict(), b);
export const parseRecon = (q) => parse(z.object({ asOf: date.optional() }).strict(), q);


// ---- part 23.03: accounts payable ----
const money = z.union([z.number().nonnegative(), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'An amount such as 1500.50')]);
const natures = z.enum(['CONTRACTOR', 'PROFESSIONAL', 'PURCHASE_GOODS', 'RENT_PLANT', 'RENT_LAND', 'COMMISSION']);
const directBody = { partnerId: id, projectId: id.nullable().optional(), siteId: id.nullable().optional(), billNo: z.string().trim().max(60).nullable().optional(), billDate: date, dueDate: date.nullable().optional(), creditDays: z.coerce.number().int().min(0).max(365).nullable().optional(), description: z.string().trim().min(3, 'Say what the bill is for').max(300), expenseAccountId: id, amount: money, gst: money.optional(), tdsNature: natures.nullable().optional(), total: money.optional() };
export const parseDirectCreate = (b) => parse(z.object(directBody).strict(), b);
export const parseDirectUpdate = (b) => parse(z.object({ ...directBody, version }).strict(), b);
export const parseHold = (b) => parse(z.object({ hold: z.boolean(), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
export const parseAdjust = (b) => parse(z.object({ advanceId: id, amount: money }).strict(), b);
export const parseTdsPreview = (q) => parse(z.object({ partnerId: id, nature: natures, date: date.optional(), amount: money }).strict(), q);
export const parsePayable = (q) => parse(z.object({ dueBy: date.optional() }).strict(), q);
const dnBody = { kind: z.enum(['DEBIT', 'VENDOR_CREDIT']).default('DEBIT'), partnerId: id, projectId: id.nullable().optional(), billId: id.nullable().optional(), referenceType: z.enum(['AP_BILL', 'INV_RTV', 'VENDOR_INVOICE', 'OTHER']).nullable().optional(), referenceId: z.string().trim().max(60).nullable().optional(), reason: z.enum(['RTV', 'RATE_DIFFERENCE', 'BACK_CHARGE', 'PENALTY', 'SHORT_SUPPLY', 'OTHER']), noteDate: date, vendorNoteNo: z.string().trim().max(60).nullable().optional(), description: z.string().trim().min(3).max(300), amount: money, gst: money.optional(), creditAccountId: id.nullable().optional() };
export const parseDnCreate = (b) => parse(z.object(dnBody).strict(), b);
export const parseDnUpdate = (b) => parse(z.object({ ...dnBody, kind: z.enum(['DEBIT', 'VENDOR_CREDIT']).optional(), version }).strict(), b);
export const parseVendorLedger = (q) => parse(z.object({ partnerId: id, from: date.optional(), to: date.optional() }).strict(), q);
export const parseAsOf = (q) => parse(z.object({ asOf: date.optional() }).strict(), q);
export const parseRange = (q) => parse(z.object({ from: date.optional(), to: date.optional() }).strict(), q);

// ---- part 23.04: payments ----
const pmtLine = z.object({
  kind: z.enum(['BILL', 'ADVANCE', 'ON_ACCOUNT']), billId: id.optional(), advanceId: id.optional(), partnerId: id.optional(), projectId: id.optional().nullable(), amount: money, purpose: z.string().trim().max(200).optional(),
}).strict().superRefine((l, ctx) => {
  if (l.kind === 'BILL' && !l.billId) ctx.addIssue({ code: 'custom', path: ['billId'], message: 'Choose the bill.' });
  if (l.kind === 'ADVANCE' && !l.advanceId) ctx.addIssue({ code: 'custom', path: ['advanceId'], message: 'Choose the advance.' });
  if (l.kind === 'ON_ACCOUNT' && !l.partnerId) ctx.addIssue({ code: 'custom', path: ['partnerId'], message: 'Choose the payee.' });
});
const proposalBody = { bankAccountId: id, payMode: z.enum(['NEFT', 'RTGS', 'IMPS', 'CHEQUE']), payDate: date, purpose: z.string().trim().max(300).optional(), lines: z.array(pmtLine).min(1, 'Add at least one line').max(500), total: money.optional() };
export const parseProposalCreate = (b) => parse(z.object(proposalBody).strict(), b);
export const parseProposalUpdate = (b) => parse(z.object({ ...proposalBody, version: z.number().int().min(1) }).strict(), b);
export const parseCandidates = (q) => parse(z.object({ dueBy: date.optional(), projectId: id.optional(), partnerId: id.optional(), msmeOnly: z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true'), exceptProposal: id.optional() }).strict(), q);
export const parseDropLine = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
const confirmRow = z.object({ paymentId: id.optional(), docNo: z.string().trim().max(40).optional(), status: z.enum(['PAID', 'FAILED', 'CANCELLED']), utr: z.string().trim().max(40).optional().nullable(), paidOn: date.optional(), reason: z.string().trim().max(300).optional().nullable() }).strict();
export const parseConfirm = (b) => parse(z.object({ rows: z.array(confirmRow).min(1).max(500).optional(), csv: z.string().max(500_000).optional() }).strict().refine((v) => Boolean(v.rows) !== Boolean(v.csv), { message: 'Send the rows or the bank\'s file, one of the two.', path: ['rows'] }), b);
export const parseChequeRegister = (q) => parse(z.object({ bankAccountId: id }).strict(), q);
export const parseBankAccount = (b) => parse(z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Z0-9-]+$/, 'Capital letters, digits and hyphens'), name: z.string().trim().min(3).max(100), bankName: z.string().trim().min(2).max(100),
  ifsc: z.string().trim().toUpperCase(), accountNo: z.string().trim().regex(/^[0-9]{9,18}$/, 'An account number is 9 to 18 digits').optional(), glAccountId: id, fileFormat: z.enum(['GENERIC_CSV', 'H2H_PIPE']),
  template: z.object({ delimiter: z.string().max(1).optional(), header: z.boolean().optional(), trailer: z.boolean().optional(), dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY']).optional(), columns: z.array(z.string()).max(20).optional() }).strict().optional(),
  chequeFrom: z.number().int().min(1).optional().nullable(), chequeTo: z.number().int().min(1).optional().nullable(), blocked: z.boolean().optional(), version: z.number().int().min(1).optional(),
}).strict(), b);

// ---- part 23.05: receivables ----
const otherBody = { partnerId: id, projectId: id.optional().nullable(), incomeKind: z.enum(['SCRAP', 'HIRE_OUT', 'RENT', 'OTHER']), incomeAccountId: id, description: z.string().trim().min(3).max(300), invoiceNo: z.string().trim().max(60).optional().nullable(), invoiceDate: date, dueDate: date.optional().nullable(), amount: money, gst: money.optional(), total: money.optional() };
export const parseArInvoiceCreate = (b) => parse(z.object(otherBody).strict(), b);
export const parseArInvoiceUpdate = (b) => parse(z.object({ ...otherBody, version: z.number().int().min(1) }).strict(), b);
const allocRow = z.object({ invoiceId: id, amount: money }).strict();
const receiptBody = { partnerId: id, receiptDate: date, bankAccountId: id, reference: z.string().trim().max(60).optional().nullable(), projectId: id.optional().nullable(), amount: money, tds: money.optional(), tdsSection: z.string().trim().max(20).optional().nullable(), gstTds: money.optional(), retention: money.optional(),
  otherDeductions: z.array(z.object({ label: z.string().trim().min(2).max(100), accountId: id, amount: money }).strict()).max(10).optional(), allocations: z.array(allocRow).max(200).optional(), auto: z.boolean().optional() };
export const parseReceiptCreate = (b) => parse(z.object({ ...receiptBody, post: z.boolean().optional() }).strict(), b);
export const parseReceiptUpdate = (b) => parse(z.object({ ...receiptBody, version: z.number().int().min(1) }).strict(), b);
export const parseAllocate = (b) => parse(z.object({ allocations: z.array(allocRow).max(200).optional(), auto: z.boolean().optional() }).strict().refine((v) => v.auto || (v.allocations ?? []).length > 0, { message: 'Give the allocation or ask for it oldest first.', path: ['allocations'] }), b);
export const parseTdsMatched = (b) => parse(z.object({ matched: z.boolean() }).strict(), b);
export const parseOpenInvoices = (q) => parse(z.object({ partnerId: id }).strict(), q);
export const parseCreditNote = (b) => parse(z.object({ invoiceId: id, reason: z.enum(['RATE_REVISION', 'DISPUTE', 'QUANTITY', 'OTHER']), noteDate: date, description: z.string().trim().min(5).max(300), taxable: money, gst: money.optional() }).strict(), b);
export const parseWriteOff = (b) => parse(z.object({ invoiceId: id, amount: money, reason: z.string().trim().min(10, 'Say why (at least 10 characters)').max(300) }).strict(), b);
export const parseFollowup = (b) => parse(z.object({ date, action: z.enum(['CALL', 'EMAIL', 'VISIT', 'LETTER', 'REMINDER']), notes: z.string().trim().min(3).max(500), contact: z.string().trim().max(100).optional().nullable(), promisedDate: date.optional().nullable(), promised: money.optional().nullable(), nextDate: date.optional().nullable() }).strict(), b);
export const parseWorklist = (q) => parse(z.object({ partnerId: id.optional(), projectId: id.optional(), bucket: z.enum(['0', '30', '60', '90']).optional() }).strict(), q);
export const parseArAgeing = (q) => parse(z.object({ asOf: date.optional(), projectId: id.optional() }).strict(), q);
export const parseClientStatement = (q) => parse(z.object({ partnerId: id, from: date.optional(), to: date.optional() }).strict(), q);

// ---- part 23.06: cash and bank ----
export const parseBankProfile = (b) => parse(z.object({ kind: z.enum(['CURRENT', 'CASH_CREDIT', 'OVERDRAFT', 'ESCROW', 'DEPOSIT']), scope: z.enum(['COMPANY', 'BRANCH', 'PROJECT']), branchId: id.optional().nullable(), projectId: id.optional().nullable(), escrowPurpose: z.string().trim().max(200).optional().nullable(), odLimit: money.optional(), openingDate: date.optional().nullable(), opening: z.union([z.number(), z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/)]).optional() }).strict(), b);
export const parseStatementImport = (b) => parse(z.object({ bankAccountId: id, fileName: z.string().trim().min(1).max(200), format: z.enum(['CSV', 'MT940']).optional(), content: z.string().min(10).max(5_000_000) }).strict(), b);
export const parseStatementLines = (q) => parse(z.object({ bankAccountId: id, status: z.enum(['UNMATCHED', 'AUTO', 'MANUAL', 'POSTED', 'IGNORED']).optional(), from: date.optional(), to: date.optional() }).strict(), q);
export const parseLineMatch = (b) => parse(z.object({ entity: z.enum(['pmt_payments', 'ar_receipts', 'fin_contras', 'fin_imprest_replenishments']), id }).strict(), b);
export const parseLinePost = (b) => parse(z.object({ accountId: id, narration: z.string().trim().min(3).max(200), projectId: id.optional().nullable(), costCentreId: id.optional().nullable() }).strict(), b);
export const parseBankOnly = (b) => parse(z.object({ bankAccountId: id }).strict(), b);
export const parseBrs = (q) => parse(z.object({ bankAccountId: id, asOf: date.optional() }).strict(), q);
export const parseImprest = (b) => parse(z.object({ name: z.string().trim().min(3).max(100), kind: z.enum(['SITE', 'OFFICE']).optional(), projectId: id.optional().nullable(), siteId: id.optional().nullable(), custodian: z.string().trim().min(1).max(100), limit: money }).strict(), b);
export const parseCashCount = (b) => parse(z.object({ denominations: z.record(z.string().regex(/^\d+(\.\d{1,2})?$/), z.number().int().min(0).max(100000)), witness: z.string().trim().max(100).optional().nullable(), note: z.string().trim().max(300).optional().nullable() }).strict(), b);
const voucherBody = { imprestId: id, date, payee: z.string().trim().min(2).max(100), category: z.enum(['MATERIAL', 'TRANSPORT', 'FOOD', 'REPAIRS', 'SITE_EXPENSE', 'TRAVEL', 'POSTAGE', 'OTHER']), description: z.string().trim().min(3).max(300), amount: money, gst: money.optional(), expenseAccountId: id, costCodeId: id.optional().nullable(), projectId: id.optional().nullable(), siteId: id.optional().nullable(), clientRef: z.string().trim().max(80).optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() };
export const parseVoucherCreate = (b) => parse(z.object(voucherBody).strict(), b);
export const parseVoucherUpdate = (b) => parse(z.object({ ...voucherBody, imprestId: id.optional(), version: z.number().int().min(1) }).strict(), b);
export const parseReplenish = (b) => parse(z.object({ imprestId: id, bankAccountId: id }).strict(), b);
export const parseContra = (b) => parse(z.object({ kind: z.enum(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER']), date, fromBankId: id.optional().nullable(), fromImprestId: id.optional().nullable(), toBankId: id.optional().nullable(), toImprestId: id.optional().nullable(), amount: money, reference: z.string().trim().max(60).optional().nullable(), purpose: z.string().trim().min(3).max(200) }).strict(), b);
export const parsePosition = (q) => parse(z.object({ date: date.optional() }).strict(), q);

// ---- part 23.07: the GST tax engine, e-invoices and e-way bills ----
const stateCode = z.string().trim().regex(/^\d{2}$/, 'A 2-digit GST state code');
const gstin = z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'A GSTIN has 15 characters');
const rupees = z.union([z.number().min(0), z.string().trim().regex(/^\d+(\.\d{1,2})?$/)]);
const settingsBody = { effectiveFrom: date, aato: rupees, einvoiceEnabled: z.boolean(), einvoiceThreshold: rupees, irnWindowAato: rupees, irnWindowDays: z.number().int().min(1).max(365), irnAlertDays: z.array(z.number().int().min(1).max(364)).min(1).max(5), irnCancelHours: z.number().int().min(1).max(72), ewayEnabled: z.boolean(), ewayThreshold: rupees, ewayMaxDocAgeDays: z.number().int().min(1).max(3650), ewayExtCapDays: z.number().int().min(1).max(3650), ewayKmPerDay: z.number().int().min(1).max(5000), ewayOdcKmPerDay: z.number().int().min(1).max(5000), ewayExtWindowHours: z.number().int().min(1).max(72), ewayCancelHours: z.number().int().min(1).max(72), ewayAlertHours: z.number().int().min(1).max(168), gspConnector: z.string().trim().max(60).nullable(), gspMode: z.enum(['SANDBOX', 'PRODUCTION']), changeNote: z.string().trim().min(3).max(300) };
export const parseGstSettingsCreate = (b) => parse(z.object(Object.fromEntries(Object.entries(settingsBody).map(([k, v]) => [k, k === 'changeNote' ? v : v.optional()]))).strict(), b);
export const parseGstSettingsUpdate = (b) => parse(z.object({ ...Object.fromEntries(Object.entries(settingsBody).map(([k, v]) => [k, v.optional()])), version: z.number().int().min(1) }).strict(), b);
export const parseGstSettingsImport = (b) => parse(z.object({ content: z.object({ kind: z.string(), version: z.number().optional(), settings: z.record(z.string(), z.any()) }), effectiveFrom: date, changeNote: z.string().trim().min(3).max(200).optional() }).strict(), b);
export const parseGstResolve = (b) => parse(z.object({ docDate: date, supplyDate: date.optional().nullable(), paymentDate: date.optional().nullable(), supplierGstin: gstin.optional().nullable(), supplierState: stateCode.optional().nullable(), recipientGstin: gstin.optional().nullable(), recipientState: stateCode.optional().nullable(), placeOfSupply: z.string().trim().regex(/^\d{2}$/).optional().nullable(), propertyState: stateCode.optional().nullable(), supplyKind: z.enum(['B2B', 'B2C', 'SEZ', 'EXPORT', 'IMPORT', 'DEEMED_EXPORT']).default('B2B'), withPayment: z.boolean().optional(), reverseCharge: z.boolean().optional(), lines: z.array(z.object({ hsn: z.string().trim().regex(/^\d{4,8}$/).optional(), rateCode: z.string().trim().max(20).optional(), taxable: rupees, description: z.string().trim().max(200).optional() }).strict()).min(1).max(500) }).strict(), b);
export const parseGstinCheck = (b) => parse(z.object({ gstin: z.string().trim().toUpperCase().min(1).max(20), online: z.boolean().default(true) }).strict(), b);
export const parseEinvDoc = (b) => parse(z.object({ documentType: z.enum(['bill_tax_invoices', 'ar_credit_notes']), documentId: id }).strict(), b);
export const parseEinvCancel = (b) => parse(z.object({ reasonCode: z.enum(['1', '2', '3', '4']), remark: z.string().trim().min(3).max(100) }).strict(), b);
export const parseEwbDoc = (q) => parse(z.object({ documentType: z.enum(['bill_tax_invoices', 'inv_transfers', 'bp_delivery_tickets']), documentId: id }).strict(), q);
const vehicle = z.string().trim().toUpperCase().transform((v) => v.replace(/[\s-]+/g, '')).pipe(z.string().regex(/^[A-Z]{2}[0-9A-Z]{2,4}[A-Z]{0,3}[0-9]{4}$|^TMP[0-9A-Z]{6,12}$/, 'A registration number such as TS09EA1234'));
const pin = z.string().trim().regex(/^[1-9]\d{5}$/, 'A 6-digit PIN code');
export const parseEwbCreate = (b) => parse(z.object({ documentType: z.enum(['bill_tax_invoices', 'inv_transfers', 'bp_delivery_tickets']), documentId: id, subType: z.enum(['SUPPLY', 'BRANCH_TRANSFER', 'OWN_USE', 'JOB_WORK', 'OTHERS']).optional(), fromGstin: gstin.optional(), toGstin: z.union([gstin, z.literal('URP')]).optional().nullable(), fromState: stateCode.optional(), toState: stateCode.optional(), fromPin: pin.optional(), toPin: pin.optional(), distance: z.number().int().min(1).max(4000), hsn: z.string().trim().regex(/^\d{4,8}$/).optional(), value: rupees.optional(), tax: rupees.optional(), transportMode: z.enum(['ROAD', 'RAIL', 'AIR', 'SHIP']).default('ROAD'), vehicleType: z.enum(['REGULAR', 'ODC']).default('REGULAR'), vehicleNo: vehicle.optional().nullable(), transporterId: z.string().trim().max(15).optional().nullable(), transporterDoc: z.string().trim().max(15).optional().nullable() }).strict(), b);
export const parseEwbVehicle = (b) => parse(z.object({ vehicleNo: vehicle, fromPlace: z.string().trim().min(3).max(50), reasonCode: z.enum(['1', '2', '3', '4']), remark: z.string().trim().min(3).max(50), version: z.number().int().min(1) }).strict(), b);
export const parseEwbExtend = (b) => parse(z.object({ remainingKm: z.number().int().min(1).max(4000), fromPlace: z.string().trim().min(3).max(50), reasonCode: z.enum(['1', '2', '3', '4', '99']), remark: z.string().trim().min(3).max(50), vehicleNo: vehicle.optional() }).strict(), b);
export const parseEwbCancel = (b) => parse(z.object({ reasonCode: z.enum(['1', '2', '3', '4']), remark: z.string().trim().min(3).max(50) }).strict(), b);

// ---- part 23.08: GST reconciliation, ITC review, returns and TDS ----
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'A month such as 2026-10');
const quarter = z.string().regex(/^\d{4}-\d{2}-Q[1-4]$/, 'A quarter such as 2026-27-Q3');
const fy = z.string().regex(/^\d{4}-\d{2}$/, 'A financial year such as 2026-27');
export const parse2bImport = (b) => parse(z.object({ period, gstin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/).optional(), fileName: z.string().trim().min(1).max(200), format: z.enum(['JSON', 'CSV', 'GSP']), content: z.string().max(20_000_000).default('') }).strict(), b);
export const parsePeriod = (q) => parse(z.object({ period }).strict(), q);
export const parseWorklist2b = (q) => parse(z.object({ period, status: z.enum(['MATCHED', 'MISMATCH', 'MISMATCH_AMOUNT', 'MISMATCH_DATE', 'MISMATCH_NUMBER', 'MISSING_IN_BOOKS', 'MISSING_IN_2B']).optional(), mine: z.enum(['1', 'true']).optional() }).strict(), q);
export const parseReconAct = (b) => parse(z.object({ on: z.enum(['line', 'bill']).default('line'), action: z.enum(['assign', 'followup', 'resolve', 'accept', 'reopen']), owner: z.string().trim().max(80).optional(), channel: z.enum(['EMAIL', 'PORTAL', 'CALL', 'LETTER']).optional(), note: z.string().trim().max(500).optional(), nextDate: date.optional().nullable(), version: z.number().int().min(1).optional() }).strict().refine((x) => x.action !== 'followup' || (x.channel && x.note && x.note.length >= 5), { message: 'A follow-up needs a channel and a note of at least 5 characters', path: ['note'] }), b);
export const parseItcCreate = (b) => parse(z.object({ period }).strict(), b);
export const parseItcOverride = (b) => parse(z.object({ billId: id, claim: z.boolean(), reason: z.string().trim().max(500).optional(), version: z.number().int().min(1) }).strict(), b);
export const parseReturnAct = (b) => parse(z.object({ period, returnType: z.enum(['GSTR1', 'GSTR3B']), arn: z.string().trim().min(5).max(30).optional(), filedOn: date.optional() }).strict(), b);
export const parseReturnFile = (b) => parse(z.object({ period, returnType: z.enum(['GSTR1', 'GSTR3B']), arn: z.string().trim().min(5).max(30), filedOn: date }).strict(), b);
export const parseQuarter = (q) => parse(z.object({ quarter }).strict(), q);
const challan = z.object({ bsr: z.string().trim().regex(/^\d{7}$/, 'The BSR code has 7 digits'), date, serial: z.string().trim().regex(/^\d{1,5}$/, 'The challan serial has up to 5 digits'), amount: money, forMonth: period.optional(), journalId: id.optional() }).strict();
export const parseTdsPrepare = (b) => parse(z.object({ quarter, challans: z.array(challan).max(60).optional(), tan: z.string().trim().toUpperCase().regex(/^[A-Z]{4}\d{5}[A-Z]$/, 'A TAN is four letters, five digits and a letter').optional() }).strict(), b);
export const parseTdsFile = (b) => parse(z.object({ quarter, tokenNo: z.string().trim().min(5).max(30), filedOn: date }).strict(), b);
export const parseTdsCert = (q) => parse(z.object({ quarter, partnerId: id }).strict(), q);
export const parse26as = (b) => parse(z.object({ fy, content: z.string().min(10).max(5_000_000) }).strict(), b);
export const parseFy = (q) => parse(z.object({ fy }).strict(), q);
export const parseCalendar = (q) => parse(z.object({ from: period.optional(), to: period.optional() }).strict(), q);

// ---- part 23.09: fixed assets and depreciation ----
const assetBody = { source: z.enum(['AP_BILL', 'CWIP', 'EQUIPMENT', 'SMALL_ASSET', 'OPENING']), parentAssetId: id.optional().nullable(), billId: id.optional().nullable(), cwipId: id.optional().nullable(), equipmentId: id.optional().nullable(), smallAssetId: id.optional().nullable(), classCode: z.string().trim().min(2).max(30), description: z.string().trim().min(3).max(300).optional(), cost: money.optional(), capDate: date.optional(), projectId: id.optional().nullable(), siteId: id.optional().nullable(), custodian: z.string().trim().max(100).optional().nullable(), usefulLifeMonths: z.number().int().min(1).max(1200).optional(), residual: money.optional(), method: z.enum(['SLM', 'WDV']).optional(), hsn: z.string().trim().regex(/^\d{4,8}$/).optional().nullable(), openingAccum: money.optional() };
export const parseAssetCreate = (b) => parse(z.object(assetBody).strict(), b);
export const parseAssetUpdate = (b) => parse(z.object({ ...Object.fromEntries(Object.entries(assetBody).map(([k, v]) => [k, v.optional()])), version: z.number().int().min(1) }).strict(), b);
export const parseAssetTransfer = (b) => parse(z.object({ date, toProjectId: id.optional().nullable(), toSiteId: id.optional().nullable(), toCustodian: z.string().trim().max(100).optional().nullable(), reason: z.string().trim().min(5).max(300), version: z.number().int().min(1) }).strict(), b);
export const parseCwipCreate = (b) => parse(z.object({ title: z.string().trim().min(3).max(200), projectId: id.optional().nullable(), billIds: z.array(id).min(1).max(200) }).strict(), b);
export const parseDepPeriod = (q) => parse(z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'A month such as 2026-10') }).strict(), q);
export const parseDisposalCreate = (b) => parse(z.object({ assetId: id, date, method: z.enum(['SALE', 'SCRAP', 'WRITE_OFF']), buyerPartnerId: id.optional().nullable(), proceeds: money.optional(), hsn: z.string().trim().regex(/^\d{4,8}$/).optional().nullable(), reason: z.string().trim().min(5).max(300) }).strict(), b);
export const parseVerifyCreate = (b) => parse(z.object({ projectId: id.optional().nullable(), siteId: id.optional().nullable(), date }).strict(), b);
export const parseVerifyScan = (b) => parse(z.object({ code: z.string().trim().min(2).max(60), condition: z.enum(['GOOD', 'FAIR', 'DAMAGED', 'NOT_WORKING']).optional(), note: z.string().trim().max(200).optional() }).strict(), b);
/** D-740: the opening WDV of a tax block. */
export const parseTaxOpening = (b) => parse(z.object({ block: z.string().trim().min(2).max(40), fy: z.string().regex(/^\d{4}-\d{2}$/, 'A financial year such as 2026-27'), openingWdv: z.coerce.number().min(0).max(1e13), version: z.number().int().optional() }).strict(), b);
export const parseFyQuery = (q) => parse(z.object({ fy: z.string().regex(/^\d{4}-\d{2}$/, 'A financial year such as 2026-27') }).strict(), q);

// ---- part 23.10: project accounting ----
const rrMethod = z.enum(['COST_TO_COST', 'OUTPUT']);
const surveyPct = z.coerce.number().min(0).max(100).nullable().optional();
export const parseRevrecCreate = (b) => parse(z.object({ projectId: id, period, method: rrMethod.default('COST_TO_COST'), surveyPct, surveyNote: z.string().trim().max(500).nullable().optional() }).strict(), b);
export const parseRevrecUpdate = (b) => parse(z.object({ method: rrMethod.optional(), surveyPct, surveyNote: z.string().trim().max(500).nullable().optional(), version: z.number().int().optional() }).strict(), b);
export const parseRevrecImport = (b) => parse(z.object({ rows: z.array(z.object({ project: z.string().trim().min(1).max(40), period, method: rrMethod.optional(), surveyPct, surveyNote: z.string().trim().max(500).nullable().optional() }).strict()).min(1).max(500) }).strict(), b);
export const parseProjectTb = (q) => parse(z.object({ projectId: id, from: date, to: date }).strict().refine((x) => x.from <= x.to, { message: 'The start is on or before the end', path: ['to'] }), q);
export const parseMonthRange = (q) => parse(z.object({ from: period, to: period }).strict().refine((x) => x.from <= x.to, { message: 'The first month is on or before the last', path: ['to'] }), q);
export const parseProjectExport = (q) => parse(z.object({ kind: z.enum(['tb', 'wip', 'overheads']), projectId: id.optional(), from: z.string().optional(), to: z.string().optional(), period: period.optional() }).strict(), q);

// ---- part 23.11: cost forecast ----
const etcMethod = z.enum(['REMAINING_BUDGET', 'CPI', 'BOTTOM_UP', 'COMMITTED_PLUS', 'MANUAL']);
const optNum = z.coerce.number().min(0).max(1e13).nullable().optional();
export const parseForecastCreate = (b) => parse(z.object({ projectId: id, period }).strict(), b);
export const parseForecastUpdate = (b) => parse(z.object({ pendingVarCost: optNum, pendingVarNote: z.string().trim().max(500).nullable().optional(), confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(), commentary: z.string().trim().max(2000).nullable().optional(), version: z.number().int().optional() }).strict(), b);
const forecastLine = { method: etcMethod.optional(), accrued: optNum, remainingQty: optNum, rate: optNum, manual: optNum, notes: z.string().trim().max(1000).nullable().optional() };
export const parseForecastLine = (b) => parse(z.object(forecastLine).strict(), b);
export const parseForecastImport = (b) => parse(z.object({ rows: z.array(z.object({ wbs: z.string().trim().max(40).optional(), costCode: z.string().trim().min(1).max(40), ...forecastLine }).strict()).min(1).max(1000) }).strict(), b);
export const parseProjectQuery = (q) => parse(z.object({ projectId: id }).strict(), q);
