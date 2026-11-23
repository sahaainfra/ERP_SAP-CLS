import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Module M30 (tst): system integration, quality assurance and go-live (parts 30.01-30.03). Technical consoles for the QA lead, the technical
// lead, the CFO and the auditor; each behind its own flag.
const IntegrationMatrix = lazyPage(() => import('./IntegrationMatrix.jsx'), 'IntegrationMatrix');
const ReconHealth = lazyPage(() => import('./ReconHealth.jsx'), 'ReconHealth');
const PageAudit = lazyPage(() => import('./PageAudit.jsx'), 'PageAudit');

registerModule({
  code: 'tst', label: 'Go-live testing',
  routes: [
    { path: '/admin/integration-matrix', label: 'Integration Matrix', labelHi: 'एकीकरण मैट्रिक्स', icon: 'erp.insights.rb', permission: 'tst.integration.view', flag: 'ff.qa.p3001', Page: IntegrationMatrix },
    { path: '/admin/reconciliation-health', label: 'Reconciliation Health', labelHi: 'मिलान स्वास्थ्य', icon: 'erp.insights.rb', permission: 'tst.recon.view', flag: 'ff.qa.p3002', Page: ReconHealth },
    { path: '/admin/page-audit', label: 'Page Completion Audit', labelHi: 'पृष्ठ पूर्णता ऑडिट', icon: 'erp.insights.rb', permission: 'tst.page_audit.view', flag: 'ff.qa.p3003', Page: PageAudit },
  ],
});
