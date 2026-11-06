import { registerModule } from '../../platform/shell/registry.js';
import ComparePage from './ComparePage.jsx';
import EstimatePage from './EstimatePage.jsx';
import EstimatesPage from './EstimatesPage.jsx';
import ImportBoqPage from './ImportBoqPage.jsx';
import NewEstimatePage from './NewEstimatePage.jsx';
import ResourcesPage from './ResourcesPage.jsx';

registerModule({
  code: 'est',
  label: 'Estimation',
  routes: [
    { path: '/est/estimates', label: 'Estimates', icon: 'erp.group.commercial', permission: 'est.estimate.view', flag: 'ff.est.p0901', Page: EstimatesPage },
    { path: '/est/estimate', label: 'Estimate', icon: 'erp.group.commercial', permission: 'est.estimate.view', flag: 'ff.est.p0901', Page: EstimatePage },
    { path: '/est/estimate/new', label: 'New Estimate', icon: 'erp.action.create', permission: 'est.estimate.create', flag: 'ff.est.p0901', Page: NewEstimatePage },
    { path: '/est/import', label: 'Import Client BOQ', icon: 'erp.action.import', permission: 'est.estimate.import', flag: 'ff.est.p0901', Page: ImportBoqPage },
    { path: '/est/compare', label: 'Version Comparison', icon: 'erp.group.insights', permission: 'est.estimate.view', flag: 'ff.est.p0901', Page: ComparePage },
    { path: '/est/resources', label: 'Resource Summary', icon: 'erp.group.insights', permission: 'est.estimate.view', flag: 'ff.est.p0901', Page: ResourcesPage },
  ],
});
