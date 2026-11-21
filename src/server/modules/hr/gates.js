import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { authzOf } from '../../platform/authz/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { transaction } from '../../platform/db/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import CATALOGUE from './gate-catalogue.json' with { type: 'json' };
import { renderPdf } from '../eng/tpl-pdf.js';

// Part 07.14 (built in 166.6): the formal closure of the gates G1–G4. A gate is an object page per company: its criteria (derived from the
// repository by scripts/gate_catalogue.mjs — D-690), each with its evidence links, a status set by the reviewer (the IT administrator, the
// technical lead of 07_APPROVAL_WORKFLOW_REFERENCE.md), the reviewer and the date. When every criterion is met the gate is sent for sign-off
// through the workflow engine (technical lead → director, ADR-622); it passes when the director approves. The report is a PDF with the
// criteria, the evidence and the sign-off history.

export const GATE_DOC = 'HR_GATE';
const STATUSES = ['OPEN', 'MET', 'NOT_MET'];
const DOCS_ROOT = resolve('docs', 'erp');
const services = new WeakMap();
export const bindGates = (db, s) => services.set(db, s);
export const gatesOf = (db) => services.get(db) ?? null;

/** Where an evidence path is on disk, if it is one of the documents of docs/erp (nothing outside it is ever read). */
export function evidenceFile(path) {
  if (typeof path !== 'string' || !/^docs\/erp\/[\w./ -]+\.(md|png|json|csv)$/.test(path) || path.includes('..')) return null;
  const file = resolve(path);
  if (!file.startsWith(DOCS_ROOT + sep)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

export function createGateService({ db }) {
  const authz = authzOf(db);
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const now = () => new Date().toISOString();
  const byCode = new Map(CATALOGUE.gates.map((g) => [g.code, g]));
  const evidenceOfCriterion = new Map(CATALOGUE.gates.flatMap((g) => g.criteria.map((c) => [`${g.code}|${c.code}`, c.evidence])));

  /** The gates of the company, made from the catalogue the first time (and any criterion added to the catalogue since). */
  function ensure(actor) {
    transaction(db, () => {
      for (const g of CATALOGUE.gates) {
        db.prepare("INSERT OR IGNORE INTO hr_gates (company_id, code, name, catalogue_version, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'catalogue')").run(actor.companyId, g.code, g.name, CATALOGUE.version, actor.user);
        const gate = db.prepare('SELECT id FROM hr_gates WHERE company_id = ? AND code = ?').get(actor.companyId, g.code);
        g.criteria.forEach((c, i) => {
          db.prepare("INSERT OR IGNORE INTO hr_gate_criteria (company_id, gate_id, code, title, part_id, kind, sort_order, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'catalogue')")
            .run(actor.companyId, gate.id, c.code, c.title, c.partId, c.kind, i + 1, actor.user);
        });
      }
    });
  }
  const row = (actor, code) => {
    if (!byCode.has(code)) throw notFound(`There is no gate ${code}.`);
    ensure(actor);
    return db.prepare('SELECT * FROM hr_gates WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(actor.companyId, code);
  };
  const counts = (gateId) => {
    const r = db.prepare("SELECT COUNT(*) AS total, SUM(status = 'MET') AS met, SUM(status = 'NOT_MET') AS notMet, SUM(status = 'OPEN') AS open FROM hr_gate_criteria WHERE gate_id = ? AND deleted_at IS NULL").get(gateId);
    return { total: r.total, met: r.met ?? 0, notMet: r.notMet ?? 0, open: r.open ?? 0 };
  };
  const evidence = (gateCode, c) => [
    ...(evidenceOfCriterion.get(`${gateCode}|${c.code}`) ?? []),
    ...JSON.parse(c.extra_evidence_json || '[]'),
  ].map((e) => ({ ...e, resolves: Boolean(evidenceFile(e.path)), href: `/api/v1/hr/gates/evidence?path=${encodeURIComponent(e.path)}` }));
  const view = (g) => ({
    code: g.code, name: g.name, status: g.status, derived: CATALOGUE.derived, catalogueVersion: g.catalogue_version, counts: counts(g.id),
    submittedBy: g.submitted_by, submittedAt: g.submitted_at, passedAt: g.passed_at, workflowInstanceId: g.workflow_instance_id, version: g.version,
  });
  const editable = (g) => g.status === 'OPEN' || g.status === 'RETURNED';

  const gates = {
    list(actor) {
      need(actor, 'hr.gate.view', 'see the gates');
      ensure(actor);
      return db.prepare('SELECT * FROM hr_gates WHERE company_id = ? AND deleted_at IS NULL ORDER BY code').all(actor.companyId).map(view);
    },
    get(actor, code) {
      need(actor, 'hr.gate.view', 'see the gates');
      const g = row(actor, code);
      const criteria = db.prepare('SELECT * FROM hr_gate_criteria WHERE gate_id = ? AND deleted_at IS NULL ORDER BY sort_order').all(g.id).map((c) => ({
        code: c.code, title: c.title, partId: c.part_id, kind: c.kind, status: c.status, note: c.note, reviewedBy: c.reviewed_by, reviewedAt: c.reviewed_at,
        version: c.version, evidence: evidence(g.code, c),
      }));
      const history = g.workflow_instance_id ? signoff(actor, g.workflow_instance_id) : [];
      return { ...view(g), criteria, history, canReview: may(actor, 'hr.gate.review') && editable(g), canExport: may(actor, 'hr.gate.export') };
    },
    /** The reviewer marks a criterion met or not met (or back to open), with a note; a gate sent for sign-off or passed is not changed. */
    review(actor, code, criterion, { status, note, version }) {
      need(actor, 'hr.gate.review', 'review a gate');
      if (!STATUSES.includes(status)) throw unprocessable('A criterion is open, met or not met.', [{ field: 'status', message: 'is OPEN, MET or NOT_MET' }]);
      const g = row(actor, code);
      if (!editable(g)) throw conflict(`Gate ${code} is ${g.status.toLowerCase()}: its criteria are not changed.`);
      const c = db.prepare('SELECT * FROM hr_gate_criteria WHERE gate_id = ? AND code = ? AND deleted_at IS NULL').get(g.id, criterion);
      if (!c) throw notFound(`Gate ${code} has no criterion ${criterion}.`);
      if (version !== undefined && version !== c.version) throw conflict('Someone changed this criterion; reload it.');
      if (status === 'MET' && !evidence(g.code, c).some((e) => e.resolves)) throw unprocessable('A criterion is met only with evidence that can be opened.', [{ field: 'evidence', message: 'no evidence link resolves' }]);
      if (status === 'NOT_MET' && !String(note ?? '').trim()) throw unprocessable('Say why the criterion is not met.', [{ field: 'note', message: 'is required' }]);
      transaction(db, () => {
        db.prepare('UPDATE hr_gate_criteria SET status = ?, note = ?, reviewed_by = ?, reviewed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, note ?? null, actor.user, now(), actor.user, now(), c.id);
        writeAudit(db, { entity: 'hr_gate_criteria', entityId: c.id, action: 'update', oldValues: { status: c.status, note: c.note }, newValues: { status, note: note ?? null }, actor: actor.user, companyId: actor.companyId });
      });
      return gates.get(actor, code);
    },
    /** T-G2: sent for sign-off only when every criterion is met; the workflow engine routes it (technical lead, then the director). */
    /** @param {any} actor @param {string} code @param {{ comment?: string }} [body] */
    submit(actor, code, { comment } = {}) {
      need(actor, 'hr.gate.review', 'send a gate for sign-off');
      const g = row(actor, code);
      if (!editable(g)) throw conflict(`Gate ${code} is ${g.status.toLowerCase()}.`);
      const n = counts(g.id);
      if (n.met !== n.total) throw unprocessable(`Gate ${code} cannot pass: ${n.total - n.met} of its ${n.total} criteria are not met.`, [{ field: 'criteria', message: `${n.open} open, ${n.notMet} not met` }]);
      return transaction(db, () => {
        const inst = workflowOf(db).submit(actor, { docType: GATE_DOC, docId: g.id, comment: comment ?? `Gate ${code} for sign-off`, context: { gate: code, criteria: n.total } });
        db.prepare("UPDATE hr_gates SET status = 'SUBMITTED', workflow_instance_id = ?, submitted_by = ?, submitted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(inst.id, actor.user, now(), actor.user, now(), g.id);
        writeAudit(db, { entity: 'hr_gates', entityId: g.id, action: 'submit', newValues: { code, criteria: n.total }, actor: actor.user, companyId: actor.companyId });
        return gates.get(actor, code);
      });
    },
    /** The decision of the sign-off chain. */
    decide(instance, actor, outcome, comment) {
      const g = db.prepare('SELECT * FROM hr_gates WHERE id = ?').get(Number(instance.docId));
      if (!g) return;
      const status = outcome === 'APPROVED' ? 'PASSED' : 'RETURNED';
      db.prepare('UPDATE hr_gates SET status = ?, passed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, status === 'PASSED' ? now() : null, actor?.user ?? 'system', now(), g.id);
      writeAudit(db, { entity: 'hr_gates', entityId: g.id, action: outcome === 'APPROVED' ? 'approve' : 'return', newValues: { status }, reason: comment ?? null, actor: actor?.user ?? 'system', companyId: g.company_id });
    },
    /** §2.3: the gate report as a PDF: the criteria with status, reviewer, date and evidence, and the sign-off of the reviewer roles. */
    async report(actor, code) {
      need(actor, 'hr.gate.export', 'export a gate report');
      const g = gates.get(actor, code);
      const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
      const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/ /g, '-') : '');
      const WORD = { OPEN: 'Open', MET: 'Met', NOT_MET: 'Not met' };
      const EVENT = { SUBMITTED: 'Sent for sign-off', RESUBMITTED: 'Sent again', APPROVED: 'Signed (approved)', REJECTED: 'Rejected', RETURNED_TO_STEP: 'Returned', COMPLETED: 'Sign-off complete' };
      const html = `<h1>${esc(g.code)} ${esc(g.name)}: gate report</h1>
<p>Status: <b>${esc(g.status === 'PASSED' ? `Passed on ${day(g.passedAt)}` : g.status.toLowerCase())}</b>. Criteria met: ${g.counts.met} of ${g.counts.total}${g.counts.notMet ? `; not met: ${g.counts.notMet}` : ''}${g.counts.open ? `; open: ${g.counts.open}` : ''}.</p>
<p>The criteria are derived from the parts of the gate in the progress register, their completion reports and discovery notes, and the defect register (catalogue ${esc(g.catalogueVersion)}).</p>
<h2>Sign-off</h2>
<table><thead><tr><th>Step</th><th>Decision</th><th>By</th><th>Date</th><th>Comment</th></tr></thead><tbody>${g.history.length ? g.history.map((h) => `<tr><td>${esc(h.role ?? h.step ?? '')}</td><td>${esc(EVENT[h.event] ?? h.event)}</td><td>${esc(h.by)}</td><td>${esc(day(h.at))}</td><td>${esc(h.comment)}</td></tr>`).join('') : '<tr><td colspan="5">Not sent for sign-off yet.</td></tr>'}</tbody></table>
<h2>Criteria</h2>
<table><thead><tr><th>Criterion</th><th>Status</th><th>Reviewer</th><th>Date</th><th>Evidence</th></tr></thead><tbody>${g.criteria.map((c) => `<tr><td>${esc(c.code)}: ${esc(c.title)}${c.note ? `<br/>${esc(c.note)}` : ''}</td><td>${esc(WORD[c.status])}</td><td>${esc(c.reviewedBy)}</td><td>${esc(day(c.reviewedAt))}</td><td>${c.evidence.map((e) => `${esc(e.path)}${e.resolves ? '' : ' (missing)'}`).join('<br/>')}</td></tr>`).join('')}</tbody></table>`;
      const pdf = await renderPdf(html, { css: 'h1 { font-size: 16pt; } h2 { font-size: 12pt; margin-top: 12pt; } table { width: 100%; border-collapse: collapse; } th, td { border: 0.5pt solid #999; padding: 3pt; font-size: 8pt; text-align: left; } th { background: #eee; }', title: `${g.code} ${g.name} gate report`, author: actor.user });
      writeAudit(db, { entity: 'hr_gates', entityId: db.prepare('SELECT id FROM hr_gates WHERE company_id = ? AND code = ?').get(actor.companyId, code).id, action: 'export', newValues: { report: 'pdf' }, actor: actor.user, companyId: actor.companyId });
      return { contentType: 'application/pdf', fileName: `gate-${code}-report.pdf`, buffer: pdf.buffer, pages: pdf.pages };
    },
    /** An evidence document, read only, from docs/erp (T-G1: every link of a criterion resolves). */
    evidence(actor, path) {
      need(actor, 'hr.gate.view', 'see gate evidence');
      const file = evidenceFile(path);
      if (!file) throw notFound('That evidence document does not exist.');
      const type = /\.png$/.test(path) ? 'image/png' : /\.json$/.test(path) ? 'application/json' : /\.csv$/.test(path) ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8';
      return { contentType: type, buffer: readFileSync(file) };
    },
  };

  /** The sign-off history of a gate: each step's decision, who took it, their role, when, and the comment. */
  function signoff(actor, instanceId) {
    const STEP = { TECHLEAD: 'Technical lead (ITADM)', DIR: 'Director (DIR)' };
    return db.prepare("SELECT event, step_code, actor, comment, at FROM wf_history WHERE instance_id = ? AND event IN ('SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED_TO_STEP', 'COMPLETED') ORDER BY id").all(instanceId)
      .map((r) => ({ event: r.event, step: r.step_code, role: STEP[r.step_code] ?? null, by: r.actor, at: r.at, comment: r.comment }));
  }

  /** Internal readiness check for dependent modules. It never opens or signs a gate. */
  function hasPassed(companyId, code) {
    return Boolean(db.prepare(`
      SELECT 1 FROM hr_gates
      WHERE company_id = ? AND code = ? AND status = 'PASSED'
        AND passed_at IS NOT NULL AND is_active = 1 AND deleted_at IS NULL
    `).get(companyId, code));
  }

  return { gates, ensure, hasPassed };
}

const step = (code, name, roles) => ({ code, name, type: 'approval', mode: 'single', approvers: roles.map((role) => ({ kind: 'role', role })), slaHours: 72, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
workflowTypes.register({
  docType: GATE_DOC, label: 'Gate sign-off', processOwner: 'DIR', route: (id) => `/admin/gate?id=${id}`,
  describe(db, companyId, id) { const g = db.prepare('SELECT code, name FROM hr_gates WHERE id = ? AND company_id = ?').get(Number(id), companyId); return g ? { ref: g.code, title: `${g.code} ${g.name}` } : null; },
  summarise(db, _actor, id) { const g = db.prepare('SELECT * FROM hr_gates WHERE id = ?').get(Number(id)); if (!g) return null; const n = db.prepare("SELECT COUNT(*) AS total, SUM(status = 'MET') AS met FROM hr_gate_criteria WHERE gate_id = ? AND deleted_at IS NULL").get(g.id); return { fields: [{ label: 'Gate', value: `${g.code} ${g.name}` }, { label: 'Criteria met', value: `${n.met ?? 0} of ${n.total}` }] }; },
  // 07_APPROVAL_WORKFLOW_REFERENCE.md: technical lead → product owner (owner/DIR); the IT administrator is the technical lead (ADR-622)
  defaultDefinition: { name: 'Gate sign-off: technical lead, director', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('TECHLEAD', 'Technical lead', ['ITADM']), step('DIR', 'Director', ['DIR'])] },
  hooks: {
    onApproved: (db, { instance, actor }) => gatesOf(db)?.gates.decide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => gatesOf(db)?.gates.decide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => gatesOf(db)?.gates.decide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => gatesOf(db)?.gates.decide(instance, actor, 'CANCELLED', comment),
  },
});
