import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

const ReportCatalogue = lazyPage(() => import('./Pages.jsx'), 'ReportCatalogue');
const ReportBuilder = lazyPage(() => import('./Pages.jsx'), 'ReportBuilder');
const ReportSubscriptions = lazyPage(() => import('./Subscriptions.jsx'), 'ReportSubscriptions');
const MetricCatalogue = lazyPage(() => import('./Metrics.jsx'), 'MetricCatalogue');
const ReportUsage = lazyPage(() => import('./Subscriptions.jsx'), 'ReportUsage');

registerModule({
  code: 'bi', label: 'Reports',
  routes: [
    { path: '/bi/metrics', label: 'Metric Catalogue', icon: 'erp.insights.rb', permission: 'bi.metric.catalogue.view', flag: 'ff.bi.p2703', Page: MetricCatalogue },
    { path: '/bi/reports', label: 'Report Catalogue', icon: 'erp.insights.rb', flag: 'ff.bi.p2701', Page: ReportCatalogue },
    { path: '/bi/builder', label: 'Report Builder', icon: 'erp.insights.rb', permission: 'proj.project.view', flag: 'ff.bi.p2702', Page: ReportBuilder },
    { path: '/bi/subscriptions', label: 'Report Subscriptions', icon: 'erp.insights.rb', permission: 'proj.project.export', flag: 'ff.bi.p2701', Page: ReportSubscriptions },
    { path: '/bi/usage', label: 'Report Usage', icon: 'erp.insights.rb', permission: 'core.audit.view', flag: 'ff.bi.p2701', Page: ReportUsage },
  ],
});
