import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unprocessable } from '../../platform/http/errors.js';
import { FORMATS, mask, masterReferences, masterTypes, normalise, similarity } from '../../platform/mdm/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';

// Master data governance (part 06.01). Every change to a governed master is a change request: a new record, an update (from a date), an inactivation, a reactivation or a merge. New records, changes of sensitive
// fields, status changes and merges go through the approval of the stewards of that master (and the accounts manager for a financial master); a change of non-sensitive fields by someone who may edit applies at once,
// audited. Duplicates are checked before anything is saved (identical PAN or GSTIN blocks, a similar name or the same mobile warns) and found again by a scan; a merge never deletes the merged record, references go on
// through the merge map (BR-01). Every version keeps the date it applies from, so a record can be read "as of" any date. Quality rules score every record; the rules and the stewards change only by an approved change.
export const CHANGE_DOC = 'MDM_CHANGE';
export const MERGE_DOC = 'MDM_MERGE';
export const CONFIG_DOC = 'MDM_CONFIG';
const nowIso = () => new Date().toISOString();
const WEIGHT = { ERROR: 3, WARNING: 2, INFO: 1 };
const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const typeOrThrow = (type) => { const t = masterTypes.get(type); if (!t) throw notFound(`There is no master called ${type}.`); return t; };

export function createMdmService({ db }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const engine = () => workflowOf(db);
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!anywhere(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const parse = (j, d) => { try { return JSON.parse(j ?? ''); } catch { return d; } };
  const nameOf = (companyId, u) => (u ? db.prepare('SELECT display_name FROM iam_users WHERE company_id = ? AND lower(username) = lower(?)').get(companyId, u)?.display_name ?? u : '');

  // ---- stewards and rules in force ----
  const stewardsOf = (companyId, type) => db.prepare("SELECT s.*, u.username FROM mdm_stewards s JOIN iam_users u ON u.id = s.user_id WHERE s.company_id = ? AND s.master_type = ? AND s.config_status = 'ACTIVE' AND s.is_active = 1 AND u.status = 'ACTIVE' AND u.is_active = 1 ORDER BY s.steward_role, u.username").all(companyId, type);
  const isSteward = (actor, type) => stewardsOf(actor.companyId, type).some((s) => s.username.toLowerCase() === actor.user.toLowerCase());
  const mayEdit = (actor, type) => anywhere(actor, 'mdm.record.edit') || isSteward(actor, type);
  const seesSensitive = (actor, type) => anywhere(actor, 'mdm.sensitive.view') || isSteward(actor, type);
  function rulesFor(companyId, type) {
    const rows = db.prepare("SELECT * FROM mdm_quality_rules WHERE company_id = ? AND master_type = ? AND config_status = 'ACTIVE' AND is_active = 1 ORDER BY id").all(companyId, type);
    if (rows.length || db.prepare("SELECT 1 FROM mdm_quality_rules WHERE company_id = ? AND config_status = 'ACTIVE' AND is_active = 1 LIMIT 1").get(companyId)) return rows.filter((r) => r.active).map((r) => ({ field: r.field, rule: r.rule, param: r.param, severity: r.severity }));
    return typeOrThrow(type).defaultRules;
  }

  // ---- checking data (FR-02, FR-04) ----
  /** The data as it would be stored: known fields only, normalised; unknown fields refused. */
  function clean(t, input) {
    const out = {}; const problems = [];
    for (const k of Object.keys(input ?? {})) if (!t.fields.some((f) => f.key === k)) problems.push({ field: k, message: 'is not a field of this master' });
    for (const f of t.fields) {
      if (!(f.key in (input ?? {}))) continue;
      const v = normalise(f, input[f.key]);
      if (v != null && f.max && v.length > f.max) problems.push({ field: f.key, message: `${f.label}: at most ${f.max} characters` });
      if (v != null && f.type === 'enum' && !f.options.some(([k]) => k === v)) problems.push({ field: f.key, message: `${f.label}: choose one of ${f.options.map(([, l]) => l).join(', ')}` });
      out[f.key] = v;
    }
    if (problems.length) throw badRequest('Some fields are not valid.', problems);
    return out;
  }
  /** The quality rules applied to one record: every result, the problems that block saving and the score (0 to 100, weighted by severity). */
  /** @param {any} t @param {any[]} rules @param {any} data @param {{ lastChangedAt?: string | null }} [opts] */
  function evaluate(t, rules, data, { lastChangedAt } = {}) {
    const results = [];
    for (const r of rules) {
      const v = data[r.field];
      if (r.rule === 'REQUIRED') results.push({ ...r, pass: v != null && v !== '', message: `${label(t, r.field)} is missing` });
      else if (r.rule === 'FORMAT') { const fmt = FORMATS[r.param]; results.push({ ...r, pass: v == null || v === '' || Boolean(fmt?.test(v)), message: `${label(t, r.field)} is not a valid ${fmt?.label ?? r.param} (${fmt?.hint ?? ''})` }); }
      else if (r.rule === 'STALE') { const days = Number(r.param ?? 365); results.push({ ...r, pass: !lastChangedAt || Date.now() - Date.parse(lastChangedAt) <= days * 86_400_000, message: `Not reviewed or changed for more than ${days} days` }); }
    }
    for (const c of t.crossCheck(data)) results.push({ field: c.field, rule: 'CROSS', severity: 'ERROR', pass: false, message: c.message });
    const total = results.reduce((n, r) => n + WEIGHT[r.severity], 0);
    const got = results.reduce((n, r) => n + (r.pass ? WEIGHT[r.severity] : 0), 0);
    return { results, blocking: results.filter((r) => !r.pass && r.severity === 'ERROR' && r.rule !== 'STALE'), score: total ? Math.round((got * 100) / total) : 100 };
  }
  const label = (t, key) => t.fields.find((f) => f.key === key)?.label ?? key;
  const currentData = (rec) => { const v = rec.current_version_id ? db.prepare('SELECT data_json FROM mdm_record_versions WHERE id = ?').get(rec.current_version_id) : null; return parse(v?.data_json, {}); };
  /** Records that look like this data: identical blocking keys (PAN, GSTIN) block, identical warning keys (mobile) and similar names warn. */
  function duplicatesOf(companyId, t, data, exceptId = null) {
    const out = [];
    const rows = db.prepare("SELECT r.*, v.data_json FROM mdm_records r JOIN mdm_record_versions v ON v.id = r.current_version_id WHERE r.company_id = ? AND r.master_type = ? AND r.record_status IN ('SUBMITTED', 'ACTIVE', 'INACTIVE') AND r.is_active = 1").all(companyId, t.type);
    for (const r of rows) {
      if (exceptId && r.id === exceptId) continue;
      const d = parse(r.data_json, {});
      for (const f of t.fields.filter((x) => x.unique)) if (data[f.key] && d[f.key] && data[f.key] === d[f.key]) out.push({ id: r.id, code: r.record_code, name: r.display_name, status: r.record_status, rule: `same ${f.label}`, field: f.key, score: 100, block: f.unique === 'block' });
      if (t.fuzzy && data[t.fuzzy.field] && d[t.fuzzy.field]) { const s = similarity(data[t.fuzzy.field], d[t.fuzzy.field]); if (s >= t.fuzzy.threshold) out.push({ id: r.id, code: r.record_code, name: r.display_name, status: r.record_status, rule: s === 100 ? 'same name' : 'similar name', field: t.fuzzy.field, score: s, block: false }); }
    }
    const best = new Map();
    for (const c of out) { const b = best.get(c.id); if (!b || c.block || (!b.block && c.score > b.score)) best.set(c.id, { ...c, rules: [...new Set([...(b?.rules ?? []), c.rule])] }); else b.rules = [...new Set([...b.rules, c.rule])]; }
    return [...best.values()].sort((a, b) => Number(b.block) - Number(a.block) || b.score - a.score);
  }
  const maskData = (actor, t, data) => (seesSensitive(actor, t.type) ? data : Object.fromEntries(Object.entries(data).map(([k, v]) => [k, t.fields.find((f) => f.key === k)?.sensitive ? mask(v) : v])));

  // ---- versions and "as of" (FR-03) ----
  /** The version that applies on a date: the latest approved version whose date has come. */
  function versionAsOf(recordId, date) {
    return db.prepare("SELECT * FROM mdm_record_versions WHERE record_id = ? AND version_status IN ('ACTIVE', 'SUPERSEDED', 'SCHEDULED') AND effective_from <= ? AND is_active = 1 ORDER BY effective_from DESC, version_no DESC LIMIT 1").get(recordId, date);
  }
  /** A version whose date has come becomes the one in force (the job does it every hour; approval does it at once when the date is today or past). */
  function activate(v) {
    const rec = db.prepare('SELECT * FROM mdm_records WHERE id = ?').get(v.record_id);
    db.prepare("UPDATE mdm_record_versions SET version_status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE record_id = ? AND version_status = 'ACTIVE' AND id != ?").run(nowIso(), v.record_id, v.id);
    db.prepare("UPDATE mdm_record_versions SET version_status = 'ACTIVE', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), v.id);
    const data = parse(v.data_json, {});
    const t = masterTypes.get(rec.master_type);
    const status = rec.record_status === 'MERGED' ? 'MERGED' : v.record_status_after;
    const dq = evaluate(t, rulesFor(rec.company_id, rec.master_type), data, { lastChangedAt: nowIso() }).score;
    db.prepare('UPDATE mdm_records SET current_version_id = ?, display_name = ?, record_status = ?, dq_score = ?, last_changed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(v.id, data[t.nameField] ?? rec.display_name, status, dq, nowIso(), nowIso(), rec.id);
    publishEvent(db, { type: 'mdm.record.changed', entity: 'mdm_record', entityId: rec.id, actorId: v.approved_by ?? 'system', companyId: rec.company_id, data: { masterType: rec.master_type, code: rec.record_code, version: v.version_no, status } });
  }
  function addVersion(rec, data, effectiveFrom, crId, statusAfter, state, by) {
    const no = (db.prepare('SELECT MAX(version_no) AS n FROM mdm_record_versions WHERE record_id = ?').get(rec.id).n ?? 0) + 1;
    return Number(db.prepare("INSERT INTO mdm_record_versions (company_id, record_id, version_no, data_json, effective_from, version_status, change_request_id, record_status_after, approved_by, approved_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mdm_version')")
      .run(rec.company_id, rec.id, no, JSON.stringify(data), effectiveFrom, state, crId, statusAfter, state === 'PENDING' ? null : by, state === 'PENDING' ? null : nowIso(), by).lastInsertRowid);
  }
  const placeVersion = (vid, by) => {
    const v = db.prepare('SELECT * FROM mdm_record_versions WHERE id = ?').get(vid);
    db.prepare('UPDATE mdm_record_versions SET approved_by = ?, approved_at = ?, version_status = ? WHERE id = ?').run(by, nowIso(), v.effective_from <= todayIST() ? 'ACTIVE' : 'SCHEDULED', v.id);
    if (v.effective_from <= todayIST()) activate({ ...v, approved_by: by });
  };

  // ---- views ----
  /** @param {any} actor @param {any} t @param {any} rec @param {{ asOf?: string }} [opts] */
  const recordView = (actor, t, rec, { asOf } = {}) => {
    const v = asOf ? versionAsOf(rec.id, asOf) : (rec.current_version_id ? db.prepare('SELECT * FROM mdm_record_versions WHERE id = ?').get(rec.current_version_id) : null);
    const pendingV = db.prepare("SELECT * FROM mdm_record_versions WHERE record_id = ? AND version_status = 'PENDING' AND is_active = 1 ORDER BY id DESC LIMIT 1").get(rec.id);
    const data = parse((v ?? pendingV)?.data_json, {});
    return { id: rec.id, masterType: rec.master_type, code: rec.record_code, name: rec.display_name, status: asOf && v ? v.record_status_after : rec.record_status, dqScore: rec.dq_score, mergedIntoId: rec.merged_into_id, versionNo: v?.version_no ?? null, effectiveFrom: v?.effective_from ?? pendingV?.effective_from ?? null,
      data: maskData(actor, t, data), masked: !seesSensitive(actor, t.type), lastChangedAt: rec.last_changed_at, rowVersion: rec.version, asOf: asOf ?? null };
  };
  const recordRow = (actor, type, id) => {
    const rec = db.prepare('SELECT * FROM mdm_records WHERE id = ? AND company_id = ? AND master_type = ? AND is_active = 1').get(id, actor.companyId, type);
    if (!rec) throw notFound('That record does not exist.');
    return rec;
  };
  const resolveId = (companyId, id) => { let cur = id; for (let i = 0; i < 10; i += 1) { const m = db.prepare('SELECT to_id FROM mdm_merge_map WHERE company_id = ? AND from_id = ? AND is_active = 1').get(companyId, cur); if (!m) return cur; cur = m.to_id; } return cur; };

  // ---- change requests (FR-01, FR-05) ----
  const crRow = (actor, id) => { const r = db.prepare('SELECT * FROM mdm_change_requests WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId); if (!r) throw notFound('That change request does not exist.'); return r; };
  const crView = (actor, cr, { full = false } = {}) => {
    const t = masterTypes.get(cr.master_type);
    const rec = cr.record_id ? db.prepare('SELECT record_code, display_name, record_status FROM mdm_records WHERE id = ?').get(cr.record_id) : null;
    const target = cr.target_id ? db.prepare('SELECT record_code, display_name FROM mdm_records WHERE id = ?').get(cr.target_id) : null;
    const change = parse(cr.change_json, {}); const before = parse(cr.before_json, {});
    const fields = t ? t.fields.filter((f) => f.key in change && (cr.change_type === 'CREATE' || change[f.key] !== before[f.key])).map((f) => ({ key: f.key, label: f.label, sensitive: Boolean(f.sensitive), before: seesSensitive(actor, cr.master_type) || !f.sensitive ? before[f.key] ?? null : mask(before[f.key]), after: seesSensitive(actor, cr.master_type) || !f.sensitive ? change[f.key] ?? null : mask(change[f.key]) })) : [];
    const ageHours = Math.floor((Date.now() - Date.parse(cr.created_at)) / 3_600_000);
    return { id: cr.id, masterType: cr.master_type, masterLabel: t?.label ?? cr.master_type, changeType: cr.change_type, recordId: cr.record_id, record: rec ? { code: rec.record_code, name: rec.display_name, status: rec.record_status } : null, targetId: cr.target_id, target: target ? { code: target.record_code, name: target.display_name } : null,
      justification: cr.justification, effectiveFrom: cr.effective_from, sensitive: Boolean(cr.sensitive), status: cr.request_status, requestedBy: { username: cr.requested_by, name: nameOf(actor.companyId, cr.requested_by) }, createdAt: cr.created_at, decidedBy: cr.decided_by, decidedAt: cr.decided_at, appliedAt: cr.applied_at,
      instanceId: cr.workflow_instance_id, ageHours, fields, duplicates: full ? parse(cr.duplicates_json, []) : undefined, rowVersion: cr.version, mine: cr.requested_by.toLowerCase() === actor.user.toLowerCase(), canReview: isSteward(actor, cr.master_type) };
  };
  function submitCr(actor, t, { recordId, changeType, change, before, justification, effectiveFrom, sensitive, duplicates, targetId = null }) {
    if (recordId && db.prepare("SELECT 1 FROM mdm_change_requests WHERE record_id = ? AND request_status IN ('PENDING', 'RETURNED') AND is_active = 1").get(recordId)) throw conflict('A change of this record is already waiting. It must be decided or withdrawn first.');
    const id = Number(db.prepare("INSERT INTO mdm_change_requests (company_id, master_type, record_id, change_type, change_json, before_json, justification, effective_from, sensitive, duplicates_json, requested_by, target_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mdm_request')")
      .run(actor.companyId, t.type, recordId ?? null, changeType, JSON.stringify(change ?? {}), JSON.stringify(before ?? {}), justification, effectiveFrom ?? null, sensitive ? 1 : 0, JSON.stringify(duplicates ?? []), actor.user, targetId, actor.user).lastInsertRowid);
    const instance = engine().submit(actor, { docType: changeType === 'MERGE' ? MERGE_DOC : CHANGE_DOC, docId: id, comment: justification, context: { masterType: t.type, financial: t.financial, changeType, sensitive: Boolean(sensitive) } });
    db.prepare('UPDATE mdm_change_requests SET workflow_instance_id = ? WHERE id = ?').run(instance.id, id);
    writeAudit(db, { entity: 'mdm_change_requests', entityId: id, action: 'submit', newValues: { masterType: t.type, changeType, recordId: recordId ?? null }, actor: actor.user, companyId: actor.companyId, reason: justification });
    publishEvent(db, { type: 'mdm.change.requested', entity: 'mdm_change_request', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { masterType: t.type, changeType } });
    return { id, instance };
  }
  const tellRequester = (cr, decision, comment) => notif.notify({ companyId: cr.company_id, templateCode: 'mdm.request.decided', recipients: [`user:${cr.requested_by}`], data: { decision, change: cr.change_type.toLowerCase(), master: masterTypes.get(cr.master_type)?.label ?? cr.master_type, record: cr.record_id ? db.prepare('SELECT record_code FROM mdm_records WHERE id = ?').get(cr.record_id)?.record_code ?? '' : '', comment: comment ? `: ${comment}` : '' }, link: '/admin/master-data/change-requests', sourceType: 'mdm_change_request', sourceId: String(cr.id), eventKey: `mdm.request.decided:${cr.id}:${decision}` });

  const records = {
    types(actor) { need(actor, 'mdm.record.view', 'see master data'); return { rows: masterTypes.list().map((t) => ({ type: t.type, label: t.label, financial: t.financial, fields: t.fields.map(({ key, label: l, type, required, options, format, sensitive, unique, max }) => ({ key, label: l, type, required: Boolean(required), options: options ?? null, format: format ?? null, formatHint: format ? FORMATS[format]?.hint : null, sensitive: Boolean(sensitive), unique: unique ?? null, max: max ?? null })), canEdit: mayEdit(actor, t.type), steward: isSteward(actor, t.type) })) }; },
    list(actor, type, f) {
      need(actor, 'mdm.record.view', 'see master data');
      const t = typeOrThrow(type);
      const where = ['company_id = ?', 'master_type = ?', 'is_active = 1']; const args = [actor.companyId, type];
      if (f.status) { where.push('record_status = ?'); args.push(f.status); } else { where.push("record_status != 'REJECTED'"); }
      if (f.q) { where.push('(display_name LIKE ? OR record_code LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`); }
      if (f.maxScore != null) { where.push('dq_score <= ?'); args.push(f.maxScore); }
      const order = { name: 'display_name', code: 'record_code', score: 'dq_score', changed: 'last_changed_at DESC' }[f.sort] ?? 'record_code';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM mdm_records WHERE ${where.join(' AND ')}`).get(...args).n;
      const rows = db.prepare(`SELECT * FROM mdm_records WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, f.limit, f.offset).map((r) => recordView(actor, t, r, { asOf: f.asOf }));
      return { rows, total, canEdit: mayEdit(actor, type) };
    },
    /** @param {any} actor @param {string} type @param {number} id @param {{ asOf?: string }} [opts] */
    get(actor, type, id, { asOf } = {}) {
      need(actor, 'mdm.record.view', 'see master data');
      const t = typeOrThrow(type);
      const rec = recordRow(actor, type, id);
      const view = recordView(actor, t, rec, { asOf });
      const versions = db.prepare('SELECT * FROM mdm_record_versions WHERE record_id = ? AND is_active = 1 ORDER BY version_no DESC').all(rec.id).map((v) => ({ id: v.id, version: v.version_no, effectiveFrom: v.effective_from, status: v.version_status, statusAfter: v.record_status_after, approvedBy: v.approved_by, approvedAt: v.approved_at, data: maskData(actor, t, parse(v.data_json, {})), changeRequestId: v.change_request_id }));
      const quality = evaluate(t, rulesFor(actor.companyId, type), parse(rec.current_version_id ? db.prepare('SELECT data_json FROM mdm_record_versions WHERE id = ?').get(rec.current_version_id).data_json : '{}', {}), { lastChangedAt: rec.last_changed_at });
      const survivorId = rec.record_status === 'MERGED' ? resolveId(actor.companyId, rec.id) : null;
      const survivor = survivorId ? db.prepare('SELECT id, record_code, display_name FROM mdm_records WHERE id = ?').get(survivorId) : null;
      const merged = db.prepare('SELECT m.from_id, r.record_code, r.display_name, m.merged_at FROM mdm_merge_map m JOIN mdm_records r ON r.id = m.from_id WHERE m.to_id = ? AND m.is_active = 1').all(rec.id).map((m) => ({ id: m.from_id, code: m.record_code, name: m.display_name, mergedAt: m.merged_at }));
      const requests = db.prepare('SELECT * FROM mdm_change_requests WHERE (record_id = ? OR target_id = ?) AND is_active = 1 ORDER BY id DESC LIMIT 20').all(rec.id, rec.id).map((c) => crView(actor, c));
      const dups = db.prepare("SELECT * FROM mdm_duplicates WHERE (record_a = ? OR record_b = ?) AND duplicate_status IN ('OPEN', 'MERGE_PENDING') AND is_active = 1").all(rec.id, rec.id).map((d) => ({ id: d.id, other: d.record_a === rec.id ? d.record_b : d.record_a, score: d.score, rule: d.match_rule, status: d.duplicate_status }));
      return { ...view, versions, quality: { score: quality.score, results: quality.results.map(({ field, rule, severity, pass, message }) => ({ field, rule, severity, pass, message: pass ? null : message })) }, survivor: survivor ? { id: survivor.id, code: survivor.record_code, name: survivor.display_name } : null, merged, requests, duplicates: dups, canEdit: mayEdit(actor, type) && ['ACTIVE', 'INACTIVE'].includes(rec.record_status), stewards: stewardsOf(actor.companyId, type).map((s) => ({ username: s.username, name: nameOf(actor.companyId, s.username), role: s.steward_role })) };
    },
    /** For forms of other modules: only records in force can be chosen (BR-02); a merged record is replaced by the one it was merged into. */
    lookup(actor, type, q) {
      need(actor, 'mdm.record.view', 'see master data');
      const t = typeOrThrow(type);
      return { rows: db.prepare("SELECT * FROM mdm_records WHERE company_id = ? AND master_type = ? AND record_status = 'ACTIVE' AND is_active = 1 AND (display_name LIKE ? OR record_code LIKE ?) ORDER BY display_name LIMIT 25").all(actor.companyId, type, `%${q ?? ''}%`, `%${q ?? ''}%`).map((r) => ({ id: r.id, code: r.record_code, label: `${r.record_code} ${r.display_name}`, name: r.display_name, kind: currentData(r).kind ?? null })), type: t.type };
    },
    /** Shown before saving: what blocks, what only warns, and the possible duplicates. */
    check(actor, type, { data, recordId }) {
      need(actor, 'mdm.record.view', 'see master data');
      const t = typeOrThrow(type);
      const base = recordId ? currentData(recordRow(actor, type, recordId)) : {};
      const merged = { ...base, ...clean(t, data) };
      const q = evaluate(t, rulesFor(actor.companyId, type), merged, { lastChangedAt: nowIso() });
      return { score: q.score, errors: q.blocking.map(({ field, message }) => ({ field, message })), warnings: q.results.filter((r) => !r.pass && r.severity !== 'ERROR').map(({ field, message, severity }) => ({ field, message, severity })), duplicates: duplicatesOf(actor.companyId, t, merged, recordId ?? null).map((d) => ({ ...d, name: d.name })) };
    },
    /** A new record: checked, then sent to its stewards (and the accounts manager for a financial master). Nothing is active until it is approved. */
    create(actor, type, b) {
      need(actor, 'mdm.record.view', 'request master data');
      const t = typeOrThrow(type);
      const data = clean(t, b.data);
      for (const f of t.fields.filter((x) => x.required)) if (data[f.key] == null) throw badRequest('Some fields are missing.', [{ field: f.key, message: `${f.label} is required` }]);
      const q = evaluate(t, rulesFor(actor.companyId, type), data, { lastChangedAt: nowIso() });
      if (q.blocking.length) throw badRequest('Some fields are not valid.', q.blocking.map(({ field, message }) => ({ field, message })));
      const dups = duplicatesOf(actor.companyId, t, data);
      const blocking = dups.filter((d) => d.block);
      if (blocking.length) throw new HttpError(409, 'DUPLICATE', `This ${t.label.toLowerCase()} already exists: ${blocking.map((d) => `${d.code} ${d.name} (${d.rules.join(', ')})`).join('; ')}.`, blocking.map((d) => ({ field: d.field, message: `same as ${d.code} ${d.name}`, recordId: d.id })));
      if (dups.length && !b.acknowledgeDuplicates) throw new HttpError(409, 'DUPLICATE_WARNING', `This looks like ${dups.map((d) => `${d.code} ${d.name} (${d.rules.join(', ')})`).join('; ')}. Check it, then confirm that it is a different ${t.label.toLowerCase()}.`, dups.map((d) => ({ field: d.field, message: `similar to ${d.code} ${d.name}`, recordId: d.id, score: d.score })));
      const effectiveFrom = b.effectiveFrom ?? todayIST();
      return transaction(db, () => {
        const n = (db.prepare("SELECT COUNT(*) AS n FROM mdm_records WHERE company_id = ? AND master_type = ?").get(actor.companyId, type).n ?? 0) + 1;
        const code = `${t.codePrefix}-${String(n).padStart(5, '0')}`;
        const rid = Number(db.prepare("INSERT INTO mdm_records (company_id, master_type, record_code, display_name, record_status, dq_score, created_by, source_type) VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?, 'mdm_record')").run(actor.companyId, type, code, data[t.nameField], q.score, actor.user).lastInsertRowid);
        const rec = db.prepare('SELECT * FROM mdm_records WHERE id = ?').get(rid);
        const { id, instance } = submitCr(actor, t, { recordId: rid, changeType: 'CREATE', change: data, before: {}, justification: b.justification, effectiveFrom, sensitive: true, duplicates: dups });
        const vid = addVersion(rec, data, effectiveFrom, id, 'ACTIVE', 'PENDING', actor.user);
        db.prepare('UPDATE mdm_records SET current_version_id = ? WHERE id = ?').run(vid, rid);
        writeAudit(db, { entity: 'mdm_records', entityId: rid, action: 'create', newValues: { code, masterType: type, status: 'SUBMITTED' }, actor: actor.user, companyId: actor.companyId, reason: b.justification });
        for (const d of dups) recordDuplicate(actor.companyId, type, rid, d.id, d.score, d.rules.join(', '));
        return { record: recordView(actor, t, db.prepare('SELECT * FROM mdm_records WHERE id = ?').get(rid)), changeRequestId: id, workflow: instance, duplicates: dups.length };
      });
    },
    /**
     * A change from a date. A change of a sensitive field, or by someone who may not edit, goes to the stewards with its justification (FR-05); a change of other fields by someone who may edit applies at once
     * (from its date), audited. Either way the record keeps every version.
     */
    update(actor, type, id, b) {
      need(actor, 'mdm.record.view', 'request master data');
      const t = typeOrThrow(type);
      const rec = recordRow(actor, type, id);
      if (rec.version !== b.version) throw conflict('This record was changed by someone else. Reload it and try again.');
      if (!['ACTIVE', 'INACTIVE'].includes(rec.record_status)) throw conflict(rec.record_status === 'MERGED' ? 'A merged record is not changed: change the record it was merged into.' : 'This record is not approved yet.');
      const before = currentData(rec);
      const input = clean(t, b.data);
      const changed = Object.keys(input).filter((k) => input[k] !== (before[k] ?? null));
      if (!changed.length) throw badRequest('Nothing was changed.', [{ field: 'data', message: 'change at least one field' }]);
      const after = { ...before, ...input };
      for (const f of t.fields.filter((x) => x.required)) if (after[f.key] == null) throw badRequest('Some fields are missing.', [{ field: f.key, message: `${f.label} is required` }]);
      const q = evaluate(t, rulesFor(actor.companyId, type), after, { lastChangedAt: nowIso() });
      if (q.blocking.length) throw badRequest('Some fields are not valid.', q.blocking.map(({ field, message }) => ({ field, message })));
      const dups = duplicatesOf(actor.companyId, t, after, rec.id);
      const blocking = dups.filter((d) => d.block && changed.includes(d.field));
      if (blocking.length) throw new HttpError(409, 'DUPLICATE', `Another record already has this value: ${blocking.map((d) => `${d.code} ${d.name} (${d.rules.join(', ')})`).join('; ')}.`, blocking.map((d) => ({ field: d.field, message: `same as ${d.code} ${d.name}`, recordId: d.id })));
      const effectiveFrom = b.effectiveFrom ?? todayIST();
      if (effectiveFrom < todayIST()) throw badRequest('A change cannot apply from a past date.', [{ field: 'effectiveFrom', message: 'choose today or a later date' }]);
      const sensitive = changed.some((k) => t.fields.find((f) => f.key === k)?.sensitive);
      const direct = !sensitive && mayEdit(actor, type);
      if (!direct && !b.justification) throw badRequest('Say why this change is needed.', [{ field: 'justification', message: 'is required for a change that is approved' }]);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM mdm_change_requests WHERE record_id = ? AND request_status IN ('PENDING', 'RETURNED') AND is_active = 1").get(rec.id)) throw conflict('A change of this record is already waiting. It must be decided or withdrawn first.');
        const statusAfter = rec.record_status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
        if (direct) {
          const vid = addVersion(rec, after, effectiveFrom, null, statusAfter, 'PENDING', actor.user);
          placeVersion(vid, actor.user);
          db.prepare('UPDATE mdm_records SET version = version + 1, updated_by = ? WHERE id = ?').run(actor.user, rec.id);
          writeAudit(db, { entity: 'mdm_records', entityId: rec.id, action: 'update', oldValues: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])), newValues: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])), actor: actor.user, companyId: actor.companyId, reason: b.justification ?? 'Change of fields that are not sensitive' });
          return { applied: true, effectiveFrom, record: records.get(actor, type, rec.id) };
        }
        const { id: crId, instance } = submitCr(actor, t, { recordId: rec.id, changeType: 'UPDATE', change: after, before, justification: b.justification, effectiveFrom, sensitive, duplicates: dups });
        addVersion(rec, after, effectiveFrom, crId, statusAfter, 'PENDING', actor.user);
        return { applied: false, changeRequestId: crId, workflow: instance };
      });
    },
    /** Inactivation and reactivation are approved like a new record (BR-02: an inactive record cannot be chosen for new transactions, it stays in history). */
    setStatus(actor, type, id, { action, effectiveFrom, justification }) {
      need(actor, 'mdm.record.view', 'request master data');
      const t = typeOrThrow(type);
      const rec = recordRow(actor, type, id);
      if (action === 'INACTIVATE' && rec.record_status !== 'ACTIVE') throw conflict('Only a record in force can be made inactive.');
      if (action === 'REACTIVATE' && rec.record_status !== 'INACTIVE') throw conflict('Only an inactive record can be made active again.');
      const from = effectiveFrom ?? todayIST();
      if (from < todayIST()) throw badRequest('A change cannot apply from a past date.', [{ field: 'effectiveFrom', message: 'choose today or a later date' }]);
      return transaction(db, () => {
        const data = currentData(rec);
        const { id: crId, instance } = submitCr(actor, t, { recordId: rec.id, changeType: action, change: data, before: data, justification, effectiveFrom: from, sensitive: true, duplicates: [] });
        addVersion(rec, data, from, crId, action === 'INACTIVATE' ? 'INACTIVE' : 'ACTIVE', 'PENDING', actor.user);
        return { changeRequestId: crId, workflow: instance };
      });
    },
    /** BR-01: a merged record points to the one it was merged into; following the map gives the record in force. */
    resolve(actor, type, id) {
      need(actor, 'mdm.record.view', 'see master data');
      const rec = recordRow(actor, type, id);
      const to = resolveId(actor.companyId, rec.id);
      const r = db.prepare('SELECT id, record_code, display_name, record_status FROM mdm_records WHERE id = ?').get(to);
      return { requested: rec.id, resolved: r.id, code: r.record_code, name: r.display_name, status: r.record_status, redirected: r.id !== rec.id };
    },
    /** Who refers to the record (and to the records merged into it): the references go on through the merge map. */
    references(actor, type, id) {
      need(actor, 'mdm.record.view', 'see master data');
      const rec = recordRow(actor, type, id);
      const ids = [rec.id, ...db.prepare('SELECT from_id FROM mdm_merge_map WHERE to_id = ? AND is_active = 1').all(rec.id).map((m) => m.from_id)];
      const rows = [];
      for (const p of masterReferences.list()) for (const r of p.find(db, actor.companyId, ids)) rows.push({ ...r, source: p.label, redirectedFrom: r.recordId !== rec.id ? db.prepare('SELECT record_code FROM mdm_records WHERE id = ?').get(r.recordId)?.record_code ?? null : null });
      return { rows };
    },
  };

  // ---- the change requests worklist ----
  const requests = {
    /** @param {any} actor @param {{ view?: string, status?: string, type?: string }} [f] */
    list(actor, { view = 'mine', status, type } = {}) {
      need(actor, 'mdm.record.view', 'see master data');
      const where = ['company_id = ?', 'is_active = 1']; const args = [actor.companyId];
      if (view === 'mine') { where.push('lower(requested_by) = lower(?)'); args.push(actor.user); }
      else if (view === 'review') { const mine = masterTypes.list().filter((t) => isSteward(actor, t.type)).map((t) => t.type); if (!mine.length && !anywhere(actor, 'mdm.governance.view')) return { rows: [], counts: {} }; if (mine.length) { where.push(`master_type IN (${mine.map(() => '?').join(',')})`); args.push(...mine); } where.push("request_status IN ('PENDING', 'RETURNED')"); }
      else if (!anywhere(actor, 'mdm.governance.view')) throw forbidden('You may not see all change requests (permission mdm.governance.view).');
      if (status) { where.push('request_status = ?'); args.push(status); }
      if (type) { where.push('master_type = ?'); args.push(type); }
      const rows = db.prepare(`SELECT * FROM mdm_change_requests WHERE ${where.join(' AND ')} ORDER BY CASE request_status WHEN 'PENDING' THEN 0 WHEN 'RETURNED' THEN 1 ELSE 2 END, created_at LIMIT 500`).all(...args).map((c) => crView(actor, c));
      const counts = {}; for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
      return { rows, counts };
    },
    get(actor, id) {
      need(actor, 'mdm.record.view', 'see master data');
      const cr = crRow(actor, id);
      if (!(cr.requested_by.toLowerCase() === actor.user.toLowerCase() || isSteward(actor, cr.master_type) || anywhere(actor, 'mdm.governance.view') || anywhere(actor, 'mdm.record.edit'))) throw notFound('That change request does not exist.');
      return crView(actor, cr, { full: true });
    },
    /** The requester withdraws a request that has not been decided. */
    cancel(actor, id, { reason }) {
      const cr = crRow(actor, id);
      if (cr.requested_by.toLowerCase() !== actor.user.toLowerCase()) throw forbidden('Only the person who asked can withdraw a request.');
      if (!['PENDING', 'RETURNED'].includes(cr.request_status)) throw conflict('This request was already decided.');
      // still running and nobody has acted: the engine's withdraw (its hook ends the request); returned to the requester: the instance is ended and the request with it
      if (cr.request_status === 'PENDING') engine().withdraw(actor, cr.workflow_instance_id, { comment: reason });
      else transaction(db, () => { engine().abandon(actor.companyId, cr.workflow_instance_id, actor.user, 'WITHDRAWN', reason); decisions.ended({ docId: cr.id }, actor, 'CANCELLED', reason); });
      return crView(actor, crRow(actor, id));
    },
    /** Returned for correction: the requester changes the data or the justification and sends it again. */
    resubmit(actor, id, b) {
      const cr = crRow(actor, id);
      if (cr.requested_by.toLowerCase() !== actor.user.toLowerCase()) throw forbidden('Only the person who asked can send it again.');
      if (cr.request_status !== 'RETURNED') throw conflict('Only a request that was returned can be sent again.');
      const t = masterTypes.get(cr.master_type);
      return transaction(db, () => {
        let change = parse(cr.change_json, {});
        if (b.data && ['CREATE', 'UPDATE'].includes(cr.change_type)) {
          change = { ...change, ...clean(t, b.data) };
          const q = evaluate(t, rulesFor(actor.companyId, cr.master_type), change, { lastChangedAt: nowIso() });
          if (q.blocking.length) throw badRequest('Some fields are not valid.', q.blocking.map(({ field, message }) => ({ field, message })));
          db.prepare("UPDATE mdm_record_versions SET data_json = ? WHERE change_request_id = ? AND version_status = 'PENDING'").run(JSON.stringify(change), cr.id);
          if (cr.change_type === 'CREATE') db.prepare('UPDATE mdm_records SET display_name = ? WHERE id = ?').run(change[t.nameField], cr.record_id);
        }
        db.prepare("UPDATE mdm_change_requests SET change_json = ?, justification = ?, request_status = 'PENDING', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(change), b.justification ?? cr.justification, actor.user, nowIso(), cr.id);
        engine().resubmit(actor, cr.workflow_instance_id, { comment: b.justification ?? 'Corrected', context: { masterType: cr.master_type, financial: t.financial, changeType: cr.change_type, sensitive: Boolean(cr.sensitive) } });
        writeAudit(db, { entity: 'mdm_change_requests', entityId: cr.id, action: 'resubmit', actor: actor.user, companyId: actor.companyId, reason: b.justification });
        return crView(actor, crRow(actor, id));
      });
    },
  };

  // ---- what an approval does ----
  const decisions = {
    approved(instance, actor) {
      const cr = db.prepare('SELECT * FROM mdm_change_requests WHERE id = ?').get(Number(instance.docId));
      if (!cr || cr.request_status !== 'PENDING') return;
      const now = nowIso();
      db.prepare("UPDATE mdm_change_requests SET request_status = 'APPLIED', decided_by = ?, decided_at = ?, applied_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, now, now, cr.id);
      if (cr.change_type === 'MERGE') mergeApply(cr, actor);
      else {
        const v = db.prepare("SELECT id FROM mdm_record_versions WHERE change_request_id = ? AND version_status = 'PENDING'").get(cr.id);
        if (v) placeVersion(v.id, actor.user);
        if (cr.change_type === 'CREATE') {
          const rec = db.prepare('SELECT * FROM mdm_records WHERE id = ?').get(cr.record_id);
          if (rec.record_status === 'SUBMITTED' && cr.effective_from > todayIST()) db.prepare("UPDATE mdm_records SET record_status = 'SUBMITTED' WHERE id = ?").run(rec.id); // stays out of new transactions until its date
          if (rec.record_status === 'ACTIVE') scanOne(cr.company_id, cr.master_type, rec.id);
        }
      }
      writeAudit(db, { entity: 'mdm_change_requests', entityId: cr.id, action: 'approve', newValues: { changeType: cr.change_type }, actor: actor.user, companyId: cr.company_id });
      tellRequester(cr, 'approved');
    },
    ended(instance, actor, status, comment) {
      const cr = db.prepare('SELECT * FROM mdm_change_requests WHERE id = ?').get(Number(instance.docId));
      if (!cr || !['PENDING', 'RETURNED'].includes(cr.request_status)) return;
      const now = nowIso();
      db.prepare('UPDATE mdm_change_requests SET request_status = ?, decided_by = ?, decided_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, status === 'RETURNED' ? null : now, now, cr.id);
      if (status !== 'RETURNED') {
        db.prepare("UPDATE mdm_record_versions SET version_status = 'REJECTED', updated_at = ? WHERE change_request_id = ? AND version_status = 'PENDING'").run(now, cr.id);
        if (cr.change_type === 'CREATE') db.prepare("UPDATE mdm_records SET record_status = 'REJECTED', updated_at = ?, version = version + 1 WHERE id = ? AND record_status = 'SUBMITTED'").run(now, cr.record_id);
        if (cr.change_type === 'MERGE') db.prepare("UPDATE mdm_duplicates SET duplicate_status = 'OPEN', updated_at = ? WHERE company_id = ? AND duplicate_status = 'MERGE_PENDING' AND ((record_a = ? AND record_b = ?) OR (record_a = ? AND record_b = ?))").run(now, cr.company_id, cr.record_id, cr.target_id, cr.target_id, cr.record_id);
      }
      writeAudit(db, { entity: 'mdm_change_requests', entityId: cr.id, action: status.toLowerCase(), actor: actor.user, companyId: cr.company_id, reason: comment ?? null });
      tellRequester(cr, status === 'RETURNED' ? 'returned for correction' : status.toLowerCase(), comment);
    },
  };

  // ---- duplicates and merge (FR-02, BR-01) ----
  function recordDuplicate(companyId, type, x, y, score, rule) {
    const [a, b] = x < y ? [x, y] : [y, x];
    db.prepare("INSERT INTO mdm_duplicates (company_id, master_type, record_a, record_b, score, match_rule, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'system', 'mdm_duplicate') ON CONFLICT (company_id, master_type, record_a, record_b) DO UPDATE SET score = MAX(score, excluded.score), match_rule = excluded.match_rule").run(companyId, type, a, b, score, rule);
  }
  function scanOne(companyId, type, id) {
    const t = masterTypes.get(type);
    const rec = db.prepare('SELECT * FROM mdm_records WHERE id = ?').get(id);
    let n = 0;
    for (const d of duplicatesOf(companyId, t, currentData(rec), id)) {
      const [a, b] = id < d.id ? [id, d.id] : [d.id, id];
      const ex = db.prepare('SELECT duplicate_status FROM mdm_duplicates WHERE company_id = ? AND master_type = ? AND record_a = ? AND record_b = ?').get(companyId, type, a, b);
      if (!ex) { recordDuplicate(companyId, type, id, d.id, d.score, d.rules.join(', ')); n += 1; }
    }
    return n;
  }
  /** A scan of a whole master (the job, and the "Scan now" of the report). */
  function scan(companyId, type) { let n = 0; for (const r of db.prepare("SELECT id FROM mdm_records WHERE company_id = ? AND master_type = ? AND record_status IN ('ACTIVE', 'INACTIVE') AND is_active = 1").all(companyId, type)) n += scanOne(companyId, type, r.id); return n; }
  const dupView = (actor, d) => {
    const t = masterTypes.get(d.master_type);
    const side = (id) => { const r = db.prepare('SELECT * FROM mdm_records WHERE id = ?').get(id); return { id: r.id, code: r.record_code, name: r.display_name, status: r.record_status, dqScore: r.dq_score, data: maskData(actor, t, currentData(r)), createdAt: r.created_at }; };
    return { id: d.id, masterType: d.master_type, masterLabel: t?.label ?? d.master_type, score: d.score, rule: d.match_rule, status: d.duplicate_status, resolution: d.resolution, resolvedBy: d.resolved_by, resolvedAt: d.resolved_at, a: side(d.record_a), b: side(d.record_b), fields: t?.fields.map((f) => ({ key: f.key, label: f.label })) ?? [], createdAt: d.created_at };
  };
  const duplicates = {
    /** @param {any} actor @param {{ type?: string, status?: string, minScore?: number, limit?: number, offset?: number }} [f] */
    list(actor, { type, status, minScore, limit = 50, offset = 0 } = {}) {
      need(actor, 'mdm.governance.view', 'see the duplicates report');
      const where = ['company_id = ?', 'is_active = 1']; const args = [actor.companyId];
      if (type) { where.push('master_type = ?'); args.push(type); }
      if (status) { where.push('duplicate_status = ?'); args.push(status); }
      if (minScore) { where.push('score >= ?'); args.push(minScore); }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM mdm_duplicates WHERE ${where.join(' AND ')}`).get(...args).n;
      const rows = db.prepare(`SELECT * FROM mdm_duplicates WHERE ${where.join(' AND ')} ORDER BY CASE duplicate_status WHEN 'OPEN' THEN 0 WHEN 'MERGE_PENDING' THEN 1 ELSE 2 END, score DESC, id LIMIT ? OFFSET ?`).all(...args, limit, offset).map((d) => dupView(actor, d));
      return { rows, total, canMerge: anywhere(actor, 'mdm.record.edit') };
    },
    dismiss(actor, id, { reason }) {
      need(actor, 'mdm.record.edit', 'decide about duplicates');
      const d = db.prepare('SELECT * FROM mdm_duplicates WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
      if (!d) throw notFound('That duplicate candidate does not exist.');
      if (d.duplicate_status !== 'OPEN') throw conflict('This candidate was already decided.');
      db.prepare("UPDATE mdm_duplicates SET duplicate_status = 'NOT_DUPLICATE', resolution = ?, resolved_by = ?, resolved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), nowIso(), d.id);
      writeAudit(db, { entity: 'mdm_duplicates', entityId: d.id, action: 'not_duplicate', actor: actor.user, companyId: actor.companyId, reason });
      return dupView(actor, db.prepare('SELECT * FROM mdm_duplicates WHERE id = ?').get(d.id));
    },
    scanNow(actor, type) { need(actor, 'mdm.record.edit', 'scan for duplicates'); typeOrThrow(type); return { found: scan(actor.companyId, type) }; },
    /** A merge request: approved by the stewards (and the accounts manager for vendors and clients); the merged record is kept and points to the other one (BR-01). */
    requestMerge(actor, { type, fromId, toId, justification }) {
      need(actor, 'mdm.record.edit', 'request a merge');
      const t = typeOrThrow(type);
      if (fromId === toId) throw badRequest('A record cannot be merged into itself.');
      const from = recordRow(actor, type, fromId); const to = recordRow(actor, type, toId);
      for (const r of [from, to]) if (!['ACTIVE', 'INACTIVE'].includes(r.record_status)) throw conflict(`${r.record_code} is ${r.record_status.toLowerCase()} and cannot be merged.`);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM mdm_change_requests WHERE (record_id IN (?, ?) OR target_id IN (?, ?)) AND request_status IN ('PENDING', 'RETURNED') AND is_active = 1").get(from.id, to.id, from.id, to.id)) throw conflict('One of these records already has a change waiting.');
        const { id, instance } = submitCr(actor, t, { recordId: from.id, targetId: to.id, changeType: 'MERGE', change: { into: to.record_code }, before: { from: from.record_code }, justification, effectiveFrom: todayIST(), sensitive: true, duplicates: [] });
        const [a, b] = from.id < to.id ? [from.id, to.id] : [to.id, from.id];
        recordDuplicate(actor.companyId, type, a, b, 100, 'merge requested');
        db.prepare("UPDATE mdm_duplicates SET duplicate_status = 'MERGE_PENDING', updated_at = ? WHERE company_id = ? AND master_type = ? AND record_a = ? AND record_b = ?").run(nowIso(), actor.companyId, type, a, b);
        return { changeRequestId: id, workflow: instance };
      });
    },
  };
  function mergeApply(cr, actor) {
    const now = nowIso();
    db.prepare("INSERT INTO mdm_merge_map (company_id, master_type, from_id, to_id, merged_at, merged_by, change_request_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mdm_merge')").run(cr.company_id, cr.master_type, cr.record_id, cr.target_id, now, actor.user, cr.id, actor.user);
    db.prepare("UPDATE mdm_records SET record_status = 'MERGED', merged_into_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(cr.target_id, actor.user, now, cr.record_id);
    db.prepare("UPDATE mdm_duplicates SET duplicate_status = 'MERGED', resolution = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE company_id = ? AND ((record_a = ? AND record_b = ?) OR (record_a = ? AND record_b = ?))").run(`merged into ${cr.target_id}`, actor.user, now, now, cr.company_id, cr.record_id, cr.target_id, cr.target_id, cr.record_id);
    writeAudit(db, { entity: 'mdm_records', entityId: cr.record_id, action: 'merge', newValues: { into: cr.target_id }, actor: actor.user, companyId: cr.company_id });
    publishEvent(db, { type: 'mdm.record.merged', entity: 'mdm_record', entityId: cr.record_id, actorId: actor.user, companyId: cr.company_id, data: { masterType: cr.master_type, from: cr.record_id, to: cr.target_id } });
  }

  // ---- quality (FR-04) ----
  const quality = {
    /** @param {any} actor @param {{ type?: string }} [f] */
    summary(actor, { type } = {}) {
      need(actor, 'mdm.governance.view', 'see data quality');
      const out = [];
      for (const t of masterTypes.list().filter((x) => !type || x.type === type)) {
        const rules = rulesFor(actor.companyId, t.type);
        const recs = db.prepare("SELECT * FROM mdm_records WHERE company_id = ? AND master_type = ? AND record_status IN ('ACTIVE', 'INACTIVE') AND is_active = 1").all(actor.companyId, t.type);
        const failing = new Map(); const worst = [];
        let sum = 0; let stale = 0;
        for (const r of recs) {
          const q = evaluate(t, rules, currentData(r), { lastChangedAt: r.last_reviewed_at && r.last_reviewed_at > (r.last_changed_at ?? '') ? r.last_reviewed_at : r.last_changed_at });
          sum += q.score;
          if (q.results.some((x) => x.rule === 'STALE' && !x.pass)) stale += 1;
          for (const x of q.results.filter((y) => !y.pass)) { const k = `${x.rule}:${x.field}`; failing.set(k, { field: x.field, label: label(t, x.field), rule: x.rule, severity: x.severity, count: (failing.get(k)?.count ?? 0) + 1 }); }
          worst.push({ id: r.id, code: r.record_code, name: r.display_name, score: q.score, problems: q.results.filter((y) => !y.pass).map((y) => y.message) });
          if (q.score !== r.dq_score) db.prepare('UPDATE mdm_records SET dq_score = ? WHERE id = ?').run(q.score, r.id);
        }
        out.push({ type: t.type, label: t.label, records: recs.length, score: recs.length ? Math.round(sum / recs.length) : null, below70: worst.filter((w) => w.score < 70).length, stale, failing: [...failing.values()].sort((a, b) => b.count - a.count), worst: worst.sort((a, b) => a.score - b.score).slice(0, 10), rules: rules.length });
      }
      return { rows: out };
    },
    /** A steward confirms a record is still right: it is no longer stale. */
    review(actor, type, id) {
      const rec = recordRow(actor, type, id);
      if (!mayEdit(actor, type)) throw forbidden('Only a steward or someone who may edit this master confirms a record.');
      db.prepare('UPDATE mdm_records SET last_reviewed_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(nowIso(), actor.user, nowIso(), rec.id);
      writeAudit(db, { entity: 'mdm_records', entityId: rec.id, action: 'review', actor: actor.user, companyId: actor.companyId });
      return { id: rec.id, reviewedAt: nowIso() };
    },
  };

  // ---- the rules and the stewards (FR-07; config: maker-checker) ----
  const config = {
    get(actor) {
      need(actor, 'mdm.governance.view', 'see the rules and stewards');
      const ver = (table) => db.prepare(`SELECT MAX(config_version) AS v FROM ${table} WHERE company_id = ? AND config_status = 'ACTIVE'`).get(actor.companyId).v ?? 0;
      const rv = Math.max(ver('mdm_quality_rules'), ver('mdm_stewards'));
      const rules = []; for (const t of masterTypes.list()) for (const r of rulesFor(actor.companyId, t.type)) rules.push({ masterType: t.type, ...r, active: true });
      const pendingRules = db.prepare("SELECT * FROM mdm_quality_rules WHERE company_id = ? AND config_status = 'PENDING' AND is_active = 1 ORDER BY id").all(actor.companyId).map((r) => ({ masterType: r.master_type, field: r.field, rule: r.rule, param: r.param, severity: r.severity, active: Boolean(r.active) }));
      const stewards = db.prepare("SELECT * FROM mdm_stewards WHERE company_id = ? AND config_status = 'ACTIVE' AND is_active = 1 ORDER BY master_type, steward_role, user_ref").all(actor.companyId).map((s) => ({ masterType: s.master_type, username: s.user_ref, name: nameOf(actor.companyId, s.user_ref), role: s.steward_role }));
      const pendingStewards = db.prepare("SELECT * FROM mdm_stewards WHERE company_id = ? AND config_status = 'PENDING' AND is_active = 1 ORDER BY master_type").all(actor.companyId).map((s) => ({ masterType: s.master_type, username: s.user_ref, name: nameOf(actor.companyId, s.user_ref), role: s.steward_role }));
      const pending = db.prepare("SELECT config_version AS version, MIN(created_by) AS by, MIN(created_at) AS at, MIN(reason) AS reason, MIN(instance_id) AS instanceId FROM (SELECT config_version, created_by, created_at, reason, instance_id FROM mdm_quality_rules WHERE company_id = ? AND config_status = 'PENDING' UNION ALL SELECT config_version, created_by, created_at, reason, instance_id FROM mdm_stewards WHERE company_id = ? AND config_status = 'PENDING') GROUP BY config_version").get(actor.companyId, actor.companyId) ?? null;
      const history = db.prepare("SELECT config_version AS version, config_status AS status, MIN(created_by) AS by, MIN(created_at) AS at, MIN(reason) AS reason FROM (SELECT config_version, config_status, created_by, created_at, reason FROM mdm_quality_rules WHERE company_id = ? UNION ALL SELECT config_version, config_status, created_by, created_at, reason FROM mdm_stewards WHERE company_id = ?) GROUP BY config_version, config_status ORDER BY config_version DESC LIMIT 30").all(actor.companyId, actor.companyId);
      return { version: rv, rules, stewards, pending: pending?.version ? { ...pending, rules: pendingRules, stewards: pendingStewards } : null, history, canEdit: anywhere(actor, 'mdm.config.edit'), formats: Object.entries(FORMATS).map(([k, f]) => ({ code: k, label: f.label, hint: f.hint })), types: masterTypes.list().map((t) => ({ type: t.type, label: t.label, fields: t.fields.map((f) => ({ key: f.key, label: f.label })) })) };
    },
    propose(actor, b) {
      need(actor, 'mdm.config.edit', 'change the rules and stewards');
      for (const r of b.rules) { const t = typeOrThrow(r.masterType); if (r.field !== '*' && !t.fields.some((f) => f.key === r.field)) throw badRequest(`${r.field} is not a field of ${t.label}.`, [{ field: 'rules', message: `unknown field ${r.field}` }]); if (r.rule === 'FORMAT' && !FORMATS[r.param]) throw badRequest(`${r.param} is not a format.`, [{ field: 'rules', message: `unknown format ${r.param}` }]); if (r.rule === 'STALE' && !(Number(r.param) >= 1)) throw badRequest('A stale rule needs a number of days.', [{ field: 'rules', message: 'days' }]); }
      const users = b.stewards.map((s) => { typeOrThrow(s.masterType); const u = db.prepare("SELECT id, username FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND status = 'ACTIVE' AND is_active = 1").get(actor.companyId, s.username); if (!u) throw unprocessable(`${s.username} is not an active person of your company.`, [{ field: 'stewards', message: `${s.username} is unknown` }]); return { ...s, user: u }; });
      for (const t of masterTypes.list()) if (!users.some((s) => s.masterType === t.type)) throw unprocessable(`${t.label} needs at least one steward: someone has to approve its changes.`, [{ field: 'stewards', message: `no steward for ${t.label}` }]);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM mdm_quality_rules WHERE company_id = ? AND config_status = 'PENDING' UNION SELECT 1 FROM mdm_stewards WHERE company_id = ? AND config_status = 'PENDING'").get(actor.companyId, actor.companyId)) throw conflict('A change of the rules and stewards is already waiting for approval.');
        const v = Math.max(db.prepare('SELECT MAX(config_version) AS v FROM mdm_quality_rules WHERE company_id = ?').get(actor.companyId).v ?? 0, db.prepare('SELECT MAX(config_version) AS v FROM mdm_stewards WHERE company_id = ?').get(actor.companyId).v ?? 0) + 1;
        for (const r of b.rules) db.prepare("INSERT INTO mdm_quality_rules (company_id, config_version, master_type, field, rule, param, severity, active, config_status, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 'mdm_config')").run(actor.companyId, v, r.masterType, r.field, r.rule, r.param ?? null, r.severity, r.active ? 1 : 0, b.reason, actor.user);
        for (const s of users) db.prepare("INSERT INTO mdm_stewards (company_id, config_version, master_type, user_id, user_ref, steward_role, config_status, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 'mdm_config')").run(actor.companyId, v, s.masterType, s.user.id, s.user.username, s.role, b.reason, actor.user);
        writeAudit(db, { entity: 'mdm_config', entityId: v, action: 'propose', newValues: { rules: b.rules.length, stewards: users.map((s) => `${s.masterType}:${s.user.username}`) }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        const instance = engine().submit(actor, { docType: CONFIG_DOC, docId: v, comment: b.reason, context: {} });
        db.prepare('UPDATE mdm_quality_rules SET instance_id = ? WHERE company_id = ? AND config_version = ?').run(instance.id, actor.companyId, v);
        db.prepare('UPDATE mdm_stewards SET instance_id = ? WHERE company_id = ? AND config_version = ?').run(instance.id, actor.companyId, v);
        return { version: v, workflow: instance };
      });
    },
    activate(instance, actor) {
      const row = db.prepare('SELECT company_id FROM mdm_stewards WHERE config_version = ? AND instance_id = ? UNION SELECT company_id FROM mdm_quality_rules WHERE config_version = ? AND instance_id = ? LIMIT 1').get(Number(instance.docId), instance.id, Number(instance.docId), instance.id);
      if (!row) return;
      const now = nowIso();
      for (const table of ['mdm_quality_rules', 'mdm_stewards']) {
        db.prepare(`UPDATE ${table} SET config_status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND config_status = 'ACTIVE'`).run(actor.user, now, row.company_id);
        db.prepare(`UPDATE ${table} SET config_status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND config_version = ? AND config_status = 'PENDING'`).run(actor.user, now, row.company_id, Number(instance.docId));
      }
      writeAudit(db, { entity: 'mdm_config', entityId: Number(instance.docId), action: 'approve', actor: actor.user, companyId: row.company_id });
    },
    reject(instance, actor) { for (const table of ['mdm_quality_rules', 'mdm_stewards']) db.prepare(`UPDATE ${table} SET config_status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE config_version = ? AND instance_id = ? AND config_status = 'PENDING'`).run(actor.user, nowIso(), Number(instance.docId), instance.id); },
    export(actor) { const g = config.get(actor); return { exportedAt: nowIso(), version: g.version, rules: g.rules, stewards: g.stewards.map(({ masterType, username, role }) => ({ masterType, username, role })) }; },
  };

  // ---- the dashboard (FR-08) ----
  function dashboard(actor) {
    need(actor, 'mdm.governance.view', 'see the master data dashboard');
    const q = quality.summary(actor);
    const masters = masterTypes.list().map((t) => {
      const counts = Object.fromEntries(db.prepare('SELECT record_status AS s, COUNT(*) AS n FROM mdm_records WHERE company_id = ? AND master_type = ? AND is_active = 1 GROUP BY record_status').all(actor.companyId, t.type).map((r) => [r.s, r.n]));
      const pending = db.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM mdm_change_requests WHERE company_id = ? AND master_type = ? AND request_status IN ('PENDING', 'RETURNED') AND is_active = 1").get(actor.companyId, t.type);
      const dups = db.prepare("SELECT COUNT(*) AS n FROM mdm_duplicates WHERE company_id = ? AND master_type = ? AND duplicate_status = 'OPEN' AND is_active = 1").get(actor.companyId, t.type).n;
      const qs = q.rows.find((r) => r.type === t.type);
      const last30 = db.prepare("SELECT COUNT(*) AS n FROM mdm_change_requests WHERE company_id = ? AND master_type = ? AND created_at >= ? AND is_active = 1").get(actor.companyId, t.type, new Date(Date.now() - 30 * 86_400_000).toISOString()).n;
      return { type: t.type, label: t.label, active: counts.ACTIVE ?? 0, inactive: counts.INACTIVE ?? 0, submitted: counts.SUBMITTED ?? 0, merged: counts.MERGED ?? 0, pending: pending.n, oldestPendingHours: pending.oldest ? Math.floor((Date.now() - Date.parse(pending.oldest)) / 3_600_000) : null, duplicates: dups, score: qs?.score ?? null, below70: qs?.below70 ?? 0, stale: qs?.stale ?? 0, changes30d: last30, stewards: stewardsOf(actor.companyId, t.type).map((s) => s.username) };
    });
    const mine = requests.list(actor, { view: 'review' }).rows.filter((r) => r.status === 'PENDING' && !r.mine);
    const exceptions = [...masters.filter((m) => m.oldestPendingHours > 48).map((m) => ({ kind: 'OLD_REQUEST', text: `${m.label}: a change has waited ${Math.floor(m.oldestPendingHours / 24)} days`, link: `/admin/master-data/change-requests?type=${m.type}` })),
      ...masters.filter((m) => m.duplicates > 0).map((m) => ({ kind: 'DUPLICATES', text: `${m.label}: ${m.duplicates} possible duplicate(s)`, link: `/admin/master-data/duplicates?type=${m.type}` })),
      ...masters.filter((m) => m.below70 > 0).map((m) => ({ kind: 'QUALITY', text: `${m.label}: ${m.below70} record(s) score below 70`, link: `/admin/master-data/records?type=${m.type}&maxScore=69` })),
      ...masters.filter((m) => !m.stewards.length).map((m) => ({ kind: 'NO_STEWARD', text: `${m.label} has no steward: its changes go to the workflow administrators`, link: '/admin/master-data/quality' }))];
    return { masters, myPending: mine.slice(0, 10), exceptions, target: 90 };
  }

  /** The hourly job: versions whose date has come, records whose start date has come, duplicates of the day. */
  function cycle(companyId) {
    const out = { activated: 0, duplicates: 0 };
    for (const v of db.prepare("SELECT * FROM mdm_record_versions WHERE company_id = ? AND version_status = 'SCHEDULED' AND effective_from <= ? AND is_active = 1 ORDER BY effective_from, version_no").all(companyId, todayIST())) { transaction(db, () => activate(v)); out.activated += 1; }
    for (const t of masterTypes.list()) out.duplicates += scan(companyId, t.type);
    return out;
  }

  return { records, requests, decisions, duplicates, quality, config, dashboard, cycle, isSteward, stewardsOf, resolveId, versionAsOf, evaluate, rulesFor,
    /** For other modules: the record in force a reference points to, refused when it cannot be used in a new transaction (BR-02). */
    assertSelectable(actor, type, id) {
      const to = resolveId(actor.companyId, id);
      const r = db.prepare('SELECT * FROM mdm_records WHERE id = ? AND company_id = ? AND master_type = ?').get(to, actor.companyId, type);
      if (!r) throw notFound('That master record does not exist.');
      if (r.record_status !== 'ACTIVE') throw unprocessable(`${r.record_code} ${r.display_name} is ${r.record_status.toLowerCase()} and cannot be used in a new transaction.`);
      return { id: r.id, code: r.record_code, name: r.display_name, redirected: to !== id };
    },
  };
}

const services = new WeakMap();
export const bindService = (db, s) => services.set(db, s);
const bound = (db) => services.get(db);
// the stewards of the master of a request approve it; when there is none, the step goes to the workflow administrators (the engine's rule for an empty step)
if (!workflowResolvers.get('mdm.steward')) workflowResolvers.register('mdm.steward', ({ db, companyId, instance }) => db.prepare("SELECT u.username FROM mdm_stewards s JOIN iam_users u ON u.id = s.user_id WHERE s.company_id = ? AND s.master_type = ? AND s.config_status = 'ACTIVE' AND s.is_active = 1 AND u.status = 'ACTIVE'").all(companyId, instance.context?.masterType ?? '').map((r) => r.username));
const describeCr = (db, companyId, id) => { const r = db.prepare('SELECT c.*, m.record_code, m.display_name FROM mdm_change_requests c LEFT JOIN mdm_records m ON m.id = c.record_id WHERE c.id = ? AND c.company_id = ?').get(Number(id), companyId); return r ? { ref: `${masterTypes.get(r.master_type)?.label ?? r.master_type} ${r.record_code ?? ''} ${r.change_type.toLowerCase()}`.replace(/\s+/g, ' '), title: r.display_name ?? r.change_type, originator: r.requested_by } : null; };
const summariseCr = (db, actor, id) => {
  const r = db.prepare('SELECT * FROM mdm_change_requests WHERE id = ?').get(Number(id));
  if (!r) return null;
  const t = masterTypes.get(r.master_type);
  const ch = JSON.parse(r.change_json || '{}'); const be = JSON.parse(r.before_json || '{}');
  const s = bound(db);
  const sees = s ? authzOf(db).check(actor, 'mdm.sensitive.view').allowed || s.isSteward(actor, r.master_type) : false;
  const show = (f, v) => (f?.sensitive && !sees ? mask(v) : v);
  const rows = (t?.fields ?? []).filter((f) => f.key in ch && (r.change_type === 'CREATE' || ch[f.key] !== be[f.key])).map((f) => ({ field: f.label, before: show(f, be[f.key]) ?? '', after: show(f, ch[f.key]) ?? '' }));
  return { fields: [{ label: 'Master', value: t?.label ?? r.master_type }, { label: 'Change', value: r.change_type }, { label: 'From', value: r.effective_from ?? '' }, { label: 'Justification', value: r.justification }], lines: r.change_type === 'MERGE' ? undefined : { columns: [{ key: 'field', label: 'Field' }, { key: 'before', label: 'Now' }, { key: 'after', label: 'Asked for' }], rows } };
};
const hooks = (onApproved) => ({
  onApproved: (db, { instance, actor }) => onApproved(db, instance, actor),
  onRejected: (db, { instance, actor, comment }) => bound(db)?.decisions.ended(instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => bound(db)?.decisions.ended(instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => bound(db)?.decisions.ended(instance, actor, 'CANCELLED', comment),
});
const financial = { field: 'financial', op: 'eq', value: true };
workflowTypes.register({
  docType: CHANGE_DOC, label: 'Master data change', processOwner: 'SYSADM', route: () => '/admin/master-data/change-requests', describe: describeCr, summarise: summariseCr,
  defaultDefinition: { name: 'Master data change approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('STEWARD', 'Steward of the master', [{ kind: 'resolver', resolver: 'mdm.steward' }]), step('ACCMGR', 'Accounts manager (financial masters)', [{ kind: 'role', role: 'ACCMGR' }], financial)] },
  hooks: hooks((db, instance, actor) => bound(db)?.decisions.approved(instance, actor)),
});
workflowTypes.register({
  docType: MERGE_DOC, label: 'Merge of duplicate master records', processOwner: 'SYSADM', route: () => '/admin/master-data/duplicates', describe: describeCr, summarise: summariseCr,
  defaultDefinition: { name: 'Master data merge approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('STEWARD', 'Steward of the master', [{ kind: 'resolver', resolver: 'mdm.steward' }]), step('ACCMGR', 'Accounts manager (vendors and clients)', [{ kind: 'role', role: 'ACCMGR' }], financial)] },
  hooks: hooks((db, instance, actor) => bound(db)?.decisions.approved(instance, actor)),
});
workflowTypes.register({
  docType: CONFIG_DOC, label: 'Data quality rules and stewards change', processOwner: 'SYSADM', route: () => '/admin/master-data/quality',
  describe(db, companyId, id) { const r = db.prepare('SELECT created_by FROM mdm_stewards WHERE company_id = ? AND config_version = ? UNION SELECT created_by FROM mdm_quality_rules WHERE company_id = ? AND config_version = ? LIMIT 1').get(companyId, Number(id), companyId, Number(id)); return r ? { ref: `Master data rules version ${id}`, title: 'Change of the data quality rules and the stewards', originator: r.created_by } : null; },
  summarise(db, actor, id) { const n = db.prepare('SELECT COUNT(*) AS n FROM mdm_quality_rules WHERE company_id = ? AND config_version = ?').get(actor.companyId, Number(id)).n; const st = db.prepare('SELECT master_type, user_ref, steward_role FROM mdm_stewards WHERE company_id = ? AND config_version = ?').all(actor.companyId, Number(id)); return { fields: [{ label: 'Rules', value: n }, ...st.map((s) => ({ label: `Steward of ${masterTypes.get(s.master_type)?.label ?? s.master_type}`, value: `${s.user_ref} (${s.steward_role.toLowerCase()})` }))] }; },
  defaultDefinition: { name: 'Master data rules approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('CHECK', 'IT administrator or director', [{ kind: 'role', role: 'ITADM|DIR' }])] },
  hooks: { onApproved: (db, { instance, actor }) => bound(db)?.config.activate(instance, actor), onRejected: (db, { instance, actor }) => bound(db)?.config.reject(instance, actor), onReturned: (db, { instance, actor }) => bound(db)?.config.reject(instance, actor), onCancelled: (db, { instance, actor }) => bound(db)?.config.reject(instance, actor) },
});
for (const doc of [CHANGE_DOC, MERGE_DOC]) {
  evidenceProviders.register(doc, ({ db, instance }) => {
    const r = db.prepare('SELECT * FROM mdm_change_requests WHERE id = ?').get(Number(instance.docId));
    if (!r) return { sections: [] };
    const dups = JSON.parse(r.duplicates_json || '[]');
    const t = masterTypes.get(r.master_type);
    const s = bound(db);
    const after = JSON.parse(r.change_json || '{}');
    const q = s && t && r.change_type !== 'MERGE' ? s.evaluate(t, s.rulesFor(r.company_id, r.master_type), after, { lastChangedAt: new Date().toISOString() }) : null;
    return { sections: [{ code: 'mdm', title: 'What the approver checks', kind: 'metrics', items: [{ label: 'Possible duplicates', value: dups.length ? dups.map((d) => `${d.code} ${d.name} (${(d.rules ?? [d.rule]).join(', ')})`).join('; ') : 'None found', format: 'text', tone: dups.length ? 'warn' : undefined }, { label: 'Data quality score after the change', value: q ? q.score : '—', format: 'text', tone: q && q.score < 70 ? 'warn' : undefined }, { label: 'Sensitive fields changed', value: r.sensitive ? 'Yes' : 'No', format: 'text' }] }] };
  });
}
