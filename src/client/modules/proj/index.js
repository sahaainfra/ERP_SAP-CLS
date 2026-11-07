import { registerModule } from '../../platform/shell/registry.js';
import BaselineComparePage from './BaselineComparePage.jsx';
import BaselinePackPage from './BaselinePackPage.jsx';
import BaselinePacksPage from './BaselinePacksPage.jsx';
import FromAwardPage from './FromAwardPage.jsx';
import BoqImportPage from './BoqImportPage.jsx';
import BoqMappingPage from './BoqMappingPage.jsx';
import BoqReportsPage from './BoqReportsPage.jsx';
import BoqVersionPage from './BoqVersionPage.jsx';
import BoqVersionsPage from './BoqVersionsPage.jsx';
import LocationsPage from './LocationsPage.jsx';
import ProjectPage from './ProjectPage.jsx';
import ProjectsPage from './ProjectsPage.jsx';
import WbsPage from './WbsPage.jsx';
import WizardPage from './WizardPage.jsx';
import WorkPackagePage from './WorkPackagePage.jsx';
import WorkPackagesPage from './WorkPackagesPage.jsx';

registerModule({
  code: 'proj',
  label: 'Project Master',
  routes: [
    { path: '/proj/projects', label: 'Project Portfolio', icon: 'erp.group.projects', permission: 'proj.project.view', flag: 'ff.proj.p1001', Page: ProjectsPage },
    { path: '/proj/project', label: 'Project', icon: 'erp.group.projects', permission: 'proj.project.view', flag: 'ff.proj.p1001', Page: ProjectPage },
    { path: '/proj/wizard', label: 'Project Setup Wizard', icon: 'erp.action.create', permission: 'proj.project.create', flag: 'ff.proj.p1001', Page: WizardPage },
    { path: '/proj/from-award', label: 'Project from Award', icon: 'erp.action.create', permission: 'proj.project.create', flag: 'ff.proj.p1002', Page: FromAwardPage },
    { path: '/proj/baseline-packs', label: 'Commercial Baseline', icon: 'erp.group.projects', permission: 'proj.baseline_pack.view', flag: 'ff.proj.p1002', Page: BaselinePacksPage },
    { path: '/proj/baseline-pack', label: 'Commercial Baseline Pack', icon: 'erp.group.projects', permission: 'proj.baseline_pack.view', flag: 'ff.proj.p1002', Page: BaselinePackPage },
    { path: '/proj/baseline-compare', label: 'Baseline vs Current', icon: 'erp.group.projects', permission: 'proj.baseline_pack.view', flag: 'ff.proj.p1002', Page: BaselineComparePage },
    { path: '/proj/wbs', label: 'WBS Editor', icon: 'erp.group.projects', permission: 'proj.wbs.view', flag: 'ff.proj.p1003', Page: WbsPage },
    { path: '/proj/locations', label: 'Location Breakdown', icon: 'erp.group.projects', permission: 'proj.wbs.view', flag: 'ff.proj.p1003', Page: LocationsPage },
    { path: '/proj/work-packages', label: 'Work Packages', icon: 'erp.group.projects', permission: 'proj.wbs.view', flag: 'ff.proj.p1003', Page: WorkPackagesPage },
    { path: '/proj/work-package', label: 'Work Package', icon: 'erp.group.projects', permission: 'proj.wbs.view', flag: 'ff.proj.p1003', Page: WorkPackagePage },
    { path: '/proj/versions', label: 'BOQ Versions', icon: 'erp.group.projects', permission: 'proj.version.view', flag: 'ff.proj.p1004', Page: BoqVersionsPage },
    { path: '/proj/version', label: 'BOQ', icon: 'erp.group.projects', permission: 'proj.version.view', flag: 'ff.proj.p1004', Page: BoqVersionPage },
    { path: '/proj/boq-import', label: 'Import BOQ', icon: 'erp.action.import', permission: 'proj.boq.import', flag: 'ff.proj.p1004', Page: BoqImportPage },
    { path: '/proj/boq-mapping', label: 'WBS and Location Mapping', icon: 'erp.group.projects', permission: 'proj.version.view', flag: 'ff.proj.p1004', Page: BoqMappingPage },
    { path: '/proj/boq-reports', label: 'BOQ Reports', icon: 'erp.group.projects', permission: 'proj.version.view', flag: 'ff.proj.p1004', Page: BoqReportsPage },
  ],
});
