import { commandRegistry } from '../../platform/search/registry.js';

// Part 03.08: the actions the command palette offers. A module adds its own with commandRegistry.register (create a purchase order, punch in, open
// today's progress report) when its pages exist; these are the ones of the parts built so far. `route` opens a page, `clientAction` is something the
// shell itself does. `contexts` are the pages where the command is offered first.
const c = (def) => commandRegistry.register(def);

c({ code: 'work.open', label: 'Open My Work', labelHi: 'मेरा कार्य खोलें', keywords: 'dashboard approvals tasks home', icon: 'erp.home.dash', route: '/work', flag: 'ff.ui.p0307' });
c({ code: 'sample_request.create', label: 'Create a sample material request', labelHi: 'नया नमूना सामग्री अनुरोध बनाएँ', keywords: 'new material request indent mr', icon: 'erp.action.create', route: '/admin/sample-requests?new=1', permission: 'core.sample.use', contexts: ['/admin/sample-requests'] });
c({ code: 'sample_request.overview', label: 'Open the requests overview', labelHi: 'अनुरोध सारांश खोलें', keywords: 'dashboard charts requests kpi', icon: 'erp.insights.metrics', route: '/admin/sample-requests/overview', permission: 'core.sample.use', flag: 'ff.ui.p0307', contexts: ['/admin/sample-requests'] });
c({ code: 'approvals.open', label: 'Review my approvals', labelHi: 'मेरी स्वीकृतियाँ देखें', keywords: 'pending decide approve waiting', icon: 'erp.action.inbox', route: '/admin/approvals', permission: 'core.requests.view', flag: 'ff.core.p0106' });
c({ code: 'drafts.open', label: 'Open my drafts', labelHi: 'मेरे ड्राफ़्ट खोलें', keywords: 'unfinished forms saved', icon: 'erp.state.draft', route: '/account/drafts', flag: 'ff.ui.p0302' });
c({ code: 'exports.open', label: 'Open my exports', labelHi: 'मेरे एक्सपोर्ट खोलें', keywords: 'download files xlsx csv', icon: 'erp.action.export', route: '/account/exports', flag: 'ff.ui.p0303' });
c({ code: 'user.invite', label: 'Invite a person', labelHi: 'किसी को आमंत्रित करें', keywords: 'new user add invite people', icon: 'erp.action.create', route: '/admin/users?invite=1', permission: 'iam.user.manage', contexts: ['/admin/users'] });
c({ code: 'search.advanced', label: 'Advanced search', labelHi: 'उन्नत खोज', keywords: 'find filter records', icon: 'erp.action.search', route: '/search', flag: 'ff.ui.p0308' });
c({ code: 'search.rebuild', label: 'Rebuild the search index', labelHi: 'खोज सूची दोबारा बनाएँ', keywords: 'reindex search administration', icon: 'erp.action.settings', route: '/admin/search', permission: 'ui.search.reindex', flag: 'ff.ui.p0308' });
c({ code: 'context.choose', label: 'Choose project and site', labelHi: 'परियोजना और साइट चुनें', keywords: 'working context switch project site', icon: 'erp.action.filter', clientAction: 'context:open' });
c({ code: 'theme.light', label: 'Switch to the light theme', labelHi: 'हल्की थीम', keywords: 'appearance colour mode', icon: 'erp.action.settings', clientAction: 'theme:light', group: 'Appearance' });
c({ code: 'theme.dark', label: 'Switch to the dark theme', labelHi: 'गहरी थीम', keywords: 'appearance colour mode night', icon: 'erp.action.settings', clientAction: 'theme:dark', group: 'Appearance' });
c({ code: 'theme.contrast', label: 'Switch to the high-contrast theme', labelHi: 'उच्च कंट्रास्ट थीम', keywords: 'appearance accessibility contrast', icon: 'erp.action.settings', clientAction: 'theme:high-contrast', group: 'Appearance' });
c({ code: 'language.en', label: 'Show the application in English', labelHi: 'अंग्रेज़ी में दिखाएँ', keywords: 'language english', icon: 'erp.action.settings', clientAction: 'language:en', group: 'Appearance' });
c({ code: 'language.hi', label: 'Show the application in Hindi', labelHi: 'हिन्दी में दिखाएँ', keywords: 'language hindi हिन्दी', icon: 'erp.action.settings', clientAction: 'language:hi', group: 'Appearance' });
c({ code: 'help.shortcuts', label: 'Show keyboard shortcuts', labelHi: 'कीबोर्ड शॉर्टकट दिखाएँ', keywords: 'help keys', icon: 'erp.action.info', clientAction: 'help:shortcuts', group: 'Help' });
