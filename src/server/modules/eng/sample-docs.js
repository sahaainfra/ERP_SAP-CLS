import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { workflowTypes } from '../../platform/workflow/registry.js';
import { formatINR, fromUnits, toUnits } from '../../../shared/money.js';

/**
 * The sample document of the workflow engine (part 04.01): a small request for money that goes through every path of the engine and shows a
 * module how to integrate: register the document type with its hooks, call submit(), and let the hooks set the status and lock the record. There is
 * no other way to change its status: the hooks are the only code that writes it after the first save (AC-05).
 */
export const SAMPLE_DOC_TYPE = 'ENG_SAMPLE_DOC';
export const PERMISSION = 'eng.sample.use';
export const BIG_AMOUNT_RUPEES = 1_000_000;
const iso = () => new Date().toISOString();
const setStatus = (db, id, status, actor, extra = '') => db.prepare(`UPDATE eng_sample_docs SET status = ?, ${extra} updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(status, actor?.user ?? 'system', iso(), Number(id));
const changed = (db, doc, verb, actorId) => publishEvent(db, { type: `eng.sample_doc.${verb}`, entity: 'sample_doc', entityId: doc.id, actorId, companyId: doc.company_id, projectId: doc.project_id, siteId: doc.site_id, data: { docNo: doc.doc_no, status: doc.status } });

workflowTypes.register({
  docType: SAMPLE_DOC_TYPE,
  label: 'Sample document',
  processOwner: 'PROCMGR',
  route: (id) => `/engine/sample-docs?open=${id}`,
  describe(db, companyId, id) {
    const d = db.prepare('SELECT * FROM eng_sample_docs WHERE id = ? AND company_id = ? AND is_active = 1').get(Number(id), companyId);
    return d ? { ref: d.doc_no, title: d.title, originator: d.requested_by, projectId: d.project_id, siteId: d.site_id } : null;
  },
  defaultDefinition: {
    name: 'Sample document approval',
    settings: { resubmit: 'first', distinctApprovers: true },
    steps: [
      { code: 'MANAGER', name: 'Project manager', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'PM' }], slaHours: 24, requireAttachment: false, checklist: [], when: null, notify: [], action: null },
      { code: 'FINANCE', name: 'Accounts manager', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'ACCMGR' }], slaHours: 24, requireAttachment: false, checklist: [], when: null, notify: [], action: null },
      { code: 'CFO', name: 'Chief financial officer (large amounts)', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'CFO' }], slaHours: 48, requireAttachment: false, checklist: [], when: { field: 'amount', op: 'gte', value: BIG_AMOUNT_RUPEES }, notify: [], action: null },
    ],
  },
  hooks: {
    onSubmitted(db, { instance, actor }) { setStatus(db, instance.docId, 'IN_APPROVAL', actor, 'instance_id = ' + Number(instance.id) + ','); },
    onResubmitted(db, { instance, actor }) { setStatus(db, instance.docId, 'IN_APPROVAL', actor); },
    onApproved(db, { instance, actor }) {
      setStatus(db, instance.docId, 'APPROVED', actor, 'locked = 1,'); // BR-03: approved means locked
      changed(db, db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(instance.docId)), 'approved', actor.user);
    },
    onRejected(db, { instance, actor }) { setStatus(db, instance.docId, 'REJECTED', actor); changed(db, db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(instance.docId)), 'rejected', actor.user); },
    onReturned(db, { instance, actor }) { setStatus(db, instance.docId, 'RETURNED', actor); changed(db, db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(instance.docId)), 'returned', actor.user); },
    onCancelled(db, { instance, actor }) { setStatus(db, instance.docId, 'CANCELLED', actor); changed(db, db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(instance.docId)), 'cancelled', actor.user); },
  },
});

export function createSampleDocService({ db, engine }) {
  const authz = authzOf(db);
  const present = (d) => ({
    id: d.id, docNo: d.doc_no, title: d.title, amount: fromUnits(d.amount, 'money').toFixed(2), amountText: formatINR(fromUnits(d.amount, 'money')), status: d.status, locked: d.locked === 1, requestedBy: d.requested_by,
    projectId: d.project_id, amendsId: d.amends_id, instanceId: d.instance_id, createdAt: d.created_at, version: d.version,
  });
  const load = (actor, id) => {
    const d = db.prepare('SELECT * FROM eng_sample_docs WHERE id = ? AND is_active = 1').get(id);
    if (!d || d.company_id !== actor.companyId || !authz.check(actor, PERMISSION, { companyId: d.company_id, projectId: d.project_id, siteId: d.site_id }).allowed) throw notFound('That sample document does not exist.');
    return d;
  };
  const mine = (actor, d) => { if (d.requested_by !== actor.user) throw forbidden(`Only ${d.requested_by}, who raised this document, can do this.`); };
  const editable = (d) => {
    if (d.locked || !['DRAFT', 'RETURNED'].includes(d.status) || engine.isLocked(d.company_id, SAMPLE_DOC_TYPE, d.id)) throw unprocessable(`This document is ${d.status.toLowerCase().replace('_', ' ')}${d.locked ? ' and locked' : ''}, so it cannot be changed. ${d.status === 'APPROVED' ? 'Amend it to start a new approval linked to this one.' : ''}`.trim());
  };
  const number = (companyId) => `WSD-${String(db.prepare('SELECT COUNT(*) + 1 AS n FROM eng_sample_docs WHERE company_id = ?').get(companyId).n).padStart(5, '0')}`;

  return {
    present,
    /** @param {any} actor @param {any} [o] */
    list(actor, { status, q, limit = 25, offset = 0 } = {}) {
      const where = ['d.company_id = :c', 'd.is_active = 1', authz.scopeFilter(actor, PERMISSION, { project: 'd.project_id', site: 'd.site_id' }).sql];
      const p = { c: actor.companyId, limit, offset };
      if (status) { where.push('d.status = :s'); p.s = status; }
      if (q) { where.push('(d.title LIKE :q OR d.doc_no LIKE :q)'); p.q = `%${q}%`; }
      const pc = { ...p };
    delete pc.limit;
    delete pc.offset;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM eng_sample_docs d WHERE ${where.join(' AND ')}`).get(pc).n;
      return { rows: db.prepare(`SELECT d.* FROM eng_sample_docs d WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT :limit OFFSET :offset`).all(p).map(present), total };
    },
    get(actor, id) {
      const d = load(actor, id);
      return { ...present(d), workflow: d.instance_id ? engine.forDocument(actor, SAMPLE_DOC_TYPE, d.id) : null };
    },
    create(actor, { title, amount, projectId }) {
      if (!authz.check(actor, PERMISSION, { companyId: actor.companyId, projectId }).allowed) throw forbidden('You may not raise sample documents here.');
      return transaction(db, () => {
        if (projectId && !db.prepare('SELECT 1 FROM org_projects WHERE id = ? AND company_id = ?').get(projectId, actor.companyId)) throw unprocessable('That project does not exist in your company.');
        const res = db.prepare("INSERT INTO eng_sample_docs (company_id, doc_no, title, amount, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'sample_doc')")
          .run(actor.companyId, number(actor.companyId), title, toUnits(amount, 'money'), actor.user, projectId ?? null, actor.user);
        const d = db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(res.lastInsertRowid));
        writeAudit(db, { entity: 'eng_sample_docs', entityId: d.id, action: 'create', newValues: { docNo: d.doc_no, amount }, actor: actor.user });
        changed(db, d, 'created', actor.user);
        return present(d);
      });
    },
    update(actor, id, { title, amount, projectId, version }) {
      return transaction(db, () => {
        const d = load(actor, id);
        mine(actor, d);
        editable(d);
        if (version !== undefined && version !== d.version) throw conflict('This document was changed by someone else. Refresh it and edit again.');
        db.prepare('UPDATE eng_sample_docs SET title = ?, amount = ?, project_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(title, toUnits(amount, 'money'), projectId ?? d.project_id, actor.user, iso(), id);
        writeAudit(db, { entity: 'eng_sample_docs', entityId: id, action: 'update', oldValues: { title: d.title, amount: fromUnits(d.amount, 'money').toFixed(2) }, newValues: { title, amount }, actor: actor.user });
        return present(db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(id));
      });
    },
    /** Send it into approval (or back, after a return). The total is recomputed here and the engine is given the facts its conditions read. */
    /** @param {any} actor @param {any} id @param {any} [o] */
    submit(actor, id, { comment } = {}) {
      return transaction(db, () => {
        const d = load(actor, id);
        mine(actor, d);
        if (!['DRAFT', 'RETURNED', 'REJECTED', 'CANCELLED'].includes(d.status)) throw unprocessable(`This document is ${d.status.toLowerCase().replace('_', ' ')}, so it cannot be submitted.`);
        if (d.amount <= 0) throw unprocessable('Enter an amount above zero before you submit.');
        const instance = engine.submit(actor, { docType: SAMPLE_DOC_TYPE, docId: d.id, comment, amendsDocId: d.amends_id ?? undefined, context: { amount: Number(fromUnits(d.amount, 'money').toFixed(2)), title: d.title } });
        return { ...present(db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(id)), workflow: instance };
      });
    },
    /** An approved document is locked; the amendment is a new document linked to it, with its own approval. */
    amend(actor, id) {
      return transaction(db, () => {
        const d = load(actor, id);
        if (d.status !== 'APPROVED') throw unprocessable('Only an approved document is amended; this one is not approved.');
        mine(actor, d);
        if (db.prepare("SELECT 1 FROM eng_sample_docs WHERE amends_id = ? AND status NOT IN ('CANCELLED', 'REJECTED') AND is_active = 1").get(id)) throw conflict('This document already has an amendment in progress.');
        const res = db.prepare("INSERT INTO eng_sample_docs (company_id, doc_no, title, amount, requested_by, project_id, site_id, amends_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sample_doc', ?)")
          .run(d.company_id, number(d.company_id), d.title, d.amount, actor.user, d.project_id, d.site_id, d.id, actor.user, String(d.id));
        const n = db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(res.lastInsertRowid));
        writeAudit(db, { entity: 'eng_sample_docs', entityId: n.id, action: 'amend', newValues: { amends: d.doc_no }, actor: actor.user });
        return present(n);
      });
    },
  };
}
