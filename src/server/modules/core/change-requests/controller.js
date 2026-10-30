import { parseAct, parseId, parseRequestList, parseResubmit } from './validators.js';

export function createChangeRequestController(service) {
  return {
    list: (req, res) => res.json(service.list(req.actor, parseRequestList(req.query))),
    get: (req, res) => res.json({ data: service.get(req.actor, parseId(req.params.id)) }),
    act: (req, res) => res.json({ data: service.act(req.actor, parseId(req.params.id), parseAct(req.body)) }),
    resubmit: (req, res) => res.json({ data: service.resubmit(req.actor, parseId(req.params.id), parseResubmit(req.body)) }),
    withdraw: (req, res) => res.json({ data: service.withdraw(req.actor, parseId(req.params.id)) }),
  };
}
