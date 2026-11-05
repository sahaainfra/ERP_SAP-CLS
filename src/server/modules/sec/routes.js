import { Router } from 'express';
import { parseAck, parseBundleQuery, parseBundles, parseCard, parseDeviceRegister, parseDevicesAdmin, parseDisappear, parseEnvelopes, parseFetch, parseId, parsePrekeyUpload, parseRegisterQuery, parseRevoke, parseSecureCreate } from './validators.js';
import { parsePolicy, parseRegisterEntry, parseReviewSubmit } from './governance.js';
import { toCsv } from '../../platform/export/index.js';

/** Part 05.03: the secure messaging API. Every route needs a signed-in person; devices and conversations are checked in the service. The service never sees plaintext (BR-01). */
export function secureRoutes({ service, gov }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  // devices and keys (FR-02)
  r.post('/devices', idempotent, async (req, res) => ok(res, await service.devices.register(req.actor, parseDeviceRegister(req.body)), 201));
  r.get('/devices', (req, res) => ok(res, service.devices.mine(req.actor)));
  r.get('/devices/all', (req, res) => ok(res, service.devices.all(req.actor, parseDevicesAdmin(req.query))));
  r.post('/devices/:id/revoke', idempotent, (req, res) => ok(res, service.devices.revoke(req.actor, parseId(req.params.id), parseRevoke(req.body).reason)));
  r.post('/devices/:id/prekeys', idempotent, async (req, res) => ok(res, await service.prekeys.upload(req.actor, parseId(req.params.id), parsePrekeyUpload(req.body))));
  r.get('/devices/:id/prekeys/count', (req, res) => ok(res, service.prekeys.count(req.actor, parseId(req.params.id))));
  r.get('/prekeys/:userId', (req, res) => ok(res, service.prekeys.bundle(req.actor, String(req.params.userId), parseBundleQuery(req.query))));
  // secure conversations (FR-03, FR-05, FR-08)
  r.get('/ready', (req, res) => ok(res, { ready: service.ready(req.actor), canCreate: service.conversations.mayCreate(req.actor) }));
  r.post('/conversations', idempotent, (req, res) => { const out = service.conversations.create(req.actor, parseSecureCreate(req.body)); ok(res, out, out.created ? 201 : 200); });
  r.get('/conversations/:id', (req, res) => ok(res, service.conversations.get(req.actor, parseId(req.params.id))));
  r.get('/conversations/:id/bundles', (req, res) => ok(res, service.conversations.bundles(req.actor, parseId(req.params.id), parseBundles(req.query).device)));
  r.put('/conversations/:id/disappearing', idempotent, (req, res) => ok(res, service.conversations.setDisappear(req.actor, parseId(req.params.id), parseDisappear(req.body).seconds)));
  // envelopes (FR-03)
  r.post('/envelopes', idempotentRequired, (req, res) => ok(res, service.envelopes.send(req.actor, parseEnvelopes(req.body)), 201));
  r.get('/envelopes', (req, res) => { const q = parseFetch(req.query); ok(res, service.envelopes.fetch(req.actor, { deviceId: q.device, since: q.since, limit: q.limit })); });
  r.post('/envelopes/ack', idempotent, (req, res) => ok(res, service.envelopes.ack(req.actor, parseAck(req.body))));
  r.get('/cards', (req, res) => { const q = parseCard(req.query); ok(res, service.card(req.actor, q.entity, q.id)); });
  // policy (FR-07)
  r.get('/policy', (req, res) => ok(res, gov.policy.get(req.actor)));
  r.post('/policy/changes', idempotentRequired, (req, res) => ok(res, gov.policy.propose(req.actor, parsePolicy(req.body)), 202));
  r.get('/policy/export', (req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="secure-messaging-policy.json"'); ok(res, gov.policy.export(req.actor)); });
  // licence register and review (FR-01)
  r.get('/licences', (req, res) => ok(res, gov.register.list(req.actor, parseRegisterQuery(req.query))));
  r.post('/licences', idempotent, (req, res) => { const out = gov.register.upsert(req.actor, parseRegisterEntry(req.body)); ok(res, out, out.created ? 201 : 200); });
  r.post('/licences/scan', idempotent, (req, res) => ok(res, gov.register.scan(req.actor)));
  r.get('/licences/export', (req, res) => {
    const rows = gov.register.export(req.actor, parseRegisterQuery(req.query));
    const columns = ['Component', 'Version', 'Licence', 'Usage', 'Obligations', 'Status', 'Reviewed by', 'Reviewed at'].map((k) => ({ key: k, label: k }));
    const csv = toCsv({ columns, rows, footer: null });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="open-source-licence-register.csv"'); res.send(csv);
  });
  r.post('/licences/reviews', idempotentRequired, (req, res) => ok(res, gov.reviews.submit(req.actor, parseReviewSubmit(req.body)), 202));
  return r;
}
