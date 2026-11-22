import { Router } from 'express';
import { z } from 'zod';
import { idempotency } from '../../platform/http/idempotency.js';
import { parse } from '../../platform/validation/index.js';
import { createFlagService } from '../core/api.js';
import { AREAS, createControlCenter } from './control.js';
import { MAP_ENTITIES, createBusinessConnectors } from './connectors.js';
import { runtimeOf } from '../../platform/runtime/index.js';

// Module M29 (admin): administration, integration and data operations. Part 29.01 mounts the Enterprise Control Center; the later parts of
// the module (connectors, public API, bulk entry, migration, backups, archival, help desk) add their routes here behind their own flags.
const id = (v) => parse(z.coerce.number().int().positive(), v);
const actorKey = ({ companyId, userId, user }) => JSON.stringify([companyId, userId ?? null, user]);
const reasonText = z.string().trim().min(5).max(500);

export const admin = {
  code: 'admin', name: 'Administration & Data Operations', routePrefix: '/api/v1/admin', ownerPart: '29.01',
  status: 'Enterprise Control Center: governance dashboard, maker-checker configuration changes, emergency controls, configuration snapshots and diff, onboarding checklist.',
  tables: ['adm_controls', 'adm_emergency_actions', 'adm_config_snapshots', 'int_mappings', 'int_sync_runs'], companyOptional: [], resources: ['dashboard', 'catalogue', 'areas', 'changes', 'emergency', 'snapshots', 'onboarding', 'connectors'],
  mount(api, { db, config }) {
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
    api.use('/admin', r);
  },
};
