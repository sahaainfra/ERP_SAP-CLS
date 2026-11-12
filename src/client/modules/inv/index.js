import { registerModule } from '../../platform/shell/registry.js';
import StoresDashboardPage from './StoresDashboardPage.jsx';
import StoresPage from './StoresPage.jsx';
import StockBalancesPage from './StockBalancesPage.jsx';
import StockLedgerPage from './StockLedgerPage.jsx';
import StockValuationPage from './StockValuationPage.jsx';
import StockAdjustmentsPage from './StockAdjustmentsPage.jsx';
import StockPostingPage from './StockPostingPage.jsx';

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
  ],
});
