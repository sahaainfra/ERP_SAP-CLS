import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const QsDashboardPage = lazyPage(() => import('./QsDashboardPage.jsx'));
const CvrPage = lazyPage(() => import('./CvrPages.jsx'));
const ControlTowerPage = lazyPage(() => import('./CvrPages.jsx'), 'ControlTowerPage');
const AdvancesPage = lazyPage(() => import('./LedgerPages.jsx'), 'AdvancesPage');
const ReleasesPage = lazyPage(() => import('./LedgerPages.jsx'), 'ReleasesPage');
const RetentionPage = lazyPage(() => import('./LedgerPages.jsx'), 'RetentionPage');
const InvoiceHubPage = lazyPage(() => import('./VinvPages.jsx'), 'InvoiceHubPage');
const RegisterVendorInvoicePage = lazyPage(() => import('./VinvPages.jsx'), 'RegisterVendorInvoicePage');
const VendorInvoicesPage = lazyPage(() => import('./VinvPages.jsx'), 'VendorInvoicesPage');
const PrepareSubBillPage = lazyPage(() => import('./SubPages.jsx'), 'PrepareSubBillPage');
const SubBillsPage = lazyPage(() => import('./SubPages.jsx'), 'SubBillsPage');
const SubMeasurePage = lazyPage(() => import('./SubPages.jsx'), 'SubMeasurePage');
const CertAnalysisPage = lazyPage(() => import('./CertPages.jsx'), 'CertAnalysisPage');
const CertificationsPage = lazyPage(() => import('./CertPages.jsx'), 'CertificationsPage');
const RecordCertificationPage = lazyPage(() => import('./CertPages.jsx'), 'RecordCertificationPage');
const TaxInvoicesPage = lazyPage(() => import('./InvoicePages.jsx'), 'TaxInvoicesPage');
const BillAbstractPage = lazyPage(() => import('./ClientBillPages.jsx'), 'BillAbstractPage');
const ClientBillsPage = lazyPage(() => import('./ClientBillPages.jsx'), 'ClientBillsPage');
const PrepareBillPage = lazyPage(() => import('./ClientBillPages.jsx'), 'PrepareBillPage');
const DeviationsPage = lazyPage(() => import('./DeviationPages.jsx'), 'DeviationsPage');
const MbAbstractPage = lazyPage(() => import('./MbPages.jsx'), 'MbAbstractPage');
const MbEntriesPage = lazyPage(() => import('./MbPages.jsx'), 'MbEntriesPage');
const RecordMeasurementPage = lazyPage(() => import('./MbPages.jsx'), 'RecordMeasurementPage');
const QtyLimitsPage = lazyPage(() => import('./ReconPages.jsx'), 'QtyLimitsPage');
const QtyReconPage = lazyPage(() => import('./ReconPages.jsx'), 'QtyReconPage');

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
    { path: '/bill/cvr', label: 'CVR Workbench', icon: 'erp.group.commercial', permission: 'bill.report.view', flag: 'ff.bill.p2209', Page: CvrPage },
    { path: '/bill/control-tower', label: 'Contract Control Tower', icon: 'erp.group.commercial', permission: 'bill.control_tower.view', flag: 'ff.bill.p2209', Page: ControlTowerPage },
    { path: '/bill/qs-dashboard', label: 'QS Management Dashboard', icon: 'erp.group.commercial', permission: 'bill.qs_dashboard.view', flag: 'ff.bill.p2208', Page: QsDashboardPage },
    { path: '/bill/retention', label: 'Retention Summary', icon: 'erp.group.commercial', permission: 'bill.retention.view', flag: 'ff.bill.p2207', Page: RetentionPage },
    { path: '/bill/advances', label: 'Advances', icon: 'erp.group.commercial', permission: 'bill.advance.view', flag: 'ff.bill.p2207', Page: AdvancesPage },
    { path: '/bill/releases', label: 'Release Requests', icon: 'erp.group.commercial', permission: 'bill.release.view', flag: 'ff.bill.p2207', Page: ReleasesPage },
  ],
});
