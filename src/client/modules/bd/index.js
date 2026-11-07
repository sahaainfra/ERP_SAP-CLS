import { registerModule } from '../../platform/shell/registry.js';
import BdDashboardPage from './BdDashboardPage.jsx';
import ClientPage from './ClientPage.jsx';
import ClientsPage from './ClientsPage.jsx';
import LeadPage from './LeadPage.jsx';
import { NewLead, NewOpportunity, NewTender } from './creators.jsx';
import BidDecisionPage from './BidDecisionPage.jsx';
import BidDecisionsPage from './BidDecisionsPage.jsx';
import TenderCalendarPage from './TenderCalendarPage.jsx';
import TenderDashboardPage from './TenderDashboardPage.jsx';
import TenderPage from './TenderPage.jsx';
import TendersPage from './TendersPage.jsx';
import LeadsPage from './LeadsPage.jsx';
import OpportunitiesPage from './OpportunitiesPage.jsx';
import OpportunityPage from './OpportunityPage.jsx';
import PipelinePage from './PipelinePage.jsx';
import AwardPage from './AwardPage.jsx';
import AwardsPage from './AwardsPage.jsx';
import BidResultsPage from './BidResultsPage.jsx';
import CompetitorsPage from './CompetitorsPage.jsx';
import CredentialsPage from './CredentialsPage.jsx';
import EmdPage from './EmdPage.jsx';
import EmdRegisterPage from './EmdRegisterPage.jsx';
import SubmissionPage from './SubmissionPage.jsx';

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
