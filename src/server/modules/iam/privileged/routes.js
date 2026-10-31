import { Router } from 'express';
import { notFound } from '../../../platform/http/errors.js';
import {
  parseCampaign, parseCampaignList, parseDecision, parseDormantList, parseElevation, parseElevationList, parseId, parseItemList, parseReassign, parseReviewDecision, parseRevoke,
  parseRuleChange, parseRuleList, parseRuleTest, parseViolationList, parseViolationResolve,
} from './validators.js';

/**
 * Segregation of duties, elevated access and access reviews (part 02.05), mounted at /api/v1/iam. The feature flag ff.iam.p0205 guards
 * every path here (the caller mounts the guard in front).
 */
export function privilegedRoutes({ sod, elevations, reviews }, { idempotentRequired }) {
  const r = Router();
  const id = (req) => parseId(req.params.id);

  // ---- rules ----
  r.get('/sod-rules', (req, res) => res.json(sod.rules(req.actor, parseRuleList(req.query))));
  r.get('/sod-rules/test', (req, res) => res.json({ data: sod.test(req.actor, parseRuleTest(req.query)) }));
  r.post('/sod-rules', idempotentRequired, (req, res) => res.status(201).json({ data: sod.requestChange(req.actor, parseRuleChange(req.body)) }));
  r.get('/sod-rules/:id', (req, res) => res.json({ data: sod.rule(req.actor, id(req)) }));
  r.put('/sod-rules/:id', idempotentRequired, (req, res) => res.status(201).json({ data: sod.requestChange(req.actor, { ...parseRuleChange({ ...req.body, ruleId: id(req) }) }) }));
  r.delete('/sod-rules/:id', idempotentRequired, (req, res) => {
    const ruleId = id(req);
    const current = sod.rule(req.actor, ruleId);
    const { reason } = parseRevoke(req.body ?? {});
    const rule = { code: current.code, name: current.name, description: current.description, kind: current.kind, setA: current.setA, setB: current.setB, scope: current.scope, severity: current.severity, conditions: current.conditions, active: false };
    res.status(201).json({ data: sod.requestChange(req.actor, { ruleId, rule, reason }) });
  });

  // ---- violations ----
  r.get('/sod-violations', (req, res) => res.json(sod.violations(req.actor, parseViolationList(req.query))));
  r.post('/sod-violations/scan', idempotentRequired, (req, res) => res.json({ data: sod.scan(req.actor) }));
  r.get('/sod-violations/:id', (req, res) => res.json({ data: sod.violation(req.actor, id(req)) }));
  r.post('/sod-violations/:id/resolve', idempotentRequired, (req, res) => res.json({ data: sod.resolve(req.actor, id(req), parseViolationResolve(req.body)) }));

  // ---- dormant accounts ----
  r.get('/dormant-accounts', (req, res) => res.json(sod.dormant(req.actor, parseDormantList(req.query))));
  r.post('/dormant-accounts/scan', idempotentRequired, (req, res) => {
    if (!req.actor.grants?.perms?.includes('iam.sod.resolve')) throw notFound('That route does not exist.');
    res.json({ data: sod.scanDormant(req.actor.companyId, { by: req.actor.user }) });
  });

  // ---- elevations ----
  r.get('/elevation-roles', (req, res) => res.json({ data: elevations.roles(req.actor) }));
  r.get('/elevations', (req, res) => res.json(elevations.list(req.actor, parseElevationList(req.query))));
  r.post('/elevations', idempotentRequired, (req, res) => res.status(201).json({ data: elevations.request(req.actor, parseElevation(req.body)) }));
  r.get('/elevations/:id', (req, res) => res.json({ data: elevations.get(req.actor, id(req)) }));
  r.post('/elevations/:id/decision', idempotentRequired, (req, res) => res.json({ data: elevations.decide(req.actor, id(req), parseDecision(req.body)) }));
  r.post('/elevations/:id/cancel', idempotentRequired, (req, res) => res.json({ data: elevations.cancel(req.actor, id(req)) }));
  r.post('/elevations/:id/revoke', idempotentRequired, (req, res) => res.json({ data: elevations.revoke(req.actor, id(req), parseRevoke(req.body)) }));

  // ---- access reviews ----
  r.get('/access-reviews', (req, res) => res.json(reviews.campaigns(req.actor, parseCampaignList(req.query))));
  r.post('/access-reviews', idempotentRequired, (req, res) => res.status(201).json({ data: reviews.create(req.actor, parseCampaign(req.body)) }));
  r.get('/access-reviews/mine', (req, res) => res.json(reviews.mine(req.actor, parseItemList(req.query))));
  r.post('/access-reviews/decisions', idempotentRequired, (req, res) => res.json({ data: reviews.decide(req.actor, parseReviewDecision(req.body)) }));
  r.get('/access-reviews/:id', (req, res) => res.json({ data: reviews.campaign(req.actor, id(req)) }));
  r.get('/access-reviews/:id/items', (req, res) => res.json(reviews.items(req.actor, id(req), parseItemList(req.query))));
  r.post('/access-reviews/:id/reassign', idempotentRequired, (req, res) => res.json({ data: reviews.reassign(req.actor, id(req), parseReassign(req.body)) }));
  r.post('/access-reviews/:id/close', idempotentRequired, (req, res) => res.json({ data: reviews.close(req.actor, id(req)) }));
  r.post('/access-reviews/:id/cancel', idempotentRequired, (req, res) => res.json({ data: reviews.cancel(req.actor, id(req), req.body?.reason) }));
  return r;
}
