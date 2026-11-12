import { registerModule } from '../../platform/shell/registry.js';
import StoresDashboardPage from './StoresDashboardPage.jsx';
import StoresPage from './StoresPage.jsx';
import StockBalancesPage from './StockBalancesPage.jsx';
import StockLedgerPage from './StockLedgerPage.jsx';
import StockValuationPage from './StockValuationPage.jsx';
import StockAdjustmentsPage from './StockAdjustmentsPage.jsx';
import StockPostingPage from './StockPostingPage.jsx';
import GateEntryPage from './GateEntryPage.jsx';
import GateExitPage from './GateExitPage.jsx';
import GateRegisterPage from './GateRegisterPage.jsx';
import GatePassesPage from './GatePassesPage.jsx';
import GatePassPage from './GatePassPage.jsx';
import GrnNewPage from './GrnNewPage.jsx';
import GrnsPage from './GrnsPage.jsx';
import RtvsPage from './RtvsPage.jsx';
import IssueNewPage from './IssueNewPage.jsx';
import IssuesPage from './IssuesPage.jsx';
import SiteReturnsPage from './SiteReturnsPage.jsx';
import FreeIssuePage from './FreeIssuePage.jsx';
import TransfersPage from './TransfersPage.jsx';
import TransferNewPage from './TransferNewPage.jsx';
import TransferReceivePage from './TransferReceivePage.jsx';
import InTransitPage from './InTransitPage.jsx';

import CountPlansPage from './CountPlansPage.jsx';
import BlindCountPage from './BlindCountPage.jsx';
import CountVariancePage from './CountVariancePage.jsx';
import ScrapPage from './ScrapPage.jsx';
import ReorderParamsPage from './ReorderParamsPage.jsx';
import ReorderSuggestionsPage from './ReorderSuggestionsPage.jsx';
import AgeingPage from './AgeingPage.jsx';
import LabelsPage from './LabelsPage.jsx';
import RtaDashboardPage from './RtaDashboardPage.jsx';
import RtaMovementsPage from './RtaMovementsPage.jsx';
import RtaIssuePage from './RtaIssuePage.jsx';
import RtaHirePage from './RtaHirePage.jsx';
import SmallAssetsPage from './SmallAssetsPage.jsx';
import AssetScanPage from './AssetScanPage.jsx';
import CustodyPage from './CustodyPage.jsx';
registerModule({
  code: 'inv',
  label: 'Stores and Inventory',
  routes: [
    { path: '/inv/dashboard', label: 'Stores Dashboard', icon: 'erp.group.supply', permission: 'inv.stock.view', flag: 'ff.inv.p1601', Page: StoresDashboardPage },
    { path: '/inv/stores', label: 'Stores and Bins', icon: 'erp.group.supply', permission: 'inv.store.view', flag: 'ff.inv.p1601', Page: StoresPage },
    { path: '/inv/balances', label: 'Stock Balances', icon: 'erp.group.supply', permission: 'inv.stock.view', flag: 'ff.inv.p1601', Page: StockBalancesPage },
    { path: '/inv/ledger', label: 'Stock Ledger', icon: 'erp.group.supply', permission: 'inv.stock.view', flag: 'ff.inv.p1601', Page: StockLedgerPage },
    { path: '/inv/valuation', label: 'Stock Valuation', icon: 'erp.group.supply', permission: 'inv.stock.values', flag: 'ff.inv.p1601', Page: StockValuationPage },
    { path: '/inv/adjustments', label: 'Stock Adjustments', icon: 'erp.group.supply', permission: 'inv.adjustment.view', flag: 'ff.inv.p1601', Page: StockAdjustmentsPage },
    { path: '/inv/posting', label: 'Stock Posting and Opening Stock', icon: 'erp.group.supply', permission: 'inv.stock.post', flag: 'ff.inv.p1601', Page: StockPostingPage },
    { path: '/inv/gate-entry', label: 'Gate Entry', icon: 'erp.group.supply', permission: 'inv.inward.view', flag: 'ff.inv.p1602', Page: GateEntryPage },
    { path: '/inv/gate-exit', label: 'Gate Exit Verification', icon: 'erp.group.supply', permission: 'inv.pass.verify', flag: 'ff.inv.p1602', Page: GateExitPage },
    { path: '/inv/gate-register', label: 'Gate Register', icon: 'erp.group.supply', permission: 'inv.inward.view', flag: 'ff.inv.p1602', Page: GateRegisterPage },
    { path: '/inv/gate-passes', label: 'Returnable Gate Passes', icon: 'erp.group.supply', permission: 'inv.pass.view', flag: 'ff.inv.p1602', Page: GatePassesPage },
    { path: '/inv/gate-pass', label: 'Gate Pass Request', icon: 'erp.group.supply', permission: 'inv.pass.view', flag: 'ff.inv.p1602', Page: GatePassPage },
    { path: '/inv/grn-new', label: 'Create GRN', icon: 'erp.group.supply', permission: 'inv.grn.create', flag: 'ff.inv.p1603', Page: GrnNewPage },
    { path: '/inv/grns', label: 'Goods Receipts (GRNs)', icon: 'erp.group.supply', permission: 'inv.grn.view', flag: 'ff.inv.p1603', Page: GrnsPage },
    { path: '/inv/rtvs', label: 'Returns to Vendor', icon: 'erp.group.supply', permission: 'inv.rtv.view', flag: 'ff.inv.p1603', Page: RtvsPage },
    { path: '/inv/issue-new', label: 'Issue Material', icon: 'erp.group.supply', permission: 'inv.issue.create', flag: 'ff.inv.p1604', Page: IssueNewPage },
    { path: '/inv/issues', label: 'Material Issues', icon: 'erp.group.supply', permission: 'inv.issue.view', flag: 'ff.inv.p1604', Page: IssuesPage },
    { path: '/inv/site-returns', label: 'Site Returns', icon: 'erp.group.supply', permission: 'inv.site_return.view', flag: 'ff.inv.p1604', Page: SiteReturnsPage },
    { path: '/inv/free-issue', label: 'Subcontractor Free-Issue Reconciliation', icon: 'erp.group.supply', permission: 'inv.free_issue.view', flag: 'ff.inv.p1604', Page: FreeIssuePage },
    { path: '/inv/transfers', label: 'Stock Transfers', icon: 'erp.group.supply', permission: 'inv.transfer.view', flag: 'ff.inv.p1605', Page: TransfersPage },
    { path: '/inv/transfer-new', label: 'Transfer Request', icon: 'erp.group.supply', permission: 'inv.transfer.create', flag: 'ff.inv.p1605', Page: TransferNewPage },
    { path: '/inv/transfer-receive', label: 'Receive Transfer', icon: 'erp.group.supply', permission: 'inv.transfer.receive', flag: 'ff.inv.p1605', Page: TransferReceivePage },
    { path: '/inv/in-transit', label: 'In-Transit Stock Ageing', icon: 'erp.group.supply', permission: 'inv.transfer.view', flag: 'ff.inv.p1605', Page: InTransitPage },
    { path: '/inv/count-plans', label: 'Count Plans', icon: 'erp.group.supply', permission: 'inv.count_plan.view', flag: 'ff.inv.p1606', Page: CountPlansPage },
    { path: '/inv/blind-count', label: 'Blind Count', icon: 'erp.group.supply', permission: 'inv.count_plan.count', flag: 'ff.inv.p1606', Page: BlindCountPage },
    { path: '/inv/count-variance', label: 'Count Variance', icon: 'erp.group.supply', permission: 'inv.count_plan.view', flag: 'ff.inv.p1606', Page: CountVariancePage },
    { path: '/inv/scrap', label: 'Scrap, Disposal and Expiry', icon: 'erp.group.supply', permission: 'inv.scrap_disposal.view', flag: 'ff.inv.p1606', Page: ScrapPage },
    { path: '/inv/reorder-params', label: 'Reorder Parameters', icon: 'erp.group.supply', permission: 'inv.reorder.view', flag: 'ff.inv.p1607', Page: ReorderParamsPage },
    { path: '/inv/reorder-suggestions', label: 'Reorder Suggestions', icon: 'erp.group.supply', permission: 'inv.reorder.view', flag: 'ff.inv.p1607', Page: ReorderSuggestionsPage },
    { path: '/inv/ageing', label: 'Stock Ageing and Non-moving', icon: 'erp.group.supply', permission: 'inv.ageing.view', flag: 'ff.inv.p1607', Page: AgeingPage },
    { path: '/inv/labels', label: 'Print Labels', icon: 'erp.group.supply', permission: 'inv.label.print', flag: 'ff.inv.p1607', Page: LabelsPage },
    { path: '/inv/rta', label: 'Formwork and Scaffolding', icon: 'erp.group.supply', permission: 'inv.movement.view', flag: 'ff.inv.p1608', Page: RtaDashboardPage },
    { path: '/inv/rta-movements', label: 'Returnable Asset Movements', icon: 'erp.group.supply', permission: 'inv.movement.view', flag: 'ff.inv.p1608', Page: RtaMovementsPage },
    { path: '/inv/rta-issue', label: 'Issue or Return Assets', icon: 'erp.group.supply', permission: 'inv.movement.create', flag: 'ff.inv.p1608', Page: RtaIssuePage },
    { path: '/inv/rta-hire', label: 'Hire Charges and Recoveries', icon: 'erp.group.supply', permission: 'inv.rta_hire.view', flag: 'ff.inv.p1608', Page: RtaHirePage },
    { path: '/inv/small-assets', label: 'Small Asset Register', icon: 'erp.group.supply', permission: 'inv.small_asset.view', flag: 'ff.inv.p1609', Page: SmallAssetsPage },
    { path: '/inv/asset-scan', label: 'Issue or Return by QR', icon: 'erp.group.supply', permission: 'inv.small_asset.view', flag: 'ff.inv.p1609', Page: AssetScanPage },
    { path: '/inv/custody', label: 'Custody Statement and Calibration Due', icon: 'erp.group.supply', permission: 'inv.small_asset.view', flag: 'ff.inv.p1609', Page: CustodyPage },
  ],
});
