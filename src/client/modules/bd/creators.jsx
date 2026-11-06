import LeadPage from './LeadPage.jsx';
import OpportunityPage from './OpportunityPage.jsx';

/** The same pages in their create mode (routes /bd/lead/new and /bd/opportunity/new). */
export const NewLead = () => <LeadPage create />;
export const NewOpportunity = () => <OpportunityPage create />;
