import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

const ReportCatalogue = lazyPage(() => import('./Pages.jsx'), 'ReportCatalogue');
const ReportBuilder = lazyPage(() => import('./Pages.jsx'), 'ReportBuilder');
const ReportSubscriptions = lazyPage(() => import('./Subscriptions.jsx'), 'ReportSubscriptions');
const MetricCatalogue = lazyPage(() => import('./Metrics.jsx'), 'MetricCatalogue');
const ReportUsage = lazyPage(() => import('./Subscriptions.jsx'), 'ReportUsage');
const ControlTower = lazyPage(() => import('./ControlTower.jsx'), 'ControlTower');
const ExecutiveAlerts = lazyPage(() => import('./ControlTower.jsx'), 'ExecutiveAlerts');
const LeakageTower = lazyPage(() => import('./Leakage.jsx'), 'LeakageTower');
const VarianceExplainer = lazyPage(() => import('./Explain.jsx'), 'VarianceExplainer');
const MonthlyClose = lazyPage(() => import('./MonthlyClose.jsx'), 'MonthlyClose');
const ExecutionIntelligence = lazyPage(() => import('./Execution.jsx'), 'ExecutionIntelligence');
const MorningReport = lazyPage(() => import('./MorningReport.jsx'), 'MorningReport');
const ReportArchive = lazyPage(() => import('./MorningReport.jsx'), 'ReportArchive');

registerModule({
  code: 'bi', label: 'Reports',
  routes: [
    { path: '/bi/control-tower', label: 'Enterprise Control Tower', labelHi: 'उद्यम नियंत्रण टॉवर', icon: 'erp.insights.rb', permission: 'bi.control_tower.view', flag: 'ff.bi.p2704', Page: ControlTower },
    { path: '/bi/exec-alerts', label: 'Executive Alerts', labelHi: 'कार्यकारी चेतावनियाँ', icon: 'erp.insights.rb', permission: 'bi.exec_alert.view', flag: 'ff.bi.p2704', Page: ExecutiveAlerts },
    { path: '/bi/leakage', label: 'Leakage & Controls Tower', labelHi: 'रिसाव एवं नियंत्रण टॉवर', icon: 'erp.insights.rb', flag: 'ff.bi.p2709', Page: LeakageTower },
    { path: '/bi/explain', label: 'Variance Explainer', labelHi: 'विचलन विश्लेषक', icon: 'erp.insights.rb', permission: 'bi.explain.view', flag: 'ff.bi.p2708', Page: VarianceExplainer },
    { path: '/bi/monthly-close', label: 'Monthly Close Status', labelHi: 'मासिक समापन स्थिति', icon: 'erp.insights.rb', permission: 'bi.monthly_close.view', flag: 'ff.bi.p2707', Page: MonthlyClose },
    { path: '/bi/execution', label: 'Daily Execution Intelligence', labelHi: 'दैनिक निष्पादन विश्लेषण', icon: 'erp.insights.rb', permission: 'bi.execution.view', flag: 'ff.bi.p2706', Page: ExecutionIntelligence },
    { path: '/bi/morning-report', label: 'Morning Report', labelHi: 'प्रातः प्रबंधन रिपोर्ट', icon: 'erp.insights.rb', permission: 'bi.morning_report.view', flag: 'ff.bi.p2705', Page: MorningReport },
    { path: '/bi/morning-reports', label: 'Report Archive', labelHi: 'रिपोर्ट संग्रह', icon: 'erp.insights.rb', permission: 'bi.morning_report.view', flag: 'ff.bi.p2705', Page: ReportArchive },
    { path: '/bi/metrics', label: 'Metric Catalogue', icon: 'erp.insights.rb', permission: 'bi.metric.catalogue.view', flag: 'ff.bi.p2703', Page: MetricCatalogue },
    { path: '/bi/reports', label: 'Report Catalogue', icon: 'erp.insights.rb', flag: 'ff.bi.p2701', Page: ReportCatalogue },
    { path: '/bi/builder', label: 'Report Builder', icon: 'erp.insights.rb', permission: 'proj.project.view', flag: 'ff.bi.p2702', Page: ReportBuilder },
    { path: '/bi/subscriptions', label: 'Report Subscriptions', icon: 'erp.insights.rb', permission: 'proj.project.export', flag: 'ff.bi.p2701', Page: ReportSubscriptions },
    { path: '/bi/usage', label: 'Report Usage', icon: 'erp.insights.rb', permission: 'core.audit.view', flag: 'ff.bi.p2701', Page: ReportUsage },
  ],
});
