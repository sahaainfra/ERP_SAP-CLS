import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';

// Data hooks of the ui module (part 03.01): a person's screen preferences and the style guide.
const unwrap = async (promise) => (await promise).data;

export const usePreferences = (enabled = true) => useQuery({ queryKey: ['ui', 'preferences'], queryFn: () => unwrap(api.get('/ui/preferences')), enabled, retry: false, staleTime: 60_000 });
export const useStyleGuide = () => useQuery({ queryKey: ['ui', 'style-guide'], queryFn: () => unwrap(api.get('/ui/style-guide')), retry: false });

export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => unwrap(api.patch('/ui/preferences', body)),
    onSuccess: (data) => qc.setQueryData(['ui', 'preferences'], data),
  });
}

// ---- part 03.02: drafts, form definitions and the reference form ----
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null)).toString();

export const useMyDrafts = ({ page = 1, pageSize = 25, q = '', sort = '-savedAt', formCode = '' } = {}) =>
  useQuery({ queryKey: ['ui', 'drafts', page, pageSize, q, sort, formCode], queryFn: () => api.get(`/ui/drafts?${qs({ page, pageSize, q, sort, 'filter[formCode]': formCode })}`), retry: false, placeholderData: (prev) => prev });
export async function fetchAllDrafts({ q = '', formCode = '' } = {}) {
  const out = [];
  for (let page = 1; page <= 50; page += 1) {
    const r = await api.get(`/ui/drafts?${qs({ page, pageSize: 100, q, 'filter[formCode]': formCode })}`);
    out.push(...r.data);
    if (page >= r.meta.totalPages) break;
  }
  return out;
}
export function useDiscardDrafts() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (ids) => unwrap(api.post('/ui/drafts/discard', { ids })), onSuccess: () => qc.invalidateQueries({ queryKey: ['ui', 'drafts'] }) });
}
export const useFormDefinition = (code) => useQuery({ queryKey: ['ui', 'form', code], queryFn: () => unwrap(api.get(`/ui/forms/${code}`)), staleTime: 5 * 60_000, retry: false });
export const useFormRegistry = () => useQuery({ queryKey: ['ui', 'form-registry'], queryFn: () => unwrap(api.get('/ui/form-registry')), retry: false });

export const useSampleRequest = (id) => useQuery({ queryKey: ['ui', 'sample-request', id], queryFn: () => unwrap(api.get(`/ui/sample-requests/${id}`)), enabled: Boolean(id), retry: false });
export const createFromSource = (target, source, id) => unwrap(api.get(`/ui/create-from/${target}?${qs({ source, id })}`));
export function useSampleRequestActions() {
  const qc = useQueryClient();
  const done = (data) => { qc.setQueryData(['ui', 'sample-request', data.id], data); qc.invalidateQueries({ queryKey: ['list', '/ui/sample-requests'] }); return data; };
  return {
    create: (body) => unwrap(api.post('/ui/sample-requests', body, idem())).then(done),
    update: (id, body) => unwrap(api.put(`/ui/sample-requests/${id}`, body, idem())).then(done),
    submit: (id, version) => unwrap(api.post(`/ui/sample-requests/${id}/submit`, { version }, idem())).then(done),
    cancel: (id, version, reason, reasonCode) => unwrap(api.post(`/ui/sample-requests/${id}/cancel`, { version, reason, reasonCode }, idem())).then(done),
    decide: (id, body) => unwrap(api.post(`/ui/sample-requests/${id}/decision`, body, idem())).then(done),
  };
}

// ---- part 03.03: bulk actions and list exports ----
export function useSampleRequestBulk() {
  return (action, ids, { reason, reasonCode } = {}) => unwrap(api.post('/ui/sample-requests/bulk', { action, ids, ...(reason ? { reason } : {}), ...(reasonCode ? { reasonCode } : {}) }, idem()));
}
/** PACK-10: which selected requests this person may submit or cancel, and why not, before anything runs. */
export const sampleRequestBulkPreview = (action, ids) => unwrap(api.post('/ui/sample-requests/bulk/preview', { action, ids }));
export const useMyExports = () => useQuery({ queryKey: ['ui', 'exports'], queryFn: () => unwrap(api.get('/ui/exports')), retry: false, refetchInterval: (q) => ((q.state.data ?? []).some((e) => ['QUEUED', 'RUNNING'].includes(e.status)) ? 3000 : false) });
