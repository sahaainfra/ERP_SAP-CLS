import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExports, listExportsOf } from '../../platform/list/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { createFlagService } from '../core/api.js';
import { bindCrm, createCrmService } from './crm.js';
import './crm-integrations.js';
import { crmRoutes } from './crm-routes.js';
import { bindTenders, createTenderService } from './tender.js';
import './tender-integrations.js';
import { tenderRoutes } from './tender-routes.js';
import { bindAwards, createAwardService } from './award.js';
import './award-integrations.js';
import { awardRoutes } from './award-routes.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['bd.lead.created', 'A lead was recorded: data { docNo, source, sector, estValue }.'],
  ['bd.lead.qualified', 'A lead passed the qualification review: data { docNo, score, estValue }.'],
  ['bd.lead.converted', 'A qualified lead became an opportunity: data { docNo, opportunityId, opportunityNo }.'],
  ['bd.lead.amended', 'A qualified lead was amended and goes through the review again: data { docNo, amendmentNo }.'],
  ['bd.lead.cancelled', 'A lead was cancelled: data { docNo, reason }.'],
  ['bd.opportunity.created', 'An opportunity was recorded (from the form, a lead or an import): data { docNo, clientPartnerId, stage, estValue, leadId }.'],
  ['bd.opportunity.approved', 'The go-ahead for tendering was given: data { docNo, clientPartnerId, estValue, name }.'],
  ['bd.opportunity.amended', 'An approved opportunity was amended and needs the go-ahead again: data { docNo, amendmentNo }.'],
  ['bd.opportunity.cancelled', 'An opportunity was cancelled: data { docNo, reason }.'],
  ['bd.opportunity.stage_changed', 'An opportunity moved in the pipeline: data { docNo, from, to, probability }.'],
  ['bd.opportunity.lost', 'An opportunity was lost: data { docNo, reasonCode, lostTo, estValue, sector, region }.'],
  ['bd.opportunity.won', 'An opportunity was won, by a tender award or an approved direct award: data { opportunityId, docNo, via, clientPartnerId, name, sector, region, wonValue, tenderRef }. Contracts (09) and project set-up (10) start from it.'],
  ['bd.opportunity.converted', 'An approved opportunity is converted to a tender (08.02 makes the tender): data { opportunityId, docNo, clientPartnerId, name, sector, location, region, estValue, expectedTenderDate, expectedAwardDate, competitors, owner, notes }.'],
  ['bd.interaction.logged', 'A call, meeting, site visit, e-mail or note was logged against a lead, an opportunity or a client: data { entity, entityId, type, clientPartnerId, nextActionDate }.'],
  ['bd.tender.created', 'A tender was recorded (from the form, an import or the conversion of an opportunity): data { docNo, clientPartnerId, opportunityId, estCost }.'],
  ['bd.tender.registered', 'The registration of a tender was approved: data { tenderId, docNo, clientPartnerId, opportunityId, estCost, submissionAt }.'],
  ['bd.tender.amended', 'A registered tender was amended and is checked again: data { docNo, amendmentNo }.'],
  ['bd.tender.cancelled', 'A tender was cancelled: data { docNo, reason }.'],
  ['bd.tender.bid_decided', 'The decision to bid or not to bid was approved: data { tenderId, docNo, decision, score, opportunityId }.'],
  ['bd.tender.addendum_issued', 'An addendum or corrigendum was recorded; a tender that was ready goes back to preparation: data { tenderId, docNo, number, kind, impact, newSubmissionAt, backToPreparation }.'],
  ['bd.tender.query_answered', 'A clarification to a pre-bid query was received: data { tenderId, docNo, clauseRef }.'],
  ['bd.tender.ready', 'A tender is ready for submission (registered, bid decision approved, eligibility complete, addenda read): data { tenderId, docNo, opportunityId, clientPartnerId, nameOfWork, estCost, emd, tenderFee, bidType, periodMonths, submissionAt, openingAt, region, bidCapacity }. Estimation (09.01) and submission (08.03) start from it.'],
  ['bd.tender.submitted', 'The bid of a tender was submitted (08.03 tells the register): data { tenderId, docNo, submittedOn }.'],
  ['bd.emd.requested', 'An EMD or tender fee was approved and is asked of finance (a bank guarantee to securities 21.02, a payment to 23.04): data { emdId, docNo, tenderId, kind, mode, amount, payee, neededBy, bankGuarantee }.'],
  ['bd.emd.issued', 'Accounts recorded the instrument of an EMD or fee: data { emdId, docNo, tenderId, kind, mode, amount, validUntil }.'],
  ['bd.emd.refund_changed', 'The refund of an EMD was asked for, received, forfeited or adjusted: data { emdId, docNo, tenderId, status, on, amount }.'],
  ['bd.submission.approved', 'The final bid was approved (estimation, then the director): data { submissionId, docNo, tenderId, bidAmount, estimate, adjustment, estimateSource }.'],
  ['bd.tender.opened', 'The prices of a tender opening were recorded and ranked: data { tenderId, docNo, openedOn, bidders, ourRank, ourQuoted, l1 }.'],
  ['tdr.tender.awarded', 'A tender was awarded to us (letter of acceptance, approved by the director): data { tenderId, docNo, awardId, opportunityId, clientPartnerId, nameOfWork, location, region, loaNo, loaDate, awardedValue, periodMonths, bidType, owner }. Project set-up (10.02) makes the project from it.'],
  ['tdr.tender.lost', 'A tender was lost: data { tenderId, docNo, awardId, opportunityId, reasonCode, awardedTo }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'bd', description });

const TABLES = ['bd_leads', 'bd_opportunities', 'bd_interactions', 'bd_contacts', 'bd_stage_log', 'bd_amendments', 'tdr_tenders', 'tdr_eligibility', 'tdr_bid_decisions', 'tdr_addenda', 'tdr_queries', 'tdr_team_tasks', 'tdr_date_log', 'tdr_amendments', 'tdr_credentials', 'tdr_tender_credentials', 'tdr_emd', 'tdr_submissions', 'tdr_competitors', 'tdr_bid_results', 'tdr_negotiations', 'tdr_awards'];
integrityRegistry.register({
  allowNegative: [], companyOptional: [],
  statuses: { bd_leads: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CONVERTED'], bd_opportunities: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], tdr_tenders: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], tdr_bid_decisions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], tdr_emd: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], tdr_submissions: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'], tdr_awards: ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED'] },
  uniqueKeys: [{ table: 'bd_leads', columns: ['company_id', 'doc_no'] }, { table: 'bd_opportunities', columns: ['company_id', 'doc_no'] }, { table: 'tdr_tenders', columns: ['company_id', 'doc_no'] }, { table: 'tdr_bid_decisions', columns: ['company_id', 'doc_no'] }, { table: 'tdr_emd', columns: ['company_id', 'doc_no'] }, { table: 'tdr_awards', columns: ['company_id', 'doc_no'] }, { table: 'tdr_submissions', columns: ['company_id', 'doc_no'] }, { table: 'tdr_credentials', columns: ['company_id', 'doc_no'] }],
});
/** Module "bd": CRM, business development and tendering (M08). Part 08.01 holds leads, clients, contacts, interactions and the opportunity pipeline. The tables are `bd_*`. */
export const bd = {
  code: 'bd',
  name: 'CRM & Business Development',
  routePrefix: '/api/v1/bd',
  ownerPart: '08.01, 08.02, 08.03',
  status: 'Leads from sources with a BANT-like qualification and a review, opportunities with the go-ahead for tendering, pipeline stages with default probabilities, the weighted forecast, win and loss analysis, interactions with follow-up tasks, client contacts with an influence map, Client 360, Excel import',
  tables: TABLES,
  companyOptional: [],
  resources: ['leads', 'opportunities', 'interactions', 'clients', 'contacts', 'reports', 'tenders', 'eligibility', 'addenda', 'queries', 'team-tasks', 'bid-decisions', 'tender-reports', 'credentials', 'emd', 'submissions', 'competitors', 'competitor-reports', 'awards'],

  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bd_leads'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const crm = createCrmService({ db });
    bindCrm(db, crm);
    const runtime = runtimeOf(db);
    listExports.register('bd.leads', { source: (actor, req) => crm.leads.exportSource(actor, req), hidden: () => [] });
    listExports.register('bd.opportunities', { source: (actor, req) => crm.opportunities.exportSource(actor, req), hidden: () => [] });
    const companies = () => db.prepare('SELECT id FROM org_companies').all().map((r) => r.id);
    runtime.jobs.register('bd.daily', () => { const out = { reminded: 0 }; for (const c of companies()) out.reminded += crm.cycle(c).reminded; return out; }, { maxAttempts: 3 });
    runtime.scheduler.define({ code: 'bd.daily_followups', cron: '40 1 * * *', jobType: 'bd.daily', description: 'Daily (01:40): the next actions of the interactions that are due (or due soon, by the setting) are told to their owners once.' });
    try {
      widgetRegistry.register({ code: 'bd.weighted_forecast', provider: (ctx) => { const w = crm.widget(ctx.actor); return { value: w.value, unit: '₹ weighted forecast', previous: null, trendPct: null, target: null, status: 'green', note: `${w.count} open opportunities` }; } });
    } catch { /* registered once per process */ }
    const router = Router();
    router.use(gate('ff.bd.p0801', 'Business development is'));
    router.use(crmRoutes({ crm, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
    api.use('/bd', router);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tdr_tenders'").get()) {
      const tdr = createTenderService({ db });
      bindTenders(db, tdr);
      listExports.register('bd.tenders', { source: (actor, req) => tdr.tenders.exportSource(actor, req), hidden: () => [] });
      listExports.register('bd.bid_decisions', { source: (actor, req) => tdr.decisions.exportSource(actor, req), hidden: () => [] });
      runtime.jobs.register('bd.tender_daily', () => { const out = { reminded: 0 }; for (const c of companies()) out.reminded += tdr.cycle(c).reminded; return out; }, { maxAttempts: 3 });
      runtime.scheduler.define({ code: 'bd.tender_daily_reminders', cron: '50 1 * * *', jobType: 'bd.tender_daily', description: 'Daily (01:50): the owner and the team of a tender are reminded on the days before the pre-bid meeting, the submission and the opening (and before a team task is due), once for each date.' });
      try {
        widgetRegistry.register({ code: 'bd.tender_deadlines', provider: (ctx) => { const w = tdr.widget(ctx.actor); return { value: w.value, unit: w.value === 1 ? 'tender submission this week' : 'tender submissions this week', previous: null, trendPct: null, target: null, status: w.value > 0 ? 'amber' : 'green', note: 'Tenders whose submission falls in the next seven days' }; } });
      } catch { /* registered once per process */ }
      const tr = Router();
      tr.use(gate('ff.bd.p0802', 'The tender register is'));
      tr.use(tenderRoutes({ tdr, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/bd', tr);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tdr_awards'").get()) {
      const aw = createAwardService({ db });
      bindAwards(db, aw);
      listExports.register('bd.emd', { source: (actor, req) => aw.emd.exportSource(actor, req), hidden: () => [] });
      listExports.register('bd.awards', { source: (actor, req) => aw.awards.exportSource(actor, req), hidden: () => [] });
      listExports.register('bd.credentials', { source: (actor, req) => aw.credentials.exportSource(actor, req), hidden: () => [] });
      runtime.jobs.register('bd.emd_daily', () => { const out = { followUps: 0, expiring: 0 }; for (const c of companies()) { const r = aw.cycle(c); out.followUps += r.followUps; out.expiring += r.expiring; } return out; }, { maxAttempts: 3 });
      runtime.scheduler.define({ code: 'bd.emd_daily_followups', cron: '55 1 * * *', jobType: 'bd.emd_daily', description: 'Daily (01:55): EMDs not refunded N days after the result are followed up (and every N days after); bank guarantees that end soon are told to accounts.' });
      const ar = Router();
      ar.use(gate('ff.bd.p0803', 'Prequalification, EMD, submission and award are'));
      ar.use(awardRoutes({ aw, exportsOf: () => listExportsOf(db) }, { idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }) }));
      api.use('/bd', ar);
    }
  },
};
