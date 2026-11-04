import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';

// Data hooks of the document service (part 04.10).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false).map(([k, v]) => [k, String(v)])).toString();
export const DOC = ['doc'];
const B = '/doc';

export const useDocuments = (filters) => useQuery({ queryKey: [...DOC, 'list', filters], queryFn: () => unwrap(api.get(`${B}/documents?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useDocument = (id) => useQuery({ queryKey: [...DOC, 'document', id], queryFn: () => unwrap(api.get(`${B}/documents/${id}`)), enabled: Boolean(id), retry: false });
export const useVersionLocate = (id) => useQuery({ queryKey: [...DOC, 'locate', id], queryFn: () => unwrap(api.get(`${B}/versions/${id}`)), enabled: Boolean(id), retry: false });
export const useFolders = (projectId) => useQuery({ queryKey: [...DOC, 'folders', projectId ?? 0], queryFn: () => unwrap(api.get(`${B}/folders?${qs({ projectId })}`)), retry: false });
export const useDocTypes = () => useQuery({ queryKey: [...DOC, 'types'], queryFn: () => unwrap(api.get(`${B}/types`)), retry: false, staleTime: 60_000 });
export const useCompare = (id, from, to) => useQuery({ queryKey: [...DOC, 'compare', id, from, to], queryFn: () => unwrap(api.get(`${B}/documents/${id}/compare?${qs({ from, to })}`)), enabled: Boolean(id && from && to), retry: false });
export const useAnnotations = (versionId) => useQuery({ queryKey: [...DOC, 'annotations', versionId], queryFn: () => unwrap(api.get(`${B}/versions/${versionId}/annotations`)), enabled: Boolean(versionId), retry: false });
export const useDocConfig = () => useQuery({ queryKey: [...DOC, 'config'], queryFn: () => unwrap(api.get(`${B}/config`)), retry: false });
export const documentsUrl = (format, filters) => `/api/v1${B}/documents/export?${qs({ ...filters, format })}`;
export { authHeaders };

/** The bytes of a revision, fetched with the person's own sign-in (the viewer and the downloads: nothing is opened by a link anyone could pass on). */
export async function fetchContent(versionId, { download = false } = {}) {
  const res = await fetch(`/api/v1${B}/versions/${versionId}/content${download ? '?download=1' : ''}`, { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
  if (!res.ok) { const body = await res.json().catch(() => null); const e = new Error(body?.error?.message ?? 'The file could not be opened.'); e.status = res.status; throw e; }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `revision-${versionId}`;
  return { buffer: await res.arrayBuffer(), type: res.headers.get('content-type') ?? 'application/octet-stream', name, status: res.headers.get('x-revision-status'), watermark: res.headers.get('x-watermark') };
}
export async function saveBlob(buffer, type, name) {
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
export async function downloadZip(ids) {
  const res = await fetch(`/api/v1${B}/documents/zip`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json', 'idempotency-key': globalThis.crypto.randomUUID() }, body: JSON.stringify({ ids }) });
  if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.error?.message ?? 'The files could not be prepared.'); }
  await saveBlob(await res.arrayBuffer(), 'application/zip', /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'documents.zip');
  return { included: Number(res.headers.get('x-included')), left: Number(res.headers.get('x-not-included')) };
}
export async function bulkSheet(file, commit) {
  const res = await fetch(`/api/v1${B}/bulk-upload?commit=${commit ? 1 : 0}`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/octet-stream', 'idempotency-key': globalThis.crypto.randomUUID() }, body: file });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'The sheet could not be read.');
  return body.data;
}
export async function downloadTemplate() {
  const res = await fetch(`/api/v1${B}/bulk-template`, { headers: authHeaders() });
  await saveBlob(await res.arrayBuffer(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'documents-to-register.xlsx');
}

const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: DOC }); qc.invalidateQueries({ queryKey: ['work'] }); } });
};
export const useCreateDocument = () => useWrite((body) => unwrap(api.post(`${B}/documents`, body, idem())));
export const useUpdateDocument = () => useWrite(({ id, ...body }) => unwrap(api.patch(`${B}/documents/${id}`, body, idem())));
export const useDocAction = () => useWrite(({ id, action, ...body }) => unwrap(api.post(`${B}/documents/${id}/${action}`, body, idem())));
export const useShare = () => useWrite(({ id, ...body }) => unwrap(api.post(`${B}/documents/${id}/shares`, body, idem())));
export const useUnshare = () => useWrite(({ id, shareId }) => unwrap(api.delete(`${B}/documents/${id}/shares/${shareId}`, idem())));
export const useAddAnnotation = () => useWrite(({ versionId, ...body }) => unwrap(api.post(`${B}/versions/${versionId}/annotations`, body, idem())));
export const useSetAnnotation = () => useWrite(({ id, ...body }) => unwrap(api.patch(`${B}/annotations/${id}`, body, idem())));
export const useCreateFolder = () => useWrite((body) => unwrap(api.post(`${B}/folders`, body, idem())));
export const useApplyTemplate = () => useWrite(({ projectId, template }) => unwrap(api.post(`${B}/projects/${projectId}/folder-template`, { template }, idem())));
export const useProposeDocConfig = () => useWrite((body) => unwrap(api.post(`${B}/config/changes`, body, idem())));
