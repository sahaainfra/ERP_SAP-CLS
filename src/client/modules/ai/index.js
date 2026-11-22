import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

const AssistantPage = lazyPage(() => import('./Assistant.jsx'), 'AssistantPage');
const AiFeatures = lazyPage(() => import('./AiFeatures.jsx'), 'AiFeatures');
const ForecastsPage = lazyPage(() => import('./Forecasts.jsx'), 'ForecastsPage');

registerModule({
  code: 'ai', label: 'AI',
  routes: [
    { path: '/ai/features', label: 'AI Features & Enablement', labelHi: 'AI सुविधाएं एवं सक्षमता', icon: 'erp.insights.rb', permission: 'ai.feature.view', flag: 'ff.ai.p2801', Page: AiFeatures },
    { path: '/ai/forecasts', label: 'Forecasts & Anomalies', labelHi: 'पूर्वानुमान एवं विसंगतियाँ', icon: 'erp.insights.rb', permission: 'ai.forecast.view', flag: 'ff.ai.p2803', Page: ForecastsPage },
    { path: '/ai/assistant', label: 'AI Assistant', labelHi: 'AI सहायक', icon: 'erp.insights.rb', flag: 'ff.ai.p2802', Page: AssistantPage },
  ],
});
