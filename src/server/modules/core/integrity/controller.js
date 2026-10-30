import { parseRuns } from './validators.js';

export function createIntegrityController(service) {
  return {
    run(req, res) {
      res.status(201).json({ data: service.run(req.actor, req.correlationId) });
    },
    summary(req, res) {
      res.json({ data: service.summary(req.actor) });
    },
    runs(req, res) {
      res.json(service.runs(req.actor, parseRuns(req.query)));
    },
  };
}
