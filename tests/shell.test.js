import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breadcrumbs, consoleGroup, entryFor, forOnboarding, guard, searchEntries, shortcutMap, sidebarGroups, titleFor } from '../src/client/platform/shell/nav.js';

// Part 03.05: the pure rules of the application shell: breadcrumbs, titles, route guards, search, shortcuts, the phone menu.
const page = (code, label, route, extra = {}) => ({ code, label, labelHi: null, route, icon: 'erp.action.info', keywords: '', mobileVisible: true, requiresContext: null, onboarding: 'none', shortcut: null, tile: false, quickCreate: null, ...extra });
const nav = {
  groups: [
    { code: 'g-home', label: 'Home', placement: 'sidebar', pages: [page('home', 'Home', '/home', { shortcut: 'h' }), page('welcome', 'Welcome', '/welcome', { onboarding: 'only' })] },
    { code: 'g-procurement', label: 'Procurement', placement: 'sidebar', pages: [page('admin-sample-requests', 'Sample Material Requests', '/admin/sample-requests', { keywords: 'indent purchase', shortcut: 'm' }), page('admin-sample-bills', 'Sample Bills', '/admin/sample-bills', { requiresContext: 'project', mobileVisible: false })] },
    { code: 'g-account', label: 'Account', placement: 'user_menu', pages: [page('profile', 'My Profile', '/account/profile', { onboarding: 'allowed' })] },
    { code: 'g-console', label: 'Technical Console', placement: 'console', pages: [page('admin-about', 'About', '/admin/about')] },
  ],
  denied: [{ route: '/admin/users', label: 'Users', reason: 'permission', permissionKey: 'iam.user.view' }, { route: '/admin/legacy', label: 'Legacy', reason: 'flag', featureFlag: 'ff.x' }],
};
// the page address with a query string still finds its entry
test('FR-05 breadcrumbs name Home, the group and the page; titles follow one pattern', () => {
  assert.deepEqual(breadcrumbs(nav, '/admin/sample-requests?open=4').map((c) => c.label), ['Home', 'Procurement', 'Sample Material Requests']);
  assert.deepEqual(breadcrumbs(nav, '/home').map((c) => c.label), ['Home']);
  assert.deepEqual(breadcrumbs(nav, '/welcome').map((c) => c.label), ['Home', 'Welcome'], 'a page of the Home group is not named twice');
  assert.deepEqual(breadcrumbs(nav, '/nowhere'), []);
  assert.equal(titleFor(nav, '/admin/sample-requests'), 'Sample Material Requests - Procurement - ERP');
  assert.equal(titleFor(nav, '/home'), 'Home - ERP');
  assert.equal(titleFor(nav, '/nowhere'), 'ERP');
});

test('FR-08 a route guard says why a page cannot be drawn: permission, flag, context, or no such page', () => {
  assert.deepEqual(guard(nav, '/home', { knownRoute: true }), { ok: true, entry: entryFor(nav, '/home') });
  const denied = guard(nav, '/admin/users', { knownRoute: true });
  assert.deepEqual([denied.ok, denied.reason, denied.permissionKey, denied.label], [false, 'permission', 'iam.user.view', 'Users']);
  assert.equal(guard(nav, '/admin/legacy', { knownRoute: true }).reason, 'flag');
  assert.equal(guard(nav, '/admin/sample-bills', { knownRoute: true, context: {} }).reason, 'context');
  assert.equal(guard(nav, '/admin/sample-bills', { knownRoute: true, context: {} }).need, 'project');
  assert.equal(guard(nav, '/admin/sample-bills', { knownRoute: true, context: { projectId: 7 } }).ok, true, 'a project in the working context opens it');
  assert.equal(guard(nav, '/nothing', { knownRoute: false }).reason, 'unknown');
  // a record or create page has no menu entry: its own registered permission decides
  const record = { path: '/bd/tender/new', label: 'New tender', permission: 'bd.tender.create', menu: false };
  const refused = guard(nav, '/bd/tender/new', { knownRoute: true, route: record, permissions: ['bd.tender.view'] });
  assert.deepEqual([refused.ok, refused.reason, refused.permissionKey, refused.label], [false, 'permission', 'bd.tender.create', 'New tender']);
  assert.equal(guard(nav, '/bd/tender/new', { knownRoute: true, route: record, permissions: ['bd.tender.create'] }).ok, true);
  assert.equal(guard(nav, '/bd/tender/new', { knownRoute: true, route: { ...record, permission: undefined }, permissions: [] }).ok, true, 'a page with no permission of its own is open to the signed-in');
  assert.equal(guard(null, '/anything').ok, true, 'before the menu is known nothing is blocked');
});

test('FR-07 search ranks label starts, label contains, keywords and groups; shortcuts map one letter to a page', () => {
  assert.deepEqual(searchEntries(nav, 'sample').map((p) => p.code), ['admin-sample-bills', 'admin-sample-requests']);
  assert.deepEqual(searchEntries(nav, 'indent').map((p) => p.code), ['admin-sample-requests'], 'a keyword finds the page');
  assert.deepEqual(searchEntries(nav, 'procure').map((p) => p.code).sort(), ['admin-sample-bills', 'admin-sample-requests'], 'the group name finds its pages');
  assert.deepEqual(searchEntries(nav, '  '), []);
  assert.deepEqual(searchEntries(nav, 'zzz'), []);
  assert.deepEqual(Object.fromEntries(Object.entries(shortcutMap(nav)).map(([k, p]) => [k, p.code])), { h: 'home', m: 'admin-sample-requests' });
});

test('FR-02 FR-09 the sidebar holds the business groups only, on phones without the pages hidden there; the console and account stay apart', () => {
  assert.deepEqual(sidebarGroups(nav).map((g) => g.code), ['g-home', 'g-procurement']);
  assert.deepEqual(sidebarGroups(nav, { mobile: true }).find((g) => g.code === 'g-procurement').pages.map((p) => p.code), ['admin-sample-requests']);
  assert.equal(consoleGroup(nav).code, 'g-console');
  assert.ok(!sidebarGroups(nav).flatMap((g) => g.pages).some((p) => p.code === 'admin-about'), 'BR-03: build information is not in a business group');
});

test('a person still being onboarded sees the welcome page and the pages onboarding allows; everyone else does not see the welcome page', () => {
  assert.deepEqual(forOnboarding(nav, true).groups.flatMap((g) => g.pages.map((p) => p.code)), ['welcome', 'profile']);
  assert.ok(!forOnboarding(nav, false).groups.flatMap((g) => g.pages.map((p) => p.code)).includes('welcome'));
});

test('FR-07 a page is found by the name the screen shows: its Hindi and Telugu names and its group in those languages', () => {
  const local = {
    groups: [
      { code: 'g-procurement', label: 'Procurement', labelHi: 'खरीद', labelTe: 'కొనుగోలు', placement: 'sidebar', pages: [page('proc-po', 'Purchase Orders', '/proc/purchase-orders', { labelHi: 'खरीद आदेश', labelTe: 'కొనుగోలు ఆర్డర్లు' })] },
      { code: 'g-hr', label: 'People', labelHi: 'कर्मचारी', placement: 'sidebar', pages: [page('hr-emp', 'Employees', '/hr/employees', { labelHi: 'कर्मचारी सूची' })] },
    ],
  };
  assert.deepEqual(searchEntries(local, 'खरीद आदेश').map((p) => p.code), ['proc-po'], 'the Hindi name');
  assert.deepEqual(searchEntries(local, 'కొనుగోలు ఆర్డర్').map((p) => p.code), ['proc-po'], 'the Telugu name');
  assert.deepEqual(searchEntries(local, 'कर्मचारी').map((p) => p.code), ['hr-emp'], 'a Hindi page name start ranks as a label match');
  assert.deepEqual(searchEntries(local, 'purchase').map((p) => p.code), ['proc-po'], 'English still works');
  assert.deepEqual(searchEntries(local, 'खरीद').map((p) => p.code), ['proc-po'], 'the group name in Hindi finds its pages');
  const more = { groups: [{ code: 'g-p', label: 'Procurement', placement: 'sidebar', pages: [page('po-new', 'New Purchase Order', '/proc/po-new', { labelHi: 'खरीद आदेश बनाएँ' }), page('proc-po', 'Purchase Orders', '/proc/purchase-orders', { labelHi: 'खरीद आदेश' })] }] };
  assert.deepEqual(searchEntries(more, 'खरीद आदेश').map((p) => p.code), ['proc-po', 'po-new'], 'the exact name ranks before names that only start with it');
});
