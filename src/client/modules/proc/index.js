import { registerModule } from '../../platform/shell/registry.js';
import MaterialRequestNewPage from './MaterialRequestNewPage.jsx';
import MaterialRequestsPage from './MaterialRequestsPage.jsx';
import RequisitionsPage from './RequisitionsPage.jsx';
import ConsolidatePage from './ConsolidatePage.jsx';

registerModule({
  code: 'proc',
  label: 'Procurement',
  routes: [
    { path: '/proc/material-requests/new', label: 'New Material Request', icon: 'erp.group.supply', permission: 'proc.material_request.create', flag: 'ff.proc.p1501', Page: MaterialRequestNewPage },
    { path: '/proc/material-requests', label: 'Material Requests', icon: 'erp.group.supply', permission: 'proc.material_request.view', flag: 'ff.proc.p1501', Page: MaterialRequestsPage },
    { path: '/proc/requisitions', label: 'Purchase Requisitions', icon: 'erp.group.supply', permission: 'proc.requisition.view', flag: 'ff.proc.p1501', Page: RequisitionsPage },
    { path: '/proc/consolidate', label: 'Consolidate MRs into PR', icon: 'erp.group.supply', permission: 'proc.requisition.create', flag: 'ff.proc.p1501', Page: ConsolidatePage },
  ],
});
