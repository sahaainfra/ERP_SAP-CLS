import { parseCronPreview, parseId, parseJobAction, parseJobList, parseScheduleChange } from './validators.js';

export function createJobController(service) {
  return {
    types: (req, res) => res.json({ data: service.types(req.actor) }),
    list: (req, res) => res.json(service.list(req.actor, parseJobList(req.query))),
    get: (req, res) => res.json({ data: service.get(req.actor, parseId(req.params.id)) }),
    cancel: (req, res) => res.json({ data: service.cancel(req.actor, parseId(req.params.id), parseJobAction(req.body), req.correlationId) }),
    retry: (req, res) => res.status(201).json({ data: service.retry(req.actor, parseId(req.params.id), parseJobAction(req.body), req.correlationId) }),
    schedules: (req, res) => res.json({ data: service.schedules(req.actor) }),
    preview: (req, res) => res.json({ data: service.preview(req.actor, parseCronPreview(req.query)) }),
    requestChange: (req, res) => res.status(201).json({ data: service.requestChange(req.actor, parseId(req.params.id), parseScheduleChange(req.body)) }),
  };
}
