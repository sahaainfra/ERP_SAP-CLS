import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';

// Inputs of the secure messaging API (part 05.03). Keys and envelopes are opaque text: only their shape is checked here, the service checks the rest.
const id = z.coerce.number().int().min(1);
const b64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Not valid base64 text').max(400);
const USER = z.string().trim().min(2).max(60);
const prekey = z.object({ id: z.number().int().min(0).max(2_147_483_647), publicKey: b64 }).strict();
const signed = z.object({ id: z.number().int().min(0).max(2_147_483_647), publicKey: b64, signature: b64 }).strict();
export const parseId = (v) => parse(id, v);
export const parseDeviceRegister = (b) => parse(z.object({
  name: z.string().trim().min(2, 'Name this device, for example "Pooja\'s phone"').max(60), platform: z.string().trim().max(40).optional(), registrationId: z.number().int().min(1).max(2_147_483_647),
  identityKey: b64, signedPrekey: signed, oneTimePrekeys: z.array(prekey).max(100).default([]),
}).strict(), b);
export const parseRevoke = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(300) }).strict(), b);
export const parsePrekeyUpload = (b) => parse(z.object({ signedPrekey: signed.optional(), oneTimePrekeys: z.array(prekey).max(100).default([]) }).strict().refine((o) => o.signedPrekey || o.oneTimePrekeys.length, 'Send at least one key'), b);
export const parseBundleQuery = (q) => parse(z.object({ consume: z.enum(['0', '1']).default('0').transform((v) => v === '1') }).strict(), q);
export const parseSecureCreate = (b) => parse(z.object({ members: z.array(USER).min(1, 'Choose at least one person').max(20), title: z.string().trim().max(120).optional(), disappearSeconds: z.number().int().min(0).max(31_536_000).optional() }).strict(), b);
export const parseDisappear = (b) => parse(z.object({ seconds: z.number().int().min(0).max(31_536_000) }).strict(), b);
export const parseBundles = (q) => parse(z.object({ device: id }).strict(), q);
export const parseEnvelopes = (b) => parse(z.object({
  conversationId: id, senderDeviceId: id, messageUid: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, 'A unique id of 16 to 64 letters, digits or dashes'),
  envelopes: z.array(z.object({ recipientDeviceId: id.transform(Number), ciphertext: z.string().min(16).max(262_144) }).strict()).min(1).max(200),
}).strict(), b);
export const parseFetch = (q) => parse(z.object({ device: id, since: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(100) }).strict(), q);
export const parseAck = (b) => parse(z.object({ deviceId: id, ids: z.array(id).min(1).max(500) }).strict(), b);
export const parseCard = (q) => parse(z.object({ entity: z.string().regex(/^[a-z][a-z_]*$/).max(60), id: z.string().trim().min(1).max(60) }).strict(), q);
export const parseDevicesAdmin = (q) => parse(z.object({ user: USER.optional() }).strict(), q);
export const parseRegisterQuery = (q) => parse(z.object({ q: z.string().trim().max(80).optional(), status: z.enum(['TO_REVIEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'NOT_USED']).optional(), licence: z.enum(['copyleft', 'permissive']).optional() }).strict(), q);
