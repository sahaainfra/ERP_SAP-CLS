import { parseCancel, parseCreate, parseId, parsePreview, parseSampleList, parseSubmit } from './validators.js';

export function createSampleDocumentController(service) {
  return {
    list: (req, res) => res.json(service.list(req.actor, parseSampleList(req.query))),
    create: (req, res) => res.status(201).json({ data: service.create(req.actor, parseCreate(req.body), req.correlationId) }),
    submit: (req, res) => res.json({ data: service.submit(req.actor, parseId(req.params.id), parseSubmit(req.body), req.correlationId) }),
    cancel: (req, res) => res.json({ data: service.cancel(req.actor, parseId(req.params.id), parseCancel(req.body), req.correlationId) }),
    preview: (req, res) => res.json({ data: service.previewNumber(req.actor, parsePreview(req.query)) }),
  };
}
