import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Module M29 (admin): administration, integration and data operations (parts 29.x).
const ControlCenter = lazyPage(() => import('./Control.jsx'), 'ControlCenter');
const BusinessConnectors = lazyPage(() => import('./Connectors.jsx'), 'BusinessConnectors');
const ApiPlatform = lazyPage(() => import('./ApiPlatform.jsx'), 'ApiPlatform');
const BulkEntry = lazyPage(() => import('./BulkEntry.jsx'), 'BulkEntry');
const MigrationCockpit = lazyPage(() => import('./Migration.jsx'), 'MigrationCockpit');

registerModule({
  code: 'admin', label: 'Administration',
  routes: [
    { path: '/admin/control', label: 'Enterprise Control Center', labelHi: 'एंटरप्राइज़ नियंत्रण केंद्र', icon: 'erp.insights.rb', permission: 'adm.control.view', flag: 'ff.admin.p2901', Page: ControlCenter },
    { path: '/admin/connectors', label: 'Business Connectors', labelHi: 'व्यावसायिक कनेक्टर', icon: 'erp.insights.rb', permission: 'adm.connector.view', flag: 'ff.admin.p2902', Page: BusinessConnectors },
    { path: '/admin/api', label: 'API Clients & Webhooks', labelHi: 'एपीआई क्लाइंट और वेबहुक', icon: 'erp.insights.rb', permission: 'adm.api.view', flag: 'ff.admin.p2903', Page: ApiPlatform },
    { path: '/admin/bulk', label: 'Template Packs & Bulk Entry', labelHi: 'टेम्पलेट पैक और बल्क एंट्री', icon: 'erp.insights.rb', permission: 'adm.bulk.use', flag: 'ff.admin.p2904', Page: BulkEntry },
    { path: '/admin/data-migration', label: 'Migration Cockpit', labelHi: 'माइग्रेशन कॉकपिट', icon: 'erp.insights.rb', permission: 'adm.migration.view', flag: 'ff.admin.p2905', Page: MigrationCockpit },
  ],
});
