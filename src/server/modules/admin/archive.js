import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport } from '../../platform/export/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/index.js';

// integrity: the workflow states of this part's tables (the Data Health check)
integrityRegistry.register({ statuses: { 'arc_policies': ['ACTIVE', 'RETIRED'], 'arc_jobs': ['SUBMITTED', 'DONE', 'REJECTED'], 'arc_disposals': ['SUBMITTED', 'DONE', 'REJECTED'], 'arc_erasures': ['SUBMITTED', 'REFUSED', 'REJECTED', 'DONE'] } });

/**
 * Part 29.07 — data retention and archival.
 *
 * A retention policy names a record class, when its finished records are archived (months after their date, or once their project is
 * closed), how many years they are kept, the legal basis and what happens after (DISPOSE, ANONYMISE or REVIEW). An archival job (SYSADM →
 * AUD) takes the eligible records of a class: each is copied with its SHA-256 into the archive (arc_records and a compressed file per job in
 * archive storage) and becomes read-only: a database trigger refuses any change or deletion of an archived row, while its id, references and
 * search entries stay in place, so links and search keep working. An archived record is viewed with its snapshot, checksum, job, policy,
 * holds and audit trail.
 *
 * A legal hold on a record, or on a project (covering its records), keeps it out of every job and disposal (BR-01). After the retention
 * period a disposal proposal (AUD → DIR) deletes the records (or anonymises them where other records still refer to them, or where the policy
 * says so), clears their archive copy and issues a certificate of destruction with its hash. A personal data erasure request (DPDP Act) is
 * checked (subject exists, not active, no legal hold, statutory retention elapsed), approved by DIR and executed by redacting the personal
 * fields.
 */
export const ARCHIVE_FLAG = 'ff.admin.p2907';
export const ARCHIVE_JOB = 'arc_archival_job';
export const DISPOSAL = 'arc_disposal';
export const ERASURE = 'arc_erasure';
const DAY = 86_400_000;
const iso = (d = new Date()) => d.toISOString();
const sha = (s) => createHash('sha256').update(s).digest('hex');
integrityRegistry.register({ technicalTables: ['arc_bypass'] });

/** The archivable record classes: their table, date, project, finished statuses and personal fields. */
export const CLASSES = Object.freeze({
  'site.dpr': { label: 'Daily progress reports', table: 'site_dprs', date: 'dpr_date', project: 'org_project_id', statusColumn: 'status', done: ['APPROVED', 'CANCELLED', 'SUPERSEDED'], ref: 'doc_no', personal: [] },
  'fin.journal': { label: 'Journals', table: 'fin_journals', date: 'voucher_date', project: 'project_id', statusColumn: 'status', done: ['APPROVED', 'CANCELLED', 'REJECTED'], ref: 'doc_no', personal: [] },
  'proc.po': { label: 'Purchase orders', table: 'proc_purchase_orders', date: 'doc_date', project: 'org_project_id', statusColumn: 'status', done: ['CLOSED', 'CANCELLED'], ref: 'doc_no', personal: [] },
  'hr.employee': { label: 'Former employees', table: 'hr_employees', date: 'last_working_date', project: 'project_id', statusColumn: 'employment_status', done: ['SEPARATED', 'ABSCONDING'], ref: 'emp_code', personal: ['mobile', 'email', 'permanent_address', 'current_address', 'dob'] },
});
const ERASABLE = { mobile: '0000000000', email: null, permanent_address: '[erased]', current_address: '[erased]', dob: '1900-01-01' };

const services = new WeakMap();
export const archiveOf = (db) => services.get(db) ?? null;

/** @param {any} context @param {{ storagePath: string }} deps */
export function createArchiveService(context, { storagePath }) {
  const { db } = context;
  const store = join(storagePath, 'archive');
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, ARCHIVE_FLAG)) throw notFound('Retention and archival are not enabled for this company.');
    if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`);
  };
  const cls = (code) => { const c = CLASSES[code]; if (!c) throw unprocessable(`Unknown record class ${code}.`); return c; };
  const policyOf = (companyId, code) => db.prepare("SELECT * FROM arc_policies WHERE company_id = ? AND record_class = ? AND status = 'ACTIVE' AND deleted_at IS NULL").get(companyId, code);
  /** Run with the read-only triggers lifted (disposal, erasure), inside the caller's transaction. */
  const bypass = (fn) => { db.prepare('INSERT INTO arc_bypass (token) VALUES (1)').run(); try { return fn(); } finally { db.prepare('DELETE FROM arc_bypass').run(); } };

  // ---------------------------------------------------------------- legal holds (FR-04, BR-01)
  const heldSql = (c) => `EXISTS (SELECT 1 FROM arc_holds h WHERE h.company_id = r.company_id AND h.released_at IS NULL AND ((h.entity = '${c.table}' AND h.entity_id = r.id) OR (h.entity = 'org_projects' AND h.entity_id = r.${c.project})))`;
  const isHeld = (companyId, entity, id, projectId) => Boolean(db.prepare("SELECT 1 FROM arc_holds WHERE company_id = ? AND released_at IS NULL AND ((entity = ? AND entity_id = ?) OR (entity = 'org_projects' AND entity_id = ?))").get(companyId, entity, id, projectId ?? -1));
  const holdView = (h) => ({ id: h.id, entity: h.entity, entityId: h.entity_id, label: h.label, reason: h.reason, placedBy: h.placed_by, placedAt: h.created_at, releasedAt: h.released_at, releasedBy: h.released_by });
  const holds = {
    list(actor, { active = true } = {}) { guard(actor, 'adm.archive.view'); return { rows: db.prepare(`SELECT * FROM arc_holds WHERE company_id = ? ${active ? 'AND released_at IS NULL' : ''} ORDER BY id DESC LIMIT 500`).all(actor.companyId).map(holdView), canHold: hasPermissionAnywhere(actor, 'adm.archive.hold') }; },
    place(actor, { entity, entityId, reason }) {
      guard(actor, 'adm.archive.hold');
      const table = entity === 'org_projects' ? 'org_projects' : cls(entity).table;
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`).get(entityId, actor.companyId); if (!row) throw notFound('That record does not exist.');
      if (db.prepare('SELECT 1 FROM arc_holds WHERE company_id = ? AND entity = ? AND entity_id = ? AND released_at IS NULL').get(actor.companyId, table, entityId)) throw conflict('That record is already on hold.');
      const label = entity === 'org_projects' ? `Project ${row.code ?? row.id} ${row.name ?? ''}`.trim() : `${CLASSES[entity].label}: ${row[CLASSES[entity].ref] ?? row.id}`;
      const id = Number(db.prepare("INSERT INTO arc_holds (company_id, entity, entity_id, label, reason, placed_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'legal_hold')").run(actor.companyId, table, entityId, label, reason, actor.user, actor.user).lastInsertRowid);
      writeAudit(db, { companyId: actor.companyId, entity: 'arc_holds', entityId: String(id), action: 'place', actor: actor.user, newValues: { entity: table, entityId, reason } });
      publishEvent(db, { type: 'admin.legal_hold.placed', entity: 'arc_holds', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { entity: table, entityId } });
      return holdView(db.prepare('SELECT * FROM arc_holds WHERE id = ?').get(id));
    },
    release(actor, id, { reason }) {
      guard(actor, 'adm.archive.hold');
      const h = db.prepare('SELECT * FROM arc_holds WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!h) throw notFound('That hold does not exist.'); if (h.released_at) throw conflict('The hold is already released.');
      db.prepare('UPDATE arc_holds SET released_at = ?, released_by = ?, release_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(iso(), actor.user, reason, actor.user, iso(), h.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'arc_holds', entityId: String(h.id), action: 'release', actor: actor.user, newValues: { reason } });
      return holdView(db.prepare('SELECT * FROM arc_holds WHERE id = ?').get(h.id));
    },
  };

  // ---------------------------------------------------------------- policies (FR-01)
  const polView = (p) => ({ id: p.id, recordClass: p.record_class, label: CLASSES[p.record_class]?.label ?? p.record_class, archiveAfterMonths: p.archive_after_months, retentionYears: p.retention_years, legalBasis: p.legal_basis, actionAfter: p.action_after, by: p.created_by, updatedAt: p.updated_at ?? p.created_at });
  const policies = {
    list(actor) {
      guard(actor, 'adm.archive.view');
      const rows = db.prepare("SELECT * FROM arc_policies WHERE company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL ORDER BY record_class").all(actor.companyId).map(polView);
      return { rows, classes: Object.entries(CLASSES).map(([code, c]) => ({ code, label: c.label, personal: c.personal.length > 0, policy: rows.find((r) => r.recordClass === code) ?? null })), canManage: hasPermissionAnywhere(actor, 'adm.archive.manage'), canDispose: hasPermissionAnywhere(actor, 'adm.archive.dispose') };
    },
    /** A policy is replaced by a new one (the old is kept, retired) so the history of what applied stays. */
    set(actor, { recordClass, archiveAfterMonths, retentionYears, legalBasis, actionAfter }) {
      guard(actor, 'adm.archive.manage'); cls(recordClass);
      if (archiveAfterMonths > retentionYears * 12) throw unprocessable('A record is archived before its retention ends.');
      return transaction(db, () => {
        const old = policyOf(actor.companyId, recordClass);
        if (old) db.prepare("UPDATE arc_policies SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), old.id);
        const id = Number(db.prepare("INSERT INTO arc_policies (company_id, record_class, archive_after_months, retention_years, legal_basis, action_after, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 'retention_policy')").run(actor.companyId, recordClass, archiveAfterMonths, retentionYears, legalBasis, actionAfter, actor.user).lastInsertRowid);
        writeAudit(db, { companyId: actor.companyId, entity: 'arc_policies', entityId: String(id), action: old ? 'replace' : 'create', actor: actor.user, oldValues: old ? polView(old) : null, newValues: { recordClass, archiveAfterMonths, retentionYears, legalBasis, actionAfter } });
        return polView(db.prepare('SELECT * FROM arc_policies WHERE id = ?').get(id));
      });
    },
  };

  // ---------------------------------------------------------------- archival jobs (FR-02)
  /** The records a job would take: finished, not archived, past the archive age (or in a closed project), not on hold. */
  function eligible(companyId, code, { closedProjectsOnly = false, before = null } = {}) {
    const c = cls(code); const p = policyOf(companyId, code); if (!p) throw unprocessable(`${c.label} has no retention policy yet.`);
    const cutoff = before ?? iso(new Date(Date.now() - p.archive_after_months * 30.44 * DAY)).slice(0, 10);
    const where = `r.company_id = ? AND r.deleted_at IS NULL AND r.${c.statusColumn} IN (${c.done.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM arc_records a WHERE a.entity = '${c.table}' AND a.entity_id = r.id)
      AND (${closedProjectsOnly ? `r.${c.project} IN (SELECT id FROM org_projects WHERE company_id = r.company_id AND status = 'CLOSED')` : `COALESCE(r.${c.date}, substr(r.created_at, 1, 10)) <= ?`})`;
    const params = [companyId, ...c.done, ...(closedProjectsOnly ? [] : [cutoff])];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ${c.table} r WHERE ${where}`).get(...params).n;
    const held = db.prepare(`SELECT COUNT(*) AS n FROM ${c.table} r WHERE ${where} AND ${heldSql(c)}`).get(...params).n;
    return { c, p, cutoff, where: `${where} AND NOT ${heldSql(c)}`, params, total, held, eligible: total - held };
  }
  const engine = createApprovalEngine({ db, handlers: {
    [ARCHIVE_JOB]: { authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); }, apply(_db, request, actor) { runJob(request.payload.jobId, actor); } },
    [DISPOSAL]: { authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); }, apply(_db, request, actor) { runDisposal(request.payload.disposalId, actor); } },
    [ERASURE]: { authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); }, apply(_db, request, actor) { runErasure(request.payload.erasureId, actor); } },
  } });
  const jobView = (j, mine = new Set()) => ({ id: j.id, recordClass: j.record_class, label: CLASSES[j.record_class]?.label, scope: JSON.parse(j.scope_json), records: j.records, held: j.held, status: j.status, requestId: j.request_id, canApprove: mine.has(j.request_id), approvedBy: j.approved_by, executedAt: j.executed_at, file: j.file_name, fileSha256: j.file_sha256, by: j.created_by, createdAt: j.created_at });
  function runJob(id, actor) {
    const j = db.prepare('SELECT * FROM arc_jobs WHERE id = ?').get(id); const scope = JSON.parse(j.scope_json);
    const e = eligible(j.company_id, j.record_class, scope);
    const rows = db.prepare(`SELECT r.* FROM ${e.c.table} r WHERE ${e.where} ORDER BY r.id LIMIT 50000`).all(...e.params);
    const ins = db.prepare("INSERT INTO arc_records (company_id, record_class, entity, entity_id, ref, project_ref, record_date, payload_json, payload_sha256, job_id, archived_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'archival_job')");
    const lines = [];
    for (const r of rows) { const payload = JSON.stringify(r); const h = sha(payload); ins.run(j.company_id, j.record_class, e.c.table, r.id, String(r[e.c.ref] ?? r.id), r[e.c.project] ?? null, r[e.c.date] ?? String(r.created_at).slice(0, 10), payload, h, j.id, iso(), actor.user); lines.push(JSON.stringify({ entity: e.c.table, id: r.id, sha256: h, row: r })); }
    mkdirSync(store, { recursive: true });
    const name = `c${j.company_id}-job-${j.id}-${j.record_class}.jsonl.gz`; const gz = gzipSync(Buffer.from(lines.join('\n')));
    writeFileSync(join(store, name), gz);
    db.prepare("UPDATE arc_jobs SET status = 'DONE', records = ?, held = ?, approved_by = ?, executed_at = ?, file_name = ?, file_sha256 = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(rows.length, e.held, actor.user, iso(), name, sha(gz), iso(), j.id);
    writeAudit(db, { companyId: j.company_id, entity: 'arc_jobs', entityId: String(j.id), action: 'archive', actor: actor.user, newValues: { records: rows.length, held: e.held } });
    publishEvent(db, { type: 'admin.archive.completed', entity: 'arc_jobs', entityId: j.id, actorId: actor.user, companyId: j.company_id, data: { recordClass: j.record_class, records: rows.length, held: e.held } });
  }
  const jobs = {
    list(actor) { guard(actor, 'adm.archive.view'); const mine = new Set(engine.awaiting(actor).map((x) => x.id)); return { rows: db.prepare('SELECT * FROM arc_jobs WHERE company_id = ? ORDER BY id DESC LIMIT 200').all(actor.companyId).map((j) => jobView(j, mine)) }; },
    preview(actor, { recordClass, closedProjectsOnly = false, before = null }) { guard(actor, 'adm.archive.view'); const e = eligible(actor.companyId, recordClass, { closedProjectsOnly, before }); return { recordClass, cutoff: closedProjectsOnly ? null : e.cutoff, total: e.total, held: e.held, eligible: e.eligible }; },
    /** FR-02 SYSADM raises a job; AUD approves; the archive runs on the approval. */
    create(actor, { recordClass, closedProjectsOnly = false, before = null, reason }) {
      guard(actor, 'adm.archive.manage');
      const e = eligible(actor.companyId, recordClass, { closedProjectsOnly, before });
      if (!e.eligible) throw unprocessable(`No ${e.c.label.toLowerCase()} are due for archival${e.held ? ` (${e.held} on legal hold)` : ''}.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO arc_jobs (company_id, record_class, scope_json, records, held, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'SUBMITTED', ?, 'archival_job')").run(actor.companyId, recordClass, JSON.stringify({ closedProjectsOnly, before: closedProjectsOnly ? null : e.cutoff }), e.eligible, e.held, actor.user).lastInsertRowid);
        const req = engine.submit(actor, { type: ARCHIVE_JOB, title: `Archive ${e.eligible} ${e.c.label.toLowerCase()}`, targetType: 'arc_jobs', targetId: String(id), payload: { jobId: id }, reason, chain: ['AUD'] });
        db.prepare('UPDATE arc_jobs SET request_id = ? WHERE id = ?').run(req.id, id);
        return jobView(db.prepare('SELECT * FROM arc_jobs WHERE id = ?').get(id));
      });
    },
    decide(actor, id, body) {
      guard(actor, 'adm.archive.view');
      const j = db.prepare('SELECT * FROM arc_jobs WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!j || j.status !== 'SUBMITTED') throw conflict('The job is not waiting for approval.');
      const out = engine.act(actor, j.request_id, body);
      if (out.status === 'REJECTED' || out.status === 'RETURNED') db.prepare("UPDATE arc_jobs SET status = 'REJECTED', updated_by = ?, updated_at = ? WHERE id = ?").run(actor.user, iso(), j.id);
      return jobView(db.prepare('SELECT * FROM arc_jobs WHERE id = ?').get(j.id));
    },
  };

  // ---------------------------------------------------------------- the archive (FR-03)
  const recView = (a) => ({ id: a.id, recordClass: a.record_class, label: CLASSES[a.record_class]?.label, entity: a.entity, entityId: a.entity_id, ref: a.ref, projectId: a.project_ref, recordDate: a.record_date, archivedAt: a.archived_at, jobId: a.job_id, disposedAt: a.disposed_at, disposal: a.disposal_action });
  const archive = {
    search(actor, { recordClass = null, q = null, page = 1, pageSize = 25 } = {}) {
      guard(actor, 'adm.archive.view');
      const where = ['company_id = ?']; const p = [actor.companyId];
      if (recordClass) { where.push('record_class = ?'); p.push(recordClass); } if (q) { where.push("ref LIKE ? ESCAPE '\\'"); p.push(`%${String(q).replace(/[\\%_]/g, '\\$&')}%`); }
      const sql = where.join(' AND ');
      return { rows: db.prepare(`SELECT * FROM arc_records WHERE ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (page - 1) * pageSize).map(recView), total: db.prepare(`SELECT COUNT(*) AS n FROM arc_records WHERE ${sql}`).get(...p).n, page, pageSize };
    },
    /** An archived record with its snapshot (checked against its hash), job, policy, holds and audit trail; the view is audited. */
    get(actor, id) {
      guard(actor, 'adm.archive.view');
      const a = db.prepare('SELECT * FROM arc_records WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!a) throw notFound('That archived record does not exist.');
      const c = CLASSES[a.record_class];
      const payload = a.payload_json ? JSON.parse(a.payload_json) : null;
      const masked = payload && c.personal.length && !hasPermissionAnywhere(actor, 'adm.archive.dispose') ? Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, c.personal.includes(k) && v ? '••••' : v])) : payload;
      writeAudit(db, { companyId: actor.companyId, entity: 'arc_records', entityId: String(a.id), action: 'view', actor: actor.user });
      return { ...recView(a), payload: masked, intact: a.payload_json ? sha(a.payload_json) === a.payload_sha256 : null, sha256: a.payload_sha256, readOnly: true, held: isHeld(actor.companyId, a.entity, a.entity_id, a.project_ref),
        job: jobView(db.prepare('SELECT * FROM arc_jobs WHERE id = ?').get(a.job_id)), policy: polView(policyOf(actor.companyId, a.record_class) ?? {}),
        trail: db.prepare('SELECT action, actor, created_at, reason FROM core_audit_log WHERE entity = ? AND entity_id = ? ORDER BY id').all(a.entity, String(a.entity_id)).map((x) => ({ action: x.action, actor: x.actor, at: x.created_at, reason: x.reason })) };
    },
  };

  // ---------------------------------------------------------------- disposal (FR-05)
  const disView = (d, mine = new Set()) => ({ id: d.id, recordClass: d.record_class, label: CLASSES[d.record_class]?.label, records: d.records, held: d.held, action: d.action_after, status: d.status, requestId: d.request_id, canApprove: mine.has(d.request_id), certificateNo: d.certificate_no, certificateSha256: d.certificate_sha256, disposed: d.disposed, anonymised: d.anonymised, executedAt: d.executed_at, by: d.created_by, createdAt: d.created_at });
  const expiredWhere = (companyId, code, p) => ({ sql: `a.company_id = ? AND a.record_class = ? AND a.disposed_at IS NULL AND a.record_date <= ? AND NOT EXISTS (SELECT 1 FROM arc_holds h WHERE h.company_id = a.company_id AND h.released_at IS NULL AND ((h.entity = a.entity AND h.entity_id = a.entity_id) OR (h.entity = 'org_projects' AND h.entity_id = a.project_ref)))`, params: [companyId, code, iso(new Date(Date.now() - p.retention_years * 365.25 * DAY)).slice(0, 10)] });
  function runDisposal(id, actor) {
    const d = db.prepare('SELECT * FROM arc_disposals WHERE id = ?').get(id); const c = CLASSES[d.record_class]; const p = policyOf(d.company_id, d.record_class);
    const w = expiredWhere(d.company_id, d.record_class, p);
    const recs = db.prepare(`SELECT a.* FROM arc_records a WHERE ${w.sql} AND a.id IN (SELECT value FROM json_each(?))`).all(...w.params, d.record_ids_json);
    let disposed = 0; let anonymised = 0; const items = [];
    bypass(() => {
      for (const a of recs) {
        let how = d.action_after;
        if (how === 'DISPOSE') {
          db.exec('SAVEPOINT arc_del');
          try { db.prepare(`DELETE FROM ${c.table} WHERE id = ? AND company_id = ?`).run(a.entity_id, d.company_id); db.exec('RELEASE arc_del'); disposed += 1; } catch { db.exec('ROLLBACK TO arc_del'); db.exec('RELEASE arc_del'); how = 'ANONYMISE'; }
        }
        if (how === 'ANONYMISE') {
          const sets = c.personal.filter((k) => k in ERASABLE);
          db.prepare(`UPDATE ${c.table} SET ${[...sets.map((k) => `${k} = ?`), 'deleted_at = ?', 'deleted_by = ?'].join(', ')} WHERE id = ? AND company_id = ?`).run(...sets.map((k) => ERASABLE[k]), iso(), actor.user, a.entity_id, d.company_id); anonymised += 1;
        }
        db.prepare('UPDATE arc_records SET payload_json = NULL, disposed_at = ?, disposal_action = ?, disposal_id = ? WHERE id = ?').run(iso(), how, d.id, a.id);
        items.push({ ref: a.ref, entity: a.entity, id: String(a.entity_id), date: a.record_date, how, sha256: a.payload_sha256 });
      }
    });
    const certNo = `COD-${d.company_id}-${String(d.id).padStart(5, '0')}`;
    const cert = writeExport('pdf', { title: `Certificate of destruction ${certNo}`, sheetName: 'Certificate', columns: [['ref', 'Record'], ['entity', 'Table'], ['id', 'Id'], ['date', 'Record date'], ['how', 'Action'], ['sha256', 'Archive hash']].map(([key, label]) => ({ key, label })), rows: items,
      footer: [`${c.label}: ${items.length} record(s) past ${p.retention_years} years (${p.legal_basis}). Approved by ${actor.user} on ${iso().slice(0, 10)}. Records on legal hold were excluded.`] });
    mkdirSync(store, { recursive: true }); writeFileSync(join(store, `${certNo}.pdf`), cert);
    db.prepare("UPDATE arc_disposals SET status = 'DONE', disposed = ?, anonymised = ?, certificate_no = ?, certificate_sha256 = ?, executed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(disposed, anonymised, certNo, sha(cert), iso(), iso(), d.id);
    writeAudit(db, { companyId: d.company_id, entity: 'arc_disposals', entityId: String(d.id), action: 'dispose', actor: actor.user, newValues: { disposed, anonymised, certificate: certNo } });
    publishEvent(db, { type: 'admin.disposal.completed', entity: 'arc_disposals', entityId: d.id, actorId: actor.user, companyId: d.company_id, data: { recordClass: d.record_class, disposed, anonymised } });
  }
  const disposals = {
    list(actor) { guard(actor, 'adm.archive.view'); const mine = new Set(engine.awaiting(actor).map((x) => x.id)); return { rows: db.prepare('SELECT * FROM arc_disposals WHERE company_id = ? ORDER BY id DESC LIMIT 200').all(actor.companyId).map((d) => disView(d, mine)) }; },
    /** AUD proposes disposing the archived records past their retention; DIR approves. */
    propose(actor, { recordClass, reason }) {
      guard(actor, 'adm.archive.dispose');
      const c = cls(recordClass); const p = policyOf(actor.companyId, recordClass); if (!p) throw unprocessable(`${c.label} has no retention policy.`);
      if (p.action_after === 'REVIEW') throw unprocessable(`The policy of ${c.label.toLowerCase()} says REVIEW: change it before disposing.`);
      const w = expiredWhere(actor.companyId, recordClass, p);
      const ids = db.prepare(`SELECT a.id FROM arc_records a WHERE ${w.sql} ORDER BY a.id LIMIT 50000`).all(...w.params).map((r) => r.id);
      const held = db.prepare('SELECT COUNT(*) AS n FROM arc_records a WHERE a.company_id = ? AND a.record_class = ? AND a.disposed_at IS NULL AND a.record_date <= ?').get(...w.params).n - ids.length;
      if (!ids.length) throw unprocessable(`No archived ${c.label.toLowerCase()} are past their ${p.retention_years}-year retention${held ? ` (${held} on legal hold)` : ''}.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO arc_disposals (company_id, record_class, record_ids_json, records, held, action_after, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, 'disposal')").run(actor.companyId, recordClass, JSON.stringify(ids), ids.length, held, p.action_after, actor.user).lastInsertRowid);
        const req = engine.submit(actor, { type: DISPOSAL, title: `Dispose of ${ids.length} ${c.label.toLowerCase()} (${p.action_after.toLowerCase()})`, targetType: 'arc_disposals', targetId: String(id), payload: { disposalId: id }, reason, chain: ['DIR'] });
        db.prepare('UPDATE arc_disposals SET request_id = ? WHERE id = ?').run(req.id, id);
        return disView(db.prepare('SELECT * FROM arc_disposals WHERE id = ?').get(id));
      });
    },
    decide(actor, id, body) {
      guard(actor, 'adm.archive.view');
      const d = db.prepare('SELECT * FROM arc_disposals WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!d || d.status !== 'SUBMITTED') throw conflict('The disposal is not waiting for approval.');
      const out = engine.act(actor, d.request_id, body);
      if (out.status === 'REJECTED' || out.status === 'RETURNED') db.prepare("UPDATE arc_disposals SET status = 'REJECTED', updated_by = ?, updated_at = ? WHERE id = ?").run(actor.user, iso(), d.id);
      return disView(db.prepare('SELECT * FROM arc_disposals WHERE id = ?').get(d.id));
    },
    certificate(actor, id) {
      guard(actor, 'adm.archive.view');
      const d = db.prepare('SELECT * FROM arc_disposals WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!d?.certificate_no) throw notFound('That disposal has no certificate.');
      const file = join(store, `${d.certificate_no}.pdf`);
      writeAudit(db, { companyId: actor.companyId, entity: 'arc_disposals', entityId: String(d.id), action: 'certificate', actor: actor.user });
      return { file, fileName: `${d.certificate_no}.pdf`, contentType: 'application/pdf' };
    },
  };

  // ---------------------------------------------------------------- personal data erasure (DPDP)
  const erView = (e, mine = new Set()) => ({ id: e.id, subjectType: e.subject_type, subjectId: e.subject_id, subject: e.subject_label, basis: e.basis, checks: JSON.parse(e.checks_json), status: e.status, requestId: e.request_id, canApprove: mine.has(e.request_id), executedAt: e.executed_at, fields: e.fields_json ? JSON.parse(e.fields_json) : [], by: e.created_by, createdAt: e.created_at });
  function checksOf(companyId, id) {
    const c = CLASSES['hr.employee']; const r = db.prepare('SELECT * FROM hr_employees WHERE id = ? AND company_id = ?').get(id, companyId);
    if (!r) return { r: null, checks: [{ check: 'The person exists', ok: false, detail: 'No such employee.' }] };
    const years = Number(context.statutoryYears ?? 8);
    const left = r.last_working_date ? (Date.now() - Date.parse(r.last_working_date)) / (365.25 * DAY) : 0;
    const checks = [
      { check: 'The person exists', ok: true, detail: `${r.emp_code} ${r.full_name ?? ''}`.trim() },
      { check: 'No longer employed', ok: c.done.includes(r.employment_status), detail: r.employment_status },
      { check: 'No legal hold', ok: !isHeld(companyId, 'hr_employees', r.id, r.project_id), detail: isHeld(companyId, 'hr_employees', r.id, r.project_id) ? 'A legal hold covers this person.' : 'None' },
      { check: `Statutory retention (${years} years after leaving: payroll, PF, ESI, tax)`, ok: left >= years, detail: r.last_working_date ? `Left on ${r.last_working_date} (${left.toFixed(1)} years)` : 'No leaving date' },
    ];
    return { r, checks };
  }
  function runErasure(id, actor) {
    const e = db.prepare('SELECT * FROM arc_erasures WHERE id = ?').get(id);
    const { r, checks } = checksOf(e.company_id, e.subject_id);
    if (!r || !checks.every((x) => x.ok)) { db.prepare("UPDATE arc_erasures SET status = 'REFUSED', checks_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(checks), iso(), e.id); return; }
    const fields = CLASSES['hr.employee'].personal;
    bypass(() => db.prepare(`UPDATE hr_employees SET ${fields.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...fields.map((k) => ERASABLE[k]), r.id));
    db.prepare("UPDATE arc_records SET payload_json = NULL, disposal_action = 'ERASED', disposed_at = ? WHERE entity = 'hr_employees' AND entity_id = ? AND company_id = ?").run(iso(), r.id, e.company_id);
    db.prepare("UPDATE arc_erasures SET status = 'DONE', executed_at = ?, fields_json = ?, checks_json = ?, updated_at = ? WHERE id = ?").run(iso(), JSON.stringify(fields), JSON.stringify(checks), iso(), e.id);
    writeAudit(db, { companyId: e.company_id, entity: 'hr_employees', entityId: String(r.id), action: 'personal_data_erased', actor: actor.user, newValues: { fields, request: e.id } });
  }
  const erasures = {
    list(actor) { guard(actor, 'adm.archive.view'); const mine = new Set(engine.awaiting(actor).map((x) => x.id)); return { rows: db.prepare('SELECT * FROM arc_erasures WHERE company_id = ? ORDER BY id DESC LIMIT 200').all(actor.companyId).map((e) => erView(e, mine)) }; },
    check(actor, subjectId) { guard(actor, 'adm.archive.dispose'); return checksOf(actor.companyId, subjectId).checks; },
    /** A request from the person (data principal) under the DPDP Act: refused at once when a check fails, else sent to DIR. */
    request(actor, { subjectId, basis, reason }) {
      guard(actor, 'adm.archive.dispose');
      const { r, checks } = checksOf(actor.companyId, subjectId);
      return transaction(db, () => {
        const ok = Boolean(r) && checks.every((x) => x.ok);
        const id = Number(db.prepare("INSERT INTO arc_erasures (company_id, subject_type, subject_id, subject_label, basis, checks_json, status, created_by, source_type) VALUES (?, 'EMPLOYEE', ?, ?, ?, ?, ?, ?, 'dpdp_request')").run(actor.companyId, subjectId, r ? `${r.emp_code} ${r.full_name ?? ''}`.trim() : String(subjectId), basis, JSON.stringify(checks), ok ? 'SUBMITTED' : 'REFUSED', actor.user).lastInsertRowid);
        if (ok) { const req = engine.submit(actor, { type: ERASURE, title: `Erase personal data of ${r.emp_code}`, targetType: 'arc_erasures', targetId: String(id), payload: { erasureId: id }, reason, chain: ['DIR'] }); db.prepare('UPDATE arc_erasures SET request_id = ? WHERE id = ?').run(req.id, id); }
        writeAudit(db, { companyId: actor.companyId, entity: 'arc_erasures', entityId: String(id), action: 'request', actor: actor.user, newValues: { subjectId, basis, ok } });
        return erView(db.prepare('SELECT * FROM arc_erasures WHERE id = ?').get(id));
      });
    },
    decide(actor, id, body) {
      guard(actor, 'adm.archive.view');
      const e = db.prepare('SELECT * FROM arc_erasures WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!e || e.status !== 'SUBMITTED') throw conflict('The request is not waiting for approval.');
      const out = engine.act(actor, e.request_id, body);
      if (out.status === 'REJECTED' || out.status === 'RETURNED') db.prepare("UPDATE arc_erasures SET status = 'REJECTED', updated_by = ?, updated_at = ? WHERE id = ?").run(actor.user, iso(), e.id);
      return erView(db.prepare('SELECT * FROM arc_erasures WHERE id = ?').get(e.id));
    },
  };

  /** FR-01 report: by class, the live, archived, disposed and held counts. */
  function report(actor) {
    guard(actor, 'adm.archive.view');
    return { rows: Object.entries(CLASSES).map(([code, c]) => ({ recordClass: code, label: c.label, live: db.prepare(`SELECT COUNT(*) AS n FROM ${c.table} WHERE company_id = ? AND deleted_at IS NULL`).get(actor.companyId).n,
      archived: db.prepare('SELECT COUNT(*) AS n FROM arc_records WHERE company_id = ? AND record_class = ? AND disposed_at IS NULL').get(actor.companyId, code).n, disposed: db.prepare('SELECT COUNT(*) AS n FROM arc_records WHERE company_id = ? AND record_class = ? AND disposed_at IS NOT NULL').get(actor.companyId, code).n,
      held: db.prepare('SELECT COUNT(*) AS n FROM arc_holds WHERE company_id = ? AND entity = ? AND released_at IS NULL').get(actor.companyId, c.table).n, policy: policyOf(actor.companyId, code) ? polView(policyOf(actor.companyId, code)) : null })),
      projectHolds: db.prepare("SELECT COUNT(*) AS n FROM arc_holds WHERE company_id = ? AND entity = 'org_projects' AND released_at IS NULL").get(actor.companyId).n };
  }

  const svc = { policies, jobs, archive, holds, disposals, erasures, report, engine };
  services.set(db, svc);
  return svc;
}
