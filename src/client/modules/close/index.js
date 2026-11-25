import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Module M26 (close): project closeout. Parts 26.01 commissioning, 26.02 handover, 26.03 defects liability and 26.04 closeout; each part behind its own flag.
const Commissioning = lazyPage(() => import('./Commissioning.jsx'), 'Commissioning');
const CommissioningSystem = lazyPage(() => import('./Commissioning.jsx'), 'CommissioningSystem');
const TestPacks = lazyPage(() => import('./Commissioning.jsx'), 'TestPacks');
const Certificates = lazyPage(() => import('./Commissioning.jsx'), 'Certificates');
const Handovers = lazyPage(() => import('./Handover.jsx'), 'Handovers');
const Handover = lazyPage(() => import('./Handover.jsx'), 'Handover');
const ClientAssets = lazyPage(() => import('./Handover.jsx'), 'ClientAssets');
const DlpOverview = lazyPage(() => import('./Dlp.jsx'), 'DlpOverview');
const DlpPeriod = lazyPage(() => import('./Dlp.jsx'), 'DlpPeriod');
const DlpComplaints = lazyPage(() => import('./Dlp.jsx'), 'DlpComplaints');
const Closures = lazyPage(() => import('./Closure.jsx'), 'Closures');
const Closure = lazyPage(() => import('./Closure.jsx'), 'Closure');
const Lessons = lazyPage(() => import('./Closure.jsx'), 'Lessons');
const BenchmarkReport = lazyPage(() => import('./Closure.jsx'), 'BenchmarkReport');

registerModule({
  code: 'close', label: 'Commissioning & Closeout',
  routes: [
    { path: '/close/commissioning', label: 'Commissioning', labelHi: 'कमीशनिंग', icon: 'erp.state.approved', permission: 'tnc.view', flag: 'ff.close.p2601', Page: Commissioning },
    { path: '/close/commissioning/system', label: 'Commissioning System', menu: false, icon: 'erp.state.approved', permission: 'tnc.view', flag: 'ff.close.p2601', Page: CommissioningSystem },
    { path: '/close/test-packs', label: 'Test Packs', labelHi: 'परीक्षण पैक', icon: 'erp.action.list', permission: 'tnc.view', flag: 'ff.close.p2601', Page: TestPacks },
    { path: '/close/certificates', label: 'Commissioning Certificates', labelHi: 'कमीशनिंग प्रमाणपत्र', icon: 'erp.state.approved', permission: 'tnc.view', flag: 'ff.close.p2601', Page: Certificates },
    { path: '/close/handovers', label: 'Handovers', labelHi: 'हस्तांतरण', icon: 'erp.state.approved', permission: 'ho.view', flag: 'ff.close.p2602', Page: Handovers },
    { path: '/close/handover', label: 'Handover', menu: false, icon: 'erp.state.approved', permission: 'ho.view', flag: 'ff.close.p2602', Page: Handover },
    { path: '/close/client-assets', label: 'Client Asset Register', labelHi: 'ग्राहक परिसंपत्ति रजिस्टर', icon: 'erp.action.list', permission: 'ho.view', flag: 'ff.close.p2602', Page: ClientAssets },
    { path: '/close/dlp', label: 'Defects Liability', labelHi: 'दोष दायित्व', icon: 'erp.state.approved', permission: 'dlp.view', flag: 'ff.close.p2603', Page: DlpOverview },
    { path: '/close/dlp/period', label: 'Defects Liability Period', menu: false, icon: 'erp.state.approved', permission: 'dlp.view', flag: 'ff.close.p2603', Page: DlpPeriod },
    { path: '/close/dlp/complaints', label: 'DLP Complaints', labelHi: 'दोष दायित्व शिकायतें', icon: 'erp.action.list', permission: 'dlp.view', flag: 'ff.close.p2603', Page: DlpComplaints },
    { path: '/close/closures', label: 'Project Closeout', labelHi: 'परियोजना समापन', icon: 'erp.state.approved', permission: 'cls.view', flag: 'ff.close.p2604', Page: Closures },
    { path: '/close/closure', label: 'Project Closeout Record', menu: false, icon: 'erp.state.approved', permission: 'cls.view', flag: 'ff.close.p2604', Page: Closure },
    { path: '/close/lessons', label: 'Lessons Learned', labelHi: 'सीखे गए सबक', icon: 'erp.action.list', permission: 'kb.lesson.view', flag: 'ff.close.p2604', Page: Lessons },
    { path: '/close/benchmarks', label: 'Benchmarks', labelHi: 'बेंचमार्क', icon: 'erp.insights.rb', permission: 'kb.benchmark.view', flag: 'ff.close.p2604', Page: BenchmarkReport },
  ],
});
