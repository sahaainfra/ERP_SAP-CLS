import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toCsv } from '../../platform/security/csv.js';
import { workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createBase, nowIso, rid } from '../proc/base.js';

/**
 * Part 26.04: project closeout, final account, lessons learned and the knowledge base (built on the owner's instruction of 2026-11-25,
 * audit AUD-DEF-004).
 *
 *  - FR-01 The closeout checklist: automatic checks read live from the modules that own the records (an issued handover, every defects
 *    liability period completed, no work order open, no snag open, the final account agreed, an approved P&L snapshot linked, a lesson
 *    written) and manual items done with their evidence (retention and securities settled, bank guarantees returned, subcontract settlements,
 *    demobilisation, records archived).
 *  - FR-02 The client final account: the agreed value, date and signed copy.
 *  - FR-03 The final P&L from an approved, frozen monthly snapshot of Finance (23.12), and the performance of the project (time against the
 *    scheduled completion, NCRs, snags, incidents, defects liability complaints).
 *  - FR-04 Lessons: written by anyone on a project team, reviewed by the project controls manager (author -> PCMGR) before they are published
 *    to the knowledge base; benchmarks proposed with the closeout are approved with it and serve estimating and planning.
 *  - FR-05 Approval PM -> PD -> CFO -> DIR; on approval cls.project.closed is announced and the Project Setup move to CLOSED (10.01) finds
 *    the approved closeout among its checks (a readiness provider).
 *  - BR-01 The closeout is refused while a mandatory item is not met; checked at request.
 */
export const CLOSURE_FLAG = 'ff.close.p2604';
export const CLS_DOC = 'CLS_CLOSURE';
export const KB_DOC = 'KB_LESSON';
const MANUAL = [['RETENTION', 'Retention and securities released or settled', 1], ['GUARANTEES', 'Bank guarantees returned or released', 1], ['SUB_SETTLEMENT', 'Subcontract final settlements agreed', 1], ['DEMOB', 'Site demobilised and handed back', 1], ['RECORDS', 'Project records handed to the archive', 0]];
const AUTO = ['HANDOVER', 'DLP', 'WORK_ORDERS', 'SNAGS', 'FINAL_ACCOUNT', 'PL_SNAPSHOT', 'LESSONS'];
const AUTO_TITLE = { HANDOVER: 'A handover issued to the client (26.02)', DLP: 'Every defects liability period completed (26.03)', WORK_ORDERS: 'No work order open (21.03)', SNAGS: 'No snag open (18.06)', FINAL_ACCOUNT: 'The final account agreed with the client', PL_SNAPSHOT: 'An approved, frozen P&L snapshot linked (23.12)', LESSONS: 'At least one lesson written for the project' };
export const CATEGORIES = ['DESIGN', 'PROCUREMENT', 'EXECUTION', 'QUALITY', 'SAFETY', 'COMMERCIAL', 'CONTRACT', 'PLANNING', 'OTHER'];

export function createClosure({ db }) {
  const base = createBase({ db });
  const { may, need, audit, number } = base;
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;
  const scope = (actor, key, alias = 'c') => base.authz.scopeFilter(actor, key, { project: `${alias}.org_project_id` }).sql;
  const row = (actor, id, key = 'cls.view') => {
    const c = db.prepare('SELECT * FROM cls_closures WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!c || !may(actor, 'cls.view', c.org_project_id)) throw notFound('That closeout does not exist.');
    if (key !== 'cls.view') need(actor, key, 'do that for this closeout', c.org_project_id);
    return c;
  };
  const editable = (c) => { if (!['DRAFT', 'REJECTED'].includes(c.status)) throw conflict(`${c.doc_no} is ${c.status.toLowerCase()}: it changes while it is a draft or rejected.`); };
  const fileOk = (companyId, id) => Boolean(db.prepare('SELECT 1 FROM core_files WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), companyId));

  /** The automatic checks of FR-01, read live from their owners. */
  function autoChecks(c) {
    const pid = c.org_project_id; const out = {};
    const issued = has('ho_handovers') ? count("SELECT COUNT(*) AS n FROM ho_handovers WHERE org_project_id = ? AND status = 'ISSUED' AND deleted_at IS NULL", pid) : 0;
    out.HANDOVER = { ok: issued > 0, detail: `${issued} issued handover(s)` };
    // Every issued handover needs its period completed (or cancelled); a handover whose period was never opened (part 26.03 off when it was
    // issued) is still owed one, which the project manager opens by hand.
    const owed = has('dlp_periods') && has('ho_handovers') ? db.prepare("SELECT COUNT(*) AS n, SUM(EXISTS (SELECT 1 FROM dlp_periods p WHERE p.handover_id = h.id AND p.status IN ('COMPLETED', 'CANCELLED') AND p.deleted_at IS NULL)) AS done, SUM(NOT EXISTS (SELECT 1 FROM dlp_periods p WHERE p.handover_id = h.id AND p.deleted_at IS NULL)) AS missing FROM ho_handovers h WHERE h.org_project_id = ? AND h.status = 'ISSUED' AND h.deleted_at IS NULL").get(pid) : { n: 0, done: 0, missing: 0 };
    out.DLP = { ok: owed.n > 0 && owed.done === owed.n, detail: `${owed.done ?? 0} of ${owed.n} issued handover(s) with the period completed${owed.missing ? `; ${owed.missing} without a period opened` : ''}` };
    const wos = has('ctr_work_orders') ? count("SELECT COUNT(*) AS n FROM ctr_work_orders WHERE org_project_id = ? AND deleted_at IS NULL AND (status IN ('DRAFT', 'SUBMITTED', 'RETURNED') OR (status = 'APPROVED' AND wo_state != 'CLOSED'))", pid) : 0;
    out.WORK_ORDERS = { ok: wos === 0, detail: `${wos} work order(s) open` };
    const snags = has('qa_snags') ? count("SELECT COUNT(*) AS n FROM qa_snags WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'RECTIFIED')", pid) : 0;
    out.SNAGS = { ok: snags === 0, detail: `${snags} snag(s) open` };
    out.FINAL_ACCOUNT = { ok: c.final_account_paise != null && Boolean(c.final_account_agreed_on) && Boolean(c.final_account_file_id), detail: c.final_account_agreed_on ? `agreed on ${c.final_account_agreed_on}` : 'not recorded' };
    out.PL_SNAPSHOT = { ok: Boolean(c.pl_snapshot_id), detail: c.pl_snapshot_id ? `snapshot ${db.prepare('SELECT doc_no, period FROM pl_snapshots WHERE id = ?').get(c.pl_snapshot_id)?.period ?? c.pl_snapshot_id}` : 'not linked' };
    const lessons = count("SELECT COUNT(*) AS n FROM kb_lessons WHERE org_project_id = ? AND status IN ('SUBMITTED', 'PUBLISHED') AND deleted_at IS NULL", pid);
    out.LESSONS = { ok: lessons > 0, detail: `${lessons} lesson(s) submitted or published` };
    return out;
  }
  const items = (c) => {
    const auto = autoChecks(c);
    return [
      ...AUTO.map((code) => ({ id: null, code, title: AUTO_TITLE[code], kind: 'AUTO', mandatory: true, status: auto[code].ok ? 'DONE' : 'OPEN', note: auto[code].detail, fileId: null })),
      ...db.prepare('SELECT * FROM cls_checklist_items WHERE closure_id = ? AND deleted_at IS NULL ORDER BY id').all(c.id).map((i) => ({ id: i.id, code: i.code, title: i.title, kind: i.kind, mandatory: Boolean(i.mandatory), status: i.status, note: i.note, fileId: i.file_id, doneBy: i.done_by, doneAt: i.done_at, version: i.version })),
    ];
  };
  const readiness = (c) => { const open = items(c).filter((i) => i.mandatory && i.status !== 'DONE'); return { ready: open.length === 0, blockers: open.map((i) => `${i.title}: ${i.note ?? 'not done'}.`) }; };

  /** FR-03: the performance of the project, from the owners' records. */
  function performance(c) {
    const pid = c.org_project_id; const p = has('proj_projects') ? db.prepare('SELECT start_date, scheduled_completion, revised_completion, contract_value FROM proj_projects WHERE project_id = ?').get(pid) : null;
    const handedOn = has('ho_handovers') ? db.prepare("SELECT MAX(effective_on) AS d FROM ho_handovers WHERE org_project_id = ? AND status = 'ISSUED' AND deleted_at IS NULL").get(pid).d : null;
    const days = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) : null);
    return {
      startDate: p?.start_date ?? null, scheduledCompletion: p?.scheduled_completion ?? null, handedOverOn: handedOn,
      durationDays: days(p?.start_date, handedOn), delayDays: days(p?.revised_completion ?? p?.scheduled_completion, handedOn),
      ncrs: has('qa_ncrs') ? count('SELECT COUNT(*) AS n FROM qa_ncrs WHERE org_project_id = ? AND deleted_at IS NULL', pid) : null,
      snags: has('qa_snags') ? count('SELECT COUNT(*) AS n FROM qa_snags WHERE org_project_id = ? AND deleted_at IS NULL', pid) : null,
      incidents: has('hse_incidents') ? count('SELECT COUNT(*) AS n FROM hse_incidents WHERE org_project_id = ? AND deleted_at IS NULL', pid) : null,
      dlpComplaints: has('dlp_complaints') ? count('SELECT COUNT(*) AS n FROM dlp_complaints c JOIN dlp_periods p ON p.id = c.period_id WHERE p.org_project_id = ? AND c.deleted_at IS NULL', pid) : null,
    };
  }
  const rs = (paise) => (paise == null ? null : paise / 100);
  const benchmarksOf = (cid) => db.prepare('SELECT * FROM kb_benchmarks WHERE closure_id = ? AND deleted_at IS NULL ORDER BY id').all(cid).map((b) => ({ id: b.id, metricCode: b.metric_code, label: b.label, unit: b.unit, value: b.value_milli / 1000, basis: b.basis, status: b.status }));
  const view = (c) => ({ id: c.id, docNo: c.doc_no, projectId: c.org_project_id, project: db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(c.org_project_id) ?? null, status: c.status, finalAccount: rs(c.final_account_paise), finalAccountAgreedOn: c.final_account_agreed_on, finalAccountFileId: c.final_account_file_id, plSnapshotId: c.pl_snapshot_id, revenue: rs(c.revenue_paise), cost: rs(c.cost_paise), margin: c.revenue_paise != null && c.cost_paise != null ? rs(c.revenue_paise - c.cost_paise) : null, marginPct: c.revenue_paise ? Math.round(((c.revenue_paise - c.cost_paise) * 1000) / c.revenue_paise) / 10 : null, summary: c.summary, requestedBy: c.requested_by, closedAt: c.closed_at, workflowInstanceId: c.workflow_instance_id, version: c.version });

  const lessonView = (l) => ({ id: l.id, docNo: l.doc_no, projectId: l.org_project_id, project: l.org_project_id ? db.prepare('SELECT code FROM org_projects WHERE id = ?').get(l.org_project_id)?.code ?? null : null, title: l.title, category: l.category, impact: l.impact, whatHappened: l.what_happened, recommendation: l.recommendation, tags: l.tags, status: l.status, author: l.author, publishedAt: l.published_at, workflowInstanceId: l.workflow_instance_id, version: l.version });

  const svc = {
    list(actor, { projectId = null, status = null } = {}) {
      if (!base.authz.hasAnywhere(actor, 'cls.view')) throw forbidden('You may not see the closeouts (permission cls.view).');
      const where = ['c.company_id = ?', 'c.deleted_at IS NULL', scope(actor, 'cls.view')]; const args = [actor.companyId];
      if (projectId) { where.push('c.org_project_id = ?'); args.push(rid(projectId)); } if (status) { where.push('c.status = ?'); args.push(status); }
      return db.prepare(`SELECT c.* FROM cls_closures c WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT 500`).all(...args).map((c) => ({ ...view(c), readiness: readiness(c) }));
    },
    options(actor) {
      if (!base.authz.hasAnywhere(actor, 'cls.view')) throw forbidden('You may not see the closeouts (permission cls.view).');
      return { projects: db.prepare('SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 500').all(actor.companyId).filter((p) => may(actor, 'cls.manage', p.id)).map((p) => ({ ...p })) };
    },
    create(actor, { projectId }) {
      const p = base.project(actor, projectId, 'cls.view', 'cls.manage');
      if (db.prepare("SELECT 1 FROM cls_closures WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED') AND deleted_at IS NULL").get(p.id)) throw conflict('The project already has a closeout.');
      return transaction(db, () => {
        const docNo = number(actor.companyId, actor.user, 'CLS_CLOSURE', 'cls_closures', 'CLS');
        const id = Number(db.prepare("INSERT INTO cls_closures (company_id, org_project_id, doc_no, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'api')").run(actor.companyId, p.id, docNo, p.id, actor.user).lastInsertRowid);
        for (const [code, title, mandatory] of MANUAL) db.prepare("INSERT INTO cls_checklist_items (company_id, closure_id, code, title, kind, mandatory, project_id, created_by, source_type) VALUES (?, ?, ?, ?, 'MANUAL', ?, ?, ?, 'api')").run(actor.companyId, id, code, title, mandatory, p.id, actor.user);
        audit(actor, 'cls_closures', String(id), 'create', actor.companyId, { newValues: { project: p.code } });
        return svc.get(actor, id);
      });
    },
    get(actor, id) {
      const c = row(actor, id);
      const perf = performance(c); const v = view(c);
      const suggestions = [
        ...(v.marginPct != null ? [{ metricCode: 'MARGIN_PCT', label: 'Final operating margin', unit: '%', value: v.marginPct }] : []),
        ...(perf.durationDays != null ? [{ metricCode: 'DURATION_DAYS', label: 'Start to handover', unit: 'days', value: perf.durationDays }] : []),
        ...(perf.delayDays != null ? [{ metricCode: 'DELAY_DAYS', label: 'Handover against the scheduled completion', unit: 'days', value: perf.delayDays }] : []),
        ...(perf.ncrs != null && perf.durationDays ? [{ metricCode: 'NCR_PER_100_DAYS', label: 'NCRs per 100 days', unit: 'count', value: Math.round((perf.ncrs * 100000) / perf.durationDays) / 1000 }] : []),
      ];
      return { ...v, checklist: items(c), readiness: readiness(c), performance: perf, benchmarks: benchmarksOf(c.id), suggestions, lessons: db.prepare("SELECT * FROM kb_lessons WHERE org_project_id = ? AND deleted_at IS NULL AND (status = 'PUBLISHED' OR author = ?) ORDER BY id DESC").all(c.org_project_id, actor.user).map(lessonView), snapshots: may(actor, 'cls.manage', c.org_project_id) && may(actor, 'fin.pl_snapshot.view', c.org_project_id) && has('pl_snapshots') ? db.prepare("SELECT id, doc_no AS docNo, period FROM pl_snapshots WHERE company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND frozen_at IS NOT NULL ORDER BY period DESC LIMIT 36").all(c.company_id, c.org_project_id).map((x) => ({ ...x })) : [], can: { manage: may(actor, 'cls.manage', c.org_project_id), request: may(actor, 'cls.request', c.org_project_id), export: may(actor, 'cls.export', c.org_project_id) } };
    },
    /** FR-02 and FR-03: the agreed final account and the approved P&L snapshot. */
    update(actor, id, b) {
      const c = row(actor, id, 'cls.manage'); editable(c);
      if (b.rowVersion != null && b.rowVersion !== c.version) throw conflict('The closeout changed since you opened it; reload and try again.');
      const set = {};
      if (b.finalAccount !== undefined) {
        if (b.finalAccount != null) { if (!b.agreedOn || !b.fileId) throw unprocessable('The final account is recorded with the day it was agreed and the signed copy.'); if (!fileOk(actor.companyId, b.fileId)) throw unprocessable('That file does not exist.'); if (b.agreedOn > todayIST()) throw unprocessable('The final account was agreed on a day that has come.'); }
        Object.assign(set, { final_account_paise: b.finalAccount == null ? null : Math.round(b.finalAccount * 100), final_account_agreed_on: b.finalAccount == null ? null : b.agreedOn, final_account_file_id: b.finalAccount == null ? null : rid(b.fileId) });
      }
      if (b.snapshotId !== undefined) {
        if (b.snapshotId == null) Object.assign(set, { pl_snapshot_id: null, revenue_paise: null, cost_paise: null });
        else {
          const s = db.prepare("SELECT * FROM pl_snapshots WHERE id = ? AND company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND frozen_at IS NOT NULL").get(rid(b.snapshotId), actor.companyId, c.org_project_id);
          if (!s || !may(actor, 'fin.pl_snapshot.view', c.org_project_id)) throw unprocessable('That is not an approved, frozen P&L snapshot of this project you may see.');
          Object.assign(set, { pl_snapshot_id: s.id, revenue_paise: s.revenue_cum_paise, cost_paise: s.revenue_cum_paise - s.operating_profit_cum_paise });
        }
      }
      if (b.summary !== undefined) set.summary = b.summary;
      const keys = Object.keys(set); if (!keys.length) return svc.get(actor, c.id);
      db.prepare(`UPDATE cls_closures SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...keys.map((k) => set[k]), actor.user, nowIso(), c.id);
      audit(actor, 'cls_closures', String(c.id), 'update', actor.companyId, { newValues: b });
      return svc.get(actor, c.id);
    },
    recordItem(actor, itemId, b) {
      const i = db.prepare('SELECT * FROM cls_checklist_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(itemId), actor.companyId); if (!i) throw notFound('That checklist item does not exist.');
      const c = row(actor, i.closure_id, 'cls.manage'); editable(c);
      if (b.status === 'NOT_APPLICABLE' && i.mandatory) throw unprocessable('A mandatory item is done, not set aside.');
      if (b.status === 'DONE' && !b.fileId && (b.note ?? '').length < 5) throw unprocessable('Attach the evidence or say how it was done (at least 5 characters).');
      if (b.fileId && !fileOk(actor.companyId, b.fileId)) throw unprocessable('That file does not exist.');
      db.prepare('UPDATE cls_checklist_items SET status = ?, file_id = ?, note = ?, done_by = ?, done_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.status, b.fileId ? rid(b.fileId) : null, b.note ?? null, b.status === 'OPEN' ? null : actor.user, b.status === 'OPEN' ? null : nowIso(), actor.user, nowIso(), i.id);
      audit(actor, 'cls_checklist_items', String(i.id), b.status.toLowerCase(), actor.companyId, { reason: b.note });
      return svc.get(actor, c.id);
    },
    addBenchmark(actor, id, b) {
      const c = row(actor, id, 'cls.manage'); editable(c);
      if (db.prepare('SELECT 1 FROM kb_benchmarks WHERE closure_id = ? AND metric_code = ? AND deleted_at IS NULL').get(c.id, b.metricCode)) throw conflict(`The closeout already proposes ${b.metricCode}.`);
      db.prepare("INSERT INTO kb_benchmarks (company_id, org_project_id, closure_id, metric_code, label, unit, value_milli, basis, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, c.org_project_id, c.id, b.metricCode, b.label, b.unit, Math.round(b.value * 1000), b.basis ?? null, c.org_project_id, actor.user);
      audit(actor, 'kb_benchmarks', `${c.id}:${b.metricCode}`, 'create', actor.companyId, { newValues: b });
      return svc.get(actor, c.id);
    },
    request(actor, id) {
      const c = row(actor, id, 'cls.request'); editable(c);
      const r = readiness(c);
      if (!r.ready) throw unprocessable(`The closeout is refused: ${r.blockers.join(' ')}`, r.blockers.map((m) => ({ field: 'readiness', message: m })));
      return transaction(db, () => {
        db.prepare("UPDATE cls_closures SET status = 'SUBMITTED', requested_by = ?, readiness_json = ?, performance_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, JSON.stringify(r), JSON.stringify(performance(c)), actor.user, nowIso(), c.id);
        const inst = workflowOf(db).submit(actor, { docType: CLS_DOC, docId: String(c.id), comment: `Closeout ${c.doc_no}`, context: { projectId: c.org_project_id } });
        db.prepare('UPDATE cls_closures SET workflow_instance_id = ? WHERE id = ?').run(inst.id, c.id);
        audit(actor, 'cls_closures', String(c.id), 'request', actor.companyId);
        return svc.get(actor, c.id);
      });
    },
    decide(instance, actor, outcome, comment) {
      const c = db.prepare('SELECT * FROM cls_closures WHERE id = ?').get(rid(instance.docId)); if (!c || c.status !== 'SUBMITTED') return;
      const status = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'CANCELLED' ? 'DRAFT' : 'REJECTED';
      db.prepare('UPDATE cls_closures SET status = ?, closed_at = ?, remarks = COALESCE(?, remarks), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, status === 'APPROVED' ? nowIso() : null, comment ?? null, actor?.user ?? 'system', nowIso(), c.id);
      audit(actor, 'cls_closures', String(c.id), outcome.toLowerCase(), c.company_id, { reason: comment ?? undefined });
      if (status !== 'APPROVED') return;
      db.prepare("UPDATE kb_benchmarks SET status = 'APPROVED', approved_at = ?, updated_at = ?, version = version + 1 WHERE closure_id = ? AND status = 'PROPOSED' AND deleted_at IS NULL").run(nowIso(), nowIso(), c.id);
      publishEvent(db, { type: 'cls.project.closed', entity: 'cls_closures', entityId: String(c.id), actorId: actor?.user ?? 'system', companyId: c.company_id, projectId: c.org_project_id, data: { closureId: c.id, docNo: c.doc_no, projectId: c.org_project_id, finalAccount: rs(c.final_account_paise), revenue: rs(c.revenue_paise), cost: rs(c.cost_paise), plSnapshotId: c.pl_snapshot_id, benchmarks: benchmarksOf(c.id).length } });
    },
    exportCsv(actor) {
      if (!base.authz.hasAnywhere(actor, 'cls.export')) throw forbidden('You may not export the closeouts (permission cls.export).');
      const rows = svc.list(actor);
      audit(actor, 'cls_closures', '0', 'export', actor.companyId, { reason: `${rows.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `closeouts-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Closeout', 'Project', 'Status', 'Final account (Rs)', 'Agreed on', 'Revenue (Rs)', 'Cost (Rs)', 'Margin (Rs)', 'Margin %', 'Ready', 'Closed at'], rows.map((c) => [c.docNo, c.project?.code ?? '', c.status, c.finalAccount ?? '', c.finalAccountAgreedOn ?? '', c.revenue ?? '', c.cost ?? '', c.margin ?? '', c.marginPct ?? '', c.readiness.ready ? 'Yes' : 'No', c.closedAt ?? '']))}`, 'utf8') };
    },
    /** For Project Setup's move to CLOSED (10.01): the approved closeout of the project. */
    approvedFor: (projectId) => Boolean(db.prepare("SELECT 1 FROM cls_closures WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(projectId)),

    // FR-04 lessons and benchmarks
    lessons: {
      list(actor, { q = null, category = null, projectId = null, mine = null } = {}) {
        if (!base.authz.hasAnywhere(actor, 'kb.lesson.view')) throw forbidden('You may not read the lessons learned (permission kb.lesson.view).');
        const where = ['l.company_id = ?', 'l.deleted_at IS NULL']; const args = [actor.companyId];
        if (mine) { where.push('l.author = ?'); args.push(actor.user); } else { where.push("(l.status = 'PUBLISHED' OR l.author = ?)"); args.push(actor.user); }
        if (category) { where.push('l.category = ?'); args.push(category); } if (projectId) { where.push('l.org_project_id = ?'); args.push(rid(projectId)); }
        if (q) { where.push("(l.title LIKE ? ESCAPE '\\' OR l.what_happened LIKE ? ESCAPE '\\' OR l.recommendation LIKE ? ESCAPE '\\' OR l.tags LIKE ? ESCAPE '\\')"); const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`; args.push(like, like, like, like); }
        return db.prepare(`SELECT l.* FROM kb_lessons l WHERE ${where.join(' AND ')} ORDER BY COALESCE(l.published_at, l.created_at) DESC LIMIT 500`).all(...args).map(lessonView);
      },
      create(actor, b) {
        if (!base.authz.hasAnywhere(actor, 'kb.lesson.create')) throw forbidden('You may not write lessons (permission kb.lesson.create).');
        if (b.projectId) base.project(actor, b.projectId, 'kb.lesson.view');
        const docNo = number(actor.companyId, actor.user, 'KB_LESSON', 'kb_lessons', 'LL');
        const id = Number(db.prepare("INSERT INTO kb_lessons (company_id, org_project_id, doc_no, title, category, impact, what_happened, recommendation, tags, author, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, b.projectId ?? null, docNo, b.title, b.category, b.impact, b.whatHappened, b.recommendation, b.tags ?? null, actor.user, b.projectId ?? null, actor.user).lastInsertRowid);
        audit(actor, 'kb_lessons', String(id), 'create', actor.companyId, { newValues: b });
        return lessonView(db.prepare('SELECT * FROM kb_lessons WHERE id = ?').get(id));
      },
      submit(actor, id) {
        const l = db.prepare('SELECT * FROM kb_lessons WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
        if (!l || (l.author !== actor.user && l.status !== 'PUBLISHED')) throw notFound('That lesson does not exist.');
        if (l.author !== actor.user) throw forbidden('The author submits a lesson.');
        if (!['DRAFT', 'REJECTED'].includes(l.status)) throw conflict(`${l.doc_no} is ${l.status.toLowerCase()}.`);
        return transaction(db, () => {
          db.prepare("UPDATE kb_lessons SET status = 'SUBMITTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), l.id);
          const inst = workflowOf(db).submit(actor, { docType: KB_DOC, docId: String(l.id), comment: l.title, context: { projectId: l.org_project_id ?? undefined } });
          db.prepare('UPDATE kb_lessons SET workflow_instance_id = ? WHERE id = ?').run(inst.id, l.id);
          audit(actor, 'kb_lessons', String(l.id), 'submit', actor.companyId);
          return lessonView(db.prepare('SELECT * FROM kb_lessons WHERE id = ?').get(l.id));
        });
      },
      decide(instance, actor, outcome, comment) {
        const l = db.prepare('SELECT * FROM kb_lessons WHERE id = ?').get(rid(instance.docId)); if (!l || l.status !== 'SUBMITTED') return;
        const status = outcome === 'APPROVED' ? 'PUBLISHED' : outcome === 'CANCELLED' ? 'DRAFT' : 'REJECTED';
        db.prepare('UPDATE kb_lessons SET status = ?, published_at = ?, remarks = COALESCE(?, remarks), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, status === 'PUBLISHED' ? nowIso() : null, comment ?? null, actor?.user ?? 'system', nowIso(), l.id);
        audit(actor, 'kb_lessons', String(l.id), status.toLowerCase(), l.company_id, { reason: comment ?? undefined });
      },
    },
    benchmarks(actor, { metricCode = null } = {}) {
      if (!base.authz.hasAnywhere(actor, 'kb.benchmark.view')) throw forbidden('You may not see the benchmarks (permission kb.benchmark.view).');
      const where = ["b.company_id = ? AND b.status = 'APPROVED' AND b.deleted_at IS NULL"]; const args = [actor.companyId];
      if (metricCode) { where.push('b.metric_code = ?'); args.push(metricCode); }
      const rows = db.prepare(`SELECT b.*, p.code AS project FROM kb_benchmarks b JOIN org_projects p ON p.id = b.org_project_id WHERE ${where.join(' AND ')} ORDER BY b.metric_code, b.approved_at DESC LIMIT 2000`).all(...args);
      const byMetric = {};
      for (const b of rows) { const m = (byMetric[b.metric_code] ??= { metricCode: b.metric_code, label: b.label, unit: b.unit, values: [] }); m.values.push({ project: b.project, value: b.value_milli / 1000, approvedAt: b.approved_at }); }
      return Object.values(byMetric).map((m) => { const v = m.values.map((x) => x.value).sort((a, b) => a - b); const mid = Math.floor(v.length / 2); return { ...m, count: v.length, min: v[0], max: v.at(-1), median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2 }; });
    },
  };
  return svc;
}

const instances = new WeakMap();
export const closureOf = (db) => { if (!instances.has(db)) instances.set(db, createClosure({ db })); return instances.get(db); };

const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 72, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const hooksOf = (decide) => ({
  onApproved: (db, { instance, actor }) => decide(db)(instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => decide(db)(instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => decide(db)(instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => decide(db)(instance, actor, 'CANCELLED', comment),
});
workflowTypes.register({
  docType: CLS_DOC, label: 'Project closeout', processOwner: 'PD', route: (id) => `/close/closure?id=${id}`,
  describe(db, companyId, id) { const c = db.prepare('SELECT c.*, p.code, p.name FROM cls_closures c JOIN org_projects p ON p.id = c.org_project_id WHERE c.id = ?').get(rid(id)); return c && c.company_id === companyId ? { ref: c.doc_no, title: `Closeout of ${c.code} ${c.name}`.slice(0, 300), originator: c.requested_by, projectId: c.org_project_id, amount: c.final_account_paise ?? undefined } : null; },
  summarise(db, _actor, id) { const c = db.prepare('SELECT * FROM cls_closures WHERE id = ?').get(rid(id)); if (!c) return null; const f = (p) => (p == null ? '—' : `Rs ${(p / 100).toFixed(2)}`); return { fields: [{ label: 'Final account', value: `${f(c.final_account_paise)} agreed on ${c.final_account_agreed_on ?? '—'}` }, { label: 'Revenue', value: f(c.revenue_paise) }, { label: 'Cost', value: f(c.cost_paise) }, { label: 'Checklist', value: 'Every mandatory item met when requested' }] }; },
  defaultDefinition: { name: 'Project closeout: the project director, the CFO and a director approve what the project manager requested', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PD', 'Project director', 'PD'), step('CFO', 'Chief financial officer', 'CFO'), step('DIR', 'Director', 'DIR')] },
  hooks: hooksOf((db) => closureOf(db).decide),
});
workflowTypes.register({
  docType: KB_DOC, label: 'Lesson learned', processOwner: 'PCMGR', route: (id) => `/close/lessons?id=${id}`,
  describe(db, companyId, id) { const l = db.prepare('SELECT * FROM kb_lessons WHERE id = ?').get(rid(id)); return l && l.company_id === companyId ? { ref: l.doc_no, title: `Lesson: ${l.title}`.slice(0, 300), originator: l.author, projectId: l.org_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const l = db.prepare('SELECT * FROM kb_lessons WHERE id = ?').get(rid(id)); return l ? { fields: [{ label: 'Category', value: l.category }, { label: 'What happened', value: l.what_happened }, { label: 'Recommendation', value: l.recommendation }] } : null; },
  defaultDefinition: { name: 'Lesson learned: the project controls manager reviews it before it is published', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PCMGR', 'Project controls manager', 'PCMGR')] },
  hooks: hooksOf((db) => closureOf(db).lessons.decide),
});
