import { parseEvaluate, parseKey, parseList, parsePatch } from './validators.js';

/** Thin HTTP layer (BR-01): parse input, call the service, format output. No business rules here. */
export function createFlagController(service) {
  return {
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
      res.json({ data: { id: saved.id, key: saved.key, enabled: saved.enabled === 1, version: saved.version } });
    },
  };
}
