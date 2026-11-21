import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { listExportsOf } from '../../platform/list/index.js';
import { FILE_TYPES } from '../../platform/files/types.js';
import { createFlagService } from '../core/feature-flags/service.js';
import { createPortalService, PORTAL_ACCOUNTS_LIST } from './service.js';
import { supplierRouter } from './supplier.js';

integrityRegistry.register({
  technicalTables: ['ptl_sessions', 'ptl_asn_invoices', 'ptl_vdr_orders', 'ptl_rfq_files'],
  statuses: {
    ptl_accounts: ['INVITED', 'ACTIVE', 'REVOKED'],
    ptl_messages: ['UNREAD', 'READ', 'REQUESTED', 'CLOSED'],
  },
});

const accountEvent = { type: 'object', properties: { partnerId: { type: 'integer' }, stakeholderId: { type: 'integer' } } };
for (const verb of ['invited', 'activated', 'revoked']) {
  eventTypes.define({ type: `portal.account.${verb}`, version: 1, owner: 'portal', description: `External account ${verb}.`, schema: accountEvent });
}

const inboxEvent = { type: 'object', properties: { accountId: { type: 'integer' } }, required: ['accountId'] };
for (const [type, description] of [['portal.profile.requested', 'A partner requested a profile change.'],
  ['portal.notice.sent', 'A notice was added to the external inbox.']]) {
  eventTypes.define({ type, version: 1, owner: 'portal', description, schema: inboxEvent });
}

const bearer = (req) => /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1];

export const portal = {
  code: 'portal',
  name: 'External Portals',
  routePrefix: '/portal',
  ownerPart: '25.01',
  status: 'in-progress',
  tables: ['ptl_accounts', 'ptl_sessions', 'ptl_messages', 'ptl_shares', 'ptl_registrations', 'ptl_asn_invoices', 'ptl_vdr_orders', 'ptl_rfq_files'],
  resources: ['invitation', 'session', 'profile', 'accounts', 'messages', 'documents'],
  mount(api, { db, config, publicApi }) {
    const flags = createFlagService({ db, environment: config.environment });
    const service = createPortalService({ db, flags, vaultKey: config.vaultKey, authSecret: config.authSecret ?? undefined });

    const external = Router();
    external.post('/invitation', (req, res) => res.json({ data: service.prepare(req.body) }));
    external.post('/activation', async (req, res) => res.json({ data: await service.activate(req.body) }));
    external.post('/session', async (req, res) => res.json({ data: await service.login(req.body) }));
    external.get('/profile', (req, res) => res.json({ data: service.profile(bearer(req)) }));
    external.delete('/session', (req, res) => {
      service.logout(bearer(req));
      res.status(204).end();
    });
    external.get('/messages', (req, res) => res.json({ data: service.messages(bearer(req)) }));
    external.post('/messages/:id/read', (req, res) => res.json({ data: service.readMessage(bearer(req), req.params.id) }));
    external.post('/profile/requests', (req, res) => res.status(201).json({ data: service.requestProfile(bearer(req), req.get('idempotency-key'), req.body) }));
    external.get('/documents', (req, res) => res.json({ data: service.documents(bearer(req)) }));
    external.get('/documents/:id/ticket', (req, res) => res.json({ data: service.documentTicket(bearer(req), req.params.id) }));
    external.get('/documents/:id/content', async (req, res) => {
      const file = await service.download(bearer(req), req.params.id, req.get('x-portal-download'));
      res.attachment(`shared-document.${file.extension}`).type(FILE_TYPES[file.extension].mime).send(file.buffer);
    });
    external.post('/registrations', (req, res) => res.status(202).json({ data: service.registerVendor(req.get('idempotency-key'), req.body) }));
    external.post('/registrations/status', (req, res) => res.json({ data: service.vendorStatus(req.body) }));
    external.post('/registrations/revise', (req, res) => res.status(202).json({ data: service.reviseVendor(bearer(req), req.body) }));
    publicApi.use('/portal', external);
    publicApi.use('/portal/supplier', supplierRouter({ db, service, bearer }));

    const admin = Router();
    const exportsService = listExportsOf(db);
    exportsService?.register(PORTAL_ACCOUNTS_LIST, service.exportSource);
    admin.get('/accounts/export', (req, res) => {
      const out = exportsService.start(req.actor, PORTAL_ACCOUNTS_LIST, req.query);
      if (out.kind === 'job') return res.status(202).json({ data: out });
      return res.set('X-Export-Rows', String(out.rows)).attachment(out.fileName).type(out.contentType).send(out.buffer);
    });
    admin.get('/accounts', (req, res) => res.json(service.list(req.actor, req.query)));
    admin.post('/accounts/revoke', (req, res) => res.json({ data: service.revokeBatch(req.actor, req.body) }));
    admin.post('/invitations', (req, res) => res.status(201).json({ data: service.invite(req.actor, req.body) }));
    admin.post('/accounts/:id/revoke', (req, res) => res.json({ data: service.revoke(req.actor, req.params.id, req.body) }));
    admin.post('/accounts/:id/notices', (req, res) => res.status(201).json({ data: service.sendNotice(req.actor, req.params.id, req.body) }));
    admin.get('/accounts/:id/requests', (req, res) => res.json({ data: service.profileRequests(req.actor, req.params.id) }));
    admin.post('/accounts/:id/requests/:requestId/close', (req, res) =>
      res.json({ data: service.closeProfileRequest(req.actor, req.params.id, req.params.requestId, req.body) }));
    admin.post('/accounts/:id/shares', (req, res) => res.status(201).json({ data: service.share(req.actor, req.params.id, req.body) }));
    api.use('/portal/admin', admin);
  },
};
