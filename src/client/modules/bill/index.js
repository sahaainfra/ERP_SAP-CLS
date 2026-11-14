import { registerModule } from '../../platform/shell/registry.js';
import { MbAbstractPage, MbEntriesPage, RecordMeasurementPage } from './MbPages.jsx';

registerModule({
  code: 'bill',
  label: 'Billing',
  routes: [
    { path: '/bill/mb-record', label: 'Record Measurement', icon: 'erp.group.commercial', permission: 'bill.mb_entry.create', flag: 'ff.bill.p2201', Page: RecordMeasurementPage },
    { path: '/bill/mb-entries', label: 'Measurement Book', icon: 'erp.group.commercial', permission: 'bill.mb_entry.view', flag: 'ff.bill.p2201', Page: MbEntriesPage },
    { path: '/bill/mb-abstract', label: 'MB Abstract', icon: 'erp.group.commercial', permission: 'bill.mb_entry.view', flag: 'ff.bill.p2201', Page: MbAbstractPage },
  ],
});
