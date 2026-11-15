import { registerModule } from '../../platform/shell/registry.js';
import { InvoiceHubPage, RegisterVendorInvoicePage, VendorInvoicesPage } from './VinvPages.jsx';
import { PrepareSubBillPage, SubBillsPage, SubMeasurePage } from './SubPages.jsx';
import { CertAnalysisPage, CertificationsPage, RecordCertificationPage } from './CertPages.jsx';
import { TaxInvoicesPage } from './InvoicePages.jsx';
import { BillAbstractPage, ClientBillsPage, PrepareBillPage } from './ClientBillPages.jsx';
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
    { path: '/bill/client-bills', label: 'Client Bills', icon: 'erp.group.commercial', permission: 'bill.client_bill.view', flag: 'ff.bill.p2203', Page: ClientBillsPage },
    { path: '/bill/client-bill-new', label: 'Prepare RA Bill', icon: 'erp.group.commercial', permission: 'bill.client_bill.create', flag: 'ff.bill.p2203', Page: PrepareBillPage },
    { path: '/bill/client-bill-abstract', label: 'Bill Abstract', icon: 'erp.group.commercial', permission: 'bill.client_bill.view', flag: 'ff.bill.p2203', Page: BillAbstractPage },
    { path: '/bill/certification-new', label: 'Record Certification', icon: 'erp.group.commercial', permission: 'bill.certification.create', flag: 'ff.bill.p2204', Page: RecordCertificationPage },
    { path: '/bill/certifications', label: 'Certifications', icon: 'erp.group.commercial', permission: 'bill.certification.view', flag: 'ff.bill.p2204', Page: CertificationsPage },
    { path: '/bill/tax-invoices', label: 'Tax Invoices', icon: 'erp.group.commercial', permission: 'bill.tax_invoice.view', flag: 'ff.bill.p2204', Page: TaxInvoicesPage },
    { path: '/bill/cert-analysis', label: 'Submitted vs Certified', icon: 'erp.group.commercial', permission: 'bill.certification.view', flag: 'ff.bill.p2204', Page: CertAnalysisPage },
    { path: '/bill/sub-measure', label: 'Subcontractor Measurement', icon: 'erp.group.commercial', permission: 'bill.sub_measure.view', flag: 'ff.bill.p2205', Page: SubMeasurePage },
    { path: '/bill/sub-bills', label: 'Subcontractor Bills', icon: 'erp.group.commercial', permission: 'bill.sub_bill.view', flag: 'ff.bill.p2205', Page: SubBillsPage },
    { path: '/bill/sub-bill-new', label: 'Prepare Subcontractor Bill', icon: 'erp.group.commercial', permission: 'bill.sub_bill.create', flag: 'ff.bill.p2205', Page: PrepareSubBillPage },
    { path: '/bill/vendor-invoices', label: 'Invoice Matching Queue', icon: 'erp.group.commercial', permission: 'bill.vendor_invoice.view', flag: 'ff.bill.p2206', Page: VendorInvoicesPage },
    { path: '/bill/vendor-invoice-new', label: 'Register Vendor Invoice', icon: 'erp.group.commercial', permission: 'bill.vendor_invoice.create', flag: 'ff.bill.p2206', Page: RegisterVendorInvoicePage },
    { path: '/bill/invoice-hub', label: 'Invoice Management Hub', icon: 'erp.group.commercial', permission: 'bill.invoice_hub.view', flag: 'ff.bill.p2206', Page: InvoiceHubPage },
  ],
});
