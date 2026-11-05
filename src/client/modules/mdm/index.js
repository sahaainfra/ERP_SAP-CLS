import { createElement } from 'react';
import { registerModule } from '../../platform/shell/registry.js';
import ChangeRequestsPage from './ChangeRequestsPage.jsx';
import CommonMasterPage from './CommonMasterPage.jsx';
import LookupListManagerPage from './LookupListManagerPage.jsx';
import DuplicatesPage from './DuplicatesPage.jsx';
import MasterDataGovernancePage from './MasterDataGovernancePage.jsx';
import MasterRecordsPage from './MasterRecordsPage.jsx';
import QualityRulesPage from './QualityRulesPage.jsx';

/** One register page per common master, all drawn by CommonMasterPage. */
const register = (page) => { const Page = () => createElement(CommonMasterPage, { page }); Page.displayName = `CommonMaster(${page})`; return Page; };
// Module "mdm" (parts 06.01 and 06.02): master data governance and the common masters (one register per master and the Lookup List Manager). The dashboard, the change requests worklist, the duplicates with compare and merge, the quality rules and stewards, and the records of the governed masters.
registerModule({
  code: 'mdm',
  label: 'Master Data Governance',
  routes: [
    { path: '/admin/master-data', label: 'Master Data Governance', icon: 'erp.action.settings', permission: 'mdm.governance.view', flag: 'ff.mdm.p0601', Page: MasterDataGovernancePage },
    { path: '/admin/master-data/change-requests', label: 'Master Change Requests', icon: 'erp.action.history', permission: 'mdm.record.view', flag: 'ff.mdm.p0601', Page: ChangeRequestsPage },
    { path: '/admin/master-data/duplicates', label: 'Duplicate Candidates', icon: 'erp.action.search', permission: 'mdm.governance.view', flag: 'ff.mdm.p0601', Page: DuplicatesPage },
    { path: '/admin/master-data/quality', label: 'Data Quality Rules & Stewards', icon: 'erp.action.settings', permission: 'mdm.governance.view', flag: 'ff.mdm.p0601', Page: QualityRulesPage },
    { path: '/admin/master-data/records', label: 'Master Records', icon: 'erp.action.history', permission: 'mdm.record.view', flag: 'ff.mdm.p0601', Page: MasterRecordsPage },
    { path: '/admin/master-data/common/uom', label: 'Units of Measure', icon: 'erp.action.settings', permission: 'mdm.record.view', flag: 'ff.mdm.p0602', Page: register('uom') },
    { path: '/admin/master-data/common/gst-rates', label: 'GST Rates', icon: 'erp.action.settings', permission: 'mdm.record.view', flag: 'ff.mdm.p0602', Page: register('gst-rates') },
    { path: '/admin/master-data/common/hsn-sac', label: 'HSN/SAC Codes', icon: 'erp.action.settings', permission: 'mdm.record.view', flag: 'ff.mdm.p0602', Page: register('hsn-sac') },
    { path: '/admin/master-data/common/tds-sections', label: 'TDS/TCS Sections', icon: 'erp.action.settings', permission: 'mdm.record.view', flag: 'ff.mdm.p0602', Page: register('tds-sections') },
    { path: '/admin/master-data/common/states', label: 'States & Places of Supply', icon: 'erp.action.settings', permission: 'mdm.record.view', flag: 'ff.mdm.p0602', Page: register('states') },
    { path: '/admin/master-data/common/currencies', label: 'Currencies & Exchange Rates', icon: 'erp.action.settings', permission: 'mdm.record.view', flag: 'ff.mdm.p0602', Page: register('currencies') },
    { path: '/admin/master-data/common/banks', label: 'Banks & IFSC', icon: 'erp.action.settings', permission: 'mdm.record.view', flag: 'ff.mdm.p0602', Page: register('banks') },
    { path: '/admin/master-data/common/payment-terms', label: 'Payment & Delivery Terms', icon: 'erp.action.settings', permission: 'mdm.record.view', flag: 'ff.mdm.p0602', Page: register('payment-terms') },
    { path: '/admin/master-data/common/lookups', label: 'Lookup Lists', icon: 'erp.action.settings', permission: 'mdm.record.view', flag: 'ff.mdm.p0602', Page: register('lookups') },
    { path: '/admin/master-data/lookup-manager', label: 'Lookup List Manager', icon: 'erp.action.edit', permission: 'mdm.lookup.edit', flag: 'ff.mdm.p0602', Page: LookupListManagerPage },
  ],
});
