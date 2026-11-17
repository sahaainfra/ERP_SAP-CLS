import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const BdDashboardPage = lazyPage(() => import('./BdDashboardPage.jsx'));
const ClientPage = lazyPage(() => import('./ClientPage.jsx'));
const ClientsPage = lazyPage(() => import('./ClientsPage.jsx'));
const LeadPage = lazyPage(() => import('./LeadPage.jsx'));
const NewLead = lazyPage(() => import('./creators.jsx'), 'NewLead');
const NewOpportunity = lazyPage(() => import('./creators.jsx'), 'NewOpportunity');
const NewTender = lazyPage(() => import('./creators.jsx'), 'NewTender');
const BidDecisionPage = lazyPage(() => import('./BidDecisionPage.jsx'));
const BidDecisionsPage = lazyPage(() => import('./BidDecisionsPage.jsx'));
const TenderCalendarPage = lazyPage(() => import('./TenderCalendarPage.jsx'));
const TenderDashboardPage = lazyPage(() => import('./TenderDashboardPage.jsx'));
const TenderPage = lazyPage(() => import('./TenderPage.jsx'));
const TendersPage = lazyPage(() => import('./TendersPage.jsx'));
const LeadsPage = lazyPage(() => import('./LeadsPage.jsx'));
const OpportunitiesPage = lazyPage(() => import('./OpportunitiesPage.jsx'));
const OpportunityPage = lazyPage(() => import('./OpportunityPage.jsx'));
const PipelinePage = lazyPage(() => import('./PipelinePage.jsx'));
const AwardPage = lazyPage(() => import('./AwardPage.jsx'));
const AwardsPage = lazyPage(() => import('./AwardsPage.jsx'));
const BidResultsPage = lazyPage(() => import('./BidResultsPage.jsx'));
const CompetitorsPage = lazyPage(() => import('./CompetitorsPage.jsx'));
const CredentialsPage = lazyPage(() => import('./CredentialsPage.jsx'));
const EmdPage = lazyPage(() => import('./EmdPage.jsx'));
const EmdRegisterPage = lazyPage(() => import('./EmdRegisterPage.jsx'));
const SubmissionPage = lazyPage(() => import('./SubmissionPage.jsx'));

registerModule({
  code: 'bd',
  label: 'Business Development',
  routes: [
    { path: '/bd', label: 'Business Development', icon: 'erp.group.commercial', permission: 'bd.forecast.view', flag: 'ff.bd.p0801', Page: BdDashboardPage },
    { path: '/bd/leads', label: 'Leads', icon: 'erp.group.commercial', permission: 'bd.lead.view', flag: 'ff.bd.p0801', Page: LeadsPage },
    { path: '/bd/lead', label: 'Lead', menu: false, icon: 'erp.group.commercial', permission: 'bd.lead.view', flag: 'ff.bd.p0801', Page: LeadPage },
    { path: '/bd/lead/new', label: 'New Lead', menu: false, icon: 'erp.action.create', permission: 'bd.lead.create', flag: 'ff.bd.p0801', Page: NewLead },
    { path: '/bd/pipeline', label: 'Opportunity Pipeline', icon: 'erp.group.commercial', permission: 'bd.opportunity.view', flag: 'ff.bd.p0801', Page: PipelinePage },
    { path: '/bd/opportunities', label: 'Opportunities', icon: 'erp.group.commercial', permission: 'bd.opportunity.view', flag: 'ff.bd.p0801', Page: OpportunitiesPage },
    { path: '/bd/opportunity', label: 'Opportunity', menu: false, icon: 'erp.group.commercial', permission: 'bd.opportunity.view', flag: 'ff.bd.p0801', Page: OpportunityPage },
    { path: '/bd/opportunity/new', label: 'New Opportunity', menu: false, icon: 'erp.action.create', permission: 'bd.opportunity.create', flag: 'ff.bd.p0801', Page: NewOpportunity },
    { path: '/bd/clients', label: 'Clients', icon: 'erp.group.commercial', permission: 'bd.client.view', flag: 'ff.bd.p0801', Page: ClientsPage },
    { path: '/bd/client', label: 'Client 360', menu: false, icon: 'erp.group.commercial', permission: 'bd.client.view', flag: 'ff.bd.p0801', Page: ClientPage },
    { path: '/bd/tender-dashboard', label: 'Tender Dashboard', icon: 'erp.group.commercial', permission: 'bd.tender.view', flag: 'ff.bd.p0802', Page: TenderDashboardPage },
    { path: '/bd/tenders', label: 'Tender Register', icon: 'erp.group.commercial', permission: 'bd.tender.view', flag: 'ff.bd.p0802', Page: TendersPage },
    { path: '/bd/tender', label: 'Tender', menu: false, icon: 'erp.group.commercial', permission: 'bd.tender.view', flag: 'ff.bd.p0802', Page: TenderPage },
    { path: '/bd/tender/new', label: 'New Tender', menu: false, icon: 'erp.action.create', permission: 'bd.tender.create', flag: 'ff.bd.p0802', Page: NewTender },
    { path: '/bd/bid-decisions', label: 'Bid / No-Bid', icon: 'erp.group.commercial', permission: 'bd.bid_decision.view', flag: 'ff.bd.p0802', Page: BidDecisionsPage },
    { path: '/bd/bid-decision', label: 'Bid / No-Bid Evaluation', menu: false, icon: 'erp.group.commercial', permission: 'bd.bid_decision.view', flag: 'ff.bd.p0802', Page: BidDecisionPage },
    { path: '/bd/tender-calendar', label: 'Tender Calendar', icon: 'erp.group.commercial', permission: 'bd.tender.view', flag: 'ff.bd.p0802', Page: TenderCalendarPage },
    { path: '/bd/credentials', label: 'Credentials Library', icon: 'erp.group.commercial', permission: 'bd.credential.view', flag: 'ff.bd.p0803', Page: CredentialsPage },
    { path: '/bd/emd', label: 'EMD & Fee Register', icon: 'erp.group.commercial', permission: 'bd.emd.view', flag: 'ff.bd.p0803', Page: EmdRegisterPage },
    { path: '/bd/emd/record', label: 'EMD / Tender Fee', menu: false, icon: 'erp.group.commercial', permission: 'bd.emd.view', flag: 'ff.bd.p0803', Page: EmdPage },
    { path: '/bd/submission', label: 'Bid Submission', menu: false, icon: 'erp.group.commercial', permission: 'bd.submission.view', flag: 'ff.bd.p0803', Page: SubmissionPage },
    { path: '/bd/bid-results', label: 'Bid Opening Results', menu: false, icon: 'erp.group.commercial', permission: 'bd.award.view', flag: 'ff.bd.p0803', Page: BidResultsPage },
    { path: '/bd/competitors', label: 'Competitor Analysis', icon: 'erp.group.commercial', permission: 'bd.competitor.view', flag: 'ff.bd.p0803', Page: CompetitorsPage },
    { path: '/bd/award', label: 'Award / Loss', menu: false, icon: 'erp.group.commercial', permission: 'bd.award.view', flag: 'ff.bd.p0803', Page: AwardPage },
    { path: '/bd/awards', label: 'Awards & Losses', icon: 'erp.group.commercial', permission: 'bd.award.view', flag: 'ff.bd.p0803', Page: AwardsPage },
  ],
});
