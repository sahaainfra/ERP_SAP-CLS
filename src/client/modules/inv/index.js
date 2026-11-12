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
  ],
});
