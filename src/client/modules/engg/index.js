import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const DrawingPage = lazyPage(() => import('./DrawingPage.jsx'));
const DrawingsDashboardPage = lazyPage(() => import('./DrawingsDashboardPage.jsx'));
const DrawingsPage = lazyPage(() => import('./DrawingsPage.jsx'));
const DeliverablePage = lazyPage(() => import('./DeliverablePage.jsx'));
const DeliverablesPage = lazyPage(() => import('./DeliverablesPage.jsx'));
const ProgressPage = lazyPage(() => import('./ProgressPage.jsx'));
const VdrItemPage = lazyPage(() => import('./VdrItemPage.jsx'));
const VdrPage = lazyPage(() => import('./VdrPage.jsx'));
const LetterDraftPage = lazyPage(() => import('./LetterDraftPage.jsx'));
const LetterPage = lazyPage(() => import('./LetterPage.jsx'));
const LettersPage = lazyPage(() => import('./LettersPage.jsx'));
const TimeBarsPage = lazyPage(() => import('./TimeBarsPage.jsx'));
const RfiDashboardPage = lazyPage(() => import('./RfiDashboardPage.jsx'));
const RfiPage = lazyPage(() => import('./RfiPage.jsx'));
const RfiRaisePage = lazyPage(() => import('./RfiRaisePage.jsx'));
const RfisPage = lazyPage(() => import('./RfisPage.jsx'));
const SubmittalPage = lazyPage(() => import('./SubmittalPage.jsx'));
const SubmittalSchedulePage = lazyPage(() => import('./SubmittalSchedulePage.jsx'));
const SubmittalsPage = lazyPage(() => import('./SubmittalsPage.jsx'));
const SiteDrawingsPage = lazyPage(() => import('./SiteDrawingsPage.jsx'));
const TransmittalPage = lazyPage(() => import('./TransmittalPage.jsx'));
const TransmittalsPage = lazyPage(() => import('./TransmittalsPage.jsx'));

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
    { path: '/engg/letters', label: 'Correspondence Register', icon: 'erp.group.projects', permission: 'engg.letter.view', flag: 'ff.engg.p1105', Page: LettersPage },
    { path: '/engg/letter', label: 'Letter', menu: false, icon: 'erp.group.projects', permission: 'engg.letter.view', flag: 'ff.engg.p1105', Page: LetterPage },
    { path: '/engg/letter-draft', label: 'Draft Outward Letter', icon: 'erp.action.create', permission: 'engg.letter.create', flag: 'ff.engg.p1105', Page: LetterDraftPage },
    { path: '/engg/time-bars', label: 'Notices and Time Bars', icon: 'erp.group.projects', permission: 'engg.letter.view', flag: 'ff.engg.p1105', Page: TimeBarsPage },
  ],
});
