import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the Messages API (part 05.01). The service checks the rules again; these reject malformed input at the door.
const id = z.coerce.number().int().min(1);
const text = (max) => z.string().trim().max(max);
const USER = z.string().trim().min(2).max(60);
const ENTITY = z.string().regex(/^[a-z][a-z_]*$/).max(60);
export const parseId = (v) => parse(id, v);
export const parseConvList = (q) => parse(z.object({ q: text(80).optional(), view: z.enum(['all', 'unread', 'pinned', 'archived', 'DIRECT', 'GROUP', 'DEPARTMENT', 'PROJECT', 'SITE', 'TEAM', 'RECORD', 'EXTERNAL']).default('all'), limit: z.coerce.number().int().min(1).max(200).default(100), offset: z.coerce.number().int().min(0).default(0) }).strict(), q);
export const parseConvCreate = (b) => parse(z.object({
  type: z.enum(['DIRECT', 'GROUP', 'TEAM', 'PROJECT', 'SITE', 'DEPARTMENT', 'RECORD']), title: text(120).optional(), members: z.array(USER).max(200).default([]),
  projectId: id.optional(), siteId: id.optional(), departmentId: id.optional(), entity: ENTITY.optional(), entityId: z.union([z.string().trim().min(1).max(60), z.number().int()]).transform(String).optional(),
}).strict(), b);
export const parseSettings = (b) => parse(z.object({ pinned: z.boolean().optional(), archived: z.boolean().optional(), mentionOnly: z.boolean().optional(), mutedUntil: z.string().datetime().nullable().optional() }).strict().refine((o) => Object.keys(o).length > 0, 'Say what to change'), b);
export const parseRename = (b) => parse(z.object({ title: text(120).min(1, 'Give the conversation a name') }).strict(), b);
export const parseArchive = (b) => parse(z.object({ archived: z.boolean() }).strict(), b);
export const parseRead = (b) => parse(z.object({ upTo: id.optional() }).strict(), b ?? {});
export const parseMessages = (q) => parse(z.object({ before: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(40) }).strict(), q);
export const parseSend = (b) => parse(z.object({
  body: z.string().max(4000).default(''), kind: z.enum(['TEXT', 'VOICE']).default('TEXT'), replyToId: id.optional(), clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  attachments: z.array(id).max(10).default([]), recordLinks: z.array(z.object({ entity: ENTITY, id: z.union([z.string().trim().min(1).max(60), z.number().int()]).transform(String) }).strict()).max(5).default([]),
}).strict(), b);
export const parseEdit = (b) => parse(z.object({ body: z.string().max(4000) }).strict(), b);
export const parseDelete = (b) => parse(z.object({ reason: text(300).optional() }).strict(), b ?? {});
export const parseReact = (b) => parse(z.object({ emoji: z.string().min(1).max(8), on: z.boolean().default(true) }).strict(), b);
export const parseForward = (b) => parse(z.object({ conversationIds: z.array(id).min(1).max(5) }).strict(), b);
export const parseAddMembers = (b) => parse(z.object({ users: z.array(USER).min(1).max(100) }).strict(), b);
export const parseMemberRole = (b) => parse(z.object({ role: z.enum(['ADMIN', 'MEMBER']) }).strict(), b);
export const parseMemberName = (v) => parse(USER, v);
export const parsePeople = (q) => parse(z.object({ q: text(60).optional() }).strict(), q);
export const parseRecordSearch = (q) => parse(z.object({ type: ENTITY, q: text(60).optional() }).strict(), q);
