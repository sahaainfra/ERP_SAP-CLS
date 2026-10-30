import { parseClose, parseCreate, parseId, parseReopen, parseStatus, parseYearList } from './validators.js';

export function createFinancialYearController(service) {
  return {
    list: (req, res) => res.json(service.list(req.actor, parseYearList(req.query))),
    get: (req, res) => res.json({ data: service.get(req.actor, parseId(req.params.id)) }),
    create: (req, res) => res.status(201).json({ data: service.create(req.actor, parseCreate(req.body)) }),
    setStatus: (req, res) => res.json({ data: service.setPeriodStatus(req.actor, parseId(req.params.id), parseStatus(req.body), req.correlationId) }),
    close: (req, res) => res.json({ data: service.closeYear(req.actor, parseId(req.params.id), parseClose(req.body), req.correlationId) }),
    requestReopen: (req, res) => res.status(201).json({ data: service.requestReopen(req.actor, parseReopen(req.body)) }),
  };
}
