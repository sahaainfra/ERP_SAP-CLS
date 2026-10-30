import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { receiveMultipart } from './multipart.js';
import {
  parseAdminList, parseBegin, parseContentQuery, parseFields, parseId, parseListFiles, parseOffset, parseReason, parseSettingsChange, parseUploadId, parseUrl,
} from './validators.js';

export function createFileController(service, { tmpRoot = service.tmpRoot ?? join(tmpdir(), 'erp-uploads') } = {}) {
  return {
    begin: async (req, res) => res.status(201).json({ data: await service.beginUpload(req.actor, parseBegin(req.body)) }),
    getUpload: (req, res) => res.json({ data: service.getUpload(req.actor, parseUploadId(req.params.uploadId)) }),
    chunk: async (req, res) => res.json({ data: await service.appendChunk(req.actor, parseUploadId(req.params.uploadId), parseOffset(req.query).offset, req) }),
    complete: async (req, res) => res.status(201).json({ data: await service.completeUpload(req.actor, parseUploadId(req.params.uploadId), req.correlationId) }),
    upload: async (req, res) => {
      const { fields, file } = await receiveMultipart(req, { tmpRoot, maxBytes: service.maxUploadBytes(req.actor) });
      const f = parseFields(fields);
      res.status(201).json({ data: await service.ingestUpload(req.actor, { tempPath: file.path, fileName: file.name, ...f }, req.correlationId) });
    },
    list: (req, res) => res.json({ data: service.list(req.actor, parseListFiles(req.query)) }),
    get: (req, res) => res.json({ data: service.get(req.actor, parseId(req.params.id)) }),
    url: (req, res) => res.json({ data: service.signedUrl(req.actor, parseId(req.params.id), parseUrl(req.query), req.correlationId) }),
    remove: (req, res) => res.json({ data: service.remove(req.actor, parseId(req.params.id), parseReason(req.body), req.correlationId) }),
    rescan: (req, res) => res.json({ data: service.rescan(req.actor, parseId(req.params.id), req.correlationId) }),
    settings: (req, res) => res.json({ data: service.getSettings(req.actor) }),
    requestSettingsChange: (req, res) => res.status(201).json({ data: service.requestSettingsChange(req.actor, parseSettingsChange(req.body)) }),
    overview: (req, res) => res.json({ data: service.overview(req.actor) }),
    admin: (req, res) => res.json(service.listAdmin(req.actor, parseAdminList(req.query))),
    content: async (req, res) => {
      const out = await service.openContent(parseId(req.params.id), parseContentQuery(req.query), req.get('range'));
      res.status(out.status).set(out.headers);
      if (!out.stream) return res.end();
      await pipeline(out.stream, res);
    },
  };
}
