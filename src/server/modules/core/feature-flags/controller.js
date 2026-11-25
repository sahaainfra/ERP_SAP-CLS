import { parseCancel, parseChangeId, parseChangeList, parseDecision, parseEvaluate, parseKey, parseList, parsePatch } from './validators.js';

/** Thin HTTP layer (BR-01): parse input, call the service, format output. No business rules here. */
export function createFlagController(service, changes = null) {
  return {
    changes(req, res) {
      res.json({ data: changes.list(req.actor, parseChangeList(req.query)) });
    },
    decide(req, res) {
      res.json({ data: changes.decide(req.actor, parseChangeId(req.params.id), parseDecision(req.body)) });
    },
    cancel(req, res) {
      res.json({ data: changes.cancel(req.actor, parseChangeId(req.params.id), parseCancel(req.body)) });
    },
    list(req, res) {
      res.json(service.list(req.actor, parseList(req.query)));
    },
    evaluate(req, res) {
      res.json({ data: service.evaluate(req.actor, parseEvaluate(req.query)) });
    },
    patch(req, res) {
      const key = parseKey(req.params.key);
      const body = parsePatch(req.body);
      const saved = service.set(req.actor, key, body, req.correlationId);
      // staging and production: the change waits for a checker (audit AUD-DEF-009); 202 with the request it became
      if (saved.pending) { res.status(202).json({ data: { pending: true, request: saved.request } }); return; }
      res.json({ data: { id: saved.id, key: saved.key, enabled: saved.enabled === 1, version: saved.version } });
    },
  };
}
