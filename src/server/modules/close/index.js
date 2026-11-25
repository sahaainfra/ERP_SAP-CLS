import { eventTypes } from '../../platform/events/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { authzOf } from '../../platform/authz/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { createFlagService } from '../core/api.js';
import { commissioningOf } from './commissioning.js';
import { closureOf } from './closure.js';
import { dlpOf } from './dlp.js';
import { readinessProviders } from '../proj/project.js';
import { handoverOf } from './handover.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { closeRoutes, closureRoutes, commissioningRoutes, dlpRoutes, handoverRoutes } from './routes.js';

/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['tnc.certificate.issued', 'A mechanical completion (MC), ready-for-commissioning (RFC) or ready-for-start-up (RFSU) certificate was signed by the client and issued (part 26.01): data { certificateId, docNo, kind, systemId, systemCode, projectId, siteId, signedOn }. The system moves to that stage; the handover dossier (26.02) reads it.'],
  ['ho.handover.issued', 'A handover of a project or an area was signed by the client and issued (part 26.02): data { handoverId, docNo, projectId, siteId, locationId, scopeType, areaLabel, effectiveOn, dlpMonths, dlpEndsOn, assets }. The defects liability period (26.03) starts from the effective date; contract closeout (26.04) reads it.'],
  ['dlp.defect.backcharge_raised', 'A defects liability complaint against a subcontractor or supplier was closed with a recovery (part 26.03): data { complaintId, docNo, periodId, projectId, responsibleType, partnerId, amount (rupees) }. Subcontractor bills (22.05) deduct it.'],
  ['dlp.period.completed', 'A defects liability period was completed: its certificate approved by the commercial manager and the CFO (part 26.03): data { periodId, docNo, handoverId, projectId, siteId, startsOn, endsOn, recoveries (rupees) }. The retention is released through Billing on the DLP end basis (22.07); project closure (26.04) reads it.'],
  ['cls.project.closed', 'The closeout of a project was approved by the project director, the CFO and a director (part 26.04): data { closureId, docNo, projectId, finalAccount, revenue, cost (rupees), plSnapshotId, benchmarks }. Project Setup may then move the project to CLOSED (10.01); the archive (29.07) and estimating read it.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'close', description });

integrityRegistry.register({
  statuses: { tnc_systems: ['ACTIVE', 'CANCELLED'], tnc_tags: ['ACTIVE', 'CANCELLED'], tnc_checksheets: ['OPEN', 'PASSED', 'FAILED', 'CANCELLED'], tnc_test_packs: ['PLANNED', 'PASSED', 'FAILED', 'CANCELLED'], tnc_certificates: ['SUBMITTED', 'APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED'], ho_handovers: ['DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED'], ho_checklist_items: ['OPEN', 'DONE', 'NOT_APPLICABLE'], ho_client_assets: ['ACTIVE', 'CANCELLED'], dlp_periods: ['ACTIVE', 'COMPLETION_REVIEW', 'COMPLETED', 'CANCELLED'], dlp_complaints: ['OPEN', 'ASSIGNED', 'RECTIFIED', 'CLOSED', 'REJECTED'], dlp_warranty_claims: ['OPEN', 'ACCEPTED', 'REJECTED', 'RESOLVED'], cls_closures: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'], cls_checklist_items: ['OPEN', 'DONE', 'NOT_APPLICABLE'], kb_lessons: ['DRAFT', 'SUBMITTED', 'PUBLISHED', 'REJECTED', 'WITHDRAWN'], kb_benchmarks: ['PROPOSED', 'APPROVED', 'REJECTED'] },
  uniqueKeys: [{ table: 'tnc_test_packs', columns: ['company_id', 'doc_no'] }, { table: 'tnc_certificates', columns: ['company_id', 'doc_no'] }, { table: 'ho_handovers', columns: ['company_id', 'doc_no'] }, { table: 'dlp_periods', columns: ['company_id', 'doc_no'] }, { table: 'dlp_complaints', columns: ['company_id', 'doc_no'] }, { table: 'dlp_warranty_claims', columns: ['company_id', 'doc_no'] }, { table: 'cls_closures', columns: ['company_id', 'doc_no'] }, { table: 'kb_lessons', columns: ['company_id', 'doc_no'] }],
});

// files: the client-signed copy of a certificate and the evidence of a test pack, seen and attached by who may act on them
const fileOf = (table, editKey, closed) => (db, actor, id) => {
  const r = db.prepare(`SELECT x.status, x.company_id, s.org_project_id, s.org_site_id FROM ${table} x JOIN tnc_systems s ON s.id = x.system_id WHERE x.id = ? AND x.company_id = ? AND x.deleted_at IS NULL`).get(Number(id), actor.companyId);
  if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined }).allowed;
  if (!at('tnc.view')) return null;
  return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined, canView: true, canEdit: at(editKey), locked: closed.includes(r.status) };
};
fileEntities.register({ entity: 'tnc_certificates', label: 'Commissioning certificate (the copy the client signed)', resolve: fileOf('tnc_certificates', 'tnc.certificate.sign', ['ISSUED', 'REJECTED', 'CANCELLED']) });
const hoFile = (db, actor, id, table) => {
  const r = db.prepare(`SELECT h.status, h.company_id, h.org_project_id, h.org_site_id FROM ${table === 'ho_handovers' ? 'ho_handovers h WHERE h.id = ?' : 'ho_checklist_items i JOIN ho_handovers h ON h.id = i.handover_id WHERE i.id = ?'} AND h.company_id = ? AND h.deleted_at IS NULL`).get(Number(id), actor.companyId);
  if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined }).allowed;
  if (!at('ho.view')) return null;
  return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined, canView: true, canEdit: at(table === 'ho_handovers' ? 'ho.sign' : 'ho.manage'), locked: ['ISSUED', 'CANCELLED'].includes(r.status) };
};
fileEntities.register({ entity: 'ho_handovers', label: 'Handover certificate (the copy the client signed)', resolve: (db, actor, id) => hoFile(db, actor, id, 'ho_handovers') });
fileEntities.register({ entity: 'ho_checklist_items', label: 'Handover checklist item (evidence for the dossier)', resolve: (db, actor, id) => hoFile(db, actor, id, 'ho_checklist_items') });
fileEntities.register({ entity: 'dlp_complaints', label: 'Defects liability complaint (photographs and rectification evidence)', resolve: (db, actor, id) => {
  const r = db.prepare('SELECT c.status, c.company_id, p.org_project_id, p.org_site_id FROM dlp_complaints c JOIN dlp_periods p ON p.id = c.period_id WHERE c.id = ? AND c.company_id = ? AND c.deleted_at IS NULL').get(Number(id), actor.companyId);
  if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined }).allowed;
  if (!at('dlp.view')) return null;
  return { companyId: r.company_id, projectId: r.org_project_id, siteId: r.org_site_id ?? undefined, canView: true, canEdit: at('dlp.rectify') || at('dlp.complaint.create'), locked: ['CLOSED', 'REJECTED'].includes(r.status) };
} });
fileEntities.register({ entity: 'cls_closures', label: 'Project closeout (final account and checklist evidence)', resolve: (db, actor, id) => {
  const r = db.prepare('SELECT status, company_id, org_project_id FROM cls_closures WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
  if (!r) return null; const a = authzOf(db); const at = (k) => a.check(actor, k, { companyId: r.company_id, projectId: r.org_project_id }).allowed;
  if (!at('cls.view')) return null;
  return { companyId: r.company_id, projectId: r.org_project_id, canView: true, canEdit: at('cls.manage'), locked: ['SUBMITTED', 'APPROVED', 'CANCELLED'].includes(r.status) };
} });
fileEntities.register({ entity: 'tnc_test_packs', label: 'Test pack (test record and witness evidence)', resolve: fileOf('tnc_test_packs', 'tnc.test.record', ['CANCELLED']) });

// 26.04 FR-05: Project Setup's move to CLOSED (10.01) checks the approved closeout of the project, where the part is on for the company.
const flagsOf = new WeakMap();
readinessProviders.push((db, x, { to }) => {
  const flags = flagsOf.get(db);
  if (to !== 'CLOSED' || !flags || !flags.isOn({ companyId: x.company_id }, 'ff.close.p2604')) return [];
  return [{ code: 'CLOSEOUT', text: 'The project closeout (26.04) is approved: checklist, final account, final P&L and lessons', ok: closureOf(db).approvedFor(x.project_id), blocking: true }];
});

/** Module M26, project closeout: commissioning (26.01), handover (26.02), defects liability (26.03) and project closure (26.04). */
export const close = {
  code: 'close',
  name: 'Project Closeout',
  routePrefix: '/api/v1/close',
  ownerPart: '26.01',
  status: 'Commissioning: systems, tags and check sheets of classes A/B/C, test packs, punch items from the snag list, and the MC, RFC and RFSU certificates approved through the workflow and signed by the client; handovers of a project or an area with their checklist, dossier, client asset register and certificate; defects liability periods with complaints, their response time and verification, warranty claims and the completion certificate; the project closeout with its checklist, final account, final P&L and performance, lessons learned and benchmarks.',
  tables: ['tnc_systems', 'tnc_tags', 'tnc_checksheets', 'tnc_test_packs', 'tnc_punch_links', 'tnc_certificates', 'ho_handovers', 'ho_checklist_items', 'ho_client_assets', 'dlp_periods', 'dlp_complaints', 'dlp_warranty_claims', 'cls_closures', 'cls_checklist_items', 'kb_lessons', 'kb_benchmarks'],
  resources: ['commissioning', 'handovers', 'handover-items', 'client-assets', 'dlp', 'closures', 'closure-items', 'lessons', 'benchmarks'],
  companyOptional: [],
  /** Later parts add their routes here: (router, helpers, ctx). */
  parts: new Map(),
  mount(api, { db, config: appConfig }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tnc_systems'").get()) return;
    const flags = createFlagService({ db, environment: appConfig.environment });
    const parts = { commissioning: (r, h) => commissioningRoutes(r, commissioningOf(db), h) };
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ho_handovers'").get()) parts.handover = (r, h) => handoverRoutes(r, handoverOf(db), h);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dlp_periods'").get()) {
      const dlp = dlpOf(db); parts.dlp = (r, h) => dlpRoutes(r, dlp, h);
      const runtime = runtimeOf(db);
      // FR-01: an issued handover opens its defects liability period (when the part is on for the company; otherwise it is opened by hand later)
      runtime?.bus?.subscribe('ho.handover.issued', (event) => {
        const h = db.prepare('SELECT company_id FROM ho_handovers WHERE id = ?').get(Number(event.data?.handoverId)); if (!h || !flags.isOn({ companyId: h.company_id }, 'ff.close.p2603')) return;
        dlp.openFor(h.company_id, event.data.handoverId);
      }, { consumer: 'close.dlp.open' });
      runtime?.jobs?.register('close.dlp_sweep', (jctx) => { let escalated = 0; let ending = 0; for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!flags.isOn({ companyId: c.id }, 'ff.close.p2603')) continue; const r = dlp.sweep(c.id); escalated += r.escalated; ending += r.ending; } jctx.log(`Escalated ${escalated} overdue complaint(s); told about ${ending} period(s) ending`); return { escalated, ending }; }, { maxAttempts: 2, description: 'Defects liability: overdue complaints escalated, periods ending within 30 days told' });
      runtime?.scheduler?.define({ code: 'close.dlp_sweep_hourly', cron: '25 * * * *', jobType: 'close.dlp_sweep', description: 'Hourly at :25: overdue defects liability complaints escalate; periods ending within 30 days are told once a day' });
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cls_closures'").get()) { flagsOf.set(db, flags); parts.closure = (r, h) => closureRoutes(r, closureOf(db), h); }
    for (const [name, make] of close.parts) parts[name] = (r, h) => make(r, h, { db, flags });
    api.use('/close', closeRoutes({ idempotent: idempotency(db), idempotentRequired: idempotency(db, { required: true }), flags, parts }));
  },
};
