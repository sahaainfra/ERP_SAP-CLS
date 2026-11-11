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
  ],
});
