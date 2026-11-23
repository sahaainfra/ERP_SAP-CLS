import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Module M30 (tst): system integration, quality assurance and go-live (parts 30.01-30.06). Technical consoles for the QA lead, the technical
// lead, the CFO and the auditor; each behind its own flag.
const IntegrationMatrix = lazyPage(() => import('./IntegrationMatrix.jsx'), 'IntegrationMatrix');
const ReconHealth = lazyPage(() => import('./ReconHealth.jsx'), 'ReconHealth');
const PageAudit = lazyPage(() => import('./PageAudit.jsx'), 'PageAudit');
const TestCoverage = lazyPage(() => import('./TestCoverage.jsx'), 'TestCoverage');
const SecurityFindings = lazyPage(() => import('./SecurityFindings.jsx'), 'SecurityFindings');
const PerfResults = lazyPage(() => import('./PerfResults.jsx'), 'PerfResults');

registerModule({
  code: 'tst', label: 'Go-live testing',
  routes: [
    { path: '/admin/integration-matrix', label: 'Integration Matrix', labelHi: 'एकीकरण मैट्रिक्स', icon: 'erp.insights.rb', permission: 'tst.integration.view', flag: 'ff.qa.p3001', Page: IntegrationMatrix },
    { path: '/admin/reconciliation-health', label: 'Reconciliation Health', labelHi: 'मिलान स्वास्थ्य', icon: 'erp.insights.rb', permission: 'tst.recon.view', flag: 'ff.qa.p3002', Page: ReconHealth },
    { path: '/admin/page-audit', label: 'Page Completion Audit', labelHi: 'पृष्ठ पूर्णता ऑडिट', icon: 'erp.insights.rb', permission: 'tst.page_audit.view', flag: 'ff.qa.p3003', Page: PageAudit },
    { path: '/admin/test-coverage', label: 'Test Coverage & Results', labelHi: 'परीक्षण कवरेज और परिणाम', icon: 'erp.insights.rb', permission: 'tst.catalogue.view', flag: 'ff.qa.p3004', Page: TestCoverage },
    { path: '/admin/security-findings', label: 'Security Findings & Remediation', labelHi: 'सुरक्षा निष्कर्ष और सुधार', icon: 'erp.insights.rb', permission: 'sct.finding.view', flag: 'ff.qa.p3005', Page: SecurityFindings },
    { path: '/admin/performance-tests', label: 'Performance Test Results', labelHi: 'प्रदर्शन परीक्षण परिणाम', icon: 'erp.insights.rb', permission: 'tst.perf.view', flag: 'ff.qa.p3006', Page: PerfResults },
  ],
});
