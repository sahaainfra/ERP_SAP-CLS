import { registerModule } from '../../platform/shell/registry.js';
import ChangeRequestsPage from './ChangeRequestsPage.jsx';
import DuplicatesPage from './DuplicatesPage.jsx';
import MasterDataGovernancePage from './MasterDataGovernancePage.jsx';
import MasterRecordsPage from './MasterRecordsPage.jsx';
import QualityRulesPage from './QualityRulesPage.jsx';

// Module "mdm" (part 06.01): master data governance. The dashboard, the change requests worklist, the duplicates with compare and merge, the quality rules and stewards, and the records of the governed masters.
registerModule({
  code: 'mdm',
  label: 'Master Data Governance',
  routes: [
    { path: '/admin/master-data', label: 'Master Data Governance', icon: 'erp.action.settings', permission: 'mdm.governance.view', flag: 'ff.mdm.p0601', Page: MasterDataGovernancePage },
    { path: '/admin/master-data/change-requests', label: 'Master Change Requests', icon: 'erp.action.history', permission: 'mdm.record.view', flag: 'ff.mdm.p0601', Page: ChangeRequestsPage },
    { path: '/admin/master-data/duplicates', label: 'Duplicate Candidates', icon: 'erp.action.search', permission: 'mdm.governance.view', flag: 'ff.mdm.p0601', Page: DuplicatesPage },
    { path: '/admin/master-data/quality', label: 'Data Quality Rules & Stewards', icon: 'erp.action.settings', permission: 'mdm.governance.view', flag: 'ff.mdm.p0601', Page: QualityRulesPage },
    { path: '/admin/master-data/records', label: 'Master Records', icon: 'erp.action.history', permission: 'mdm.record.view', flag: 'ff.mdm.p0601', Page: MasterRecordsPage },
  ],
});
