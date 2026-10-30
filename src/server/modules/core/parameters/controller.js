import { parseParameterList, parseResolve, parseSet } from './validators.js';

export function createParameterController(service) {
  return {
    definitions: (req, res) => res.json({ data: service.definitions(req.actor) }),
    list: (req, res) => res.json(service.list(req.actor, parseParameterList(req.query))),
    resolve: (req, res) => res.json({ data: service.resolve(req.actor, parseResolve(req.query)) }),
    set: (req, res) => res.status(201).json({ data: service.set(req.actor, parseSet(req.body), req.correlationId) }),
  };
}
