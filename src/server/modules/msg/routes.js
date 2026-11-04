import { Router } from 'express';
import { parseAddMembers, parseArchive, parseConvCreate, parseConvList, parseDelete, parseEdit, parseForward, parseId, parseMemberName, parseMemberRole, parseMessages, parsePeople, parseRead, parseRecordSearch, parseReact, parseRename, parseSend, parseSettings } from './validators.js';

/** Part 05.01: the Messages API. Every route needs a signed-in person; membership of the conversation (BR-01) is checked in the service. */
export function messageRoutes({ service }, { idempotent }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/people', (req, res) => ok(res, { rows: service.people(req.actor, parsePeople(req.query).q) }));
  r.get('/record-types', (req, res) => ok(res, { rows: service.records.types(req.actor) }));
  r.get('/records', (req, res) => ok(res, { rows: service.records.search(req.actor, parseRecordSearch(req.query)) }));
  r.get('/conversations', (req, res) => ok(res, service.conversations.list(req.actor, parseConvList(req.query))));
  r.post('/conversations', idempotent, (req, res) => { const out = service.conversations.create(req.actor, parseConvCreate(req.body)); ok(res, out, out.created ? 201 : 200); });
  r.get('/unread', (req, res) => ok(res, { unread: service.conversations.unreadCount(req.actor) }));
  r.get('/conversations/:id', (req, res) => ok(res, service.conversations.details(req.actor, parseId(req.params.id))));
  r.patch('/conversations/:id', idempotent, (req, res) => ok(res, service.conversations.rename(req.actor, parseId(req.params.id), parseRename(req.body))));
  r.put('/conversations/:id/settings', idempotent, (req, res) => ok(res, service.conversations.settings(req.actor, parseId(req.params.id), parseSettings(req.body))));
  r.post('/conversations/:id/archive', idempotent, (req, res) => ok(res, service.conversations.archive(req.actor, parseId(req.params.id), parseArchive(req.body))));
  r.post('/conversations/:id/read', (req, res) => ok(res, service.conversations.read(req.actor, parseId(req.params.id), parseRead(req.body))));
  r.get('/conversations/:id/messages', (req, res) => ok(res, service.messages.list(req.actor, parseId(req.params.id), parseMessages(req.query))));
  r.post('/conversations/:id/messages', idempotent, (req, res) => ok(res, service.messages.send(req.actor, parseId(req.params.id), parseSend(req.body)), 201));
  r.post('/conversations/:id/members', idempotent, (req, res) => ok(res, service.members.add(req.actor, parseId(req.params.id), parseAddMembers(req.body))));
  r.delete('/conversations/:id/members/:user', idempotent, (req, res) => ok(res, service.members.remove(req.actor, parseId(req.params.id), parseMemberName(req.params.user))));
  r.patch('/conversations/:id/members/:user', idempotent, (req, res) => ok(res, service.members.role(req.actor, parseId(req.params.id), parseMemberName(req.params.user), parseMemberRole(req.body))));
  r.patch('/messages/:id', idempotent, (req, res) => ok(res, service.messages.edit(req.actor, parseId(req.params.id), parseEdit(req.body))));
  r.delete('/messages/:id', idempotent, (req, res) => ok(res, service.messages.remove(req.actor, parseId(req.params.id), parseDelete(Object.keys(req.body ?? {}).length ? req.body : { reason: req.query.reason }))));
  r.post('/messages/:id/reactions', idempotent, (req, res) => ok(res, service.messages.react(req.actor, parseId(req.params.id), parseReact(req.body))));
  r.post('/messages/:id/forward', idempotent, (req, res) => ok(res, service.messages.forward(req.actor, parseId(req.params.id), parseForward(req.body)), 201));
  r.get('/verify', (req, res) => ok(res, service.admin.verify(req.actor)));
  r.get('/conversations/:id/export', (req, res) => { const out = service.admin.exportConversation(req.actor, parseId(req.params.id)); res.status(200).set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store' }).send(out.text); });
  return r;
}
