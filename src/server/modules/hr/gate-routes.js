import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Part 07.14 (built in 166.6): the gates G1–G4. Rights are checked in the service (hr.gate.view, hr.gate.review, hr.gate.export).
const code = z.enum(['G1', 'G2', 'G3', 'G4']);
const criterion = z.string().regex(/^G[1-4]-(P\d{2}\.\d{2}|DEF)$/, 'A criterion such as G2-P07.01 or G2-DEF');
const parseCode = (v) => parse(code, v);
const parseCriterion = (v) => parse(criterion, v);
const parseReview = (b) => parse(z.object({ status: z.enum(['OPEN', 'MET', 'NOT_MET']), note: z.string().trim().max(1000).nullish(), version: z.number().int().min(1).optional() }).strict(), b);
const parseSubmit = (b) => parse(z.object({ comment: z.string().trim().max(1000).optional() }).strict(), b ?? {});
const parseEvidence = (q) => parse(z.object({ path: z.string().min(1).max(300) }).strict(), q);

/** @param {{ gates: any }} services @param {{ idempotent?: any, idempotentRequired: any }} middleware */
export function gateRoutes({ gates }, { idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, out, inline = true) => res.set({ 'content-type': out.contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(out.fileName ? { 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${out.fileName}"` } : {}) }).send(out.buffer);
  r.get('/gates', (req, res) => ok(res, gates.list(req.actor)));
  r.get('/gates/evidence', (req, res) => file(res, gates.evidence(req.actor, parseEvidence(req.query).path)));
  r.get('/gates/:code', (req, res) => ok(res, gates.get(req.actor, parseCode(req.params.code))));
  r.get('/gates/:code/report', async (req, res) => file(res, await gates.report(req.actor, parseCode(req.params.code)), false));
  r.post('/gates/:code/criteria/:criterion', idempotentRequired, (req, res) => ok(res, gates.review(req.actor, parseCode(req.params.code), parseCriterion(req.params.criterion), parseReview(req.body))));
  r.post('/gates/:code/submit', idempotentRequired, (req, res) => ok(res, gates.submit(req.actor, parseCode(req.params.code), parseSubmit(req.body))));
  return r;
}
