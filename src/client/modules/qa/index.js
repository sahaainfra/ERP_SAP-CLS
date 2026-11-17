import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const ItpPage = lazyPage(() => import('./ItpPage.jsx'));
const TemplatesPage = lazyPage(() => import('./TemplatesPage.jsx'));
const PerformPage = lazyPage(() => import('./PerformPage.jsx'));
const InspectionsPage = lazyPage(() => import('./InspectionsPage.jsx'));
const InspectionRequestsPage = lazyPage(() => import('./InspectionRequestsPage.jsx'));
const IrRaisePage = lazyPage(() => import('./InspectionRequestsPage.jsx'), 'IrRaisePage');
const IrAnalysisPage = lazyPage(() => import('./IrAnalysisPage.jsx'));
const ReceivingPage = lazyPage(() => import('./ReceivingPage.jsx'));
const TestRequestsPage = lazyPage(() => import('./TestRequestsPage.jsx'));
const ComplianceReportPage = lazyPage(() => import('./ComplianceReportPage.jsx'));
const LabEquipmentPage = lazyPage(() => import('./LabEquipmentPage.jsx'));
const TestCataloguePage = lazyPage(() => import('./TestCataloguePage.jsx'));
const NcrsPage = lazyPage(() => import('./NcrsPage.jsx'));
const NcrRaisePage = lazyPage(() => import('./NcrsPage.jsx'), 'NcrRaisePage');
const NcrAnalysisPage = lazyPage(() => import('./NcrAnalysisPage.jsx'));
const PourCardsPage = lazyPage(() => import('./PourCardsPage.jsx'));
const CubeRegisterPage = lazyPage(() => import('./CubeRegisterPage.jsx'));
const AcceptancePage = lazyPage(() => import('./ConcretePages.jsx'), 'AcceptancePage');
const TraceabilityPage = lazyPage(() => import('./ConcretePages.jsx'), 'TraceabilityPage');
const SnagWalkPage = lazyPage(() => import('./SnagWalkPage.jsx'));
const SnagsPage = lazyPage(() => import('./SnagsPage.jsx'));
const SnagStatusPage = lazyPage(() => import('./SnagReportsPage.jsx'), 'SnagStatusPage');
const SnagReportPage = lazyPage(() => import('./SnagReportsPage.jsx'), 'SnagReportPage');
const DashboardPage = lazyPage(() => import('./DashboardPage.jsx'));
const ControlChartsPage = lazyPage(() => import('./ControlChartsPage.jsx'));
const RatingsPage = lazyPage(() => import('./RatingsPage.jsx'));

registerModule({
  code: 'qa',
  label: 'Quality',
  routes: [
    { path: '/qa/itps', label: 'ITP Library', icon: 'erp.qhse.qa', permission: 'qa.itp.view', flag: 'ff.qa.p1801', Page: ItpPage },
    { path: '/qa/templates', label: 'Checklist Templates', icon: 'erp.qhse.qa', permission: 'qa.template.view', flag: 'ff.qa.p1801', Page: TemplatesPage },
    { path: '/qa/perform', label: 'Perform Inspection', icon: 'erp.qhse.qa', permission: 'qa.inspection.create', flag: 'ff.qa.p1801', Page: PerformPage },
    { path: '/qa/inspection-requests', label: 'Inspection Requests', icon: 'erp.qhse.qa', permission: 'qa.inspection_request.view', flag: 'ff.qa.p1802', Page: InspectionRequestsPage },
    { path: '/qa/inspection-requests/new', label: 'Raise Inspection Request', icon: 'erp.qhse.qa', permission: 'qa.inspection_request.create', flag: 'ff.qa.p1802', Page: IrRaisePage },
    { path: '/qa/ir-analysis', label: 'IR Rejection Analysis', icon: 'erp.qhse.qa', permission: 'qa.inspection_request.view', flag: 'ff.qa.p1802', Page: IrAnalysisPage },
    { path: '/qa/receiving', label: 'Receiving Inspections', icon: 'erp.qhse.qa', permission: 'qa.test_request.view', flag: 'ff.qa.p1803', Page: ReceivingPage },
    { path: '/qa/test-requests', label: 'Test Requests', icon: 'erp.qhse.qa', permission: 'qa.test_request.view', flag: 'ff.qa.p1803', Page: TestRequestsPage },
    { path: '/qa/test-compliance', label: 'Test Frequency Compliance', icon: 'erp.qhse.qa', permission: 'qa.test_request.view', flag: 'ff.qa.p1803', Page: ComplianceReportPage },
    { path: '/qa/lab-equipment', label: 'Lab Equipment and Calibration', icon: 'erp.qhse.qa', permission: 'qa.lab_equipment.view', flag: 'ff.qa.p1803', Page: LabEquipmentPage },
    { path: '/qa/test-catalogue', label: 'Test Catalogue', icon: 'erp.qhse.qa', permission: 'qa.test_catalogue.view', flag: 'ff.qa.p1803', Page: TestCataloguePage },
    { path: '/qa/ncrs', label: 'NCR Register', icon: 'erp.qhse.qa', permission: 'qa.ncr.view', flag: 'ff.qa.p1804', Page: NcrsPage },
    { path: '/qa/ncrs/new', label: 'Raise NCR', icon: 'erp.qhse.qa', permission: 'qa.ncr.create', flag: 'ff.qa.p1804', Page: NcrRaisePage },
    { path: '/qa/ncr-analysis', label: 'NCR Analysis', icon: 'erp.qhse.qa', permission: 'qa.ncr.view', flag: 'ff.qa.p1804', Page: NcrAnalysisPage },
    { path: '/qa/pour-cards', label: 'Pour Cards', icon: 'erp.qhse.qa', permission: 'qa.pour_card.view', flag: 'ff.qa.p1805', Page: PourCardsPage },
    { path: '/qa/cubes', label: 'Cube Register', icon: 'erp.qhse.qa', permission: 'qa.pour_card.view', flag: 'ff.qa.p1805', Page: CubeRegisterPage },
    { path: '/qa/concrete-acceptance', label: 'Concrete Strength Acceptance', icon: 'erp.qhse.qa', permission: 'qa.pour_card.view', flag: 'ff.qa.p1805', Page: AcceptancePage },
    { path: '/qa/concrete-traceability', label: 'Concrete Traceability', icon: 'erp.qhse.qa', permission: 'qa.pour_card.view', flag: 'ff.qa.p1805', Page: TraceabilityPage },
    { path: '/qa/snag-walk', label: 'Snag Walk', icon: 'erp.qhse.qa', permission: 'qa.snag.create', flag: 'ff.qa.p1806', Page: SnagWalkPage },
    { path: '/qa/snags', label: 'Snag Register', icon: 'erp.qhse.qa', permission: 'qa.snag.view', flag: 'ff.qa.p1806', Page: SnagsPage },
    { path: '/qa/snag-status', label: 'Snag Status by Area and Party', icon: 'erp.qhse.qa', permission: 'qa.snag.view', flag: 'ff.qa.p1806', Page: SnagStatusPage },
    { path: '/qa/snag-report', label: 'Unit Snag Report', icon: 'erp.qhse.qa', permission: 'qa.snag.view', flag: 'ff.qa.p1806', Page: SnagReportPage },
    { path: '/qa/dashboard', label: 'Quality Dashboard', icon: 'erp.qhse.qa', permission: 'qa.dashboard.view', flag: 'ff.qa.p1807', Page: DashboardPage },
    { path: '/qa/control-charts', label: 'Concrete Control Charts', icon: 'erp.qhse.qa', permission: 'qa.dashboard.view', flag: 'ff.qa.p1807', Page: ControlChartsPage },
    { path: '/qa/ratings', label: 'Quality Ratings', icon: 'erp.qhse.qa', permission: 'qa.dashboard.view', flag: 'ff.qa.p1807', Page: RatingsPage },
    { path: '/qa/inspections', label: 'Inspections', icon: 'erp.qhse.qa', permission: 'qa.inspection.view', flag: 'ff.qa.p1801', Page: InspectionsPage },
  ],
});
