import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/server/platform/db/index.js';

// Audit AUD-DEF-019: a client page that shows business data declares the permission its API requires, so the menu does not offer it to people
// who would only get an error. The pages below declare none on purpose: each shows the person's own work, or reads an API every signed-in
// person may read (`g: 'self'` in the route policy). A new page without a permission must be added here with that reason, or declare one.
const OPEN_BY_DESIGN = new Set([
  // the person's own work and account
  '/home', '/work', '/welcome', '/search', '/approvals', '/approvals/task', '/approvals/submissions', '/workflow/instance', '/tasks', '/tasks/task', '/tasks/new',
  '/alerts', '/notifications', '/notifications/preferences', '/accountability', '/account/profile', '/account/security', '/account/sessions', '/account/drafts',
  '/account/exports', '/ai/assistant', '/bi/role-dashboard', '/bi/reports',
  // messages and calls of the person
  '/collab/messages', '/collab/messages/new', '/collab/call', '/collab/safety-number', '/collab/center', '/collab/acknowledgements', '/collab/announcements', '/collab/my-policies',
  // the field home of the person's phone
  '/field', '/field/scan', '/field/forms', '/field/sync', '/field/sync/conflicts', '/field/approvals',
  // read by every signed-in person: the holiday calendar (GET /core/holidays) and their own exceptions (GET /pcs/exceptions)
  '/admin/holidays', '/controls/exceptions',
]);

test('BR-AUD-019 every client page either declares a permission or is open by design', () => {
  const base = join(ROOT, 'src', 'client', 'modules'); const missing = [];
  for (const dir of readdirSync(base)) {
    let text; try { text = readFileSync(join(base, dir, 'index.js'), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = /\{ path: '([^']+)'/.exec(line);
      if (m && !line.includes('permission:') && !OPEN_BY_DESIGN.has(m[1])) missing.push(`${dir}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
