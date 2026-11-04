import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { workflowTypes } from '../../platform/workflow/registry.js';
import { evidenceProviders } from '../../platform/workflow/evidence.js';
import { controlRegistry, protocolOf } from '../../platform/protocol/index.js';
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

// The sample controls of the Protocol & Control Engine (part 04.04): three control points on the sample document that show every enforcement. They run on every path that submits a
// document (the screen, the API and the import), inside the transaction of the submission.
export const SAMPLE_ENTITY = 'sample_doc';
controlRegistry.define({
  code: 'CP-ENG-01', module: 'eng', stage: 'VERIFY', description: 'A sample document above the limit for a request needs an approved exception', enforcement: 'EXCEPTION', thresholds: { maxAmount: 500_000 },
  evidenceRequired: true, escalationLevel: 1, ownerRole: 'PROCMGR', emergencyAllowed: true, mode: 'OBSERVE',
  evaluate: ({ context, thresholds }) => ({ pass: !(Number(context.amount) > Number(thresholds.maxAmount)), message: `The amount is above ${formatINR(Number(thresholds.maxAmount).toFixed(2))}, the limit for a request without an exception`, details: { amount: context.amount, limit: thresholds.maxAmount } }),
});
controlRegistry.define({
  code: 'CP-ENG-02', module: 'eng', stage: 'VERIFY', description: 'A sample document much larger than the usual request of the same person is flagged', enforcement: 'WARN', thresholds: { times: 3 },
  escalationLevel: 1, ownerRole: 'PROCMGR', mode: 'WARN',
  evaluate: ({ db, context, thresholds }) => {
    const recent = db.prepare('SELECT amount FROM eng_sample_docs WHERE company_id = ? AND requested_by = ? AND id != ? AND is_active = 1 ORDER BY id DESC LIMIT 5').all(context.companyId, context.requestedBy, Number(context.entityId));
    if (!recent.length) return { pass: true };
    const avg = recent.reduce((n, r) => n + r.amount, 0) / recent.length / 100;
    return { pass: !(Number(context.amount) > avg * Number(thresholds.times)), message: `The amount is more than ${thresholds.times} times the usual request of ${context.requestedBy} (${formatINR(avg.toFixed(2))})`, details: { average: Math.round(avg * 100) / 100 } };
  },
});
controlRegistry.define({
  code: 'CP-ENG-03', module: 'eng', stage: 'VERIFY', description: 'A sample document of ₹1 crore or more is not accepted at all', enforcement: 'BLOCK', thresholds: { ceiling: 10_000_000 },
  escalationLevel: 2, ownerRole: 'SYSADM', mode: 'OFF',
  evaluate: ({ context, thresholds }) => ({ pass: !(Number(context.amount) >= Number(thresholds.ceiling)), message: `The amount is ${formatINR(Number(thresholds.ceiling).toFixed(2))} or more, which this kind of request may never be`, details: { amount: context.amount } }),
});
export const SAMPLE_CONTROLS = ['CP-ENG-03', 'CP-ENG-01', 'CP-ENG-02'];
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
  summarise(db, actor, id) {
    const d = db.prepare('SELECT * FROM eng_sample_docs WHERE id = ? AND is_active = 1').get(Number(id));
    if (!d) return null;
    return { fields: [{ label: 'Number', value: d.doc_no }, { label: 'Title', value: d.title }, { label: 'Amount', value: d.amount / 100, format: 'inr' }, { label: 'Raised by', value: d.requested_by }, { label: 'Status', value: d.status.replace('_', ' ').toLowerCase() }, ...(d.amends_id ? [{ label: 'Amends', value: `document ${d.amends_id}` }] : [])], lines: null };
  },
  defaultDefinition: {
    name: 'Sample document approval',
    settings: { resubmit: 'first', distinctApprovers: true, matrix: true },
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
      protocolOf(db).markStage(instance.companyId, SAMPLE_ENTITY, instance.docId, 'APPROVE', null, actor.user);
      changed(db, db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(instance.docId)), 'approved', actor.user);
    },
    onRejected(db, { instance, actor }) { setStatus(db, instance.docId, 'REJECTED', actor); changed(db, db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(instance.docId)), 'rejected', actor.user); },
    onReturned(db, { instance, actor }) { setStatus(db, instance.docId, 'RETURNED', actor); changed(db, db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(instance.docId)), 'returned', actor.user); },
    onCancelled(db, { instance, actor }) { setStatus(db, instance.docId, 'CANCELLED', actor); changed(db, db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(Number(instance.docId)), 'cancelled', actor.user); },
  },
});

/** @param {{ db: any, engine: any, controlsOn?: (companyId: number) => boolean }} o */
export function createSampleDocService({ db, engine, controlsOn = () => false }) {
  const protocol = protocolOf(db);
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
        if (controlsOn(actor.companyId)) protocol.markStage(actor.companyId, SAMPLE_ENTITY, d.id, 'PLAN', null, actor.user);
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
    submit(actor, id, { comment, source = 'api' } = {}) {
      return transaction(db, () => {
        const d = load(actor, id);
        mine(actor, d);
        if (!['DRAFT', 'RETURNED', 'REJECTED', 'CANCELLED'].includes(d.status)) throw unprocessable(`This document is ${d.status.toLowerCase().replace('_', ' ')}, so it cannot be submitted.`);
        if (d.amount <= 0) throw unprocessable('Enter an amount above zero before you submit.');
        // the control points of the Protocol & Control Engine: a block or a missing exception stops the submission here, on every path, and undoes nothing else because nothing else was done yet
        const controlWarnings = [];
        if (controlsOn(actor.companyId)) {
          const facts = { entity: SAMPLE_ENTITY, entityId: String(d.id), ref: d.doc_no, amount: Number(fromUnits(d.amount, 'money').toFixed(2)), projectId: d.project_id, siteId: d.site_id, companyId: d.company_id, requestedBy: d.requested_by, source };
          for (const code of SAMPLE_CONTROLS) {
            const r = protocol.enforce(actor, code, facts);
            if (r.outcome === 'warn') controlWarnings.push({ control: code, message: r.message });
          }
        }
        const instance = engine.submit(actor, { docType: SAMPLE_DOC_TYPE, docId: d.id, comment, amendsDocId: d.amends_id ?? undefined, context: { amount: Number(fromUnits(d.amount, 'money').toFixed(2)), title: d.title } });
        return { ...present(db.prepare('SELECT * FROM eng_sample_docs WHERE id = ?').get(id)), workflow: instance, controlWarnings };
      });
    },
    /**
     * Rows from a file or another system. Each row is made a draft and sent into approval on its own, through the same checks as the screen; a row a control stops stays a
     * draft, with the reason, and does not stop the others.
     * @param {any} actor @param {any[]} rows
     */
    importRows(actor, rows) {
      const out = [];
      for (const [i, row] of rows.entries()) {
        let doc = null;
        try {
          doc = this.create(actor, { title: row.title, amount: row.amount, projectId: row.projectId });
          const done = this.submit(actor, doc.id, { comment: 'Imported', source: 'import' });
          out.push({ row: i + 1, ok: true, docNo: done.docNo, status: done.status, warnings: done.controlWarnings });
        } catch (e) {
          out.push({ row: i + 1, ok: false, docNo: doc?.docNo ?? null, status: doc ? 'DRAFT' : null, code: e.code ?? 'ERROR', message: e.message });
        }
      }
      return { rows: out, submitted: out.filter((r) => r.ok).length, stopped: out.filter((r) => !r.ok).length };
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
        publishEvent(db, { type: 'eng.sample_doc.amended', entity: 'sample_doc', entityId: n.id, actorId: actor.user, companyId: n.company_id, projectId: n.project_id, siteId: n.site_id, data: { docNo: n.doc_no, status: n.status, amendsId: d.id } });
        return present(n);
      });
    },
  };
}

// The evidence the sample document shows an approver (part 04.03): how the request compares with what this person asked for before. A procurement document would
// add its budget, commitments, rates and stock the same way.
evidenceProviders.register(SAMPLE_DOC_TYPE, ({ db, instance }) => {
  const d = db.prepare('SELECT * FROM eng_sample_docs WHERE id = ? AND company_id = ?').get(Number(instance.docId), instance.companyId);
  if (!d) return { sections: [] };
  const recent = db.prepare("SELECT doc_no, title, amount, status FROM eng_sample_docs WHERE company_id = ? AND requested_by = ? AND id != ? AND is_active = 1 ORDER BY id DESC LIMIT 5").all(d.company_id, d.requested_by, d.id);
  const avg = recent.length ? recent.reduce((n, r) => n + r.amount, 0) / recent.length : null;
  return {
    sections: [
      { code: 'request', title: 'The request', kind: 'metrics', items: [
        { label: 'Amount', value: d.amount / 100, format: 'inr' },
        { label: 'Average of the last five by the same person', value: avg == null ? 'No earlier request' : avg / 100, format: avg == null ? 'text' : 'inr' },
        ...(avg ? [{ label: 'Against that average', value: Math.round(((d.amount - avg) / avg) * 1000) / 10, format: 'percent', tone: d.amount > avg * 2 ? 'warning' : 'success' }] : []),
      ] },
      { code: 'recent', title: `Earlier requests by ${d.requested_by}`, kind: 'table', columns: [{ key: 'no', label: 'Number' }, { key: 'title', label: 'Title' }, { key: 'amount', label: 'Amount', format: 'inr' }, { key: 'status', label: 'Status' }], rows: recent.map((r) => ({ no: r.doc_no, title: r.title, amount: r.amount / 100, status: r.status.replace('_', ' ').toLowerCase() })), empty: 'This person has not raised another request.' },
    ],
    flags: avg && d.amount > avg * 3 ? [{ code: 'out_of_pattern', label: 'Much larger than their usual request', severity: 'medium' }] : [],
  };
});

/** The sample document as an object type (part 04.14): its Discussion, Timeline and Trace tabs work through the shared registry like any other record. */
export function registerSampleDocObject() {
  if (objectTypes.get('sample_doc')) return;
  objectTypes.register({
    type: 'sample_doc',
    label: 'Sample document',
    permission: PERMISSION,
    route: (id) => `/engine/sample-docs?open=${id}`,
    approvalTarget: null,
    documentType: SAMPLE_DOC_TYPE,
    attachmentEntity: 'sample_doc',
    access(db, actor, id) {
      const d = db.prepare('SELECT company_id, project_id, site_id, status FROM eng_sample_docs WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      if (!d || !authzOf(db).check(actor, PERMISSION, { companyId: d.company_id, projectId: d.project_id, siteId: d.site_id ?? undefined }).allowed) return null;
      return { companyId: d.company_id, projectId: d.project_id, siteId: d.site_id, status: d.status };
    },
    auditEntities: (id) => [{ entity: 'eng_sample_docs', id }],
    summary(db, actor, id) {
      const d = db.prepare('SELECT doc_no, title, amount, status FROM eng_sample_docs WHERE id = ? AND company_id = ?').get(id, actor.companyId);
      return d ? { label: `${d.doc_no ?? `#${id}`}: ${d.title}`, status: d.status, amount: fromUnits(d.amount, 'money').toFixed(2) } : null;
    },
    projectRecords: (db, companyId, projectId, limit) => db.prepare('SELECT id FROM eng_sample_docs WHERE company_id = ? AND project_id = ? AND is_active = 1 ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((r) => r.id),
  });
}
