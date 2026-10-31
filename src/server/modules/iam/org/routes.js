import { Router } from 'express';
import {
  parseAssign, parseCreate, parseEntity, parseGeofenceRequest, parseId, parseOrgList, parsePatch, parseReasonVersion, parseRequestReason, parseShapeTest, parseSiteTest, parseStatusChange, parseUserLookup,
} from './validators.js';

const ctxOf = (req) => ({ correlationId: req.correlationId });

/** Organisation routes (part 02.02), mounted at /api/v1/iam/org. Static paths come first so they are never read as an entity name. */
export function orgRoutes(service, { idempotentRequired }) {
  const r = Router();
  const entity = (req) => parseEntity(req.params.entity);

  r.get('/context', (req, res) => res.json({ data: service.context(req.actor) }));
  r.get('/tree', (req, res) => res.json({ data: service.tree(req.actor) }));
  r.get('/lookups/users', (req, res) => res.json({ data: service.lookupUsers(req.actor, parseUserLookup(req.query)) }));
  r.post('/geofence/test', (req, res) => res.json({ data: service.testShape(req.actor, parseShapeTest(req.body)) }));

  r.get('/:entity', (req, res) => {
    const key = entity(req);
    res.json(service.list(req.actor, key, parseOrgList(key, req.query)));
  });
  r.post('/:entity', idempotentRequired, (req, res) => {
    const key = entity(req);
    res.status(201).json({ data: service.create(req.actor, key, parseCreate(key, req.body), ctxOf(req)) });
  });
  r.get('/:entity/:id', (req, res) => res.json({ data: service.get(req.actor, entity(req), parseId(req.params.id)) }));
  r.patch('/:entity/:id', (req, res) => {
    const key = entity(req);
    res.json({ data: service.update(req.actor, key, parseId(req.params.id), parsePatch(key, req.body), ctxOf(req)) });
  });
  r.get('/:entity/:id/blockers', (req, res) => res.json({ data: service.blockers(req.actor, entity(req), parseId(req.params.id)) }));
  r.get('/:entity/:id/descendants', (req, res) => res.json({ data: service.descendants(req.actor, entity(req), parseId(req.params.id)) }));
  r.get('/:entity/:id/history', (req, res) => res.json({ data: service.history(req.actor, entity(req), parseId(req.params.id)) }));
  r.get('/:entity/:id/requests', (req, res) => res.json({ data: service.requestsFor(req.actor, entity(req), parseId(req.params.id)) }));
  r.post('/:entity/:id/deactivate', idempotentRequired, (req, res) => res.json({ data: service.deactivate(req.actor, entity(req), parseId(req.params.id), parseReasonVersion(req.body), ctxOf(req)) }));
  r.post('/:entity/:id/activate', idempotentRequired, (req, res) => res.json({ data: service.activate(req.actor, entity(req), parseId(req.params.id), parseReasonVersion(req.body), ctxOf(req)) }));
  r.post('/:entity/:id/assignments', idempotentRequired, (req, res) => res.status(201).json({ data: service.assign(req.actor, entity(req), parseId(req.params.id), parseAssign(req.body), ctxOf(req)) }));
  r.delete('/:entity/:id/assignments/:aid', (req, res) => res.json({ data: service.cancelAssignment(req.actor, entity(req), parseId(req.params.id), parseId(req.params.aid)) }));

  r.post('/projects/:id/status', idempotentRequired, (req, res) => res.json({ data: service.projectStatus(req.actor, parseId(req.params.id), parseStatusChange(req.body), ctxOf(req)) }));
  r.post('/projects/:id/activation-requests', idempotentRequired, (req, res) => res.status(201).json({ data: service.requestActivation(req.actor, 'projects', parseId(req.params.id), parseRequestReason(req.body)) }));
  r.post('/sites/:id/activation-requests', idempotentRequired, (req, res) => res.status(201).json({ data: service.requestActivation(req.actor, 'sites', parseId(req.params.id), parseRequestReason(req.body)) }));
  r.post('/sites/:id/geofence/change-requests', idempotentRequired, (req, res) => res.status(201).json({ data: service.requestGeofenceChange(req.actor, parseId(req.params.id), parseGeofenceRequest(req.body)) }));
  r.post('/sites/:id/geofence/test', (req, res) => res.json({ data: service.testSite(req.actor, parseId(req.params.id), parseSiteTest(req.body)) }));
  return r;
}
