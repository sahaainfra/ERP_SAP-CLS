import { registerModule } from '../../platform/shell/registry.js';
import ProjectPage from './ProjectPage.jsx';
import ProjectsPage from './ProjectsPage.jsx';
import WizardPage from './WizardPage.jsx';

registerModule({
  code: 'proj',
  label: 'Project Master',
  routes: [
    { path: '/proj/projects', label: 'Project Portfolio', icon: 'erp.group.projects', permission: 'proj.project.view', flag: 'ff.proj.p1001', Page: ProjectsPage },
    { path: '/proj/project', label: 'Project', icon: 'erp.group.projects', permission: 'proj.project.view', flag: 'ff.proj.p1001', Page: ProjectPage },
    { path: '/proj/wizard', label: 'Project Setup Wizard', icon: 'erp.action.create', permission: 'proj.project.create', flag: 'ff.proj.p1001', Page: WizardPage },
  ],
});
