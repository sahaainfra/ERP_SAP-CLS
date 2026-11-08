import { registerModule } from '../../platform/shell/registry.js';
import DrawingPage from './DrawingPage.jsx';
import DrawingsDashboardPage from './DrawingsDashboardPage.jsx';
import DrawingsPage from './DrawingsPage.jsx';
import SiteDrawingsPage from './SiteDrawingsPage.jsx';
import TransmittalPage from './TransmittalPage.jsx';
import TransmittalsPage from './TransmittalsPage.jsx';

registerModule({
  code: 'engg',
  label: 'Engineering and Drawings',
  routes: [
    { path: '/engg/dashboard', label: 'Drawings Dashboard', icon: 'erp.group.projects', permission: 'engg.drawing.view', flag: 'ff.engg.p1101', Page: DrawingsDashboardPage },
    { path: '/engg/drawings', label: 'Drawing Register', icon: 'erp.group.projects', permission: 'engg.drawing.view', flag: 'ff.engg.p1101', Page: DrawingsPage },
    { path: '/engg/drawing', label: 'Drawing', menu: false, icon: 'erp.group.projects', permission: 'engg.drawing.view', flag: 'ff.engg.p1101', Page: DrawingPage },
    { path: '/engg/transmittals', label: 'Transmittals', icon: 'erp.group.projects', permission: 'engg.transmittal.view', flag: 'ff.engg.p1101', Page: TransmittalsPage },
    { path: '/engg/transmittal', label: 'Transmittal', menu: false, icon: 'erp.group.projects', permission: 'engg.transmittal.view', flag: 'ff.engg.p1101', Page: TransmittalPage },
    { path: '/engg/site', label: 'Current Drawings for my Site', icon: 'erp.group.projects', permission: 'engg.drawing.view', flag: 'ff.engg.p1101', Page: SiteDrawingsPage },
  ],
});
