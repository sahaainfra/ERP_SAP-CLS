import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const PlantsPage = lazyPage(() => import('./PlantsPage.jsx'));
const MixDesignsPage = lazyPage(() => import('./MixPages.jsx'));
const BatchesPage = lazyPage(() => import('./ProductionPages.jsx'), 'BatchesPage');
const ProductionBoardPage = lazyPage(() => import('./ProductionPages.jsx'), 'ProductionBoardPage');
const RequisitionsPage = lazyPage(() => import('./ProductionPages.jsx'), 'RequisitionsPage');
const CostReportPage = lazyPage(() => import('./CostingPages.jsx'), 'CostReportPage');
const CostingDashboardPage = lazyPage(() => import('./CostingPages.jsx'), 'CostingDashboardPage');
const TransferRatesPage = lazyPage(() => import('./CostingPages.jsx'), 'TransferRatesPage');
const ConsumptionPage = lazyPage(() => import('./TicketPages.jsx'), 'ConsumptionPage');
const ReceiptPage = lazyPage(() => import('./TicketPages.jsx'), 'ReceiptPage');
const TicketsPage = lazyPage(() => import('./TicketPages.jsx'), 'TicketsPage');

registerModule({
  code: 'rmc',
  label: 'Batching Plant',
  routes: [
    { path: '/rmc/plants', label: 'Batching Plants', icon: 'erp.group.plant', permission: 'rmc.plant.view', flag: 'ff.rmc.p2001', Page: PlantsPage },
    { path: '/rmc/mix-designs', label: 'Mix Designs', icon: 'erp.group.plant', permission: 'rmc.mix_design.view', flag: 'ff.rmc.p2001', Page: MixDesignsPage },
    { path: '/rmc/requisitions', label: 'Concrete Requisitions', icon: 'erp.group.plant', permission: 'rmc.requisition.view', flag: 'ff.rmc.p2002', Page: RequisitionsPage },
    { path: '/rmc/production', label: 'Production Schedule', icon: 'erp.group.plant', permission: 'rmc.requisition.view', flag: 'ff.rmc.p2002', Page: ProductionBoardPage },
    { path: '/rmc/batches', label: 'Batch Records', icon: 'erp.group.plant', permission: 'rmc.batch.view', flag: 'ff.rmc.p2002', Page: BatchesPage },
    { path: '/rmc/delivery-tickets', label: 'Delivery Tickets', icon: 'erp.group.plant', permission: 'rmc.delivery_ticket.view', flag: 'ff.rmc.p2002', Page: TicketsPage },
    { path: '/rmc/receipt', label: 'Ticket Receipt at Site', icon: 'erp.group.plant', permission: 'rmc.delivery_ticket.receive', flag: 'ff.rmc.p2002', Page: ReceiptPage },
    { path: '/rmc/consumption', label: 'Theoretical vs Actual Consumption', icon: 'erp.group.plant', permission: 'rmc.consumption.view', flag: 'ff.rmc.p2002', Page: ConsumptionPage },
    { path: '/rmc/costing', label: 'Batching Plant Costing', icon: 'erp.group.plant', permission: 'rmc.cost.view', flag: 'ff.rmc.p2003', Page: CostingDashboardPage },
    { path: '/rmc/cost-report', label: 'Cost per m3 by Grade', icon: 'erp.group.plant', permission: 'rmc.cost.view', flag: 'ff.rmc.p2003', Page: CostReportPage },
    { path: '/rmc/transfer-rates', label: 'Internal Transfer Rates', icon: 'erp.group.plant', permission: 'rmc.transfer_rate.view', flag: 'ff.rmc.p2003', Page: TransferRatesPage },
  ],
});
