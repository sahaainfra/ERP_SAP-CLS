import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';

// Data hooks of the template, generation and delivery service (part 04.11).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false).map(([k, v]) => [k, String(v)])).toString();
export const TPL = ['tpl'];
const B = '/tpl';

export const useTemplates = (filters) => useQuery({ queryKey: [...TPL, 'templates', filters], queryFn: () => unwrap(api.get(`${B}/templates?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useTemplate = (id) => useQuery({ queryKey: [...TPL, 'template', id], queryFn: () => unwrap(api.get(`${B}/templates/${id}`)), enabled: Boolean(id), retry: false });
export const useCatalogue = (docType) => useQuery({ queryKey: [...TPL, 'catalogue', docType], queryFn: () => unwrap(api.get(`${B}/templates/catalogue?${qs({ docType })}`)), enabled: Boolean(docType), retry: false, staleTime: 60_000 });
export const useTplRecords = (filters) => useQuery({ queryKey: [...TPL, 'records', filters], queryFn: () => unwrap(api.get(`${B}/records?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useGenerated = (filters) => useQuery({ queryKey: [...TPL, 'generated', filters], queryFn: () => unwrap(api.get(`${B}/generated?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useGeneratedDoc = (id) => useQuery({ queryKey: [...TPL, 'generated-one', id], queryFn: () => unwrap(api.get(`${B}/generated/${id}`)), enabled: Boolean(id), retry: false });
export const useBulkJob = (id) => useQuery({ queryKey: [...TPL, 'bulk', id], queryFn: () => unwrap(api.get(`${B}/generate/bulk/${id}`)), enabled: Boolean(id), retry: false, refetchInterval: (q) => (['DONE', 'FAILED', 'CANCELLED'].includes(q.state.data?.status) ? false : 1500) });
export const useRules = () => useQuery({ queryKey: [...TPL, 'rules'], queryFn: () => unwrap(api.get(`${B}/rules`)), retry: false });
export const generatedUrl = (format, filters) => `/api/v1${B}/generated/export?${qs({ ...filters, format })}`;

const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: TPL }); qc.invalidateQueries({ queryKey: ['work'] }); } });
};
export const useCreateTemplate = () => useWrite((body) => unwrap(api.post(`${B}/templates`, body, idem())));
export const useUpdateTemplate = () => useWrite(({ id, ...body }) => unwrap(api.patch(`${B}/templates/${id}`, body, idem())));
export const useSubmitTemplate = () => useWrite((id) => unwrap(api.post(`${B}/templates/${id}/submit`, {}, idem())));
export const useDiscardTemplate = () => useWrite((id) => unwrap(api.delete(`${B}/templates/${id}`, idem())));
export const useGenerate = () => useWrite((body) => unwrap(api.post(`${B}/generate`, body, idem())));
export const useGenerateBulk = () => useWrite((body) => unwrap(api.post(`${B}/generate/bulk`, body, idem())));
export const useDeliver = () => useWrite(({ id, ...body }) => unwrap(api.post(`${B}/generated/${id}/deliver`, body, idem())));
export const useSetRule = () => useWrite((body) => unwrap(api.put(`${B}/rules`, body, idem())));
export const useValidate = () => useMutation({ mutationFn: (body) => unwrap(api.post(`${B}/templates/validate`, body)) });
export { authHeaders };

const fail = async (res, fallback) => { const body = await res.json().catch(() => null); const e = new Error(body?.error?.message ?? fallback); e.status = res.status; e.correlationId = body?.error?.correlationId; e.details = body?.error?.details ?? []; return e; };
/** A PDF fetched with the person's own sign-in; the page shows it from a local address (nothing a link anyone could pass on). */
export async function fetchPdf(path, init = {}) {
  const res = await fetch(`/api/v1${B}${path}`, { ...init, headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID(), ...(init.headers ?? {}) } });
  if (!res.ok) throw await fail(res, 'The document could not be opened.');
  return { blob: await res.blob(), name: /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'document.pdf', pages: Number(res.headers.get('x-pdf-pages') ?? 0) };
}
export const previewPdf = (body) => fetchPdf('/templates/preview', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': globalThis.crypto.randomUUID() }, body: JSON.stringify(body) });
export const openGenerated = (id, download = false) => fetchPdf(`/generated/${id}/content${download ? '?download=1' : ''}`);
