import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import { parseChange, parseConnectorList, parseCreate, parseDisable, parseId, parseLogList } from './validators.js';

/**
 * Connectors and the integration log. Viewing needs core.connectors.view (SYSADM, ITADM); everything that changes or
 * exercises a connector needs core.connectors.configure (ITADM). New connectors, credentials and settings change only
 * through an approved request (SYSADM, and the CFO for bank and GST connectors).
 */
export function connectorRoutes(service, { idempotentRequired }) {
  const r = Router();
  const view = requirePermission('core.connectors.view');
  const configure = requirePermission('core.connectors.configure');
  r.get('/connectors/catalog', view, (req, res) => res.json({ data: service.catalog(req.actor) }));
  r.get('/connectors', view, (req, res) => res.json(service.list(req.actor, parseConnectorList(req.query))));
  r.post('/connectors', configure, idempotentRequired, (req, res) => res.status(201).json({ data: service.requestCreate(req.actor, parseCreate(req.body)) }));
  r.get('/connectors/:id', view, (req, res) => res.json({ data: service.get(req.actor, parseId(req.params.id)) }));
  r.get('/connectors/:id/secrets', view, (req, res) => res.json({ data: service.secrets(req.actor, parseId(req.params.id)) }));
  r.post('/connectors/:id/change-requests', configure, idempotentRequired, (req, res) => res.status(201).json({ data: service.requestChange(req.actor, parseId(req.params.id), parseChange(req.body)) }));
  r.post('/connectors/:id/disable', configure, idempotentRequired, (req, res) => res.json({ data: service.disable(req.actor, parseId(req.params.id), parseDisable(req.body), req.correlationId) }));
  r.post('/connectors/:id/test', configure, idempotentRequired, async (req, res) => res.json({ data: await service.test(req.actor, parseId(req.params.id), req.correlationId) }));
  r.post('/connectors/:id/sample', configure, idempotentRequired, async (req, res) => res.json({ data: await service.sample(req.actor, parseId(req.params.id), req.correlationId) }));
  r.get('/integration-logs', view, (req, res) => res.json(service.logs(req.actor, parseLogList(req.query))));
  r.get('/integration-logs/:id', view, (req, res) => res.json({ data: service.log(req.actor, parseId(req.params.id)) }));
  return r;
}

/** The inbound webhook endpoint: no sign-in, the signature is the proof (mounted before authentication). */
export function webhookRoutes(service) {
  const r = Router();
  r.post('/webhooks/:connector', (req, res) =>
    res.json({ data: service.receiveWebhook(req.params.connector, { rawBody: req.rawBody, body: req.body, headers: { 'x-signature': req.get('x-signature'), 'x-timestamp': req.get('x-timestamp'), 'x-delivery-id': req.get('x-delivery-id') } }) }),
  );
  return r;
}
