import { registerModule } from '../../platform/shell/registry.js';
import DrawingPage from './DrawingPage.jsx';
import DrawingsDashboardPage from './DrawingsDashboardPage.jsx';
import DrawingsPage from './DrawingsPage.jsx';
import DeliverablePage from './DeliverablePage.jsx';
import DeliverablesPage from './DeliverablesPage.jsx';
import ProgressPage from './ProgressPage.jsx';
import VdrItemPage from './VdrItemPage.jsx';
import VdrPage from './VdrPage.jsx';
import RfiDashboardPage from './RfiDashboardPage.jsx';
import RfiPage from './RfiPage.jsx';
import RfiRaisePage from './RfiRaisePage.jsx';
import RfisPage from './RfisPage.jsx';
import SubmittalPage from './SubmittalPage.jsx';
import SubmittalSchedulePage from './SubmittalSchedulePage.jsx';
import SubmittalsPage from './SubmittalsPage.jsx';
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
    { path: '/engg/rfi-dashboard', label: 'RFI Dashboard', icon: 'erp.group.projects', permission: 'engg.rfi.view', flag: 'ff.engg.p1102', Page: RfiDashboardPage },
    { path: '/engg/rfis', label: 'RFI Register', icon: 'erp.group.projects', permission: 'engg.rfi.view', flag: 'ff.engg.p1102', Page: RfisPage },
    { path: '/engg/rfi', label: 'RFI', menu: false, icon: 'erp.group.projects', permission: 'engg.rfi.view', flag: 'ff.engg.p1102', Page: RfiPage },
    { path: '/engg/rfi-raise', label: 'Raise RFI', icon: 'erp.action.create', permission: 'engg.rfi.create', flag: 'ff.engg.p1102', Page: RfiRaisePage },
    { path: '/engg/submittals', label: 'Submittal Register', icon: 'erp.group.projects', permission: 'engg.submittal.view', flag: 'ff.engg.p1103', Page: SubmittalsPage },
    { path: '/engg/submittal', label: 'Submittal', menu: false, icon: 'erp.group.projects', permission: 'engg.submittal.view', flag: 'ff.engg.p1103', Page: SubmittalPage },
    { path: '/engg/submittal-schedule', label: 'Submittal Schedule', icon: 'erp.group.projects', permission: 'engg.submittal.view', flag: 'ff.engg.p1103', Page: SubmittalSchedulePage },
    { path: '/engg/progress', label: 'Engineering Progress', icon: 'erp.group.projects', permission: 'engg.deliverable.view', flag: 'ff.engg.p1104', Page: ProgressPage },
    { path: '/engg/deliverables', label: 'Deliverable Register', icon: 'erp.group.projects', permission: 'engg.deliverable.view', flag: 'ff.engg.p1104', Page: DeliverablesPage },
    { path: '/engg/deliverable', label: 'Deliverable', menu: false, icon: 'erp.group.projects', permission: 'engg.deliverable.view', flag: 'ff.engg.p1104', Page: DeliverablePage },
    { path: '/engg/vdr', label: 'VDR Tracker', icon: 'erp.group.projects', permission: 'engg.vdr_item.view', flag: 'ff.engg.p1104', Page: VdrPage },
    { path: '/engg/vdr-item', label: 'VDR item', menu: false, icon: 'erp.group.projects', permission: 'engg.vdr_item.view', flag: 'ff.engg.p1104', Page: VdrItemPage },
  ],
});
