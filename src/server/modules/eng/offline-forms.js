import { authzOf } from '../../platform/authz/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { objectTypes } from '../../platform/objects/index.js';
import { offlineForms, registerOfflineForm, registerOfflineMaster } from './offline.js';

// What the first modules put into the offline engine (part 04.15): the sample document as the reference offline form (a title, an amount, a project; it is the form the acceptance test captures offline), and the masters
// a phone needs to fill it: the projects the person may work on, their sites and the people of the company. The forms of the field modules (attendance, DPR, material request, GRN count, inspection, HSE, log book) are
// listed by the engine as planned and register here when their parts exist (D-259).
const MONEY = /^\d{1,13}(\.\d{1,2})?$/;

const docsOf = new WeakMap();

/** The forms and masters are registered once per process; the sample document service is the one of the database in hand. */
export function registerOfflineAdapters({ db: owner, docs }) {
  docsOf.set(owner, docs);
  if (offlineForms.has('sample_doc')) return;
  registerOfflineForm({
    code: 'sample_doc', label: 'Sample document', labelHi: 'नमूना दस्तावेज़', module: '04.01', permission: 'eng.sample.use', attachmentEntity: 'sample_doc',
    fields: [
      { key: 'title', label: 'Title', labelHi: 'शीर्षक', type: 'text', required: true, max: 200 },
      { key: 'amount', label: 'Amount (₹)', labelHi: 'राशि (₹)', type: 'money', required: true },
      { key: 'projectId', label: 'Project', labelHi: 'परियोजना', type: 'project', required: false },
    ],
    rules: () => ({ titleMin: 3, titleMax: 200, amountPattern: MONEY.source, amountMin: '0.01' }),
    validate(values, rules) {
      const e = [];
      if (values.title !== undefined && (String(values.title).trim().length < rules.titleMin || String(values.title).length > rules.titleMax)) e.push({ field: 'title', message: `Title: give ${rules.titleMin} to ${rules.titleMax} characters.` });
      if (values.title === undefined || values.title === '') e.push({ field: 'title', message: `Title: give at least ${rules.titleMin} characters.` });
      if (values.amount === undefined || values.amount === '' || !MONEY.test(String(values.amount)) || Number(values.amount) <= 0) e.push({ field: 'amount', message: 'Amount: write a number above zero with at most two decimals.' });
      return e;
    },
    create(db, actor, v, ctx) {
      const d = docsOf.get(db).create(actor, { title: String(v.title).trim(), amount: String(v.amount), projectId: v.projectId ? Number(v.projectId) : undefined });
      db.prepare("UPDATE eng_sample_docs SET source_type = 'off_command', source_id = ? WHERE id = ?").run(ctx.commandId, d.id);
      return { entityId: d.id, version: d.version, projectId: d.projectId };
    },
    load(db, actor, id) {
      try {
        const d = docsOf.get(db).get(actor, Number(id));
        return { version: d.version, projectId: d.projectId ?? null, values: { title: d.title, amount: d.amount, projectId: d.projectId ?? null }, status: d.status };
      } catch { return null; }
    },
    update(db, actor, id, changes) {
      const docs = docsOf.get(db);
      const cur = docs.get(actor, Number(id));
      const d = docs.update(actor, Number(id), { title: String(changes.title ?? cur.title).trim(), amount: String(changes.amount ?? cur.amount), projectId: changes.projectId ? Number(changes.projectId) : cur.projectId ?? undefined, version: cur.version });
      return { entityId: d.id, version: d.version };
    },
  });

  registerOfflineMaster({
    code: 'projects', label: 'Projects', permission: 'eng.sample.use',
    rows(db, actor, since) {
      const authz = authzOf(db);
      const sql = `SELECT p.id, p.code, p.name, p.status, p.is_active, COALESCE(p.updated_at, p.created_at) AS changed FROM org_projects p WHERE p.company_id = ? AND ${authz.scopeFilter(actor, 'eng.sample.use', { project: 'p.id' }).sql}${since ? ' AND COALESCE(p.updated_at, p.created_at) > ?' : ''} ORDER BY p.code`;
      const all = db.prepare(sql).all(...(since ? [actor.companyId, since] : [actor.companyId]));
      return { rows: all.filter((r) => r.is_active === 1).map((r) => ({ id: r.id, code: r.code, name: r.name, status: r.status, changed: r.changed })), removed: all.filter((r) => r.is_active !== 1).map((r) => r.id) };
    },
  });
  registerOfflineMaster({
    code: 'sites', label: 'Sites', permission: 'eng.sample.use',
    rows(db, actor, since) {
      const authz = authzOf(db);
      const sql = `SELECT s.id, s.code, s.name, s.org_project_id AS project_id, s.is_active, COALESCE(s.updated_at, s.created_at) AS changed FROM org_sites s WHERE s.company_id = ? AND (${authz.scopeFilter(actor, 'eng.sample.use', { project: 's.org_project_id' }).sql})${since ? ' AND COALESCE(s.updated_at, s.created_at) > ?' : ''} ORDER BY s.code`;
      const all = db.prepare(sql).all(...(since ? [actor.companyId, since] : [actor.companyId]));
      return { rows: all.filter((r) => r.is_active === 1).map((r) => ({ id: r.id, code: r.code, name: r.name, projectId: r.project_id, changed: r.changed })), removed: all.filter((r) => r.is_active !== 1).map((r) => r.id) };
    },
  });
  registerOfflineMaster({
    code: 'people', label: 'People', permission: 'eng.sample.use',
    rows(db, actor, since) {
      const all = db.prepare(`SELECT u.username, u.display_name, u.is_active, COALESCE(u.updated_at, u.created_at) AS changed FROM iam_users u WHERE u.company_id = ?${since ? ' AND COALESCE(u.updated_at, u.created_at) > ?' : ''} ORDER BY u.username LIMIT 2000`).all(...(since ? [actor.companyId, since] : [actor.companyId]));
      return { rows: all.filter((r) => r.is_active === 1).map((r) => ({ id: r.username, code: r.username, name: r.display_name, changed: r.changed })), removed: all.filter((r) => r.is_active !== 1).map((r) => r.username) };
    },
  });

  // the files of a sample document captured offline are the document's attachments
  if (!fileEntities.get?.('sample_doc')) {
    try {
      fileEntities.register({
        entity: 'sample_doc', label: 'Sample document',
        resolve(db, actor, id) {
          const def = objectTypes.get('sample_doc');
          if (!def || !authzOf(db).check(actor, def.permission).allowed) return null;
          const a = def.access(db, actor, Number(id));
          if (!a) return null;
          const d = db.prepare('SELECT requested_by, status, locked FROM eng_sample_docs WHERE id = ?').get(Number(id));
          return { companyId: a.companyId, projectId: a.projectId ?? null, siteId: a.siteId ?? null, canView: true, canEdit: d?.requested_by === actor.user && ['DRAFT', 'RETURNED'].includes(d?.status), locked: d?.locked === 1 };
        },
      });
    } catch { /* registered once per process */ }
  }
}
