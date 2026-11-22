import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Module M29 (admin): administration, integration and data operations (parts 29.x).
const ControlCenter = lazyPage(() => import('./Control.jsx'), 'ControlCenter');

registerModule({
  code: 'admin', label: 'Administration',
  routes: [
    { path: '/admin/control', label: 'Enterprise Control Center', labelHi: 'एंटरप्राइज़ नियंत्रण केंद्र', icon: 'erp.insights.rb', permission: 'adm.control.view', flag: 'ff.admin.p2901', Page: ControlCenter },
  ],
});
