import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { createFlagService } from '../core/api.js';
import { listExports } from '../../platform/list/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createBase } from '../proc/base.js';
import { STATUS } from '../qa/flow.js';
import './integrations.js';
import { createGlService } from './gl.js';
import { glRoutes } from './glroutes.js';
import { EVENT_TYPES, createPostingService } from './posting.js';
import { postingRoutes } from './postingroutes.js';
import { createApService } from './ap.js';
import { apRoutes } from './aproutes.js';
import { createPaymentService } from './payments.js';
import { paymentRoutes } from './paymentroutes.js';
import { createArService } from './ar.js';
import { arRoutes } from './arroutes.js';
import { createCashService } from './cash.js';
import { cashRoutes } from './cashroutes.js';
import { createGstService } from './gst.js';
import { gstRoutes } from './gstroutes.js';
import { createGstReconService } from './gstrecon.js';
import { gstReconRoutes } from './gstreconroutes.js';
import { createAssetService } from './assets.js';
import { assetRoutes } from './assetroutes.js';
import { httpGsp, sandboxGsp } from './gsp.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { bindTaxEngine } from '../../platform/tax/index.js';
import { createProjectAccountingService } from './projacct.js';
import { projectAccountingRoutes } from './projacctroutes.js';
import { finRoutes } from './routes.js';
import { accountPostings, bindFin, createFinService } from './service.js';

const glServices = new WeakMap();
const postingServices = new WeakMap();
/** The posting engine of a database (part 23.02). */
export const postingOf = (db) => postingServices.get(db) ?? null;
const apServices = new WeakMap();
/** Accounts payable of a database (part 23.03). */
export const apOf = (db) => apServices.get(db) ?? null;
const paymentServices = new WeakMap();
/** Payments of a database (part 23.04). */
export const paymentsOf = (db) => paymentServices.get(db) ?? null;
const arServices = new WeakMap();
/** Accounts receivable of a database (part 23.05). */
export const arOf = (db) => arServices.get(db) ?? null;
const cashServices = new WeakMap();
/** Cash and bank of a database (part 23.06). */
export const cashOf = (db) => cashServices.get(db) ?? null;
const gstServices = new WeakMap();
/** The GST compliance service of a database (part 23.07): the tax engine, e-invoices and e-way bills. */
export const gstOf = (db) => gstServices.get(db) ?? null;
const gstReconServices = new WeakMap();
/** GST reconciliation, ITC review and TDS compliance of a database (part 23.08). */
export const gstReconOf = (db) => gstReconServices.get(db) ?? null;
const assetServices = new WeakMap();
/** Fixed assets and depreciation of a database (part 23.09). */
export const assetsOf = (db) => assetServices.get(db) ?? null;
const projectAccountServices = new WeakMap();
const costForecastServices = new WeakMap();
export const projectAccountsOf = (db) => projectAccountServices.get(db) ?? null;
/** The general ledger of a database (part 23.01), for the posting engine (23.02) and the sub-ledgers. */
export const glOf = (db) => glServices.get(db) ?? null;

const TABLES = ['fin_account_groups', 'fin_accounts', 'fin_cost_heads', 'fin_cost_codes', 'fin_dimension_rules', 'fin_category_mappings', 'fin_master_changes', 'fin_journals', 'fin_journal_lines', 'fin_balances', 'fin_recurring_journals', 'fin_posting_rules', 'fin_posting_log', 'fin_replay_runs', 'ap_bills', 'ap_debit_notes', 'ap_bill_adjustments', 'fin_bank_accounts', 'pmt_proposals', 'pmt_proposal_lines', 'pmt_payments', 'ar_invoices', 'ar_receipts', 'ar_allocations', 'ar_credit_notes', 'ar_writeoffs', 'ar_followups', 'fin_bank_account_profiles', 'fin_bank_statement_imports', 'fin_bank_statements', 'fin_bank_recons', 'fin_imprests', 'fin_imprest_vouchers', 'fin_imprest_replenishments', 'fin_cash_counts', 'fin_contras', 'gst_settings', 'gst_gstin_checks', 'gst_einvoices', 'gst_ewaybills', 'gst_compliance_log', 'gst_2b_imports', 'gst_2b_lines', 'gst_recon_followups', 'gst_itc_reviews', 'gst_itc_review_lines', 'gst_return_filings', 'tds_returns', 'tds_26as_lines', 'fa_classes', 'fa_cwip', 'fa_cwip_lines', 'fa_assets', 'fa_dep_runs', 'fa_depreciation', 'fa_transfers', 'fa_disposals', 'fa_verifications', 'fa_verification_lines', 'fa_tax_openings', 'fa_asset_components', 'tcs_collections', 'pa_revenue_recognition', 'pa_overhead_allocations'];
const TEMPLATE = ['fin_account_groups', 'fin_accounts', 'fin_cost_heads', 'fin_cost_codes', 'fin_dimension_rules', 'fin_posting_rules', 'fa_classes'];
// the integrity checks (01.02): a row without a company is the template every company copies (the seed of migration 105)
integrityRegistry.register({ allowNegative: [], companyOptional: TEMPLATE, statuses: { fin_journals: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), fin_recurring_journals: ['ACTIVE', 'PAUSED', 'ENDED'], fin_posting_rules: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), fin_replay_runs: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), ap_bills: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), ap_debit_notes: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), pmt_proposals: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), ar_invoices: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), ar_receipts: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), ar_credit_notes: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), ar_writeoffs: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), fin_imprest_vouchers: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), fin_imprest_replenishments: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), fin_contras: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), gst_settings: Object.keys(STATUS), gst_itc_reviews: Object.keys(STATUS), fa_assets: Object.keys(STATUS), fa_disposals: Object.keys(STATUS), pa_revenue_recognition: Object.keys(STATUS) }, uniqueKeys: [{ table: 'fin_journals', columns: ['company_id', 'doc_no'] }, { table: 'fin_recurring_journals', columns: ['company_id', 'doc_no'] }, { table: 'fin_replay_runs', columns: ['company_id', 'doc_no'] }, { table: 'fin_posting_log', columns: ['company_id', 'event_id'] }, { table: 'ap_bills', columns: ['company_id', 'doc_no'] }, { table: 'ap_debit_notes', columns: ['company_id', 'doc_no'] }] });
/** Module "fin": the finance masters (part 06.05): chart of accounts, cost heads and cost codes, financial dimensions and the item category mapping. The tables are `fin_*`. */
export const fin = {
  code: 'fin',
  name: 'Finance masters',
  routePrefix: '/api/v1/fin',
  ownerPart: '23.06',
  status: 'Chart of accounts with Schedule III mapping and control accounts, cost heads and cost codes, dimension rules and the posting check, item category mapping, import from Tally; every change approved by the CFO (06.05). The general ledger: journals of every voucher type with dimensions, approval by band, posting by period, reversal, accruals and recurring journals, the account ledger, the trial balance and the carry-forward of a year (23.01)',
  tables: TABLES,
  companyOptional: TEMPLATE,
  resources: ['accounts', 'account-groups', 'cost-heads', 'cost-codes', 'dimension-rules', 'category-mappings', 'schedule-iii', 'postings', 'changes', 'import', 'lookups', 'journals', 'recurring-journals', 'ledger', 'trial-balance', 'gl', 'posting-rules', 'postings', 'replays', 'reconciliation', 'bills', 'debit-notes', 'payables', 'bank-accounts', 'proposals', 'payments', 'invoices', 'receipts', 'credit-notes', 'write-offs', 'receivables', 'bank-profiles', 'bank-statements', 'brs', 'imprests', 'imprest-vouchers', 'imprest-replenishments', 'contras', 'cash-position', 'gst', 'einvoices', 'ewaybills', 'gst-recon', 'itc-reviews', 'gst-returns', 'tds-returns', 'compliance-calendar', 'assets', 'asset-classes', 'cwip', 'depreciation', 'disposals', 'asset-verifications', 'asset-reports', 'tcs-returns', 'revenue-recognition', 'project-accounts'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fin_accounts'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const fin = createFinService({ db });
    bindFin(db, fin);
    const router = Router();
    router.use((req, _res, next) => (flags.isOn(req.actor, 'ff.mdm.p0605') ? next() : next(notFound('The chart of accounts and cost codes are not enabled for your company yet (feature flag ff.mdm.p0605 is OFF).'))));
    router.use(finRoutes({ fin }, { idempotent: idempotency(db) }));
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fin_journals'").get()) {
      const base = createBase({ db }); const gl = createGlService({ db, base });
      glServices.set(db, gl);
      accountPostings.register({ code: 'fin.gl', count: (d, companyId, accountId) => (d === db ? gl.postingsOf(companyId, accountId) : 0) });
      listExports.register('fin.journals', { source: (actor, req) => { base.need(actor, 'fin.journal.export', 'export journals'); return gl.journals.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
      const runtime = runtimeOf(db);
      runtime?.jobs?.register('fin.gl_daily', (jctx) => { const a = gl.jobs.autoReverse(); const r = gl.jobs.recurring(); jctx.log(`${a.reversed} accrual(s) reversed, ${r.made} recurring journal(s) made${[...a.errors, ...r.errors].length ? `; ${[...a.errors, ...r.errors].length} problem(s): ${[...a.errors, ...r.errors].join(' | ')}` : ''}`); return { reversed: a.reversed, made: r.made, errors: [...a.errors, ...r.errors] }; }, { maxAttempts: 3, description: 'Part 23.01 FR-03: reverses the accruals whose date has come and makes the journals of the recurring templates that are due.' });
      runtime?.scheduler?.define({ code: 'fin.gl_daily_morning', cron: '35 0 * * *', jobType: 'fin.gl_daily', description: 'Every morning 06:05 India time: accrual reversals and recurring journals' });
      router.use(glRoutes(gl, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'gst_einvoices'").get()) {
        // part 23.07: the GST providers of the integration hub (01.08), the service, its consumers and its daily work
        const { providers } = integrationsOf(db, { vaultKey: appConfig.vaultKey ?? undefined }); providers.register(sandboxGsp()); providers.register(httpGsp());
        const gs = createGstService({ db, base, flags }); gstServices.set(db, gs); bindTaxEngine(db, gs);
        runtime?.bus?.subscribe('bill.invoice.issued', (e) => { gs.consumers.onInvoiceIssued(e); }, { consumer: 'fin.gst_einvoice' });
        runtime?.bus?.subscribe('fin.ar_credit_note.approved', (e) => { gs.consumers.onCreditNote(e); }, { consumer: 'fin.gst_einvoice_cn' });
        runtime?.jobs?.register('fin.gst_daily', async (jctx) => { const r = await gs.jobs.retryDue(); const a = gs.jobs.alerts(); jctx.log(`${r.tried} e-invoice(s) retried, ${r.generated} generated; ${a.irnAlerts} IRN alert(s), ${a.ewbAlerts} e-way bill(s) about to expire, ${a.expired} expired`); return { ...r, ...a }; }, { maxAttempts: 3, description: 'Part 23.07: retries e-invoices waiting or failed, alerts IRNs due (day 20 and 25 of the reporting window) and e-way bills about to expire, marks expired e-way bills.' });
        runtime?.scheduler?.define({ code: 'fin.gst_hourly', cron: '20 * * * *', jobType: 'fin.gst_daily', description: 'Every hour: e-invoice retries, IRN-due and e-way bill expiry alerts' });
        listExports.register('fin.einvoices', { source: (actor, req) => { base.need(actor, 'fin.einvoice.export', 'export e-invoices'); return gs.einvoices.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
        listExports.register('fin.ewaybills', { source: (actor, req) => { base.need(actor, 'fin.ewaybill.export', 'export e-way bills'); return gs.ewaybills.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
        router.use(gstRoutes(gs, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
      }
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fin_posting_rules'").get()) {
        const pe = createPostingService({ db, base, gl, flags }); postingServices.set(db, pe);
        // FR-02: the engine consumes the outbox (01.04): one inbox row per event, retried by the bus only when the engine itself fails; a posting problem is a failed posting in the log
        runtime?.bus?.subscribe(EVENT_TYPES, (e) => { pe.onEvent(e); }, { consumer: 'fin.posting' });
        listExports.register('fin.postings', { source: (actor, req) => { base.need(actor, 'fin.posting.view', 'export postings'); return pe.postings.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
        router.use(postingRoutes(pe, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
      }
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ap_bills'").get()) {
        const ap = createApService({ db, base, gl, flags }); apServices.set(db, ap);
        // FR-01: the payables of the other modules, by their events (idempotent: one AP bill per source document)
        runtime?.bus?.subscribe('ap.invoice.matched', (e) => { ap.consumers.onInvoice(e); }, { consumer: 'fin.ap_invoice' });
        runtime?.bus?.subscribe('bill.sub.approved', (e) => { ap.consumers.onSubBill(e); }, { consumer: 'fin.ap_sub_bill' });
        runtime?.bus?.subscribe('exp.claim.passed', (e) => { ap.consumers.onClaim(e); }, { consumer: 'fin.ap_claim' });
        listExports.register('fin.ap_bills', { source: (actor, req) => { base.need(actor, 'fin.bill.export', 'export AP bills'); return ap.bills.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
        listExports.register('fin.debit_notes', { source: (actor, req) => { base.need(actor, 'fin.debit_note.export', 'export debit notes'); return ap.notes.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
        router.use(apRoutes(ap, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pmt_proposals'").get()) {
          const pm = createPaymentService({ db, base, gl, ap, vaultKey: appConfig.vaultKey }); paymentServices.set(db, pm);
          // FR-03: accounts payable settles the bill from the payment's event (and opens it again when the bank returns it)
          runtime?.bus?.subscribe('fin.payment.released', (e) => { ap.consumers.onPaymentReleased(e); }, { consumer: 'fin.ap_payment' });
          runtime?.bus?.subscribe('fin.payment.failed', (e) => { ap.consumers.onPaymentFailed(e); }, { consumer: 'fin.ap_payment_failed' });
          listExports.register('fin.payment_proposals', { source: (actor, req) => { base.need(actor, 'fin.proposal.export', 'export payment proposals'); return pm.proposals.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
          listExports.register('fin.payments', { source: (actor, req) => { base.need(actor, 'fin.payment.export', 'export payments'); return pm.payments.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
          router.use(paymentRoutes(pm, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
        }
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ar_invoices'").get()) {
          const ar = createArService({ db, base, gl, flags }); arServices.set(db, ar);
          // FR-01: a receivable for each tax invoice issued (22.04), once
          runtime?.bus?.subscribe('bill.invoice.issued', (e) => { ar.consumers.onTaxInvoice(e); }, { consumer: 'fin.ar_invoice' });
          runtime?.jobs?.register('fin.ar_daily', (jctx) => { let n = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) if (flags.isOn({ companyId: c.id, user: 'system', roles: [] }, 'ff.fin.p2305')) n += ar.followups.escalate(c.id); jctx.log(`${n} broken promise(s) escalated`); return { escalated: n }; });
          runtime?.scheduler?.define({ code: 'fin.ar_daily_morning', cron: '50 2 * * *', jobType: 'fin.ar_daily', description: 'Every morning 08:20 India time: payment promises not kept are escalated to the accounts manager' });
          listExports.register('fin.ar_invoices', { source: (actor, req) => { base.need(actor, 'fin.invoice.export', 'export receivables'); return ar.invoices.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
          listExports.register('fin.ar_receipts', { source: (actor, req) => { base.need(actor, 'fin.receipt.export', 'export receipts'); return ar.receipts.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
          router.use(arRoutes(ar, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
        }
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'gst_2b_lines'").get()) {
          // part 23.08: GST reconciliation, ITC review, returns and TDS (reads the AP bills of 23.03, the sales of 22.04 and 23.05)
          const gr = createGstReconService({ db, base, gl, flags, gst: () => gstServices.get(db) ?? null }); gstReconServices.set(db, gr);
          runtime?.jobs?.register('fin.gst_recon_daily', (jctx) => { const r = gr.jobs.daily(); jctx.log(`${r.followups} follow-up(s) due`); return r; }, { maxAttempts: 3, description: 'Part 23.08: tells the owners of the GST mismatches whose vendor follow-up is due today.' });
          runtime?.scheduler?.define({ code: 'fin.gst_recon_morning', cron: '5 3 * * *', jobType: 'fin.gst_recon_daily', description: 'Every morning 08:35 India time: GST reconciliation follow-ups due' });
          router.use(gstReconRoutes(gr, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
        }
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fa_assets'").get()) {
          // part 23.09: fixed assets — drafts from the equipment register (17.01) and small assets (16.09); a sale becomes a receivable (23.05)
          const fa = createAssetService({ db, base, gl, flags, tax: () => gstServices.get(db) ?? null }); assetServices.set(db, fa);
          runtime?.bus?.subscribe('plant.equipment.registered', (e) => { fa.consumers.onEquipment(e); }, { consumer: 'fin.fa_equipment' });
          runtime?.bus?.subscribe('inv.asset.registered', (e) => { fa.consumers.onSmallAsset(e); }, { consumer: 'fin.fa_small_asset' });
          runtime?.bus?.subscribe('fin.asset.disposed', (e) => { const ar = arServices.get(db); const ref = ar?.consumers.onAssetSold?.(e); if (ref) fa.disposals.linkReceivable(Number(e.companyId), { disposalId: e.data?.disposalId, arRef: ref }); }, { consumer: 'fin.ar_asset_sale' });
          runtime?.jobs?.register('fin.fa_monthly', (jctx) => { const r = fa.jobs.remind(); jctx.log(`${r.reminded} compan(y/ies) reminded`); return r; }, { maxAttempts: 3, description: 'Part 23.09: from the 5th, reminds the accounts manager when last month\'s depreciation is not run.' });
          runtime?.scheduler?.define({ code: 'fin.fa_monthly_morning', cron: '15 3 * * *', jobType: 'fin.fa_monthly', description: 'Every morning 08:45 India time: depreciation not yet run for last month' });
          listExports.register('fin.fa_assets', { source: (actor, req) => { base.need(actor, 'fin.asset.export', 'export fixed assets'); return fa.assets.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
          router.use(assetRoutes(fa, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
        }
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pa_revenue_recognition'").get()) {
          // part 23.10: revenue recognition and the project accounts; the overhead pools of 12.04 posted to the projects by their events
          const pa = createProjectAccountingService({ db, base, gl, flags, forecast: () => costForecastServices.get(db) ?? null }); projectAccountServices.set(db, pa);
          runtime?.bus?.subscribe('bud.overhead.allocated', (e) => { pa.consumers.onAllocated(e); }, { consumer: 'fin.pa_overhead' });
          runtime?.bus?.subscribe('bud.overhead.allocation_reversed', (e) => { pa.consumers.onAllocationReversed(e); }, { consumer: 'fin.pa_overhead_reversed' });
          runtime?.jobs?.register('fin.pa_monthly', (jctx) => { const r = pa.jobs.remind(); jctx.log(`${r.reminded} compan(y/ies) reminded`); return r; }, { maxAttempts: 3, description: 'Part 23.10: from the 5th, reminds who recognises revenue when last month is not recognised for a project.' });
          runtime?.scheduler?.define({ code: 'fin.pa_monthly_morning', cron: '25 3 * * *', jobType: 'fin.pa_monthly', description: 'Every morning 08:55 India time: projects whose revenue of last month is not recognised' });
          listExports.register('fin.revenue_recognition', { source: (actor, req) => { base.need(actor, 'fin.revenue_recognition.export', 'export revenue recognition'); return pa.recognition.list(actor, { ...req, page: 1, pageSize: 100 }); }, hidden: () => [] });
          router.use(projectAccountingRoutes(pa, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
        }
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fin_imprests'").get()) {
          const cs = createCashService({ db, base, gl, payments: () => paymentServices.get(db) ?? null }); cashServices.set(db, cs);
          router.use(cashRoutes(cs, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags }));
        }
      }
    }
    api.use('/fin', router);
  },
};
