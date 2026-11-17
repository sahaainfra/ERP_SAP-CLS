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
import { finRoutes } from './routes.js';
import { accountPostings, bindFin, createFinService } from './service.js';

const glServices = new WeakMap();
const postingServices = new WeakMap();
/** The posting engine of a database (part 23.02). */
export const postingOf = (db) => postingServices.get(db) ?? null;
const apServices = new WeakMap();
/** Accounts payable of a database (part 23.03). */
export const apOf = (db) => apServices.get(db) ?? null;
/** The general ledger of a database (part 23.01), for the posting engine (23.02) and the sub-ledgers. */
export const glOf = (db) => glServices.get(db) ?? null;

const TABLES = ['fin_account_groups', 'fin_accounts', 'fin_cost_heads', 'fin_cost_codes', 'fin_dimension_rules', 'fin_category_mappings', 'fin_master_changes', 'fin_journals', 'fin_journal_lines', 'fin_balances', 'fin_recurring_journals', 'fin_posting_rules', 'fin_posting_log', 'fin_replay_runs', 'ap_bills', 'ap_debit_notes', 'ap_bill_adjustments'];
const TEMPLATE = ['fin_account_groups', 'fin_accounts', 'fin_cost_heads', 'fin_cost_codes', 'fin_dimension_rules', 'fin_posting_rules'];
// the integrity checks (01.02): a row without a company is the template every company copies (the seed of migration 105)
integrityRegistry.register({ allowNegative: [], companyOptional: TEMPLATE, statuses: { fin_journals: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), fin_recurring_journals: ['ACTIVE', 'PAUSED', 'ENDED'], fin_posting_rules: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), fin_replay_runs: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), ap_bills: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED'), ap_debit_notes: Object.keys(STATUS).filter((k) => k !== 'SUPERSEDED') }, uniqueKeys: [{ table: 'fin_journals', columns: ['company_id', 'doc_no'] }, { table: 'fin_recurring_journals', columns: ['company_id', 'doc_no'] }, { table: 'fin_replay_runs', columns: ['company_id', 'doc_no'] }, { table: 'fin_posting_log', columns: ['company_id', 'event_id'] }, { table: 'ap_bills', columns: ['company_id', 'doc_no'] }, { table: 'ap_debit_notes', columns: ['company_id', 'doc_no'] }] });
/** Module "fin": the finance masters (part 06.05): chart of accounts, cost heads and cost codes, financial dimensions and the item category mapping. The tables are `fin_*`. */
export const fin = {
  code: 'fin',
  name: 'Finance masters',
  routePrefix: '/api/v1/fin',
  ownerPart: '23.03',
  status: 'Chart of accounts with Schedule III mapping and control accounts, cost heads and cost codes, dimension rules and the posting check, item category mapping, import from Tally; every change approved by the CFO (06.05). The general ledger: journals of every voucher type with dimensions, approval by band, posting by period, reversal, accruals and recurring journals, the account ledger, the trial balance and the carry-forward of a year (23.01)',
  tables: TABLES,
  companyOptional: TEMPLATE,
  resources: ['accounts', 'account-groups', 'cost-heads', 'cost-codes', 'dimension-rules', 'category-mappings', 'schedule-iii', 'postings', 'changes', 'import', 'lookups', 'journals', 'recurring-journals', 'ledger', 'trial-balance', 'gl', 'posting-rules', 'postings', 'replays', 'reconciliation', 'bills', 'debit-notes', 'payables'],

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
      }
    }
    api.use('/fin', router);
  },
};
