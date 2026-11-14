import { registerModule } from '../../platform/shell/registry.js';
import PlantsPage from './PlantsPage.jsx';
import MixDesignsPage from './MixPages.jsx';
import { BatchesPage, ProductionBoardPage, RequisitionsPage } from './ProductionPages.jsx';
import { CostReportPage, CostingDashboardPage, TransferRatesPage } from './CostingPages.jsx';
import { ConsumptionPage, ReceiptPage, TicketsPage } from './TicketPages.jsx';

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
