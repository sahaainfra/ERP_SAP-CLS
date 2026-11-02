import { workflowResolvers } from './registry.js';

// The resolvers the engine brings (FR-01). "manager": the head of the originator's department today (the reporting line of the HR module, part 13, will replace
// it); nobody is found when the originator has no department, the department has no head now, or the originator is the head, and the step then goes to
// the workflow administrators instead of being approved by anyone else.
const has = (db, t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
if (!workflowResolvers.get('manager')) {
  workflowResolvers.register('manager', ({ db, companyId, instance }) => {
    if (!has(db, 'iam_users') || !has(db, 'iam_user_profiles') || !has(db, 'org_assignments')) return [];
    const user = db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1').get(companyId, instance.submittedBy);
    const dept = user && db.prepare('SELECT department_id FROM iam_user_profiles WHERE user_id = ? AND is_active = 1').get(user.id)?.department_id;
    if (!dept) return [];
    const head = db.prepare(`SELECT u.username FROM org_assignments a JOIN iam_users u ON u.id = a.user_id
      WHERE a.company_id = ? AND a.entity_type = 'DEPARTMENT' AND a.entity_id = ? AND a.role = 'HEAD' AND a.is_active = 1 AND a.applied = 1 AND u.status = 'ACTIVE'
        AND a.effective_from <= date('now') AND (a.effective_to IS NULL OR a.effective_to >= date('now')) ORDER BY a.effective_from DESC LIMIT 1`).get(companyId, dept);
    return head ? [head.username] : [];
  });
}
