import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const StoresDashboardPage = lazyPage(() => import('./StoresDashboardPage.jsx'));
const StoresPage = lazyPage(() => import('./StoresPage.jsx'));
const StockBalancesPage = lazyPage(() => import('./StockBalancesPage.jsx'));
const StockLedgerPage = lazyPage(() => import('./StockLedgerPage.jsx'));
const StockValuationPage = lazyPage(() => import('./StockValuationPage.jsx'));
const StockAdjustmentsPage = lazyPage(() => import('./StockAdjustmentsPage.jsx'));
const StockPostingPage = lazyPage(() => import('./StockPostingPage.jsx'));
const GateEntryPage = lazyPage(() => import('./GateEntryPage.jsx'));
const GateExitPage = lazyPage(() => import('./GateExitPage.jsx'));
const GateRegisterPage = lazyPage(() => import('./GateRegisterPage.jsx'));
const GatePassesPage = lazyPage(() => import('./GatePassesPage.jsx'));
const GatePassPage = lazyPage(() => import('./GatePassPage.jsx'));
const GrnNewPage = lazyPage(() => import('./GrnNewPage.jsx'));
const GrnsPage = lazyPage(() => import('./GrnsPage.jsx'));
const RtvsPage = lazyPage(() => import('./RtvsPage.jsx'));
const IssueNewPage = lazyPage(() => import('./IssueNewPage.jsx'));
const IssuesPage = lazyPage(() => import('./IssuesPage.jsx'));
const SiteReturnsPage = lazyPage(() => import('./SiteReturnsPage.jsx'));
const FreeIssuePage = lazyPage(() => import('./FreeIssuePage.jsx'));
const TransfersPage = lazyPage(() => import('./TransfersPage.jsx'));
const TransferNewPage = lazyPage(() => import('./TransferNewPage.jsx'));
const TransferReceivePage = lazyPage(() => import('./TransferReceivePage.jsx'));
const InTransitPage = lazyPage(() => import('./InTransitPage.jsx'));
const CountPlansPage = lazyPage(() => import('./CountPlansPage.jsx'));
const BlindCountPage = lazyPage(() => import('./BlindCountPage.jsx'));
const CountVariancePage = lazyPage(() => import('./CountVariancePage.jsx'));
const ScrapPage = lazyPage(() => import('./ScrapPage.jsx'));
const ReorderParamsPage = lazyPage(() => import('./ReorderParamsPage.jsx'));
const ReorderSuggestionsPage = lazyPage(() => import('./ReorderSuggestionsPage.jsx'));
const AgeingPage = lazyPage(() => import('./AgeingPage.jsx'));
const LabelsPage = lazyPage(() => import('./LabelsPage.jsx'));
const RtaDashboardPage = lazyPage(() => import('./RtaDashboardPage.jsx'));
const RtaMovementsPage = lazyPage(() => import('./RtaMovementsPage.jsx'));
const RtaIssuePage = lazyPage(() => import('./RtaIssuePage.jsx'));
const RtaHirePage = lazyPage(() => import('./RtaHirePage.jsx'));
const SmallAssetsPage = lazyPage(() => import('./SmallAssetsPage.jsx'));
const AssetScanPage = lazyPage(() => import('./AssetScanPage.jsx'));
const CustodyPage = lazyPage(() => import('./CustodyPage.jsx'));
const ReconciliationsPage = lazyPage(() => import('./ReconciliationsPage.jsx'));
const WastageTrendPage = lazyPage(() => import('./WastageTrendPage.jsx'));
const MaterialsDashboardPage = lazyPage(() => import('./MaterialsDashboardPage.jsx'));
const MaterialFunnelPage = lazyPage(() => import('./MaterialFunnelPage.jsx'));

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
    { path: '/inv/asset-scan', label: 'Issue or Return by QR', icon: 'erp.group.supply', permission: 'inv.small_asset.acknowledge', flag: 'ff.inv.p1609', Page: AssetScanPage },
    { path: '/inv/custody', label: 'Custody Statement and Calibration Due', icon: 'erp.group.supply', permission: 'inv.small_asset.view', flag: 'ff.inv.p1609', Page: CustodyPage },
    { path: '/inv/reconciliations', label: 'Monthly Material Reconciliation', icon: 'erp.group.supply', permission: 'inv.reconciliation.view', flag: 'ff.inv.p1610', Page: ReconciliationsPage },
    { path: '/inv/wastage-trend', label: 'Wastage Trend', icon: 'erp.group.supply', permission: 'inv.reconciliation.view', flag: 'ff.inv.p1610', Page: WastageTrendPage },
    { path: '/inv/materials-dashboard', label: 'Materials Management Dashboard', icon: 'erp.group.supply', permission: 'inv.dashboard.view', flag: 'ff.inv.p1611', Page: MaterialsDashboardPage },
    { path: '/inv/material-funnel', label: 'Material Lifecycle Funnel', icon: 'erp.group.supply', permission: 'inv.dashboard.view', flag: 'ff.inv.p1611', Page: MaterialFunnelPage },
  ],
});
