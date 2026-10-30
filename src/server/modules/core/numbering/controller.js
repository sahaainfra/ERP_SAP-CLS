import { forbidden } from '../../../platform/http/errors.js';
import {
  parseDocTypeCreate,
  parseDocTypeUpdate,
  parseId,
  parseIssues,
  parseNext,
  parsePreview,
  parseSeriesChange,
  parseSeriesCreate,
  parseSeriesFilter,
  parseSeriesUpdate,
} from './validators.js';

export function createNumberingController(service) {
  return {
    listTypes: (req, res) => res.json({ data: service.listDocTypes(req.actor) }),
    createType: (req, res) => res.status(201).json({ data: service.createDocType(req.actor, parseDocTypeCreate(req.body), req.correlationId) }),
    updateType: (req, res) => res.json({ data: service.updateDocType(req.actor, parseId(req.params.id), parseDocTypeUpdate(req.body), req.correlationId) }),

    listSeries: (req, res) => res.json({ data: service.listSeries(req.actor, parseSeriesFilter(req.query)) }),
    getSeries: (req, res) => res.json({ data: service.getSeries(req.actor, parseId(req.params.id)) }),
    createSeries: (req, res) => res.status(201).json({ data: service.createSeries(req.actor, parseSeriesCreate(req.body), req.correlationId) }),
    updateSeries: (req, res) => res.json({ data: service.updateSeries(req.actor, parseId(req.params.id), parseSeriesUpdate(req.body), req.correlationId) }),
    requestChange: (req, res) => res.status(202).json({ data: service.requestSeriesChange(req.actor, parseId(req.params.id), parseSeriesChange(req.body)) }),

    preview: (req, res) => res.json({ data: service.preview(req.actor, parsePreview(req.query)) }),
    next(req, res) {
      const body = parseNext(req.body);
      if (body.companyId !== undefined && body.companyId !== req.actor.companyId) throw forbidden('You can only ask for numbers of your own company.');
      res.status(201).json({ data: service.next(req.actor, body) });
    },
    issues(req, res) {
      const q = parseIssues(req.query);
      res.json(service.issues(req.actor, q, q));
    },
  };
}
