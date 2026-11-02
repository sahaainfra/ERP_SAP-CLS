import { Router } from 'express';
import { parseAct, parseAssign, parseCancel, parseComment, parseDefinitionCreate, parseDefinitionQuery, parseDefinitionUpdate, parseDocId, parseDocType, parseDraftFrom, parseId, parseInstanceQuery, parseMonitorQuery, parseSampleDoc, parseSampleQuery, parseSubmit, parseTaskQuery } from './validators.js';

/** /api/v1/workflow: the engine's API (FR-05, FR-06, FR-08). Writes carry an Idempotency-Key. */
export function workflowRoutes({ engine, definitions, monitorFile }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/doc-types', (req, res) => ok(res, definitions.options().docTypes));
  r.post('/submit', idempotentRequired, (req, res) => ok(res, engine.submit(req.actor, parseSubmit(req.body)), 201));
  r.get('/tasks', (req, res) => ok(res, engine.listTasks(req.actor, parseTaskQuery(req.query))));
  r.get('/tasks/count', (req, res) => ok(res, { open: engine.openCount(req.actor) }));
  r.post('/tasks/:id/act', idempotentRequired, (req, res) => ok(res, engine.act(req.actor, parseId(req.params.id), parseAct(req.body))));
  r.post('/tasks/:id/assign', idempotent, (req, res) => ok(res, engine.assign(req.actor, parseId(req.params.id), parseAssign(req.body))));
  r.get('/instances', (req, res) => ok(res, engine.listInstances(req.actor, parseInstanceQuery(req.query))));
  r.get('/instances/:id', (req, res) => ok(res, engine.get(req.actor, parseId(req.params.id))));
  r.get('/documents/:docType/:docId', (req, res) => {
    const found = engine.forDocument(req.actor, parseDocType(req.params.docType), parseDocId(req.params.docId));
    ok(res, found);
  });
  r.get('/documents/:docType/:docId/history', (req, res) => ok(res, engine.history(req.actor, parseDocType(req.params.docType), parseDocId(req.params.docId))));
  r.post('/instances/:id/withdraw', idempotentRequired, (req, res) => ok(res, engine.withdraw(req.actor, parseId(req.params.id), parseComment(req.body))));
  r.post('/instances/:id/cancel', idempotentRequired, (req, res) => ok(res, engine.cancel(req.actor, parseId(req.params.id), parseCancel(req.body))));
  r.post('/instances/:id/resubmit', idempotentRequired, (req, res) => ok(res, engine.resubmit(req.actor, parseId(req.params.id), parseComment(req.body))));
  r.post('/instances/:id/watch', idempotent, (req, res) => ok(res, engine.watch(req.actor, parseId(req.params.id), true)));
  r.post('/instances/:id/unwatch', idempotent, (req, res) => ok(res, engine.watch(req.actor, parseId(req.params.id), false)));
  r.get('/monitor', (req, res) => {
    const q = parseMonitorQuery(req.query);
    if (q.format === 'json') return ok(res, engine.monitor(req.actor, q));
    const out = monitorFile(req.actor, q);
    return res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer);
  });
  // definitions
  r.get('/definitions', (req, res) => ok(res, definitions.list(req.actor, parseDefinitionQuery(req.query))));
  r.get('/definitions/options', (req, res) => ok(res, definitions.options()));
  r.post('/definitions/draft', idempotent, (req, res) => ok(res, definitions.draftFrom(req.actor, parseDraftFrom(req.body).docType), 201));
  r.post('/definitions', idempotent, (req, res) => ok(res, definitions.create(req.actor, parseDefinitionCreate(req.body)), 201));
  r.get('/definitions/:a/compare/:b', (req, res) => ok(res, definitions.compare(req.actor, parseId(req.params.a), parseId(req.params.b))));
  r.get('/definitions/:id', (req, res) => ok(res, definitions.get(req.actor, parseId(req.params.id))));
  r.put('/definitions/:id', idempotent, (req, res) => { const b = parseDefinitionUpdate(req.body); ok(res, definitions.update(req.actor, parseId(req.params.id), b.definition, b.version)); });
  r.delete('/definitions/:id', idempotent, (req, res) => ok(res, definitions.remove(req.actor, parseId(req.params.id))));
  r.post('/definitions/:id/activate', idempotentRequired, (req, res) => ok(res, definitions.activate(req.actor, parseId(req.params.id)), 202));
  return r;
}

/** /api/v1/eng: the sample document type. */
export function sampleDocRoutes({ docs }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/sample-docs', (req, res) => ok(res, docs.list(req.actor, parseSampleQuery(req.query))));
  r.post('/sample-docs', idempotent, (req, res) => ok(res, docs.create(req.actor, parseSampleDoc(req.body)), 201));
  r.get('/sample-docs/:id', (req, res) => ok(res, docs.get(req.actor, parseId(req.params.id))));
  r.put('/sample-docs/:id', idempotent, (req, res) => { const b = parseSampleDoc(req.body); ok(res, docs.update(req.actor, parseId(req.params.id), b)); });
  r.post('/sample-docs/:id/submit', idempotentRequired, (req, res) => ok(res, docs.submit(req.actor, parseId(req.params.id), parseComment(req.body)), 201));
  r.post('/sample-docs/:id/amend', idempotentRequired, (req, res) => ok(res, docs.amend(req.actor, parseId(req.params.id)), 201));
  return r;
}
