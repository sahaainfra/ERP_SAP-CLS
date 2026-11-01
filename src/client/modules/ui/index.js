import { registerModule } from '../../platform/shell/registry.js';
import { registerFormPage } from '../../platform/forms/index.js';
import StyleGuidePage from './StyleGuidePage.jsx';
import FormsGalleryPage from './FormsGalleryPage.jsx';
import MyDraftsPage from './MyDraftsPage.jsx';
import SampleRequestsPage from './SampleRequestsPage.jsx';
import MyExportsPage from './MyExportsPage.jsx';
import ListReportDocsPage from './ListReportDocsPage.jsx';
import ObjectPageDocsPage from './ObjectPageDocsPage.jsx';
import LaunchpadPage from './LaunchpadPage.jsx';
import NavigationRegistryPage from './NavigationRegistryPage.jsx';
import ConsolePage from './ConsolePage.jsx';
import FieldHomePage from './FieldHomePage.jsx';
import ScannerPage from './ScannerPage.jsx';

// Module "ui" (part 03.01): the design system. The style guide is listed for those with ui.styleguide.view; outside production the
// server also lets every signed-in person open it by its address. Part 03.02 adds the form components gallery, each person's drafts
// and the reference form of the data-entry framework.
registerModule({
  code: 'ui',
  label: 'Design System',
  routes: [
    { path: '/field', label: 'Field Home', icon: 'erp.field.field', flag: 'ff.ui.p0306', Page: FieldHomePage },
    { path: '/field/scan', label: 'Scan', icon: 'erp.action.scan', flag: 'ff.ui.p0306', Page: ScannerPage },
    { path: '/home', label: 'Home', icon: 'erp.group.home', flag: 'ff.ui.p0305', Page: LaunchpadPage },
    { path: '/admin/navigation', label: 'Navigation Registry', icon: 'erp.action.sort', permission: 'ui.nav.manage', flag: 'ff.ui.p0305', Page: NavigationRegistryPage },
    { path: '/admin/console', label: 'Technical Console', icon: 'erp.tech.devapi', permission: 'ui.console.view', flag: 'ff.ui.p0305', Page: ConsolePage },
    { path: '/admin/design-system', label: 'Design System', icon: 'erp.group.admin', permission: 'ui.styleguide.view', flag: 'ff.ui.p0301', Page: StyleGuidePage },
    { path: '/admin/design-system/forms', label: 'Form Components', icon: 'erp.action.edit', permission: 'ui.styleguide.view', flag: 'ff.ui.p0302', Page: FormsGalleryPage },
    { path: '/account/drafts', label: 'My Drafts', icon: 'erp.state.draft', flag: 'ff.ui.p0302', Page: MyDraftsPage },
    { path: '/admin/design-system/lists', label: 'List Report', icon: 'erp.action.filter', permission: 'ui.styleguide.view', flag: 'ff.ui.p0303', Page: ListReportDocsPage },
    { path: '/admin/design-system/object-page', label: 'Object Page', icon: 'erp.action.info', permission: 'ui.styleguide.view', flag: 'ff.ui.p0304', Page: ObjectPageDocsPage },
    { path: '/account/exports', label: 'My Exports', icon: 'erp.action.export', flag: 'ff.ui.p0303', Page: MyExportsPage },
    { path: '/admin/sample-requests', label: 'Sample Material Requests', icon: 'erp.group.supply', permission: 'core.sample.use', flag: 'ff.ui.p0302', Page: SampleRequestsPage },
  ],
});

registerFormPage('ui.sample_request', (entityKey) => (entityKey ? `/admin/sample-requests?open=${entityKey}` : '/admin/sample-requests?new=1'));
