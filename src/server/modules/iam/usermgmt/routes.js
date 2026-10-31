import express, { Router } from 'express';
import { HttpError, badRequest } from '../../../platform/http/errors.js';
import { createRateLimiter } from '../../../platform/integrations/breaker.js';
import { IMPORT_TEMPLATE } from './import.js';
import {
  parseAccept, parseBulk, parseCreate, parseDeactivate, parseDuplicates, parseHistoryList, parseId, parseImport, parseInvite, parseMePatch, parsePatch, parseReasonVersion, parseRoleRequest, parseRoleRevoke,
  parseToken, parseUserExport, parseUserList,
} from './validators.js';

const ctxOf = (req) => ({ correlationId: req.correlationId });
const CSV_LIMIT = '2mb';

/** User administration (part 02.03), mounted at /api/v1/iam/users. Static paths come first so they are never read as a user ID. */
export function userRoutes(service, { idempotentRequired }) {
  const r = Router();
  const id = (req) => parseId(req.params.id);
  // The import file is text; JSON is accepted too ({ "csv": "..." }) for small files.
  const csvBody = express.text({ type: ['text/csv', 'text/plain'], limit: CSV_LIMIT });
  const idempotentWhenCommitting = (req, res, next) => (req.query.mode === 'commit' ? idempotentRequired(req, res, next) : next());

  r.get('/', (req, res) => res.json(service.list(req.actor, parseUserList(req.query))));
  r.get('/roles', (req, res) => res.json({ data: service.roles(req.actor) }));
  r.get('/duplicates', (req, res) => res.json({ data: service.findDuplicates(req.actor, parseDuplicates(req.query)) }));
  // A download of people's records: needs iam.user.export, is limited in size, needs an approval above the threshold and is logged (FR-08).
  r.post('/export', idempotentRequired, (req, res) => {
    const out = service.exportUsers(req.actor, parseUserExport(req.body));
    if (out.status === 'APPROVAL_REQUIRED') return res.status(202).json({ data: out });
    return res.type('text/csv').set({ 'content-disposition': 'attachment; filename="users.csv"', 'x-export-rows': String(out.rows) }).send(out.csv);
  });
  r.get('/import/template', (req, res) => {
    res.type('text/csv').set('content-disposition', 'attachment; filename="users-import-template.csv"').send(IMPORT_TEMPLATE);
  });
  r.post('/import', csvBody, idempotentWhenCommitting, async (req, res) => {
    const text = typeof req.body === 'string' ? req.body : req.body?.csv;
    if (typeof text !== 'string') throw badRequest('Send the CSV file as the request body (Content-Type: text/csv).');
    res.json({ data: await service.importUsers(req.actor, text, parseImport(req.query)) });
  });
  r.post('/bulk', idempotentRequired, async (req, res) => res.json({ data: await service.bulk(req.actor, parseBulk(req.body)) }));
  r.post('/', idempotentRequired, async (req, res) => res.status(201).json({ data: await service.create(req.actor, parseCreate(req.body)) }));

  r.get('/:id', (req, res) => res.json({ data: service.get(req.actor, id(req)) }));
  r.patch('/:id', (req, res) => res.json({ data: service.update(req.actor, id(req), parsePatch(req.body)) }));
  r.get('/:id/sessions', (req, res) => res.json({ data: service.sessions(req.actor, id(req)) }));
  r.get('/:id/login-events', (req, res) => res.json(service.loginEvents(req.actor, id(req), parseHistoryList(req.query))));
  r.get('/:id/timeline', (req, res) => res.json({ data: service.timeline(req.actor, id(req)) }));
  r.get('/:id/deactivation-check', (req, res) => res.json({ data: service.deactivationCheck(req.actor, id(req)) }));
  r.post('/:id/invite', idempotentRequired, async (req, res) => res.json({ data: await service.invite(req.actor, id(req), parseInvite(req.body)) }));
  r.delete('/:id/invitation', (req, res) => res.json({ data: service.revokeInvitation(req.actor, id(req)) }));
  r.post('/:id/suspend', idempotentRequired, (req, res) => res.json({ data: service.suspend(req.actor, id(req), parseReasonVersion(req.body)) }));
  r.post('/:id/reactivate', idempotentRequired, (req, res) => res.json({ data: service.reactivate(req.actor, id(req), parseReasonVersion(req.body)) }));
  r.post('/:id/deactivate', idempotentRequired, (req, res) => res.json({ data: service.deactivate(req.actor, id(req), parseDeactivate(req.body)) }));
  r.post('/:id/role-requests', idempotentRequired, (req, res) => res.status(201).json({ data: service.requestRoles(req.actor, id(req), parseRoleRequest(req.body)) }));
  r.post('/:id/roles/revoke', idempotentRequired, (req, res) => res.json({ data: service.revokeRoles(req.actor, id(req), parseRoleRevoke(req.body)) }));
  return r;
}

/** PATCH /api/v1/iam/me: the signed-in person's own profile. (GET /me is part 02.01.) */
export function meRoutes(service) {
  const r = Router();
  r.patch('/me', (req, res) => res.json({ data: service.updateMe(req.actor, parseMePatch(req.body)) }));
  return r;
}

/** The invitation link, before there is a sign-in: look at it, then accept it by choosing a password. Rate limited per address. */
export function invitationRoutes(service) {
  const r = Router();
  const limiter = createRateLimiter();
  const limit = (name, perMinute) => (req, _res, next) =>
    limiter.take(`${name}:${req.ip}`, perMinute).ok ? next() : next(new HttpError(429, 'RATE_LIMITED', 'Too many attempts from this address. Wait a minute and try again.'));
  r.get('/invitations/:token', limit('invite-look', 30), (req, res) => res.json({ data: service.invitationInfo(parseToken(req.params.token)) }));
  r.post('/invitations/:token/accept', limit('invite-accept', 10), async (req, res) => res.json({ data: await service.accept(parseToken(req.params.token), parseAccept(req.body), ctxOf(req)) }));
  return r;
}
