import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

const ReportCatalogue = lazyPage(() => import('./Pages.jsx'), 'ReportCatalogue');
const ReportBuilder = lazyPage(() => import('./Pages.jsx'), 'ReportBuilder');
const ReportSubscriptions = lazyPage(() => import('./Subscriptions.jsx'), 'ReportSubscriptions');
const MetricCatalogue = lazyPage(() => import('./Metrics.jsx'), 'MetricCatalogue');
const ReportUsage = lazyPage(() => import('./Subscriptions.jsx'), 'ReportUsage');
const ControlTower = lazyPage(() => import('./ControlTower.jsx'), 'ControlTower');
const ExecutiveAlerts = lazyPage(() => import('./ControlTower.jsx'), 'ExecutiveAlerts');
const MorningReport = lazyPage(() => import('./MorningReport.jsx'), 'MorningReport');
const ReportArchive = lazyPage(() => import('./MorningReport.jsx'), 'ReportArchive');

registerModule({
  code: 'bi', label: 'Reports',
  routes: [
    { path: '/bi/control-tower', label: 'Enterprise Control Tower', labelHi: 'उद्यम नियंत्रण टॉवर', icon: 'erp.insights.rb', permission: 'bi.control_tower.view', flag: 'ff.bi.p2704', Page: ControlTower },
    { path: '/bi/exec-alerts', label: 'Executive Alerts', labelHi: 'कार्यकारी चेतावनियाँ', icon: 'erp.insights.rb', permission: 'bi.exec_alert.view', flag: 'ff.bi.p2704', Page: ExecutiveAlerts },
    { path: '/bi/morning-report', label: 'Morning Report', labelHi: 'प्रातः प्रबंधन रिपोर्ट', icon: 'erp.insights.rb', permission: 'bi.morning_report.view', flag: 'ff.bi.p2705', Page: MorningReport },
    { path: '/bi/morning-reports', label: 'Report Archive', labelHi: 'रिपोर्ट संग्रह', icon: 'erp.insights.rb', permission: 'bi.morning_report.view', flag: 'ff.bi.p2705', Page: ReportArchive },
    { path: '/bi/metrics', label: 'Metric Catalogue', icon: 'erp.insights.rb', permission: 'bi.metric.catalogue.view', flag: 'ff.bi.p2703', Page: MetricCatalogue },
    { path: '/bi/reports', label: 'Report Catalogue', icon: 'erp.insights.rb', flag: 'ff.bi.p2701', Page: ReportCatalogue },
    { path: '/bi/builder', label: 'Report Builder', icon: 'erp.insights.rb', permission: 'proj.project.view', flag: 'ff.bi.p2702', Page: ReportBuilder },
    { path: '/bi/subscriptions', label: 'Report Subscriptions', icon: 'erp.insights.rb', permission: 'proj.project.export', flag: 'ff.bi.p2701', Page: ReportSubscriptions },
    { path: '/bi/usage', label: 'Report Usage', icon: 'erp.insights.rb', permission: 'core.audit.view', flag: 'ff.bi.p2701', Page: ReportUsage },
  ],
});
