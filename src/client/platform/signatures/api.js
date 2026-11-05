import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';

// Data hooks of the signature service (part 04.12) and the two calls of the public verification page (no sign-in).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false).map(([k, v]) => [k, String(v)])).toString();
export const SIG = ['sig'];
const B = '/sig';

export const useSigRegister = (filters) => useQuery({ queryKey: [...SIG, 'register', filters], queryFn: () => unwrap(api.get(`${B}/register?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useSigDoc = (id) => useQuery({ queryKey: [...SIG, 'doc', id], queryFn: () => unwrap(api.get(`${B}/documents/${id}`)), enabled: Boolean(id), retry: false });
export const useSigConfig = () => useQuery({ queryKey: [...SIG, 'config'], queryFn: () => unwrap(api.get(`${B}/config`)), retry: false });
export const useSigProfile = () => useQuery({ queryKey: [...SIG, 'profile'], queryFn: () => unwrap(api.get(`${B}/profile`)), retry: false });
export const registerUrl = (format, filters) => `/api/v1${B}/register/export?${qs({ ...filters, format })}`;

const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: SIG }); qc.invalidateQueries({ queryKey: ['tpl'] }); } });
};
export const useSign = () => useWrite(({ id, ...body }) => unwrap(api.post(`${B}/documents/${id}/sign`, body, idem())));
export const useCancelDoc = () => useWrite(({ id, reason }) => unwrap(api.post(`${B}/documents/${id}/cancel`, { reason }, idem())));
export const useRevoke = () => useWrite(({ id, reason }) => unwrap(api.post(`${B}/signatures/${id}/revoke`, { reason }, idem())));
export const useSaveProfile = () => useWrite((image) => unwrap(api.put(`${B}/profile`, { image }, idem())));
export const useRemoveProfile = () => useWrite(() => unwrap(api.delete(`${B}/profile`, idem())));
export const useProposeSigConfig = () => useWrite((body) => unwrap(api.post(`${B}/config/changes`, body, idem())));
export { authHeaders };

/** The signed copy (or the original when nobody signed), fetched with the person's own sign-in. */
export async function fetchSigned(id) {
  const res = await fetch(`/api/v1${B}/documents/${id}/signed`, { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
  if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.error?.message ?? 'The document could not be opened.'); }
  return { blob: await res.blob(), name: /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'document.pdf' };
}

// ---- the public page: plain fetch, no sign-in, no session headers ----
const plain = async (path, init) => {
  const res = await fetch(`/api/v1/verify/${path}`, { ...init, headers: { 'x-correlation-id': globalThis.crypto.randomUUID(), ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(body?.error?.message ?? 'The check could not be made. Try again in a moment.'); e.status = res.status; e.correlationId = body?.error?.correlationId; throw e; }
  return body.data;
};
export const verifyCode = (code) => plain(encodeURIComponent(code));
export const verifyFile = async (code, file) => plain(`${encodeURIComponent(code)}/file`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
