import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationsOf, routeKey } from '../scripts/openapi_routes.mjs';

// Audit AUD-DEF-005: the OpenAPI check reads both styles of the hand-written files and compares routes whatever their spelling.
test('BR-AUD-005 a route is the same whether a file writes {id} or :id, a full path or one under /api/v1', () => {
  assert.equal(routeKey('get', '/api/v1/hr/employees/{id}'), routeKey('GET', '/api/v1/hr/employees/:employeeId'));
  const text = ['paths:', '  /hr/things/{id}: { get: { summary: x }, post: { summary: y } }', '  /api/v1/hr/other:', '    get:', '      summary: z', '    delete:', '      summary: w', 'components:', '  /not/a/path: {}'].join('\n');
  assert.deepEqual(operationsOf(text).sort(), ['DELETE /api/v1/hr/other', 'GET /api/v1/hr/other', 'GET /api/v1/hr/things/:', 'POST /api/v1/hr/things/:'].sort());
});
