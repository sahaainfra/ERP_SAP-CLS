import { registerModule } from '../../platform/shell/registry.js';
import { DeviationsPage } from './DeviationPages.jsx';
import { MbAbstractPage, MbEntriesPage, RecordMeasurementPage } from './MbPages.jsx';
import { QtyLimitsPage, QtyReconPage } from './ReconPages.jsx';

registerModule({
  code: 'bill',
  label: 'Billing',
  routes: [
    { path: '/bill/mb-record', label: 'Record Measurement', icon: 'erp.group.commercial', permission: 'bill.mb_entry.create', flag: 'ff.bill.p2201', Page: RecordMeasurementPage },
    { path: '/bill/mb-entries', label: 'Measurement Book', icon: 'erp.group.commercial', permission: 'bill.mb_entry.view', flag: 'ff.bill.p2201', Page: MbEntriesPage },
    { path: '/bill/mb-abstract', label: 'MB Abstract', icon: 'erp.group.commercial', permission: 'bill.mb_entry.view', flag: 'ff.bill.p2201', Page: MbAbstractPage },
    { path: '/bill/qty-recon', label: 'Quantity Reconciliation', icon: 'erp.group.commercial', permission: 'bill.qty_recon.view', flag: 'ff.bill.p2202', Page: QtyReconPage },
    { path: '/bill/qty-limits', label: 'Items Approaching Limit', icon: 'erp.group.commercial', permission: 'bill.qty_recon.view', flag: 'ff.bill.p2202', Page: QtyLimitsPage },
    { path: '/bill/deviations', label: 'Deviation Statements', icon: 'erp.group.commercial', permission: 'bill.deviation_statement.view', flag: 'ff.bill.p2202', Page: DeviationsPage },
  ],
});
