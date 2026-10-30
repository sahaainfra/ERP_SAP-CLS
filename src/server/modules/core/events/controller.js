import { parseDlqList, parseEventList, parseId, parseReplay, parseResolution } from './validators.js';

export function createEventController(service) {
  return {
    metrics: (req, res) => res.json({ data: service.metrics(req.actor) }),
    types: (req, res) => res.json({ data: service.types(req.actor) }),
    consumers: (req, res) => res.json({ data: service.consumers(req.actor) }),
    list: (req, res) => res.json(service.list(req.actor, parseEventList(req.query))),
    dlq: (req, res) => res.json(service.dlq(req.actor, parseDlqList(req.query))),
    redrive: (req, res) => res.json({ data: service.redrive(req.actor, parseId(req.params.id), parseResolution(req.body), req.correlationId) }),
    discard: (req, res) => res.json({ data: service.discard(req.actor, parseId(req.params.id), parseResolution(req.body), req.correlationId) }),
    replay: (req, res) => res.status(202).json({ data: service.replay(req.actor, parseReplay(req.body), req.correlationId) }),
  };
}
