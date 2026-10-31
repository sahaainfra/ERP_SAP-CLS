import { Router } from 'express';
import { parseAssignment, parseAssignmentList, parseCompare, parseComparisonList, parseEffective, parseEnd, parseId, parseRoleChange, parseRoleCreate, parseRoleList, parseRolePatch } from './validators.js';

/** Roles, assignments, the effective-permission explainer and the legacy comparison (part 02.04), mounted at /api/v1/iam. */
export function accessRoutes(service, { idempotentRequired }) {
  const r = Router();
  const id = (req) => parseId(req.params.id);

  r.get('/permissions', (req, res) => res.json({ data: service.permissions(req.actor) }));
  r.get('/mask-fields', (req, res) => res.json({ data: service.maskableFields(req.actor) }));
  r.get('/me/access', (req, res) => res.json({ data: service.myAccess(req.actor) }));

  r.get('/roles', (req, res) => res.json(service.list(req.actor, parseRoleList(req.query))));
  r.post('/roles', idempotentRequired, (req, res) => res.status(201).json({ data: service.create(req.actor, parseRoleCreate(req.body)) }));
  r.get('/roles/compare', (req, res) => { const q = parseCompare(req.query); res.json({ data: service.compare(req.actor, q.a, q.b) }); });
  r.get('/roles/:id', (req, res) => res.json({ data: service.get(req.actor, id(req)) }));
  r.patch('/roles/:id', (req, res) => res.json({ data: service.update(req.actor, id(req), parseRolePatch(req.body)) }));
  r.post('/roles/:id/change-requests', idempotentRequired, (req, res) => res.status(201).json({ data: service.requestChange(req.actor, id(req), parseRoleChange(req.body)) }));

  r.get('/assignments', (req, res) => res.json(service.assignments(req.actor, parseAssignmentList(req.query))));
  r.post('/assignments', idempotentRequired, (req, res) => res.status(201).json({ data: service.requestAssignment(req.actor, parseAssignment(req.body)) }));
  r.post('/assignments/:id/end', idempotentRequired, (req, res) => res.json({ data: service.endAssignment(req.actor, id(req), parseEnd(req.body)) }));

  r.get('/effective', (req, res) => res.json({ data: service.effective(req.actor, parseEffective(req.query)) }));
  r.get('/legacy-comparison', (req, res) => res.json(service.legacyComparison(req.actor, parseComparisonList(req.query))));
  r.get('/legacy-mapping', (req, res) => res.json({ data: service.mapping(req.actor) }));
  return r;
}
