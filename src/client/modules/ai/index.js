import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

const AiFeatures = lazyPage(() => import('./AiFeatures.jsx'), 'AiFeatures');

registerModule({
  code: 'ai', label: 'AI',
  routes: [
    { path: '/ai/features', label: 'AI Features & Enablement', labelHi: 'AI सुविधाएं एवं सक्षमता', icon: 'erp.insights.rb', permission: 'ai.feature.view', flag: 'ff.ai.p2801', Page: AiFeatures },
  ],
});
