import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';

// Data hooks of the Excel engine (part 04.13).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false).map(([k, v]) => [k, String(v)])).toString();
export const XL = ['xl'];
const B = '/xl';
const LIVE = ['UPLOADED', 'VALIDATING', 'COMMITTING'];

export const useImportTypes = () => useQuery({ queryKey: [...XL, 'types'], queryFn: () => unwrap(api.get(`${B}/templates`)), retry: false });
export const useJobs = (filters) => useQuery({ queryKey: [...XL, 'jobs', filters], queryFn: () => unwrap(api.get(`${B}/jobs?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev, refetchInterval: (q) => (q.state.data?.rows?.some((r) => LIVE.includes(r.status)) ? 2000 : false) });
export const useJob = (id) => useQuery({ queryKey: [...XL, 'job', id], queryFn: () => unwrap(api.get(`${B}/jobs/${id}`)), enabled: Boolean(id), retry: false, refetchInterval: (q) => (LIVE.includes(q.state.data?.status) ? 1200 : false) });
export const usePreview = (id, page, enabled) => useQuery({ queryKey: [...XL, 'preview', id, page], queryFn: () => unwrap(api.get(`${B}/jobs/${id}/preview?${qs({ limit: 50, offset: (page - 1) * 50 })}`)), enabled: Boolean(id) && enabled, retry: false, placeholderData: (prev) => prev });
export const useErrors = (id, page, enabled) => useQuery({ queryKey: [...XL, 'errors', id, page], queryFn: () => unwrap(api.get(`${B}/jobs/${id}/errors?${qs({ limit: 100, offset: (page - 1) * 100 })}`)), enabled: Boolean(id) && enabled, retry: false, placeholderData: (prev) => prev });
export const useDesigner = () => useQuery({ queryKey: [...XL, 'designer'], queryFn: () => unwrap(api.get(`${B}/designer`)), retry: false });
export const jobsExportUrl = (format, filters) => `/api/v1${B}/exports/xl.jobs?${qs({ ...filters, format })}`;

const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: XL }); qc.invalidateQueries({ queryKey: ['work'] }); } });
};
export const useCommit = () => useWrite(({ id, ...body }) => unwrap(api.post(`${B}/jobs/${id}/commit`, body, idem())));
export const useCancel = () => useWrite((id) => unwrap(api.post(`${B}/jobs/${id}/cancel`, {}, idem())));
export const useProposeTemplate = () => useWrite((body) => unwrap(api.post(`${B}/designer/changes`, body, idem())));
export { authHeaders };

const fail = async (res, fallback) => { const body = await res.json().catch(() => null); const e = new Error(body?.error?.message ?? fallback); e.status = res.status; e.correlationId = body?.error?.correlationId; e.details = body?.error?.details ?? []; return e; };
/** The filled template goes up as the raw bytes of the request. */
export async function uploadFile({ type, file, onExisting }) {
  const res = await fetch(`/api/v1${B}/jobs?${qs({ type, onExisting, fileName: file.name })}`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/octet-stream', 'idempotency-key': globalThis.crypto.randomUUID(), 'x-correlation-id': globalThis.crypto.randomUUID() }, body: file });
  if (!res.ok) throw await fail(res, 'The file could not be uploaded.');
  return (await res.json()).data;
}
/** A file the engine builds (a template, an error file, an export), fetched with the person's own sign-in and saved. */
export async function saveFrom(path, fallbackName) {
  const res = await fetch(`/api/v1${B}${path}`, { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
  if (!res.ok) throw await fail(res, 'The file could not be prepared.');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}
