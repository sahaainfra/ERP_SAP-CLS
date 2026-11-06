import LeadPage from './LeadPage.jsx';
import OpportunityPage from './OpportunityPage.jsx';
import TenderPage from './TenderPage.jsx';

/** The same pages in their create mode (routes /bd/lead/new, /bd/opportunity/new and /bd/tender/new). */
export const NewLead = () => <LeadPage create />;
export const NewOpportunity = () => <OpportunityPage create />;
export const NewTender = () => <TenderPage create />;
