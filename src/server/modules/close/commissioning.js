import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createBase, nowIso, rid } from '../proc/base.js';

/**
 * Part 26.01: testing, pre-commissioning and commissioning (built on the owner's instruction of 2026-11-25, audit AUD-DEF-004).
 *
 *  - FR-01 A project is split into systems (and subsystems) and their tags.
 *  - FR-02 Each tag has check sheets of class A (mechanical completion), B (pre-commissioning) and C (commissioning); a sheet may point to
 *    the QA inspection (18.01) that was its evidence. A sheet is passed or failed by a person who may record tests.
 *  - FR-03 A system has test packs (hydrotest, loop check, insulation, function, performance ...) with their procedure, witness and result.
 *  - FR-04 Punch items are the QA snags of 18.06, linked to the system; their class (A, B, C) and status are read from QA.
 *  - FR-05 Certificates MC, RFC and RFSU: requested by the commissioning lead, approved by the QA/QC manager and the project manager
 *    (07: commissioning lead -> QCMGR -> PM -> client) through the workflow engine, then signed by the client: the project manager records
 *    the client's signatory, date and signed copy (the client portal, 25.04, does not take decisions yet). Issue moves the system to that
 *    stage and announces tnc.certificate.issued (for the handover dossier of 26.02).
 *  - FR-06 The completion dashboard: per system the share of check sheets passed by class, punches open, test packs and certificates.
 *  - BR-01 A certificate is refused while its system is not ready: every check sheet of the classes it needs passed (MC: A; RFC: A, B; RFSU:
 *    A, B, C), no open class A punch (class B also for RFSU), the previous certificate issued, and for RFSU every test pack passed. The
 *    readiness is checked again when the client signs.
 */
export const COMMISSIONING_FLAG = 'ff.close.p2601';
export const CERT_DOC = 'TNC_CERTIFICATE';
const KINDS = Object.freeze({ MC: { classes: ['A'], previous: null, label: 'Mechanical Completion' }, RFC: { classes: ['A', 'B'], previous: 'MC', label: 'Ready for Commissioning' }, RFSU: { classes: ['A', 'B', 'C'], previous: 'RFC', label: 'Ready for Start-Up' } });
const OPEN_PUNCH = ['OPEN', 'RECTIFIED'];

export function createCommissioning({ db }) {
  const base = createBase({ db });
  const { may, need, audit, number } = base;
  const today = () => todayIST();
  const evt = (type, actor, companyId, entityId, data, projectId) => publishEvent(db, { type, entity: 'tnc_certificates', entityId: String(entityId), actorId: actor?.user ?? 'system', companyId, projectId: projectId ?? undefined, data });
  const scope = (actor, key, alias = 's') => { const f = base.authz.scopeFilter(actor, key, { project: `${alias}.org_project_id`, site: `${alias}.org_site_id` }); return f.sql; };
  const systemRow = (actor, id, key = 'tnc.view') => {
    const s = db.prepare('SELECT * FROM tnc_systems WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!s || !may(actor, key === 'tnc.view' ? key : 'tnc.view', s.org_project_id, s.org_site_id)) throw notFound('That system does not exist.');
    if (key !== 'tnc.view') need(actor, key, 'do that for this system', s.org_project_id, s.org_site_id);
    return s;
  };
  const tagRow = (actor, id, key) => { const t = db.prepare('SELECT * FROM tnc_tags WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!t) throw notFound('That tag does not exist.'); systemRow(actor, t.system_id, key); return t; };
  const childRow = (actor, table, id, key, what) => { const r = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(rid(id), actor.companyId); if (!r) throw notFound(`That ${what} does not exist.`); const sid = table === 'tnc_checksheets' ? db.prepare('SELECT system_id FROM tnc_tags WHERE id = ?').get(r.tag_id).system_id : r.system_id; systemRow(actor, sid, key); return r; };
  const fileOk = (companyId, fileId) => Boolean(db.prepare('SELECT 1 FROM core_files WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(fileId), companyId));

  // ---- readiness (BR-01) ------------------------------------------------------------------------------------------------------------------------
  const sheetsOf = (systemId) => db.prepare("SELECT c.* FROM tnc_checksheets c JOIN tnc_tags t ON t.id = c.tag_id WHERE t.system_id = ? AND c.deleted_at IS NULL AND c.status != 'CANCELLED' AND t.deleted_at IS NULL AND t.status = 'ACTIVE'").all(systemId);
  const punchesOf = (systemId) => db.prepare('SELECT q.id, q.doc_no, q.punch_class, q.status, q.description FROM tnc_punch_links l JOIN qa_snags q ON q.id = l.snag_id WHERE l.system_id = ? AND l.deleted_at IS NULL AND q.deleted_at IS NULL ORDER BY q.id').all(systemId);
  const packsOf = (systemId) => db.prepare("SELECT * FROM tnc_test_packs WHERE system_id = ? AND deleted_at IS NULL AND status != 'CANCELLED' ORDER BY id").all(systemId);
  const issued = (systemId, kind) => Boolean(db.prepare("SELECT 1 FROM tnc_certificates WHERE system_id = ? AND kind = ? AND status = 'ISSUED' AND deleted_at IS NULL").get(systemId, kind));
  function readiness(systemId, kind) {
    const k = KINDS[kind]; const blockers = [];
    const tags = db.prepare("SELECT COUNT(*) AS n FROM tnc_tags WHERE system_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL").get(systemId).n;
    if (!tags) blockers.push('The system has no tags.');
    const sheets = sheetsOf(systemId);
    for (const c of k.classes) {
      const of = sheets.filter((x) => x.sheet_class === c);
      if (!of.length) blockers.push(`No class ${c} check sheet.`);
      const notPassed = of.filter((x) => x.status !== 'PASSED');
      if (notPassed.length) blockers.push(`${notPassed.length} class ${c} check sheet(s) not passed.`);
    }
    const blocking = punchesOf(systemId).filter((p) => OPEN_PUNCH.includes(p.status) && (p.punch_class === 'A' || (kind === 'RFSU' && p.punch_class === 'B')));
    if (blocking.length) blockers.push(`Open class ${kind === 'RFSU' ? 'A or B' : 'A'} punch(es): ${blocking.map((p) => p.doc_no).join(', ')}.`);
    if (k.previous && !issued(systemId, k.previous)) blockers.push(`The ${k.previous} certificate is not issued yet.`);
    if (kind === 'RFSU') { const packs = packsOf(systemId); if (!packs.length) blockers.push('No test pack.'); const open = packs.filter((p) => p.status !== 'PASSED'); if (open.length) blockers.push(`${open.length} test pack(s) not passed.`); }
    return { kind, ready: blockers.length === 0, blockers, blockingPunches: blocking.map((p) => p.id) };
  }

  // ---- views --------------------------------------------------------------------------------------------------------------------------------------
  const progressOf = (systemId) => {
    const sheets = sheetsOf(systemId); const by = {};
    for (const c of ['A', 'B', 'C']) { const of = sheets.filter((x) => x.sheet_class === c); by[c] = { total: of.length, passed: of.filter((x) => x.status === 'PASSED').length, failed: of.filter((x) => x.status === 'FAILED').length }; }
    const punches = punchesOf(systemId); const packs = packsOf(systemId);
    return { sheets: by, punchesOpen: punches.filter((p) => OPEN_PUNCH.includes(p.status)).length, punchesOpenA: punches.filter((p) => p.punch_class === 'A' && OPEN_PUNCH.includes(p.status)).length, packs: { total: packs.length, passed: packs.filter((p) => p.status === 'PASSED').length } };
  };
  const systemView = (s) => ({ id: s.id, projectId: s.org_project_id, siteId: s.org_site_id, parentId: s.parent_id, code: s.code, name: s.name, discipline: s.discipline, stage: s.stage, status: s.status, version: s.version, project: db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(s.org_project_id)?.code ?? null, progress: progressOf(s.id) });
  const sheetView = (c) => ({ id: c.id, tagId: c.tag_id, sheetClass: c.sheet_class, title: c.title, inspectionId: c.inspection_id, status: c.status, note: c.result_note, doneBy: c.done_by, doneAt: c.done_at, version: c.version });
  const packView = (p) => ({ id: p.id, systemId: p.system_id, docNo: p.doc_no, packType: p.pack_type, procedureRef: p.procedure_ref, status: p.status, witnessedBy: p.witnessed_by, witnessParty: p.witness_party, testedOn: p.tested_on, note: p.result_note, evidenceFileId: p.evidence_file_id, version: p.version, system: db.prepare('SELECT code FROM tnc_systems WHERE id = ?').get(p.system_id)?.code ?? null });
  const certView = (c) => ({ id: c.id, systemId: c.system_id, docNo: c.doc_no, kind: c.kind, label: KINDS[c.kind].label, status: c.status, requestedBy: c.requested_by, approvedAt: c.approved_at, clientSignatory: c.client_signatory, clientSignedOn: c.client_signed_on, clientFileId: c.client_file_id, issuedBy: c.issued_by, issuedAt: c.issued_at, workflowInstanceId: c.workflow_instance_id, version: c.version, system: db.prepare('SELECT code, name FROM tnc_systems WHERE id = ?').get(c.system_id) ?? null });

  const svc = {
    readiness,
    /** What the forms offer: the projects the actor may see systems of, their sites, and for a project its snags not linked yet. */
    options(actor, { projectId = null } = {}) {
      if (!base.authz.hasAnywhere(actor, 'tnc.view')) throw forbidden('You may not see commissioning (permission tnc.view).');
      const projects = db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 500").all(actor.companyId).filter((p) => may(actor, 'tnc.view', p.id)).map((p) => ({ ...p }));
      if (!projectId || !projects.some((p) => p.id === rid(projectId))) return { projects, sites: [], snags: [] };
      const pid = rid(projectId);
      return {
        projects,
        sites: db.prepare('SELECT id, code, name FROM org_sites WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL ORDER BY code').all(actor.companyId, pid).map((s) => ({ ...s })),
        snags: db.prepare("SELECT q.id, q.doc_no AS docNo, q.punch_class AS punchClass, q.status, q.description FROM qa_snags q WHERE q.company_id = ? AND q.org_project_id = ? AND q.deleted_at IS NULL AND q.status != 'CANCELLED' ORDER BY q.id DESC LIMIT 300").all(actor.companyId, pid).map((s) => ({ ...s })),
      };
    },
    // FR-01 systems and tags
    systems: {
      list(actor, { projectId = null, stage = null } = {}) {
        base.authz.hasAnywhere(actor, 'tnc.view') || (() => { throw forbidden('You may not see the commissioning systems (permission tnc.view).'); })();
        const where = ['s.company_id = ?', 's.deleted_at IS NULL', scope(actor, 'tnc.view')]; const args = [actor.companyId];
        if (projectId) { where.push('s.org_project_id = ?'); args.push(rid(projectId)); } if (stage) { where.push('s.stage = ?'); args.push(stage); }
        return db.prepare(`SELECT s.* FROM tnc_systems s WHERE ${where.join(' AND ')} ORDER BY s.org_project_id, s.code LIMIT 500`).all(...args).map(systemView);
      },
      create(actor, b) {
        const p = base.project(actor, b.projectId, 'tnc.view', 'tnc.manage');
        if (b.siteId && !base.siteOf(actor.companyId, p.id, b.siteId)) throw unprocessable('That site is not a site of the project.');
        if (b.parentId) { const par = systemRow(actor, b.parentId); if (par.org_project_id !== p.id) throw unprocessable('A subsystem belongs to a system of the same project.'); }
        if (db.prepare('SELECT 1 FROM tnc_systems WHERE company_id = ? AND org_project_id = ? AND code = ? AND deleted_at IS NULL').get(actor.companyId, p.id, b.code)) throw conflict(`The project already has a system ${b.code}.`);
        const id = Number(db.prepare("INSERT INTO tnc_systems (company_id, org_project_id, org_site_id, parent_id, code, name, discipline, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, p.id, b.siteId ?? null, b.parentId ?? null, b.code, b.name, b.discipline ?? 'GENERAL', actor.user).lastInsertRowid);
        audit(actor, 'tnc_systems', String(id), 'create', actor.companyId, { newValues: b });
        return systemView(db.prepare('SELECT * FROM tnc_systems WHERE id = ?').get(id));
      },
      get(actor, id) {
        const s = systemRow(actor, id);
        const tags = db.prepare('SELECT * FROM tnc_tags WHERE system_id = ? AND deleted_at IS NULL ORDER BY tag_no').all(s.id).map((t) => ({ id: t.id, tagNo: t.tag_no, description: t.description, status: t.status, version: t.version, sheets: db.prepare('SELECT * FROM tnc_checksheets WHERE tag_id = ? AND deleted_at IS NULL ORDER BY sheet_class, id').all(t.id).map(sheetView) }));
        const certificates = db.prepare('SELECT * FROM tnc_certificates WHERE system_id = ? AND deleted_at IS NULL ORDER BY id').all(s.id).map(certView);
        return { ...systemView(s), subsystems: db.prepare('SELECT id, code, name, stage FROM tnc_systems WHERE parent_id = ? AND deleted_at IS NULL ORDER BY code').all(s.id), tags, testPacks: packsOf(s.id).map(packView), punches: punchesOf(s.id).map((p) => ({ id: p.id, docNo: p.doc_no, punchClass: p.punch_class, status: p.status, description: p.description })), certificates, readiness: Object.keys(KINDS).map((k) => readiness(s.id, k)), can: { manage: may(actor, 'tnc.manage', s.org_project_id, s.org_site_id), record: may(actor, 'tnc.test.record', s.org_project_id, s.org_site_id), request: may(actor, 'tnc.certificate.request', s.org_project_id, s.org_site_id), sign: may(actor, 'tnc.certificate.sign', s.org_project_id, s.org_site_id) } };
      },
    },
    tags: {
      create(actor, systemId, b) {
        const s = systemRow(actor, systemId, 'tnc.manage');
        if (db.prepare('SELECT 1 FROM tnc_tags WHERE system_id = ? AND tag_no = ? AND deleted_at IS NULL').get(s.id, b.tagNo)) throw conflict(`The system already has a tag ${b.tagNo}.`);
        return transaction(db, () => {
          const id = Number(db.prepare("INSERT INTO tnc_tags (company_id, system_id, tag_no, description, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, s.id, b.tagNo, b.description, s.org_project_id, s.org_site_id, actor.user).lastInsertRowid);
          for (const sh of b.sheets ?? []) db.prepare("INSERT INTO tnc_checksheets (company_id, tag_id, sheet_class, title, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, id, sh.sheetClass, sh.title, s.org_project_id, s.org_site_id, actor.user);
          audit(actor, 'tnc_tags', String(id), 'create', actor.companyId, { newValues: b });
          return svc.systems.get(actor, s.id);
        });
      },
    },
    // FR-02 check sheets
    sheets: {
      create(actor, tagId, b) {
        const t = tagRow(actor, tagId, 'tnc.manage');
        const id = Number(db.prepare("INSERT INTO tnc_checksheets (company_id, tag_id, sheet_class, title, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, t.id, b.sheetClass, b.title, t.project_id, t.site_id, actor.user).lastInsertRowid);
        audit(actor, 'tnc_checksheets', String(id), 'create', actor.companyId, { newValues: b });
        return sheetView(db.prepare('SELECT * FROM tnc_checksheets WHERE id = ?').get(id));
      },
      record(actor, id, b) {
        const c = childRow(actor, 'tnc_checksheets', id, 'tnc.test.record', 'check sheet');
        if (c.status === 'CANCELLED') throw conflict('A cancelled check sheet is not recorded.');
        if (b.inspectionId && !db.prepare('SELECT 1 FROM qa_inspections WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.inspectionId), actor.companyId)) throw unprocessable('That inspection does not exist.');
        db.prepare('UPDATE tnc_checksheets SET status = ?, result_note = ?, inspection_id = COALESCE(?, inspection_id), done_by = ?, done_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.result, b.note ?? null, b.inspectionId ?? null, actor.user, nowIso(), actor.user, nowIso(), c.id);
        audit(actor, 'tnc_checksheets', String(c.id), b.result.toLowerCase(), actor.companyId, { reason: b.note });
        return sheetView(db.prepare('SELECT * FROM tnc_checksheets WHERE id = ?').get(c.id));
      },
    },
    // FR-03 test packs
    packs: {
      list(actor, { status = null, projectId = null } = {}) {
        if (!base.authz.hasAnywhere(actor, 'tnc.view')) throw forbidden('You may not see the test packs (permission tnc.view).');
        const where = ['p.company_id = ?', 'p.deleted_at IS NULL', scope(actor, 'tnc.view')]; const args = [actor.companyId];
        if (status) { where.push('p.status = ?'); args.push(status); } if (projectId) { where.push('s.org_project_id = ?'); args.push(rid(projectId)); }
        return db.prepare(`SELECT p.* FROM tnc_test_packs p JOIN tnc_systems s ON s.id = p.system_id WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 500`).all(...args).map(packView);
      },
      create(actor, systemId, b) {
        const s = systemRow(actor, systemId, 'tnc.manage');
        const docNo = number(actor.companyId, actor.user, 'TNC_TEST_PACK', 'tnc_test_packs', 'TP');
        const id = Number(db.prepare("INSERT INTO tnc_test_packs (company_id, system_id, doc_no, pack_type, procedure_ref, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, s.id, docNo, b.packType, b.procedureRef, s.org_project_id, s.org_site_id, actor.user).lastInsertRowid);
        audit(actor, 'tnc_test_packs', String(id), 'create', actor.companyId, { newValues: b });
        return packView(db.prepare('SELECT * FROM tnc_test_packs WHERE id = ?').get(id));
      },
      record(actor, id, b) {
        const p = childRow(actor, 'tnc_test_packs', id, 'tnc.test.record', 'test pack');
        if (p.status === 'CANCELLED') throw conflict('A cancelled test pack is not recorded.');
        if (b.evidenceFileId && !fileOk(actor.companyId, b.evidenceFileId)) throw unprocessable('That evidence file does not exist.');
        if (b.testedOn > today()) throw unprocessable('A test is recorded on the day it was done or later, not before.');
        db.prepare('UPDATE tnc_test_packs SET status = ?, witnessed_by = ?, witness_party = ?, tested_on = ?, result_note = ?, evidence_file_id = COALESCE(?, evidence_file_id), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(b.result, b.witnessedBy, b.witnessParty ?? null, b.testedOn, b.note ?? null, b.evidenceFileId ?? null, actor.user, nowIso(), p.id);
        audit(actor, 'tnc_test_packs', String(p.id), b.result.toLowerCase(), actor.companyId, { reason: b.note });
        return packView(db.prepare('SELECT * FROM tnc_test_packs WHERE id = ?').get(p.id));
      },
    },
    // FR-04 punch items: the QA snags of the project, linked to the system
    punches: {
      link(actor, systemId, { snagId }) {
        const s = systemRow(actor, systemId, 'tnc.manage');
        const q = db.prepare('SELECT id, org_project_id FROM qa_snags WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(snagId), actor.companyId);
        if (!q || q.org_project_id !== s.org_project_id) throw notFound('That punch item is not a snag of this project.');
        if (db.prepare('SELECT 1 FROM tnc_punch_links WHERE system_id = ? AND snag_id = ? AND deleted_at IS NULL').get(s.id, q.id)) throw conflict('The punch item is already linked to this system.');
        db.prepare("INSERT INTO tnc_punch_links (company_id, system_id, snag_id, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, s.id, q.id, s.org_project_id, s.org_site_id, actor.user);
        audit(actor, 'tnc_punch_links', `${s.id}:${q.id}`, 'link', actor.companyId);
        return svc.systems.get(actor, s.id);
      },
    },
    // FR-05 certificates
    certificates: {
      list(actor, { status = null, kind = null } = {}) {
        if (!base.authz.hasAnywhere(actor, 'tnc.view')) throw forbidden('You may not see the certificates (permission tnc.view).');
        const where = ['c.company_id = ?', 'c.deleted_at IS NULL', scope(actor, 'tnc.view')]; const args = [actor.companyId];
        if (status) { where.push('c.status = ?'); args.push(status); } if (kind) { where.push('c.kind = ?'); args.push(kind); }
        return db.prepare(`SELECT c.* FROM tnc_certificates c JOIN tnc_systems s ON s.id = c.system_id WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT 500`).all(...args).map(certView);
      },
      request(actor, systemId, { kind }) {
        const s = systemRow(actor, systemId, 'tnc.certificate.request');
        const r = readiness(s.id, kind);
        if (!r.ready) throw unprocessable(`The ${kind} certificate is refused: ${r.blockers.join(' ')}`, r.blockers.map((m) => ({ field: 'readiness', message: m })));
        if (db.prepare("SELECT 1 FROM tnc_certificates WHERE system_id = ? AND kind = ? AND status IN ('SUBMITTED', 'APPROVED', 'ISSUED') AND deleted_at IS NULL").get(s.id, kind)) throw conflict(`The system already has a ${kind} certificate in progress or issued.`);
        return transaction(db, () => {
          const docNo = number(actor.companyId, actor.user, 'TNC_CERTIFICATE', 'tnc_certificates', kind);
          const id = Number(db.prepare("INSERT INTO tnc_certificates (company_id, system_id, doc_no, kind, status, requested_by, readiness_json, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, 'api')").run(actor.companyId, s.id, docNo, kind, actor.user, JSON.stringify(r), s.org_project_id, s.org_site_id, actor.user).lastInsertRowid);
          const inst = workflowOf(db).submit(actor, { docType: CERT_DOC, docId: String(id), comment: `${KINDS[kind].label} of ${s.code}`, context: { projectId: s.org_project_id, siteId: s.org_site_id, kind } });
          db.prepare('UPDATE tnc_certificates SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id);
          audit(actor, 'tnc_certificates', String(id), 'request', actor.companyId, { newValues: { kind, system: s.code } });
          return certView(db.prepare('SELECT * FROM tnc_certificates WHERE id = ?').get(id));
        });
      },
      /** The workflow decided (QCMGR, then PM): approved waits for the client's signature; anything else ends it. */
      decide(instance, actor, outcome, comment) {
        const c = db.prepare('SELECT * FROM tnc_certificates WHERE id = ?').get(rid(instance.docId)); if (!c || c.status !== 'SUBMITTED') return;
        const status = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'CANCELLED' ? 'CANCELLED' : 'REJECTED';
        db.prepare('UPDATE tnc_certificates SET status = ?, approved_at = ?, remarks = COALESCE(?, remarks), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, status === 'APPROVED' ? nowIso() : null, comment ?? null, actor?.user ?? 'system', nowIso(), c.id);
        audit(actor, 'tnc_certificates', String(c.id), status.toLowerCase(), c.company_id, { reason: comment ?? undefined });
      },
      /** The client signed: recorded by the project manager with the signatory, date and signed copy; readiness is checked again. */
      clientSign(actor, id, b) {
        const c = childRow(actor, 'tnc_certificates', id, 'tnc.certificate.sign', 'certificate');
        if (c.status !== 'APPROVED') throw conflict(`${c.doc_no} is ${c.status.toLowerCase()}: the client signs an approved certificate.`);
        if (!fileOk(actor.companyId, b.fileId)) throw unprocessable('Attach the copy the client signed.');
        if (b.signedOn > today()) throw unprocessable('The client signed on a day that has come.');
        const r = readiness(c.system_id, c.kind);
        if (!r.ready) throw unprocessable(`The system is no longer ready: ${r.blockers.join(' ')}`, r.blockers.map((m) => ({ field: 'readiness', message: m })));
        return transaction(db, () => {
          db.prepare("UPDATE tnc_certificates SET status = 'ISSUED', client_signatory = ?, client_signed_on = ?, client_file_id = ?, issued_by = ?, issued_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.signatory, b.signedOn, rid(b.fileId), actor.user, nowIso(), actor.user, nowIso(), c.id);
          db.prepare('UPDATE tnc_systems SET stage = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(c.kind, actor.user, nowIso(), c.system_id);
          const s = db.prepare('SELECT * FROM tnc_systems WHERE id = ?').get(c.system_id);
          audit(actor, 'tnc_certificates', String(c.id), 'issue', actor.companyId, { newValues: { signatory: b.signatory, signedOn: b.signedOn } });
          evt('tnc.certificate.issued', actor, actor.companyId, c.id, { certificateId: c.id, docNo: c.doc_no, kind: c.kind, systemId: s.id, systemCode: s.code, projectId: s.org_project_id, siteId: s.org_site_id, signedOn: b.signedOn }, s.org_project_id);
          return certView(db.prepare('SELECT * FROM tnc_certificates WHERE id = ?').get(c.id));
        });
      },
    },
    // FR-06 the completion dashboard
    dashboard(actor, { projectId = null } = {}) {
      const systems = svc.systems.list(actor, { projectId });
      const sum = (k, f) => systems.reduce((t, s) => t + f(s.progress.sheets[k]), 0);
      const pct = (k) => { const total = sum(k, (x) => x.total); return total ? Math.round((sum(k, (x) => x.passed) * 1000) / total) / 10 : null; };
      return { systems, totals: { systems: systems.length, byStage: Object.fromEntries(['CONSTRUCTION', 'MC', 'RFC', 'RFSU'].map((st) => [st, systems.filter((s) => s.stage === st).length])), sheetsPassedPct: { A: pct('A'), B: pct('B'), C: pct('C') }, punchesOpenA: systems.reduce((t, s) => t + s.progress.punchesOpenA, 0), packsPassed: systems.reduce((t, s) => t + s.progress.packs.passed, 0), packs: systems.reduce((t, s) => t + s.progress.packs.total, 0) } };
    },
  };
  return svc;
}

const instances = new WeakMap();
export const commissioningOf = (db) => { if (!instances.has(db)) instances.set(db, createCommissioning({ db })); return instances.get(db); };

const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
workflowTypes.register({
  docType: CERT_DOC, label: 'Commissioning certificate', processOwner: 'QCMGR', route: (id) => `/close/certificates?id=${id}`,
  describe(db, companyId, id) { const c = db.prepare('SELECT c.*, s.code FROM tnc_certificates c JOIN tnc_systems s ON s.id = c.system_id WHERE c.id = ?').get(rid(id)); return c && c.company_id === companyId ? { ref: c.doc_no, title: `${KINDS[c.kind].label}: system ${c.code}`, originator: c.requested_by, projectId: c.project_id ?? undefined, siteId: c.site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const c = db.prepare('SELECT c.*, s.code, s.name FROM tnc_certificates c JOIN tnc_systems s ON s.id = c.system_id WHERE c.id = ?').get(rid(id)); if (!c) return null; const r = JSON.parse(c.readiness_json || '{}'); return { fields: [{ label: 'Certificate', value: `${c.kind} (${KINDS[c.kind].label})` }, { label: 'System', value: `${c.code} ${c.name}` }, { label: 'Ready when requested', value: r.ready ? 'Yes: every check passed' : 'No' }] }; },
  defaultDefinition: { name: 'Commissioning certificate: the QA/QC manager and the project manager approve what the commissioning lead requested; the client signs after', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('QCMGR', 'QA/QC manager', 'QCMGR'), step('PM', 'Project manager', 'PM')] },
  hooks: {
    onApproved: (db, { instance, actor }) => commissioningOf(db).certificates.decide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => commissioningOf(db).certificates.decide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => commissioningOf(db).certificates.decide(instance, actor, 'REJECTED', comment),
    onCancelled: (db, { instance, actor, comment }) => commissioningOf(db).certificates.decide(instance, actor, 'CANCELLED', comment),
  },
});
export { KINDS };
