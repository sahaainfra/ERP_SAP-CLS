import { registerModule } from '../../platform/shell/registry.js';
import BdDashboardPage from './BdDashboardPage.jsx';
import ClientPage from './ClientPage.jsx';
import ClientsPage from './ClientsPage.jsx';
import LeadPage from './LeadPage.jsx';
import { NewLead, NewOpportunity } from './creators.jsx';
import LeadsPage from './LeadsPage.jsx';
import OpportunitiesPage from './OpportunitiesPage.jsx';
import OpportunityPage from './OpportunityPage.jsx';
import PipelinePage from './PipelinePage.jsx';

registerModule({
  code: 'bd',
  label: 'Business Development',
  routes: [
    { path: '/bd', label: 'Business Development', icon: 'erp.group.commercial', permission: 'bd.forecast.view', flag: 'ff.bd.p0801', Page: BdDashboardPage },
    { path: '/bd/leads', label: 'Leads', icon: 'erp.group.commercial', permission: 'bd.lead.view', flag: 'ff.bd.p0801', Page: LeadsPage },
    { path: '/bd/lead', label: 'Lead', icon: 'erp.group.commercial', permission: 'bd.lead.view', flag: 'ff.bd.p0801', Page: LeadPage },
    { path: '/bd/lead/new', label: 'New Lead', icon: 'erp.action.create', permission: 'bd.lead.create', flag: 'ff.bd.p0801', Page: NewLead },
    { path: '/bd/pipeline', label: 'Opportunity Pipeline', icon: 'erp.group.commercial', permission: 'bd.opportunity.view', flag: 'ff.bd.p0801', Page: PipelinePage },
    { path: '/bd/opportunities', label: 'Opportunities', icon: 'erp.group.commercial', permission: 'bd.opportunity.view', flag: 'ff.bd.p0801', Page: OpportunitiesPage },
    { path: '/bd/opportunity', label: 'Opportunity', icon: 'erp.group.commercial', permission: 'bd.opportunity.view', flag: 'ff.bd.p0801', Page: OpportunityPage },
    { path: '/bd/opportunity/new', label: 'New Opportunity', icon: 'erp.action.create', permission: 'bd.opportunity.create', flag: 'ff.bd.p0801', Page: NewOpportunity },
    { path: '/bd/clients', label: 'Clients', icon: 'erp.group.commercial', permission: 'bd.client.view', flag: 'ff.bd.p0801', Page: ClientsPage },
    { path: '/bd/client', label: 'Client 360', icon: 'erp.group.commercial', permission: 'bd.client.view', flag: 'ff.bd.p0801', Page: ClientPage },
  ],
});
