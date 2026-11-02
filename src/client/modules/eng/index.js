import { registerModule } from '../../platform/shell/registry.js';
import SampleDocsPage from './SampleDocsPage.jsx';
import WorkflowDefinitionsPage from './WorkflowDefinitionsPage.jsx';
import WorkflowEditorPage from './WorkflowEditorPage.jsx';
import WorkflowInstancePage from './WorkflowInstancePage.jsx';
import WorkflowMonitorPage from './WorkflowMonitorPage.jsx';

// Module "eng" (part 04.01): the workflow engine's pages. The Approvals tab of any document links to the Workflow Instance page by its id.
registerModule({
  code: 'eng',
  label: 'Business Engines',
  routes: [
    { path: '/admin/workflows', label: 'Workflow Definitions', icon: 'erp.action.settings', permission: 'eng.workflow.view', flag: 'ff.eng.p0401', Page: WorkflowDefinitionsPage },
    { path: '/admin/workflows/editor', label: 'Workflow Definition Editor', icon: 'erp.action.edit', permission: 'eng.workflow.view', flag: 'ff.eng.p0401', Page: WorkflowEditorPage },
    { path: '/admin/workflows/monitor', label: 'Workflow Monitor', icon: 'erp.insights.metrics', permission: 'eng.workflow.view', flag: 'ff.eng.p0401', Page: WorkflowMonitorPage },
    { path: '/workflow/instance', label: 'Workflow Instance', icon: 'erp.action.inbox', flag: 'ff.eng.p0401', Page: WorkflowInstancePage },
    { path: '/engine/sample-docs', label: 'Sample Documents', icon: 'erp.group.supply', permission: 'eng.sample.use', flag: 'ff.eng.p0401', Page: SampleDocsPage },
  ],
});
