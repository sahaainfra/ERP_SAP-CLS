import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canWith, menuFor } from '../src/client/platform/access/index.js';

const access = {
  companyWide: ['org.view', 'core.fy.view'],
  anywhere: ['org.view', 'core.fy.view', 'org.project.manage'],
  scopes: { 'org.project.manage': { projects: [3], sites: [9] } },
};

test('FR-10 can(permission, record): company-wide holds for any record, a scoped grant only for its own projects and sites', () => {
  assert.equal(canWith(access, 'org.view'), true);
  assert.equal(canWith(access, 'org.view', { projectId: 99 }), true, 'held for the whole company');
  assert.equal(canWith(access, 'org.project.manage'), true, 'held somewhere');
  assert.equal(canWith(access, 'org.project.manage', { projectId: 3 }), true);
  assert.equal(canWith(access, 'org.project.manage', { projectId: 4 }), false);
  assert.equal(canWith(access, 'org.project.manage', { siteId: 9 }), true);
  assert.equal(canWith(access, 'org.project.manage', { siteId: 10 }), false);
  assert.equal(canWith(access, 'org.project.manage', {}), false, 'a company-level record is not reached by a scoped grant');
  assert.equal(canWith(access, 'core.settings.configure'), false, 'deny by default');
  assert.equal(canWith(null, 'org.view'), false, 'nothing is shown before the access is known');
});

test('menu filtering by permission keeps entries the person holds anywhere', () => {
  const routes = [{ path: '/a', permission: 'org.view' }, { path: '/b', permission: 'iam.role.view' }, { path: '/c' }, { path: '/d', permission: 'org.project.manage' }];
  assert.deepEqual(menuFor(access, routes).map((r) => r.path), ['/a', '/c', '/d']);
  assert.deepEqual(menuFor(null, routes).map((r) => r.path), ['/c']);
});
