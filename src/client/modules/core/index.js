import { registerModule } from '../../platform/shell/registry.js';
import AboutPage from './pages/AboutPage.jsx';
import ArchitecturePage from './pages/ArchitecturePage.jsx';
import DataHealthPage from './pages/DataHealthPage.jsx';
import CompanySettingsPage from './pages/CompanySettingsPage.jsx';
import FinancialYearsPage from './pages/FinancialYearsPage.jsx';
import HolidaysPage from './pages/HolidaysPage.jsx';
import NumberingPage from './pages/NumberingPage.jsx';
import ParametersPage from './pages/ParametersPage.jsx';
import FlagsPage from './pages/FlagsPage.jsx';

// Module "core" registers its pages once. The shell builds navigation and routing from the registry.
registerModule({
  code: 'core',
  label: 'Core',
  routes: [
    { path: '/admin/feature-flags', label: 'Feature Flags', permission: 'core.flag.view', Page: FlagsPage },
    { path: '/admin/about', label: 'About', permission: 'core.about.view', Page: AboutPage },
    { path: '/admin/data-health', label: 'Data Health', permission: 'core.integrity.view', flag: 'ff.core.p0102', Page: DataHealthPage },
    { path: '/admin/architecture', label: 'Architecture', permission: 'core.arch.view', flag: 'ff.core.p0101', Page: ArchitecturePage },
    { path: '/admin/company-settings', label: 'Company Settings', permission: 'core.settings.view', flag: 'ff.core.p0103', Page: CompanySettingsPage },
    { path: '/admin/financial-years', label: 'Financial Years', permission: 'core.fy.view', flag: 'ff.core.p0103', Page: FinancialYearsPage },
    { path: '/admin/numbering', label: 'Numbering', permission: 'core.numbering.view', flag: 'ff.core.p0103', Page: NumberingPage },
    { path: '/admin/parameters', label: 'Parameters', permission: 'core.param.view', flag: 'ff.core.p0103', Page: ParametersPage },
    { path: '/admin/holidays', label: 'Holidays', flag: 'ff.core.p0103', Page: HolidaysPage },
  ],
});
