import { Router } from 'express';
import { toCsv } from '../../platform/export/index.js';
import { parseAckReport, parseAcknowledge, parseArchive, parseCompare, parseDismiss, parseDraftList, parseId, parsePolicyCreate, parsePolicyList, parsePreview, parseRequirement, parseRequirementList, parseRequirementUpdate, parseSubmit, parseVersionUpdate } from './validators.js';

/** Part 05.05: the policy API. Every route needs a signed-in person; the rights (author, see all, convert, review drafts) and the ownership of a policy are checked in the service. */
export function policyRoutes({ service }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/policies', (req, res) => ok(res, service.policies.list(req.actor, parsePolicyList(req.query))));
  r.post('/policies', idempotent, (req, res) => ok(res, service.policies.create(req.actor, parsePolicyCreate(req.body)), 201));
  r.post('/policies/preview', (req, res) => ok(res, service.policies.preview(req.actor, parsePreview(req.body).applicability)));
  r.get('/policies/:id', (req, res) => ok(res, service.policies.get(req.actor, parseId(req.params.id))));
  r.post('/policies/:id/versions', idempotent, (req, res) => ok(res, service.policies.revise(req.actor, parseId(req.params.id)), 201));
  r.get('/policies/:id/compare', (req, res) => ok(res, service.policies.compare(req.actor, parseId(req.params.id), parseCompare(req.query))));
  r.get('/policies/:id/acknowledgements', (req, res) => ok(res, service.policies.ackReport(req.actor, parseId(req.params.id), parseAckReport(req.query))));
  r.get('/policies/:id/acknowledgements/export', (req, res) => {
    const rows = service.policies.ackRows(req.actor, parseId(req.params.id), parseAckReport(req.query));
    const columns = [['person', 'Person'], ['user', 'User'], ['status', 'Status'], ['due', 'Due'], ['read', 'Read'], ['acknowledged', 'Acknowledged'], ['quiz', 'Quiz score (%)'], ['attempts', 'Tries'], ['reminders', 'Reminders'], ['escalated', 'Escalated']].map(([key, label]) => ({ key, label }));
    res.status(200).set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="policy-acknowledgements.csv"' }).send(toCsv({ columns, rows, footer: null }));
  });
  r.post('/policies/:id/archive', idempotent, (req, res) => ok(res, service.policies.archive(req.actor, parseId(req.params.id), parseArchive(req.body))));
  r.put('/versions/:id', idempotent, (req, res) => ok(res, service.policies.updateVersion(req.actor, parseId(req.params.id), parseVersionUpdate(req.body))));
  r.post('/versions/:id/submit', idempotentRequired, (req, res) => ok(res, service.policies.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/versions/:id/read', (req, res) => ok(res, service.mine.read(req.actor, parseId(req.params.id))));
  r.get('/my', (req, res) => ok(res, service.mine.list(req.actor)));
  r.post('/acknowledge', idempotent, (req, res) => ok(res, service.mine.acknowledge(req.actor, parseAcknowledge(req.body))));
  r.get('/requirements', (req, res) => ok(res, service.requirements.list(req.actor, parseRequirementList(req.query))));
  r.post('/requirements', idempotent, (req, res) => ok(res, service.requirements.create(req.actor, parseRequirement(req.body)), 201));
  r.put('/requirements/:id', idempotent, (req, res) => ok(res, service.requirements.update(req.actor, parseId(req.params.id), parseRequirementUpdate(req.body))));
  r.delete('/requirements/:id', idempotent, (req, res) => ok(res, service.requirements.remove(req.actor, parseId(req.params.id))));
  r.post('/requirements/:id/convert', idempotentRequired, (req, res) => ok(res, service.requirements.convert(req.actor, parseId(req.params.id)), 201));
  r.post('/requirements/:id/dismiss', idempotent, (req, res) => ok(res, service.requirements.dismiss(req.actor, parseId(req.params.id), parseDismiss(req.body))));
  r.get('/drafts', (req, res) => ok(res, service.requirements.drafts(req.actor, parseDraftList(req.query))));
  return r;
}
