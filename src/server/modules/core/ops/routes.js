import { Router } from 'express';
import { requirePermission } from '../../../platform/auth/index.js';
import {
  parseAlertList, parseClientEvents, parseClientList, parseCorrelation, parseId, parseKey, parseRuleChange, parseSloChange, parseTraceId, parseTraceList,
} from './validators.js';

/**
 * Operations. Viewing needs core.ops.view (ITADM, SYSADM); acknowledging, evaluating, changing rules and the diagnostics need
 * core.ops.manage (ITADM). Alert rules and objectives change only through an approved request. Browsers report their own
 * errors with a plain sign-in (no permission): they must be able to say something is wrong whoever they are.
 */
export function opsRoutes(service, { idempotentRequired }) {
  const r = Router();
  const view = requirePermission('core.ops.view');
  const manage = requirePermission('core.ops.manage');
  r.get('/ops/summary', view, (req, res) => res.json({ data: service.summary(req.actor) }));
  r.get('/ops/slos', view, (req, res) => res.json({ data: service.slos(req.actor) }));
  r.get('/ops/alert-rules', view, (req, res) => res.json({ data: service.alertRules(req.actor) }));
  r.get('/ops/alerts', view, (req, res) => res.json({ data: service.alerts(req.actor, parseAlertList(req.query)) }));
  r.post('/ops/alerts/:id/acknowledge', manage, idempotentRequired, (req, res) => res.json({ data: service.acknowledge(req.actor, parseId(req.params.id), req.correlationId) }));
  r.post('/ops/evaluate', manage, idempotentRequired, (req, res) => res.json({ data: service.tick(req.actor) }));
  r.post('/ops/slo-definitions/:journey/change-requests', manage, idempotentRequired, (req, res) => res.status(201).json({ data: service.requestChange(req.actor, 'slo', parseKey(req.params.journey), parseSloChange(req.body)) }));
  r.post('/ops/alert-rules/:code/change-requests', manage, idempotentRequired, (req, res) => res.status(201).json({ data: service.requestChange(req.actor, 'alert_rule', parseKey(req.params.code), parseRuleChange(req.body)) }));
  r.get('/ops/traces', view, (req, res) => res.json({ data: service.traces(req.actor, parseTraceList(req.query)) }));
  r.get('/ops/traces/:traceId/otlp', view, (req, res) => res.json(service.otlp(req.actor, parseTraceId(req.params.traceId))));
  r.get('/ops/traces/:traceId', view, (req, res) => res.json({ data: service.trace(req.actor, parseTraceId(req.params.traceId)) }));
  r.get('/ops/follow', view, (req, res) => res.json({ data: service.follow(req.actor, parseCorrelation(req.query)) }));
  r.post('/ops/client-events', (req, res) => res.status(202).json({ data: service.recordClientEvents(req.actor, parseClientEvents(req.body)) }));
  r.get('/ops/client-events', view, (req, res) => res.json({ data: service.clientEvents(req.actor, parseClientList(req.query)) }));
  r.get('/ops/baseline', view, (req, res) => res.json({ data: service.baseline(req.actor) }));
  r.post('/ops/diagnostics/force-error', manage, idempotentRequired, (req, res) => res.json({ data: service.forceError(req.actor, req.correlationId) }));
  return r;
}
