import { Router } from 'express';
import { z } from 'zod';
import { idempotency } from '../../platform/http/idempotency.js';
import { parse } from '../../platform/validation/index.js';
import { createFlagService } from '../core/api.js';
import { AREAS, createControlCenter } from './control.js';
import { MAP_ENTITIES, createBusinessConnectors } from './connectors.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { SCOPES, TIERS, createApiPlatform } from './apiplatform.js';
import { PACKS, createBulkWorkspace } from './bulk.js';
import { PHASES, createMigrationCockpit } from './migration.js';
import { createBackupService } from './backups.js';

// Module M29 (admin): administration, integration and data operations. Part 29.01 mounts the Enterprise Control Center; the later parts of
// the module (connectors, public API, bulk entry, migration, backups, archival, help desk) add their routes here behind their own flags.
const id = (v) => parse(z.coerce.number().int().positive(), v);
const actorKey = ({ companyId, userId, user }) => JSON.stringify([companyId, userId ?? null, user]);
const reasonText = z.string().trim().min(5).max(500);

export const admin = {
  code: 'admin', name: 'Administration & Data Operations', routePrefix: '/api/v1/admin', ownerPart: '29.01',
  status: 'Enterprise Control Center: governance dashboard, maker-checker configuration changes, emergency controls, configuration snapshots and diff, onboarding checklist.',
  tables: ['adm_controls', 'adm_emergency_actions', 'adm_config_snapshots', 'int_mappings', 'int_sync_runs', 'api_clients', 'api_tokens', 'api_webhooks', 'api_webhook_deliveries', 'api_usage', 'xl_packs', 'xl_bulk_batches', 'mig_objects', 'mig_runs', 'mig_cutovers', 'ops_backups', 'ops_restore_tests', 'ops_backup_alerts', 'ops_restore_requests'], companyOptional: ['ops_backups', 'ops_restore_tests', 'ops_backup_alerts'], resources: ['dashboard', 'catalogue', 'areas', 'changes', 'emergency', 'snapshots', 'onboarding', 'connectors', 'api', 'bulk', 'migration', 'backups'],
  mount(api, { db, config, storagePath }) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'adm_controls'").get()) return;
    const context = { db, environment: config.environment ?? 'development', flags: createFlagService({ db, environment: config.environment }) };
    const cc = createControlCenter(context);
    const r = Router();
    const ok = (res, data, status = 200) => res.status(status).json({ data });
    const idem = idempotency(db, { required: true, actorKey });
    const send = (res, out) => res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' }).send(out.buffer);
    const file = z.object({ format: z.string(), environment: z.string().max(40), takenAt: z.string().max(40), checksum: z.string().regex(/^[0-9a-f]{64}$/), content: z.record(z.string(), z.record(z.string(), z.any())) }).strict();

    r.get('/dashboard', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, cc.dashboard(req.actor)); });
    r.get('/catalogue', (req, res) => ok(res, cc.catalogue(req.actor, parse(z.object({ q: z.string().trim().min(2).max(60).optional() }).strict(), req.query))));
    r.get('/areas', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, cc.areas(req.actor)); });
    r.get('/changes', (req, res) => ok(res, cc.changes.list(req.actor, parse(z.object({ status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED', 'WITHDRAWN']).optional(), page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(100).default(25) }).strict(), req.query))));
    r.post('/changes', idem, (req, res) => ok(res, cc.changes.request(req.actor, parse(z.object({ area: z.enum(Object.keys(AREAS)), key: z.string().min(3).max(80), value: z.union([z.string().max(2000), z.boolean(), z.number()]), reason: reasonText }).strict(), req.body)), 201));
    r.post('/changes/:id/act', idem, (req, res) => ok(res, cc.changes.act(req.actor, id(req.params.id), parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional(), version: z.number().int().positive().optional() }).strict(), req.body))));
    r.post('/changes/:id/withdraw', idem, (req, res) => ok(res, cc.changes.withdraw(req.actor, id(req.params.id))));
    r.get('/emergency', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, cc.emergencies.state(req.actor)); });
    r.post('/emergency/read-only', idem, (req, res) => ok(res, cc.emergencies.readOnly(req.actor, parse(z.object({ on: z.boolean(), reason: reasonText }).strict(), req.body))));
    r.post('/emergency/kill', idem, (req, res) => ok(res, cc.emergencies.killFeature(req.actor, parse(z.object({ key: z.string().regex(/^ff\.[a-z0-9_.]+$/), reason: reasonText }).strict(), req.body))));
    r.post('/emergency/force-logout', idem, (req, res) => ok(res, cc.emergencies.forceLogout(req.actor, parse(z.object({ reason: reasonText }).strict(), req.body))));
    r.get('/snapshots', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, cc.snapshots.list(req.actor)); });
    r.post('/snapshots', idem, (req, res) => ok(res, cc.snapshots.take(req.actor, parse(z.object({ note: z.string().trim().max(200).optional() }).strict(), req.body)), 201));
    r.get('/snapshots/:id/export', (req, res) => send(res, cc.snapshots.exportFile(req.actor, id(req.params.id))));
    r.post('/snapshots/diff', (req, res) => ok(res, cc.snapshots.diff(req.actor, parse(z.object({ file }).strict(), req.body).file)));
    r.post('/snapshots/import', idem, (req, res) => ok(res, cc.snapshots.importChanges(req.actor, parse(z.object({ file, keys: z.array(z.string().max(120)).min(1).max(200), reason: reasonText }).strict(), req.body)), 201));
    r.get('/onboarding', (req, res) => ok(res, cc.onboarding(req.actor, parse(z.object({ companyId: z.coerce.number().int().positive().optional() }).strict(), req.query).companyId)));
    // ---- part 29.02: business connectors (banking, accounting export, biometrics, telematics) on the integration hub
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'int_sync_runs'").get()) {
      const runtime = runtimeOf(db);
      const bc = createBusinessConnectors(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler });
      const code = (v) => parse(z.string().regex(/^[a-z][a-z0-9._-]{1,39}$/), v);
      const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
      const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
      r.get('/connectors', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, bc.list(req.actor)); });
      r.get('/connectors/mappings', (req, res) => ok(res, bc.mappings.list(req.actor, parse(z.object({ connector: z.string().max(40).optional(), entity: z.enum(Object.keys(MAP_ENTITIES)).optional() }).strict(), req.query))));
      r.post('/connectors/mappings', idem, (req, res) => ok(res, bc.mappings.propose(req.actor, parse(z.object({ connector: z.string().min(2).max(40), entity: z.enum(Object.keys(MAP_ENTITIES)), internal: z.string().trim().min(1).max(120), external: z.string().trim().min(1).max(120), reason: reasonText }).strict(), req.body)), 201));
      r.post('/connectors/mappings/requests/:id/act', idem, (req, res) => ok(res, bc.mappings.decide(req.actor, id(req.params.id), parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional() }).strict(), req.body))));
      r.get('/connectors/runs', (req, res) => ok(res, bc.runs.list(req.actor, parse(z.object({ connector: z.string().max(40).optional(), status: z.enum(['RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED']).optional(), page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(100).default(25) }).strict(), req.query))));
      r.get('/connectors/runs/export', (req, res) => { const { format, ...q } = parse(z.object({ connector: z.string().max(40).optional(), status: z.enum(['RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED']).optional(), format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx') }).strict(), req.query); return send(res, bc.runs.exportList(req.actor, q, format)); });
      r.get('/connectors/runs/:id', (req, res) => ok(res, bc.runs.get(req.actor, id(req.params.id))));
      r.get('/connectors/runs/:id/output', (req, res) => send(res, bc.runs.output(req.actor, id(req.params.id))));
      r.post('/connectors/accounting-export', idem, (req, res) => ok(res, bc.sync.accountingExport(req.actor, parse(z.object({ from: day, to: day, companyName: z.string().trim().max(120).optional() }).strict(), req.body)), 201));
      r.post('/connectors/:code/health', idem, wrap(async (req, res) => ok(res, await bc.health(req.actor, code(req.params.code)))));
      r.post('/connectors/:code/bank-statement', idem, wrap(async (req, res) => ok(res, await bc.sync.bankStatement(req.actor, { connector: code(req.params.code), ...parse(z.object({ bankAccountId: z.number().int().positive(), from: day, to: day }).strict(), req.body) }), 201)));
      r.post('/connectors/:code/validate-account', idem, wrap(async (req, res) => ok(res, await bc.sync.validateAccount(req.actor, { connector: code(req.params.code), ...parse(z.object({ ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), accountNo: z.string().regex(/^\d{6,18}$/), name: z.string().trim().min(2).max(120) }).strict(), req.body) }), 201)));
      r.post('/connectors/:code/biometric', idem, wrap(async (req, res) => ok(res, await bc.sync.biometric(req.actor, { connector: code(req.params.code), ...parse(z.object({ since: z.string().max(40) }).strict(), req.body) }), 201)));
      r.post('/connectors/:code/telematics', idem, wrap(async (req, res) => ok(res, await bc.sync.telematics(req.actor, { connector: code(req.params.code), ...parse(z.object({ since: z.string().max(40) }).strict(), req.body) }), 201)));
    }
    // ---- part 29.03: public API clients, webhooks, developer portal and usage (the gateway itself is mounted by app.js at /api/public)
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'api_clients'").get()) {
      const runtime = runtimeOf(db);
      const ap = createApiPlatform(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler, bus: runtime?.bus });
      const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
      const decision = z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional() }).strict();
      r.get('/api/clients', (req, res) => ok(res, ap.clients.list(req.actor, parse(z.object({ status: z.enum(['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED']).optional() }).strict(), req.query))));
      r.post('/api/clients', idem, (req, res) => ok(res, ap.clients.create(req.actor, parse(z.object({ name: z.string().trim().min(3).max(80), role: z.string().regex(/^[A-Z][A-Z0-9_-]{1,19}$/), scopes: z.array(z.enum(Object.keys(SCOPES))).min(1).max(20),
        projectIds: z.array(z.number().int().positive()).max(50).optional(), tier: z.enum(Object.keys(TIERS)).default('STANDARD'), environment: z.enum(['SANDBOX', 'LIVE']).default('SANDBOX'), ownerPartnerId: z.number().int().positive().optional(), reason: reasonText }).strict(), req.body)), 201));
      r.post('/api/clients/requests/:id/act', idem, (req, res) => ok(res, ap.clients.decide(req.actor, id(req.params.id), parse(decision, req.body))));
      r.post('/api/clients/:id/rotate', idem, (req, res) => ok(res, ap.clients.rotate(req.actor, id(req.params.id), parse(z.object({ reason: reasonText }).strict(), req.body))));
      r.post('/api/clients/:id/revoke', idem, (req, res) => ok(res, ap.clients.revoke(req.actor, id(req.params.id), parse(z.object({ reason: reasonText }).strict(), req.body))));
      r.get('/api/webhooks', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, ap.webhooks.list(req.actor)); });
      r.post('/api/webhooks', idem, (req, res) => ok(res, ap.webhooks.create(req.actor, parse(z.object({ clientRef: z.number().int().positive(), url: z.string().trim().min(10).max(500), events: z.array(z.string().regex(/^[a-z][a-z0-9_]*\.([a-z0-9_]+\.)?(\*|[a-z0-9_]+)$/)).min(1).max(50) }).strict(), req.body)), 201));
      r.post('/api/webhooks/:id/enable', idem, (req, res) => ok(res, ap.webhooks.setStatus(req.actor, id(req.params.id), true)));
      r.post('/api/webhooks/:id/disable', idem, (req, res) => ok(res, ap.webhooks.setStatus(req.actor, id(req.params.id), false)));
      r.post('/api/webhooks/:id/test', idem, wrap(async (req, res) => ok(res, await ap.webhooks.test(req.actor, id(req.params.id)))));
      const dq = { webhookId: z.coerce.number().int().positive().optional(), status: z.enum(['PENDING', 'DELIVERED', 'FAILED', 'DEAD']).optional() };
      r.get('/api/deliveries', (req, res) => ok(res, ap.deliveries.list(req.actor, parse(z.object({ ...dq, page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(100).default(25) }).strict(), req.query))));
      r.get('/api/deliveries/export', (req, res) => { const { format, ...q } = parse(z.object({ ...dq, format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx') }).strict(), req.query); return send(res, ap.deliveries.exportList(req.actor, q, format)); });
      r.get('/api/deliveries/:id', (req, res) => ok(res, ap.deliveries.get(req.actor, id(req.params.id))));
      r.post('/api/deliveries/:id/replay', idem, wrap(async (req, res) => ok(res, await ap.deliveries.replay(req.actor, id(req.params.id)), 201)));
      r.get('/api/portal', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, ap.portal(req.actor)); });
      r.get('/api/usage', (req, res) => ok(res, ap.usage(req.actor, parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).strict(), req.query))));
    }
    // ---- part 29.04: template packs and the bulk data entry workspace (on the Excel engine of 04.13)
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'xl_bulk_batches'").get()) {
      const bw = createBulkWorkspace(context);
      const tcode = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/);
      const rows = z.array(z.record(z.string().max(60), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))).max(2000);
      const onEx = z.enum(['ERROR', 'UPDATE', 'SKIP']).default('ERROR');
      const pack = (v) => parse(z.enum(Object.keys(PACKS)), v);
      r.get('/bulk/packs', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, bw.packs.list(req.actor)); });
      r.get('/bulk/packs/:code', (req, res) => ok(res, bw.packs.get(req.actor, pack(req.params.code))));
      r.get('/bulk/packs/:code/download', (req, res) => send(res, bw.packs.download(req.actor, pack(req.params.code))));
      r.post('/bulk/packs/:code/versions', idem, (req, res) => ok(res, bw.packs.publish(req.actor, pack(req.params.code), parse(z.object({ instructions: z.string().max(5000).default(''), examples: z.record(tcode, z.record(z.string().max(60), z.string().max(500))).default({}), templates: z.array(tcode).min(1).max(40).optional(), notes: reasonText }).strict(), req.body)), 201));
      r.get('/bulk/templates/:code', (req, res) => ok(res, bw.batches.columns(req.actor, parse(tcode, req.params.code))));
      r.post('/bulk/check', (req, res) => { const b = parse(z.object({ templateCode: tcode, rows, onExisting: onEx }).strict(), req.body); return ok(res, bw.batches.check(req.actor, b.templateCode, b.rows, b.onExisting)); });
      r.get('/bulk/batches', (req, res) => ok(res, bw.batches.list(req.actor, parse(z.object({ status: z.enum(['DRAFT', 'SUBMITTED', 'RETURNED', 'REJECTED', 'IMPORTED', 'FAILED', 'CANCELLED']).optional(), scope: z.enum(['mine', 'approve', 'all']).default('mine'), page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(100).default(25) }).strict(), req.query))));
      r.post('/bulk/batches', idem, (req, res) => ok(res, bw.batches.save(req.actor, parse(z.object({ templateCode: tcode, packCode: z.enum(Object.keys(PACKS)).optional(), title: z.string().trim().min(3).max(120), rows: rows.min(1), onExisting: onEx }).strict(), req.body)), 201));
      r.get('/bulk/batches/:id', (req, res) => ok(res, bw.batches.get(req.actor, id(req.params.id))));
      r.put('/bulk/batches/:id', idem, (req, res) => ok(res, bw.batches.save(req.actor, { id: id(req.params.id), ...parse(z.object({ templateCode: tcode, packCode: z.enum(Object.keys(PACKS)).optional(), title: z.string().trim().min(3).max(120), rows: rows.min(1), onExisting: onEx, version: z.number().int().positive().optional() }).strict(), req.body) })));
      r.post('/bulk/batches/:id/submit', idem, (req, res) => ok(res, bw.batches.submit(req.actor, id(req.params.id), parse(z.object({ reason: reasonText, version: z.number().int().positive().optional() }).strict(), req.body))));
      r.post('/bulk/batches/:id/act', idem, (req, res) => ok(res, bw.batches.decide(req.actor, id(req.params.id), parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional() }).strict(), req.body))));
      r.post('/bulk/batches/:id/cancel', idem, (req, res) => ok(res, bw.batches.cancel(req.actor, id(req.params.id))));
    }
    // ---- part 29.05: the migration cockpit (plan, mapping, trial and final loads with reconciliation, sign-off, cut-over runbook)
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mig_objects'").get()) {
      const mc = createMigrationCockpit(context);
      const ocode = (v) => parse(z.string().regex(/^[A-Z][A-Z0-9_-]{1,39}$/), v);
      const role = z.string().regex(/^[A-Z][A-Z0-9_-]{1,19}$/);
      const col = z.string().max(60);
      const controls = z.object({ count: z.number().int().min(0).optional(), totalColumn: col.optional(), total: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(), totalDebit: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), totalCredit: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
        stockValue: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), tb: z.array(z.object({ accountCode: z.string().max(40), debit: z.string().max(20).default(''), credit: z.string().max(20).default('') }).strict()).max(5000).optional() }).strict();
      r.get('/migration', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, mc.objects.board(req.actor)); });
      r.post('/migration/objects', idem, (req, res) => ok(res, mc.objects.create(req.actor, parse(z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_-]{1,39}$/), name: z.string().trim().min(3).max(120), kind: z.string().max(60), phase: z.enum(Object.keys(PHASES)), sequence: z.number().int().min(1).max(999), ownerRole: role, ownerUser: z.string().max(80).optional() }).strict(), req.body)), 201));
      r.get('/migration/objects/:code', (req, res) => ok(res, mc.objects.get(req.actor, ocode(req.params.code))));
      r.put('/migration/objects/:code/mapping', idem, (req, res) => ok(res, mc.objects.setMapping(req.actor, ocode(req.params.code), parse(z.object({ rename: z.record(z.string().max(120), col).default({}), upper: z.array(col).max(50).default([]), defaults: z.record(col, z.string().max(200)).default({}), values: z.record(col, z.record(z.string().max(120), z.string().max(120))).default({}), dropBlank: z.array(col).max(50).default([]) }).strict(), req.body))));
      r.get('/migration/objects/:code/mapping/export', (req, res) => send(res, mc.objects.mappingWorkbook(req.actor, ocode(req.params.code))));
      r.post('/migration/objects/:code/runs', idem, (req, res) => ok(res, mc.run(req.actor, ocode(req.params.code), parse(z.object({ type: z.enum(['TRIAL', 'FINAL']), csv: z.string().min(3).max(2_000_000), controls: controls.default({}), delta: z.boolean().default(false) }).strict(), req.body)), 201));
      r.post('/migration/objects/:code/sign-off', idem, (req, res) => ok(res, mc.objects.requestSignOff(req.actor, ocode(req.params.code), parse(z.object({ reason: reasonText }).strict(), req.body))));
      r.post('/migration/objects/:code/sign-off/act', idem, (req, res) => ok(res, mc.objects.decide(req.actor, ocode(req.params.code), parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional() }).strict(), req.body))));
      r.post('/migration/cutovers', idem, (req, res) => ok(res, mc.cutovers.plan(req.actor, parse(z.object({ name: z.string().trim().min(3).max(120), freezeFrom: z.string().datetime(), freezeTo: z.string().datetime(), rollbackPoint: z.string().trim().min(5).max(500) }).strict(), req.body)), 201));
      r.post('/migration/cutovers/:id/status', idem, (req, res) => ok(res, mc.cutovers.setStatus(req.actor, id(req.params.id), parse(z.object({ status: z.enum(['FROZEN', 'CLOSED']) }).strict(), req.body).status)));
      r.post('/migration/cutovers/:id/steps/:no', idem, (req, res) => ok(res, mc.cutovers.step(req.actor, id(req.params.id), parse(z.coerce.number().int().min(1).max(20), req.params.no), parse(z.object({ done: z.boolean(), note: z.string().trim().max(300).optional() }).strict(), req.body))));
    }
    // ---- part 29.06: backup, restore and disaster recovery
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ops_backups'").get() && storagePath) {
      const runtime = runtimeOf(db);
      const bk = createBackupService(context, { jobs: runtime?.jobs, scheduler: runtime?.scheduler, storagePath, config });
      const fmt = z.enum(['pdf', 'xlsx']).default('pdf');
      r.get('/backups/status', (req, res) => { parse(z.object({}).strict(), req.query); return ok(res, bk.status(req.actor)); });
      r.get('/backups', (req, res) => ok(res, bk.list(req.actor, parse(z.object({ type: z.enum(['FULL', 'SNAPSHOT']).optional(), status: z.enum(['RUNNING', 'VERIFIED', 'FAILED', 'EXPIRED']).optional(), page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(100).default(25) }).strict(), req.query))));
      r.post('/backups', idem, (req, res) => ok(res, bk.backupNow(req.actor, parse(z.object({ type: z.enum(['FULL', 'SNAPSHOT']).default('FULL') }).strict(), req.body)), 201));
      r.post('/backups/retention', idem, (req, res) => ok(res, bk.retention(req.actor)));
      r.post('/backups/monitor', idem, (req, res) => ok(res, bk.monitor(req.actor)));
      r.get('/backups/tests', (req, res) => ok(res, bk.tests(req.actor, parse(z.object({ kind: z.enum(['TEST', 'DRILL']).optional(), page: z.coerce.number().int().positive().max(10000).default(1), pageSize: z.coerce.number().int().positive().max(100).default(25) }).strict(), req.query))));
      r.post('/backups/tests', idem, (req, res) => ok(res, bk.test(req.actor, parse(z.object({ backupId: z.number().int().positive().optional(), kind: z.enum(['TEST', 'DRILL']).default('TEST'), note: z.string().trim().max(300).optional() }).strict(), req.body)), 201));
      r.get('/backups/tests/:id/report', (req, res) => send(res, bk.report(req.actor, id(req.params.id), parse(z.object({ format: fmt }).strict(), req.query).format)));
      r.post('/backups/restores', idem, (req, res) => ok(res, bk.requestRestore(req.actor, parse(z.object({ backupId: z.number().int().positive(), incidentRef: z.string().trim().min(3).max(60), incident: reasonText }).strict(), req.body)), 201));
      r.post('/backups/restores/:id/act', idem, (req, res) => ok(res, bk.decide(req.actor, id(req.params.id), parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional() }).strict(), req.body))));
    }
    api.use('/admin', r);
  },
};
