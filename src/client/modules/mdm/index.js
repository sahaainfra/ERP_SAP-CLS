import { createElement } from 'react';
import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const BusinessPartnersPage = lazyPage(() => import('./BusinessPartnersPage.jsx'));
const ChangeRequestsPage = lazyPage(() => import('./ChangeRequestsPage.jsx'));
const PartnerApprovalsPage = lazyPage(() => import('./PartnerApprovalsPage.jsx'));
const PartnerPage = lazyPage(() => import('./PartnerPage.jsx'));
const PartnerRegistrationPage = lazyPage(() => import('./PartnerRegistrationPage.jsx'));
const CommonMasterPage = lazyPage(() => import('./CommonMasterPage.jsx'));
const ItemCategoriesPage = lazyPage(() => import('./ItemCategoriesPage.jsx'));
const ItemMasterPage = lazyPage(() => import('./ItemMasterPage.jsx'));
const ItemMigrationPage = lazyPage(() => import('./ItemMigrationPage.jsx'));
const ItemPage = lazyPage(() => import('./ItemPage.jsx'));
const NewItemPage = lazyPage(() => import('./NewItemPage.jsx'));
const LookupListManagerPage = lazyPage(() => import('./LookupListManagerPage.jsx'));
const DuplicatesPage = lazyPage(() => import('./DuplicatesPage.jsx'));
const MasterDataGovernancePage = lazyPage(() => import('./MasterDataGovernancePage.jsx'));
const MasterRecordsPage = lazyPage(() => import('./MasterRecordsPage.jsx'));
const QualityRulesPage = lazyPage(() => import('./QualityRulesPage.jsx'));
const RateAnalysesPage = lazyPage(() => import('./RateAnalysesPage.jsx'));
const RateAnalysisPage = lazyPage(() => import('./RateAnalysisPage.jsx'));
const RateImpactPage = lazyPage(() => import('./RateImpactPage.jsx'));
const RateLibraryPage = lazyPage(() => import('./RateLibraryPage.jsx'));
const SchedulesOfRatesPage = lazyPage(() => import('./SchedulesOfRatesPage.jsx'));

/** One register page per common master, all drawn by CommonMasterPage. */
// the wrapper is a few lines; the page it draws is fetched when opened (part 166.4), so the wrapper is lazy too
const register = (page) => { const Page = () => createElement(CommonMasterPage, { page }); Object.assign(Page, { displayName: `CommonMaster(${page})`, lazyPage: true, preload: CommonMasterPage.preload }); return Page; };
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
    { path: '/admin/items', label: 'Item Master', icon: 'erp.action.history', permission: 'mdm.record.view', flag: 'ff.mdm.p0603', Page: ItemMasterPage },
    { path: '/admin/items/item', label: 'Item', icon: 'erp.action.info', permission: 'mdm.record.view', flag: 'ff.mdm.p0603', Page: ItemPage },
    { path: '/admin/items/new', label: 'New Item', icon: 'erp.action.create', permission: 'mdm.record.view', flag: 'ff.mdm.p0603', Page: NewItemPage },
    { path: '/admin/items/categories', label: 'Item Categories & Attribute Templates', icon: 'erp.action.settings', permission: 'mdm.record.view', flag: 'ff.mdm.p0603', Page: ItemCategoriesPage },
    { path: '/admin/items/migration', label: 'Item Migration', icon: 'erp.action.import', permission: 'mdm.item.migrate', flag: 'ff.mdm.p0603', Page: ItemMigrationPage },
    { path: '/admin/rate-library', label: 'Resource Rate Library', icon: 'erp.action.history', permission: 'mdm.analyse.view', flag: 'ff.mdm.p0606', Page: RateLibraryPage },
    { path: '/admin/schedule-of-rates', label: 'Schedule of Rates', icon: 'erp.action.history', permission: 'mdm.analyse.view', flag: 'ff.mdm.p0606', Page: SchedulesOfRatesPage },
    { path: '/admin/rate-analyses', label: 'Rate Analyses', icon: 'erp.action.history', permission: 'mdm.analyse.view', flag: 'ff.mdm.p0606', Page: RateAnalysesPage },
    { path: '/admin/rate-analyses/analysis', label: 'Rate Analysis', icon: 'erp.action.info', permission: 'mdm.analyse.view', flag: 'ff.mdm.p0606', Page: RateAnalysisPage },
    { path: '/admin/rate-analyses/impact', label: 'Rate Change Impact', icon: 'erp.action.history', permission: 'mdm.analyse.view', flag: 'ff.mdm.p0606', Page: RateImpactPage },
    { path: '/admin/partners', label: 'Business Partners', icon: 'erp.group.supply', permission: 'mdm.record.view', flag: 'ff.mdm.p0604', Page: BusinessPartnersPage },
    { path: '/admin/partners/partner', label: 'Partner 360', icon: 'erp.action.info', permission: 'mdm.record.view', flag: 'ff.mdm.p0604', Page: PartnerPage },
    { path: '/admin/partners/new', label: 'Partner Registration', icon: 'erp.action.create', permission: 'mdm.partner.edit', flag: 'ff.mdm.p0604', Page: PartnerRegistrationPage },
    { path: '/admin/partners/approvals', label: 'Partner Approvals & Bank Changes', icon: 'erp.action.inbox', permission: 'mdm.partner.queue', flag: 'ff.mdm.p0604', Page: PartnerApprovalsPage },
  ],
});
