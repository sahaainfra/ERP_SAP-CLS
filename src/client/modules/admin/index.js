import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Module M29 (admin): administration, integration and data operations (parts 29.x).
const ControlCenter = lazyPage(() => import('./Control.jsx'), 'ControlCenter');
const BusinessConnectors = lazyPage(() => import('./Connectors.jsx'), 'BusinessConnectors');

registerModule({
  code: 'admin', label: 'Administration',
  routes: [
    { path: '/admin/control', label: 'Enterprise Control Center', labelHi: 'एंटरप्राइज़ नियंत्रण केंद्र', icon: 'erp.insights.rb', permission: 'adm.control.view', flag: 'ff.admin.p2901', Page: ControlCenter },
    { path: '/admin/connectors', label: 'Business Connectors', labelHi: 'व्यावसायिक कनेक्टर', icon: 'erp.insights.rb', permission: 'adm.connector.view', flag: 'ff.admin.p2902', Page: BusinessConnectors },
  ],
});
