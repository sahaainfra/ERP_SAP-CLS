import { assertPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { calcOf } from '../../platform/calc/index.js';
import { transaction } from '../../platform/db/index.js';
import { companyScope } from '../../platform/db/scope.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { duplicateChecks } from '../../platform/forms/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parse } from '../../platform/validation/index.js';
import { cancelNumber, issueNumber } from '../core/numbering/service.js';
import { dec } from '../../../shared/decimal.js';
import { fromUnits, toUnits } from '../../../shared/money.js';
import { SAMPLE_REQUEST_FORM, sampleRequestSchema } from '../../../shared/forms/sample-request.js';
import { moneyColumn, rupees } from './lists.js';
import { missingDocuments, recordVersion } from './objects.js';
import { APPROVAL_TYPE, TYPE, allowedActionsOf, approvalChain, latestApproval, snapshotOf } from './sample-request-object.js';

const DOC_TYPE = 'SAMPLE_MR';
const LINE = 'boq.line_amount';
const PERMISSION = 'core.sample.use';
const cid = (actor) => companyScope(actor).params._company_scope;

/**
 * The register's List Report (part 03.03, AC-01): columns, what can be searched, sorted, filtered and totalled. The total is a commercial
 * value: masked for roles without the "show" rule on ui_sample_request.total, in the rows, the totals row and every export, and then it
 * can be neither sorted nor filtered (the order or a range would give it away).
 */
const STATUS_OPTIONS = [['DRAFT', 'Draft'], ['SUBMITTED', 'Submitted'], ['CANCELLED', 'Cancelled']];
export const sampleRequestList = defineList({
  code: 'ui.sample_requests',
  label: 'Sample material requests',
  permission: PERMISSION,
  from: 'ui_sample_requests r JOIN org_projects p ON p.id = r.project_id LEFT JOIN org_sites s ON s.id = r.site_id',
  where: 'r.deleted_at IS NULL',
  searchable: ['r.title', 'r.doc_no', 'p.code', 'p.name'],
  defaultSort: '-createdAt',
  columns: {
    docNo: { sql: "COALESCE(r.doc_no, '')", type: 'text', label: 'Number' },
    docDate: { sql: 'r.doc_date', type: 'date', label: 'Date' },
    title: { sql: 'r.title', type: 'text', label: 'Title' },
    projectCode: { sql: 'p.code', type: 'text', label: 'Project' },
    siteCode: { sql: 's.code', type: 'text', label: 'Site' },
    status: { sql: 'r.status', type: 'enum', label: 'Status', options: STATUS_OPTIONS },
    priority: { sql: 'r.priority', type: 'enum', label: 'Priority', options: [['NORMAL', 'Normal'], ['URGENT', 'Urgent']] },
    requiredBy: { sql: 'r.required_by', type: 'date', label: 'Required by' },
    lineCount: { sql: 'r.line_count', type: 'number', label: 'Items', total: true },
    total: moneyColumn('r.total_amount', 'Total (₹)', { total: true, sensitive: true }),
    requestedBy: { sql: 'r.requested_by', type: 'text', label: 'Requested by' },
    createdAt: { sql: 'r.created_at', type: 'datetime', label: 'Created' },
  },
});
const EXPORT_COLUMNS = Object.entries(sampleRequestList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type }));

/** The request as the client sends it, validated with the schema the form uses (BR-01: the server checks everything again). */
export const parseSampleRequest = (b) => parse(sampleRequestSchema, b);

const presentHeader = (r) => ({
  id: r.id, docNo: r.doc_no, docDate: r.doc_date, status: r.status, title: r.title,
  projectId: r.project_id, projectCode: r.project_code ?? null, siteId: r.site_id, siteCode: r.site_code ?? null,
  costCentreId: r.cost_centre_id, departmentId: r.department_id, requestedBy: r.requested_by, requiredBy: r.required_by,
  priority: r.priority, urgencyReason: r.urgency_reason, returnable: r.returnable === 1, returnBy: r.return_by,
  deliveryNote: r.delivery_note, deliveryLat: r.delivery_lat, deliveryLng: r.delivery_lng,
  total: fromUnits(r.total_amount, 'money').toFixed(2), lineCount: r.line_count, sourceType: r.source_type === 'sample_request' ? null : r.source_type, sourceId: r.source_id,
  submittedAt: r.submitted_at, createdBy: r.created_by, createdAt: r.created_at, version: r.version,
});
const presentLine = (l) => ({
  id: l.id, lineNo: l.line_no, description: l.description, uom: l.uom,
  quantity: fromUnits(l.quantity, 'quantity').toFixed(3), unitRate: fromUnits(l.unit_rate, 'rate').toFixed(4), amount: fromUnits(l.line_amount, 'money').toFixed(2),
  neededOn: l.needed_on, comment: l.comment, version: l.version,
});

// The request and each of its lines can carry attachments (row-level attachments of the line grid, FR-06).
const resolveRequest = (db, actor, id) => {
  const r = db.prepare('SELECT id, company_id, project_id, site_id, status FROM ui_sample_requests WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!r) return null;
  const allowed = authzOf(db).check(actor, PERMISSION, { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id ?? undefined }).allowed;
  return { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id, canView: allowed, canEdit: allowed, locked: r.status !== 'DRAFT' };
};
fileEntities.register({ entity: 'sample_request', label: 'Sample material request', resolve: resolveRequest });
fileEntities.register({
  entity: 'sample_request_line', label: 'Sample material request line',
  resolve(db, actor, id) {
    const l = db.prepare('SELECT request_id FROM ui_sample_request_lines WHERE id = ? AND deleted_at IS NULL').get(id);
    return l ? resolveRequest(db, actor, l.request_id) : null;
  },
});

duplicateChecks.register({
  name: 'ui.sample_request', label: 'Sample material requests', permission: PERMISSION,
  // the same title for the same project within a week of the date is probably the same request entered twice
  check(db, actor, f) {
    const title = String(f.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const projectId = Number(f.projectId) || 0;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(f.docDate ?? '')) ? String(f.docDate) : null;
    if (title.length < 3 || !projectId || !date) return [];
    const scope = authzOf(db).scopeFilter(actor, PERMISSION, { project: 'project_id' }).sql;
    return db.prepare(`SELECT id, doc_no, doc_date, title, status FROM ui_sample_requests WHERE company_id = ? AND project_id = ? AND deleted_at IS NULL AND status != 'CANCELLED' AND id != ? AND lower(title) = ? AND doc_date BETWEEN date(?, '-7 day') AND date(?, '+7 day') AND ${scope} ORDER BY doc_date DESC LIMIT 5`)
      .all(cid(actor), projectId, Number(f.excludeId) || 0, title, date, date)
      .map((r) => ({ id: r.id, label: `${r.doc_no ?? `Draft #${r.id}`} "${r.title}" of ${r.doc_date}`, reason: `Same title and project, ${r.status.toLowerCase()}`, link: `/admin/sample-requests?open=${r.id}` }));
  },
});

/**
 * The reference form's record (part 03.02, AC-02): a sample material request with lines. Everything the form computes the server
 * computes again: every line amount with the calculation engine (boq.line_amount) and the total; a total or amount the client saw
 * that differs is refused (section 6). The project, site, cost centre and department must exist, be active, belong together and be
 * inside the person's scope. Numbered when submitted (document type SAMPLE_MR, 01.03). Saving the request consumes the draft.
 */
export function createSampleRequestService({ db, drafts, approvals, objects }) {
  const authz = authzOf(db);
  const engine = calcOf(db);
  const header = (id, c) => db.prepare('SELECT r.*, p.code AS project_code, s.code AS site_code FROM ui_sample_requests r JOIN org_projects p ON p.id = r.project_id LEFT JOIN org_sites s ON s.id = r.site_id WHERE r.id = ? AND r.company_id = ? AND r.deleted_at IS NULL').get(id, c);
  const linesOf = (id) => db.prepare('SELECT * FROM ui_sample_request_lines WHERE request_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id);
  const visible = (actor, r) => authz.check(actor, PERMISSION, { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id ?? undefined }).allowed;
  const requestOrThrow = (actor, id) => {
    const r = header(id, cid(actor));
    if (!r || !visible(actor, r)) throw notFound('That sample material request does not exist.');
    return r;
  };

  /** The references must exist, be active, belong together and be inside the person's scope; each problem is named on its field. */
  function checkReferences(actor, v) {
    const c = cid(actor);
    const problems = [];
    const project = db.prepare("SELECT id, status FROM org_projects WHERE id = ? AND company_id = ? AND is_active = 1").get(v.projectId, c);
    if (!project) problems.push({ field: 'projectId', message: 'That project does not exist in this company.' });
    else if (project.status === 'CLOSED') problems.push({ field: 'projectId', message: 'That project is closed; material cannot be requested for it.' });
    else if (!authz.check(actor, PERMISSION, { companyId: c, projectId: v.projectId, siteId: v.siteId ?? undefined }).allowed) throw forbidden('Your role includes core.sample.use only for some projects or sites. Choose one of them, or ask a system administrator.');
    if (v.siteId) {
      const site = db.prepare("SELECT org_project_id, status FROM org_sites WHERE id = ? AND company_id = ? AND is_active = 1").get(v.siteId, c);
      if (!site) problems.push({ field: 'siteId', message: 'That site does not exist in this company.' });
      else if (site.org_project_id !== v.projectId) problems.push({ field: 'siteId', message: 'That site belongs to another project. Choose a site of the selected project.' });
      else if (site.status === 'INACTIVE') problems.push({ field: 'siteId', message: 'That site is inactive.' });
    }
    if (v.costCentreId) {
      const cc = db.prepare("SELECT linked_type, linked_id, status FROM org_cost_centres WHERE id = ? AND company_id = ? AND is_active = 1").get(v.costCentreId, c);
      const fits = cc && (!cc.linked_type || (cc.linked_type === 'SITE' && cc.linked_id === v.siteId) || (cc.linked_type === 'PROJECT' && cc.linked_id === v.projectId));
      if (!cc || cc.status !== 'ACTIVE') problems.push({ field: 'costCentreId', message: 'That cost centre does not exist or is not active.' });
      else if (!fits) problems.push({ field: 'costCentreId', message: 'That cost centre belongs to another site or project.' });
    }
    if (v.departmentId && !db.prepare("SELECT 1 FROM org_departments WHERE id = ? AND company_id = ? AND is_active = 1 AND status = 'ACTIVE'").get(v.departmentId, c)) problems.push({ field: 'departmentId', message: 'That department does not exist or is not active.' });
    const known = new Set(db.prepare('SELECT code FROM core_uoms WHERE deleted_at IS NULL AND (company_id IS NULL OR company_id = ?)').all(c).map((u) => u.code));
    v.lines.forEach((l, i) => { if (!known.has(l.uom)) problems.push({ field: `lines.${i}.uom`, message: `"${l.uom}" is not a unit of measure.` }); });
    if (problems.length) throw badRequest('Some fields are invalid. Fix them and try again.', problems);
  }

  /** Every line amount from the engine, the total from the lines; refuse figures the client saw that differ (section 6). */
  function compute(actor, v, entityId) {
    const common = { entity: 'sample_request', entityId, companyId: cid(actor), user: actor.user };
    let pin = null;
    const lines = v.lines.map((l, i) => {
      const r = engine.evaluate(LINE, { quantity: l.quantity, rate: l.unitRate }, { ...common, field: `lines.${i}.amount` });
      pin = r.formula.version;
      return { ...l, amountUnits: toUnits(r.result.amount, 'money') };
    });
    const totalUnits = lines.reduce((acc, l) => acc + l.amountUnits, 0);
    const problems = [];
    lines.forEach((l, i) => {
      if (l.amount !== undefined && l.amount !== '' && !dec(l.amount).eq(fromUnits(l.amountUnits, 'money'))) problems.push({ field: `lines.${i}.amount`, message: `This line comes to ${fromUnits(l.amountUnits, 'money').toFixed(2)}, not ${l.amount}.` });
    });
    if (v.total !== undefined && v.total !== '' && !dec(v.total).eq(fromUnits(totalUnits, 'money'))) problems.push({ field: 'total', message: `The lines add up to ${fromUnits(totalUnits, 'money').toFixed(2)}, not ${v.total}. Nothing was saved; check the lines and save again.` });
    if (problems.length) throw unprocessable('The amounts on the screen do not match the server calculation.', problems);
    return { lines, totalUnits, pins: { [LINE]: pin } };
  }

  const headerValues = (actor, v) => ({
    title: v.title, doc_date: v.docDate, project_id: v.projectId, site_id: v.siteId, cost_centre_id: v.costCentreId, department_id: v.departmentId,
    required_by: v.requiredBy, priority: v.priority, urgency_reason: v.priority === 'URGENT' ? v.urgencyReason : null,
    returnable: v.returnable ? 1 : 0, return_by: v.returnable ? v.returnBy : null, delivery_note: v.deliveryNote, delivery_lat: v.deliveryLat, delivery_lng: v.deliveryLng,
  });
  const auditShape = (h, total, lineCount) => ({ title: h.title, docDate: h.doc_date, projectId: h.project_id, siteId: h.site_id, priority: h.priority, total, lines: lineCount });

  /** Write the lines: keep the ids of lines that are still there (their attachments stay), add new ones, retire the rest. */
  function writeLines(actor, requestId, lines) {
    const existing = new Map(linesOf(requestId).map((l) => [l.id, l]));
    const at = new Date().toISOString();
    lines.forEach((l, i) => {
      const values = [i + 1, l.description, l.uom, toUnits(l.quantity, 'quantity'), toUnits(l.unitRate, 'rate'), l.amountUnits, l.neededOn, l.comment];
      if (l.id && existing.has(l.id)) {
        db.prepare('UPDATE ui_sample_request_lines SET line_no = ?, description = ?, uom = ?, quantity = ?, unit_rate = ?, line_amount = ?, needed_on = ?, comment = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(...values, actor.user, at, l.id);
        existing.delete(l.id);
      } else {
        db.prepare("INSERT INTO ui_sample_request_lines (company_id, request_id, line_no, description, uom, quantity, unit_rate, line_amount, needed_on, comment, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sample_request_line')").run(cid(actor), requestId, ...values, actor.user);
      }
    });
    for (const gone of existing.values()) db.prepare('UPDATE ui_sample_request_lines SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(at, actor.user, gone.id);
  }

  const ownerOnly = (actor, r, what) => {
    if (actor.user !== r.requested_by) throw forbidden(`Only ${r.requested_by}, who raised this request, can ${what} it.`);
  };
  const maskRuleOf = (actor) => authz.maskRule(actor, 'ui_sample_request', 'total');
  const maskLine = (actor, l) => {
    const rule = maskRuleOf(actor);
    if (rule === 'show') return l;
    const out = { ...l };
    for (const k of ['unitRate', 'amount']) { if (rule === 'hide') delete out[k]; else out[k] = '•••'; }
    return out;
  };
  const countsOf = (r) => ({
    attachments: db.prepare("SELECT COUNT(*) AS n FROM core_files WHERE company_id = ? AND linked_entity = 'sample_request' AND linked_id = ? AND deleted_at IS NULL").get(r.company_id, r.id).n,
    comments: db.prepare("SELECT COUNT(*) AS n FROM ui_record_comments WHERE company_id = ? AND entity_type = 'sample_request' AND entity_id = ? AND deleted_at IS NULL").get(r.company_id, r.id).n,
    approvals: db.prepare("SELECT COUNT(*) AS n FROM core_change_requests WHERE company_id = ? AND target_type = 'sample_request' AND target_id = ? AND is_active = 1").get(r.company_id, r.id).n,
    versions: db.prepare("SELECT COUNT(*) AS n FROM ui_record_versions WHERE company_id = ? AND entity_type = 'sample_request' AND entity_id = ?").get(r.company_id, r.id).n,
  });
  const maskRow = (actor, row) => {
    const rule = maskRuleOf(actor);
    if (rule === 'show') return row;
    const out = { ...row };
    if (rule === 'hide') delete out.total; else out.total = '•••';
    return out;
  };
  const maskTotals = (actor, t) => (maskRuleOf(actor) === 'show' ? t : { ...t, total: maskRuleOf(actor) === 'hide' ? null : '•••' });
  const checkMaskedUse = (actor, req) => {
    if (maskRuleOf(actor) === 'show') return;
    const used = req.sort.some((x) => x.key === 'total') || req.filters.some((x) => x.key === 'total');
    if (used) throw badRequest('Some list parameters are invalid.', [{ field: 'total', message: 'The total is masked for your role, so it cannot be sorted or filtered.' }]);
  };
  const scopeOf = (actor) => ({ scopeSql: `r.company_id = :c AND ${authz.scopeFilter(actor, PERMISSION, { project: 'r.project_id', site: 'r.site_id' }).sql}`, params: { c: cid(actor) } });
  const listRequest = (actor, query) => { const req = parseListRequest(sampleRequestList, query); checkMaskedUse(actor, req); return req; };

  const service = {
    /** The List Report (part 03.03): search, filters with operators, sort, pages, the total count and totals, inside the actor's scope. */
    list(actor, query) {
      assertPermissionAnywhere(actor, PERMISSION);
      const req = listRequest(actor, query);
      return runList(db, sampleRequestList, req, { select: 'r.*, p.code AS project_code, s.code AS site_code', ...scopeOf(actor), tieBreaker: 'r.id DESC', map: (r) => maskRow(actor, presentHeader(r)), presentTotals: (t) => maskTotals(actor, { lineCount: t.lineCount, total: rupees(t.total) }) });
    },

    /** What an export of the list writes: the screen's query, every matching row, the actor's masks (BR-02). */
    exportSource(actor, req) {
      assertPermissionAnywhere(actor, PERMISSION);
      checkMaskedUse(actor, req);
      const rule = maskRuleOf(actor);
      return {
        title: sampleRequestList.label,
        permission: PERMISSION,
        personal: false,
        columns: EXPORT_COLUMNS.filter((c) => !(c.key === 'total' && rule === 'hide')),
        count: () => countList(db, sampleRequestList, req, scopeOf(actor)),
        rows: () => runList(db, sampleRequestList, req, { select: 'r.*, p.code AS project_code, s.code AS site_code', ...scopeOf(actor), tieBreaker: 'r.id DESC', limit: null, map: (r) => maskRow(actor, presentHeader(r)) }).data,
        describe: (r) => [r.q ? `search "${r.q}"` : '', ...r.filters.map((x) => `${sampleRequestList.columns[x.key].label} ${x.op} ${x.raw}`)].filter(Boolean).join('; '),
      };
    },

    /** Bulk submit or cancel (FR-05): each request on its own, so one refusal does not stop the rest; the result names each one. */
    bulk(actor, { action, ids, reason, reasonCode }, correlationId) {
      assertPermissionAnywhere(actor, PERMISSION);
      const results = [];
      for (const id of ids) {
        const r = header(id, cid(actor));
        const label = r ? (r.doc_no ?? `Draft #${r.id}`) : `#${id}`;
        try {
          if (!r || !visible(actor, r)) throw notFound('That request does not exist.');
          const done = action === 'submit' ? service.submit(actor, id, { version: r.version }, correlationId) : service.cancel(actor, id, { version: r.version, reason, reasonCode }, correlationId);
          results.push({ id, label: done.docNo ?? label, ok: true, message: action === 'submit' ? `Submitted as ${done.docNo}` : 'Cancelled' });
        } catch (err) {
          results.push({ id, label, ok: false, message: err.message });
        }
      }
      return { action, results, done: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length };
    },

    maskedColumns: (actor) => (maskRuleOf(actor) === 'show' ? [] : ['total']),

    /** The record and `allowedActions[]` computed here, for this viewer (part 03.04: the Object Page draws its buttons from them). */
    get(actor, id) {
      assertPermissionAnywhere(actor, PERMISSION);
      const r = requestOrThrow(actor, id);
      const appr = latestApproval(db, r.company_id, id);
      return {
        ...maskRow(actor, presentHeader(r)),
        lines: linesOf(id).map((l) => maskLine(actor, presentLine(l))),
        formulaPins: JSON.parse(r.formula_pins_json),
        allowedActions: allowedActionsOf(db, actor, r),
        approval: appr ? { id: appr.id, status: appr.status, currentStep: appr.current_step, chain: JSON.parse(appr.chain_json), version: appr.version } : null,
        counts: countsOf(r),
      };
    },

    create(actor, v, correlationId) {
      assertPermissionAnywhere(actor, PERMISSION);
      checkReferences(actor, v);
      return transaction(db, () => {
        const h = headerValues(actor, v);
        const source = v.sourceType && v.sourceId ? { type: v.sourceType, id: String(v.sourceId) } : { type: 'sample_request', id: null };
        const res = db.prepare(`INSERT INTO ui_sample_requests (company_id, doc_date, status, title, project_id, site_id, cost_centre_id, department_id, requested_by, required_by, priority, urgency_reason, returnable, return_by, delivery_note, delivery_lat, delivery_lng, created_by, source_type, source_id)
          VALUES (:company_id, :doc_date, 'DRAFT', :title, :project_id, :site_id, :cost_centre_id, :department_id, :requested_by, :required_by, :priority, :urgency_reason, :returnable, :return_by, :delivery_note, :delivery_lat, :delivery_lng, :created_by, :source_type, :source_id)`)
          .run({ ...h, company_id: cid(actor), requested_by: actor.user, created_by: actor.user, source_type: source.type, source_id: source.id });
        const id = Number(res.lastInsertRowid);
        const { lines, totalUnits, pins } = compute(actor, v, id);
        writeLines(actor, id, lines);
        db.prepare('UPDATE ui_sample_requests SET total_amount = ?, line_count = ?, formula_pins_json = ? WHERE id = ?').run(totalUnits, lines.length, JSON.stringify(pins), id);
        drafts.consume(actor, SAMPLE_REQUEST_FORM, '');
        const total = fromUnits(totalUnits, 'money').toFixed(2);
        writeAudit(db, { entity: 'ui_sample_requests', entityId: id, action: 'create', newValues: { ...auditShape(h, total, lines.length), source: source.id ? `${source.type} ${source.id}` : null }, actor: actor.user, correlationId, companyId: cid(actor) });
        publishEvent(db, { type: 'ui.sample_request.created', entity: 'sample_request', entityId: id, actorId: actor.user, companyId: cid(actor), data: { total, lines: lines.length } });
        return service.get(actor, id);
      });
    },

    update(actor, id, v, version, correlationId) {
      assertPermissionAnywhere(actor, PERMISSION);
      const before = requestOrThrow(actor, id);
      if (before.status !== 'DRAFT') throw unprocessable(`Only a draft can be changed; this request is ${before.status.toLowerCase()}.`);
      ownerOnly(actor, before, 'change');
      if (version !== before.version) throw conflict('The request was changed by someone else. Reload it to see their change, then make yours again.');
      checkReferences(actor, v);
      return transaction(db, () => {
        const h = headerValues(actor, v);
        const { lines, totalUnits, pins } = compute(actor, v, id);
        const changed = db.prepare(`UPDATE ui_sample_requests SET title = :title, doc_date = :doc_date, project_id = :project_id, site_id = :site_id, cost_centre_id = :cost_centre_id, department_id = :department_id, required_by = :required_by, priority = :priority, urgency_reason = :urgency_reason, returnable = :returnable, return_by = :return_by, delivery_note = :delivery_note, delivery_lat = :delivery_lat, delivery_lng = :delivery_lng, total_amount = :total, line_count = :count, formula_pins_json = :pins, updated_by = :by, updated_at = :at, version = version + 1 WHERE id = :id AND version = :version`)
          .run({ ...h, total: totalUnits, count: lines.length, pins: JSON.stringify(pins), by: actor.user, at: new Date().toISOString(), id, version });
        if (Number(changed.changes) !== 1) throw conflict('The request was changed by someone else. Reload it to see their change, then make yours again.');
        writeLines(actor, id, lines);
        drafts.consume(actor, SAMPLE_REQUEST_FORM, String(id));
        writeAudit(db, { entity: 'ui_sample_requests', entityId: id, action: 'update', oldValues: auditShape(before, fromUnits(before.total_amount, 'money').toFixed(2), before.line_count), newValues: auditShape(h, fromUnits(totalUnits, 'money').toFixed(2), lines.length), actor: actor.user, correlationId, companyId: cid(actor) });
        publishEvent(db, { type: 'ui.sample_request.updated', entity: 'sample_request', entityId: id, actorId: actor.user, companyId: cid(actor), data: { total: fromUnits(totalUnits, 'money').toFixed(2), lines: lines.length } });
        return service.get(actor, id);
      });
    },

    /** Number the request (once: an amendment keeps its number), keep a snapshot of this version and send it to its approvers. */
    submit(actor, id, { version }, correlationId) {
      assertPermissionAnywhere(actor, PERMISSION);
      return transaction(db, () => {
        const r = requestOrThrow(actor, id);
        if (r.status !== 'DRAFT') throw unprocessable(`Only a draft can be submitted; this request is ${r.status.toLowerCase()}.`);
        ownerOnly(actor, r, 'submit');
        if (version !== r.version) throw conflict('The request was changed by someone else. Reload it, then submit.');
        const missing = missingDocuments(db, { companyId: r.company_id, type: TYPE, docType: DOC_TYPE, id, stage: 'submit' });
        if (missing.length) throw unprocessable(`Attach ${missing.map((m) => m.label.toLowerCase()).join(' and ')} before submitting.`);
        let number = r.doc_no;
        if (!number) {
          try {
            number = issueNumber(db, { companyId: r.company_id, docType: DOC_TYPE, date: r.doc_date, projectId: r.project_id, point: 'submit', refType: 'sample_request', refId: id, actor: actor.user }).number;
          } catch (err) {
            if (err?.code && /NUMBER|FINANCIAL_YEAR|DOCUMENT_TYPE/.test(err.code)) throw unprocessable(err.message);
            throw err;
          }
        }
        const at = new Date().toISOString();
        db.prepare("UPDATE ui_sample_requests SET status = 'SUBMITTED', doc_no = ?, submitted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?").run(number, at, actor.user, at, id, version);
        const versionNo = recordVersion(db, { companyId: r.company_id, type: TYPE, id, snapshot: snapshotOf(db, id), actor: actor.user, projectId: r.project_id, siteId: r.site_id });
        approvals.submit(actor, { type: APPROVAL_TYPE, title: `Approve sample material request ${number}`, targetType: 'sample_request', targetId: id, payload: { docNo: number }, reason: `Approval of ${number}${versionNo > 1 ? ` (amendment ${versionNo - 1})` : ''}`, chain: approvalChain(r.total_amount) });
        writeAudit(db, { entity: 'ui_sample_requests', entityId: id, action: 'submit', oldValues: { status: 'DRAFT' }, newValues: { status: 'SUBMITTED', docNo: number, versionNo }, actor: actor.user, correlationId, companyId: cid(actor) });
        publishEvent(db, { type: 'ui.sample_request.submitted', entity: 'sample_request', entityId: id, actorId: actor.user, companyId: cid(actor), data: { docNo: number, total: fromUnits(r.total_amount, 'money').toFixed(2) } });
        return service.get(actor, id);
      });
    },

    /** Cancel with a reason code (BR-02). An open approval is withdrawn; a numbered request keeps its number. */
    cancel(actor, id, { version, reasonCode, reason }, correlationId) {
      assertPermissionAnywhere(actor, PERMISSION);
      const why = objects.checkReason(actor, 'cancel', { reasonCode, reason });
      return transaction(db, () => {
        const r = requestOrThrow(actor, id);
        if (r.status === 'CANCELLED') throw unprocessable('This request is already cancelled.');
        ownerOnly(actor, r, 'cancel');
        if (version !== r.version) throw conflict('The request was changed by someone else. Reload it, then cancel.');
        const at = new Date().toISOString();
        db.prepare("UPDATE ui_sample_requests SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?").run(actor.user, at, id, version);
        const appr = latestApproval(db, r.company_id, id);
        if (appr?.status === 'SUBMITTED') approvals.withdraw(actor, appr.id);
        if (r.doc_no) cancelNumber(db, { companyId: r.company_id, docType: DOC_TYPE, number: r.doc_no, actor: actor.user });
        writeAudit(db, { entity: 'ui_sample_requests', entityId: id, action: 'cancel', oldValues: { status: r.status, docNo: r.doc_no }, newValues: { status: 'CANCELLED', docNo: r.doc_no, reasonCode: why.code }, reason: `${why.label}: ${why.text}`, actor: actor.user, correlationId, companyId: cid(actor) });
        publishEvent(db, { type: 'ui.sample_request.cancelled', entity: 'sample_request', entityId: id, actorId: actor.user, companyId: cid(actor), data: { docNo: r.doc_no } });
        return service.get(actor, id);
      });
    },

    /** The approver's decision on the open approval: approve (a comment is optional), reject or return (a reason code and words are needed). */
    decide(actor, id, { action, reasonCode, comment, version }) {
      assertPermissionAnywhere(actor, PERMISSION);
      const r = requestOrThrow(actor, id);
      const appr = latestApproval(db, r.company_id, id);
      if (r.status !== 'SUBMITTED' || appr?.status !== 'SUBMITTED') throw unprocessable('Nothing is waiting for a decision on this request.');
      let text = comment ?? null;
      if (action === 'approve') {
        const missing = missingDocuments(db, { companyId: r.company_id, type: TYPE, docType: DOC_TYPE, id, stage: 'approve' });
        if (missing.length) throw unprocessable(`Attach ${missing.map((m) => m.label.toLowerCase()).join(' and ')} before approving.`);
      } else {
        const why = objects.checkReason(actor, action, { reasonCode, reason: comment });
        text = `${why.label}: ${why.text}`;
      }
      approvals.act(actor, appr.id, { action, comment: text, version });
      return service.get(actor, id);
    },
  };
  return service;
}
