import { registerModule } from '../../platform/shell/registry.js';
import ComparePage from './ComparePage.jsx';
import EstimatePage from './EstimatePage.jsx';
import EstimatesPage from './EstimatesPage.jsx';
import ImportBoqPage from './ImportBoqPage.jsx';
import NewEstimatePage from './NewEstimatePage.jsx';
import ResourcesPage from './ResourcesPage.jsx';
import BbsListPage from './BbsListPage.jsx';
import BbsSheetPage from './BbsSheetPage.jsx';
import BbsSummaryPage from './BbsSummaryPage.jsx';
import MtoDeltaPage from './MtoDeltaPage.jsx';
import MtoExplosionPage from './MtoExplosionPage.jsx';
import TakeoffPage from './TakeoffPage.jsx';
import TakeoffsPage from './TakeoffsPage.jsx';
import BidPricePage from './BidPricePage.jsx';
import ReviewPage from './ReviewPage.jsx';

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
