import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const ComparePage = lazyPage(() => import('./ComparePage.jsx'));
const EstimatePage = lazyPage(() => import('./EstimatePage.jsx'));
const EstimatesPage = lazyPage(() => import('./EstimatesPage.jsx'));
const ImportBoqPage = lazyPage(() => import('./ImportBoqPage.jsx'));
const NewEstimatePage = lazyPage(() => import('./NewEstimatePage.jsx'));
const ResourcesPage = lazyPage(() => import('./ResourcesPage.jsx'));
const BbsListPage = lazyPage(() => import('./BbsListPage.jsx'));
const BbsSheetPage = lazyPage(() => import('./BbsSheetPage.jsx'));
const BbsSummaryPage = lazyPage(() => import('./BbsSummaryPage.jsx'));
const MtoDeltaPage = lazyPage(() => import('./MtoDeltaPage.jsx'));
const MtoExplosionPage = lazyPage(() => import('./MtoExplosionPage.jsx'));
const TakeoffPage = lazyPage(() => import('./TakeoffPage.jsx'));
const TakeoffsPage = lazyPage(() => import('./TakeoffsPage.jsx'));
const BidPricePage = lazyPage(() => import('./BidPricePage.jsx'));
const ReviewPage = lazyPage(() => import('./ReviewPage.jsx'));

registerModule({
  code: 'est',
  label: 'Estimation',
  routes: [
    { path: '/est/estimates', label: 'Estimates', icon: 'erp.group.commercial', permission: 'est.estimate.view', flag: 'ff.est.p0901', Page: EstimatesPage },
    { path: '/est/estimate', label: 'Estimate', menu: false, icon: 'erp.group.commercial', permission: 'est.estimate.view', flag: 'ff.est.p0901', Page: EstimatePage },
    { path: '/est/estimate/new', label: 'New Estimate', menu: false, icon: 'erp.action.create', permission: 'est.estimate.create', flag: 'ff.est.p0901', Page: NewEstimatePage },
    { path: '/est/import', label: 'Import Client BOQ', icon: 'erp.action.import', permission: 'est.estimate.import', flag: 'ff.est.p0901', Page: ImportBoqPage },
    { path: '/est/compare', label: 'Version Comparison', icon: 'erp.group.insights', permission: 'est.estimate.view', flag: 'ff.est.p0901', Page: ComparePage },
    { path: '/est/resources', label: 'Resource Summary', icon: 'erp.group.insights', permission: 'est.estimate.view', flag: 'ff.est.p0901', Page: ResourcesPage },
    { path: '/est/takeoffs', label: 'Take-off Sheets', icon: 'erp.group.engineering', permission: 'est.takeoff.view', flag: 'ff.est.p0902', Page: TakeoffsPage },
    { path: '/est/takeoff', label: 'Take-off Sheet', menu: false, icon: 'erp.group.engineering', permission: 'est.takeoff.view', flag: 'ff.est.p0902', Page: TakeoffPage },
    { path: '/est/bbs', label: 'Bar Bending Schedules', icon: 'erp.group.engineering', permission: 'est.bb.view', flag: 'ff.est.p0902', Page: BbsListPage },
    { path: '/est/bbs/sheet', label: 'BBS Editor', menu: false, icon: 'erp.group.engineering', permission: 'est.bb.view', flag: 'ff.est.p0902', Page: BbsSheetPage },
    { path: '/est/bbs-summary', label: 'BBS Summary by Diameter', icon: 'erp.group.insights', permission: 'est.bb.view', flag: 'ff.est.p0902', Page: BbsSummaryPage },
    { path: '/est/mto-delta', label: 'Revision Delta Report', icon: 'erp.group.insights', permission: 'est.takeoff.view', flag: 'ff.est.p0902', Page: MtoDeltaPage },
    { path: '/est/mto-explosion', label: 'Material Requirement Explosion', icon: 'erp.group.insights', permission: 'est.takeoff.view', flag: 'ff.est.p0902', Page: MtoExplosionPage },
    { path: '/est/review', label: 'Estimate Review', icon: 'erp.group.commercial', permission: 'est.review.view', flag: 'ff.est.p0903', Page: ReviewPage },
    { path: '/est/bid-price', label: 'Bid Price Finalisation', icon: 'erp.group.commercial', permission: 'est.review.view', flag: 'ff.est.p0903', Page: BidPricePage },
  ],
});
