import { registerModule } from '../../platform/shell/registry.js';
import MaterialRequestNewPage from './MaterialRequestNewPage.jsx';
import MaterialRequestsPage from './MaterialRequestsPage.jsx';
import RequisitionsPage from './RequisitionsPage.jsx';
import ConsolidatePage from './ConsolidatePage.jsx';
import MrpPage from './MrpPage.jsx';
import MrpProposalsPage from './MrpProposalsPage.jsx';
import MrpHeatmapPage from './MrpHeatmapPage.jsx';
import ItemParamsPage from './ItemParamsPage.jsx';
import RfqsPage from './RfqsPage.jsx';
import RfqNewPage from './RfqNewPage.jsx';
import QuotationEntryPage from './QuotationEntryPage.jsx';
import ComparativeStatementsPage from './ComparativeStatementsPage.jsx';
import PurchaseOrdersPage from './PurchaseOrdersPage.jsx';
import PoNewPage from './PoNewPage.jsx';
import PoAmendPage from './PoAmendPage.jsx';
import PoTrackerPage from './PoTrackerPage.jsx';
import RateContractsPage from './RateContractsPage.jsx';
import ServiceOrdersPage from './ServiceOrdersPage.jsx';
import ServiceEntriesPage from './ServiceEntriesPage.jsx';
import ExpeditingDashboardPage from './ExpeditingDashboardPage.jsx';
import ExpeditingPlansPage from './ExpeditingPlansPage.jsx';
import InspectionsPage from './InspectionsPage.jsx';
import ShipmentsPage from './ShipmentsPage.jsx';
import PrequalificationsPage from './PrequalificationsPage.jsx';
import AvlPage from './AvlPage.jsx';
import VendorScorecardsPage from './VendorScorecardsPage.jsx';
import VendorRankingPage from './VendorRankingPage.jsx';
import RateIntelligencePage from './RateIntelligencePage.jsx';
import RateExposurePage from './RateExposurePage.jsx';
import RateSurveyPage from './RateSurveyPage.jsx';
import ProcDashboardPage from './ProcDashboardPage.jsx';
import SpendAnalysisPage from './SpendAnalysisPage.jsx';
import CycleTimePage from './CycleTimePage.jsx';
import ProcurementCompliancePage from './ProcurementCompliancePage.jsx';

registerModule({
  code: 'proc',
  label: 'Procurement',
  routes: [
    { path: '/proc/material-requests/new', label: 'New Material Request', icon: 'erp.group.supply', permission: 'proc.material_request.create', flag: 'ff.proc.p1501', Page: MaterialRequestNewPage },
    { path: '/proc/material-requests', label: 'Material Requests', icon: 'erp.group.supply', permission: 'proc.material_request.view', flag: 'ff.proc.p1501', Page: MaterialRequestsPage },
    { path: '/proc/requisitions', label: 'Purchase Requisitions', icon: 'erp.group.supply', permission: 'proc.requisition.view', flag: 'ff.proc.p1501', Page: RequisitionsPage },
    { path: '/proc/consolidate', label: 'Consolidate MRs into PR', icon: 'erp.group.supply', permission: 'proc.requisition.create', flag: 'ff.proc.p1501', Page: ConsolidatePage },
    { path: '/proc/mrp', label: 'Run MRP', icon: 'erp.group.supply', permission: 'proc.run.view', flag: 'ff.proc.p1502', Page: MrpPage },
    { path: '/proc/mrp-proposals', label: 'PR Proposals', icon: 'erp.group.supply', permission: 'proc.run.view', flag: 'ff.proc.p1502', Page: MrpProposalsPage },
    { path: '/proc/mrp-heatmap', label: 'Shortage Heat-map and Long-Lead Items', icon: 'erp.group.supply', permission: 'proc.run.view', flag: 'ff.proc.p1502', Page: MrpHeatmapPage },
    { path: '/proc/item-params', label: 'Item Planning Parameters', icon: 'erp.group.supply', permission: 'proc.item_param.view', flag: 'ff.proc.p1502', Page: ItemParamsPage },
    { path: '/proc/rfqs', label: 'RFQs', icon: 'erp.group.supply', permission: 'proc.rfq.view', flag: 'ff.proc.p1503', Page: RfqsPage },
    { path: '/proc/rfq-new', label: 'Create RFQ from PRs', icon: 'erp.group.supply', permission: 'proc.rfq.create', flag: 'ff.proc.p1503', Page: RfqNewPage },
    { path: '/proc/quotation-entry', label: 'Quotation Entry', icon: 'erp.group.supply', permission: 'proc.quotation.view', flag: 'ff.proc.p1503', Page: QuotationEntryPage },
    { path: '/proc/comparative-statements', label: 'Comparative Statements', icon: 'erp.group.supply', permission: 'proc.comparative_statement.view', flag: 'ff.proc.p1504', Page: ComparativeStatementsPage },
    { path: '/proc/purchase-orders', label: 'Purchase Orders', icon: 'erp.group.supply', permission: 'proc.purchase_order.view', flag: 'ff.proc.p1505', Page: PurchaseOrdersPage },
    { path: '/proc/po-new', label: 'Create Purchase Order', icon: 'erp.group.supply', permission: 'proc.purchase_order.create', flag: 'ff.proc.p1505', Page: PoNewPage },
    { path: '/proc/po-amend', label: 'Purchase Order Amendment', icon: 'erp.group.supply', permission: 'proc.purchase_order.amend', flag: 'ff.proc.p1505', Page: PoAmendPage },
    { path: '/proc/po-tracker', label: 'Open PO and Delivery Tracker', icon: 'erp.group.supply', permission: 'proc.purchase_order.view', flag: 'ff.proc.p1505', Page: PoTrackerPage },
    { path: '/proc/rate-contracts', label: 'Rate Contracts', icon: 'erp.group.supply', permission: 'proc.rate_contract.view', flag: 'ff.proc.p1506', Page: RateContractsPage },
    { path: '/proc/service-orders', label: 'Service Orders', icon: 'erp.group.supply', permission: 'proc.service_order.view', flag: 'ff.proc.p1506', Page: ServiceOrdersPage },
    { path: '/proc/service-entries', label: 'Service Entry Sheets', icon: 'erp.group.supply', permission: 'proc.service_entry.view', flag: 'ff.proc.p1506', Page: ServiceEntriesPage },
    { path: '/proc/expediting', label: 'Expediting Dashboard', icon: 'erp.group.supply', permission: 'proc.expediting_plan.view', flag: 'ff.proc.p1507', Page: ExpeditingDashboardPage },
    { path: '/proc/expediting-plans', label: 'Expediting Plans', icon: 'erp.group.supply', permission: 'proc.expediting_plan.view', flag: 'ff.proc.p1507', Page: ExpeditingPlansPage },
    { path: '/proc/inspections', label: 'Vendor Inspections', icon: 'erp.group.supply', permission: 'proc.inspection.view', flag: 'ff.proc.p1507', Page: InspectionsPage },
    { path: '/proc/shipments', label: 'Shipments Tracker', icon: 'erp.group.supply', permission: 'proc.shipment.view', flag: 'ff.proc.p1507', Page: ShipmentsPage },
    { path: '/proc/prequalifications', label: 'Vendor Prequalifications', icon: 'erp.group.supply', permission: 'proc.prequalification.view', flag: 'ff.proc.p1508', Page: PrequalificationsPage },
    { path: '/proc/avl', label: 'Approved Vendor List', icon: 'erp.group.supply', permission: 'proc.avl.view', flag: 'ff.proc.p1508', Page: AvlPage },
    { path: '/proc/vendor-scorecards', label: 'Vendor Scorecards', icon: 'erp.group.supply', permission: 'proc.vendor_score.view', flag: 'ff.proc.p1508', Page: VendorScorecardsPage },
    { path: '/proc/vendor-ranking', label: 'Vendor Ranking', icon: 'erp.group.supply', permission: 'proc.vendor_score.view', flag: 'ff.proc.p1508', Page: VendorRankingPage },
    { path: '/proc/rate-intelligence', label: 'Rate Intelligence', icon: 'erp.group.supply', permission: 'proc.rate_intel.view', flag: 'ff.proc.p1509', Page: RateIntelligencePage },
    { path: '/proc/rate-exposure', label: 'Project Rate Exposure', icon: 'erp.group.supply', permission: 'proc.rate_intel.view', flag: 'ff.proc.p1509', Page: RateExposurePage },
    { path: '/proc/rate-survey', label: 'Market Survey and Index Upload', icon: 'erp.group.supply', permission: 'proc.rate_intel.survey', flag: 'ff.proc.p1509', Page: RateSurveyPage },
    { path: '/proc/dashboard', label: 'Procurement Dashboard', icon: 'erp.group.supply', permission: 'proc.analytics.view', flag: 'ff.proc.p1510', Page: ProcDashboardPage },
    { path: '/proc/spend-analysis', label: 'Spend Analysis', icon: 'erp.group.supply', permission: 'proc.analytics.view', flag: 'ff.proc.p1510', Page: SpendAnalysisPage },
    { path: '/proc/cycle-time', label: 'Procurement Cycle Time', icon: 'erp.group.supply', permission: 'proc.analytics.view', flag: 'ff.proc.p1510', Page: CycleTimePage },
    { path: '/proc/procurement-compliance', label: 'Procurement Compliance', icon: 'erp.group.supply', permission: 'proc.analytics.view', flag: 'ff.proc.p1510', Page: ProcurementCompliancePage },
  ],
});
