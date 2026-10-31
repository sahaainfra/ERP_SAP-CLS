import { Router } from 'express';
import { parseAuditList, parseExportLog, parseHistory, parsePeriod, parseSecurityList } from './validators.js';

/** The audit trail viewer, chain verification, sealed segments, security events and the export log (part 02.06), under /api/v1/core. */
export function auditRoutes(service, { idempotent }) {
  const r = Router();
  r.get('/audit', (req, res) => res.json(service.list(req.actor, parseAuditList(req.query))));
  r.get('/audit/entities', (req, res) => res.json({ data: service.entities(req.actor) }));
  r.get('/audit/history', (req, res) => { const q = parseHistory(req.query); res.json({ data: service.history(req.actor, q) }); });
  r.get('/audit/verification', (req, res) => res.json({ data: service.verification(req.actor) }));
  r.post('/audit/verify', idempotent, (req, res) => res.json({ data: service.verifyNow(req.actor) }));
  r.get('/audit/segments', (req, res) => res.json({ data: service.segments(req.actor) }));
  r.get('/audit/segments/:period/export', (req, res) => {
    const out = service.exportSegment(req.actor, parsePeriod(req.params.period));
    res.set('x-audit-head-hash', out.head).type('application/x-ndjson').send(`${out.lines.join('\n')}\n`);
  });
  r.post('/audit/export-log', idempotent, (req, res) => res.status(201).json({ data: service.logExport(req.actor, parseExportLog(req.body)) }));
  r.get('/security-events', (req, res) => res.json(service.securityEvents(req.actor, parseSecurityList(req.query))));
  return r;
}
