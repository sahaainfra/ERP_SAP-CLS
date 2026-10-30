import { registerModule } from '../../platform/shell/registry.js';
import AboutPage from './pages/AboutPage.jsx';
import ArchitecturePage from './pages/ArchitecturePage.jsx';
import FlagsPage from './pages/FlagsPage.jsx';

// Module "core" registers its pages once. The shell builds navigation and routing from the registry.
registerModule({
  code: 'core',
  label: 'Core',
  routes: [
    { path: '/admin/feature-flags', label: 'Feature Flags', permission: 'core.flag.view', Page: FlagsPage },
    { path: '/admin/about', label: 'About', permission: 'core.about.view', Page: AboutPage },
    { path: '/admin/architecture', label: 'Architecture', permission: 'core.arch.view', flag: 'ff.core.p0101', Page: ArchitecturePage },
  ],
});
