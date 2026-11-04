import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/index.js';

// Data hooks of global search (part 03.08). Components use these, never the API client directly.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (p) => (await p).data;

/** The query string of a search: only what is set. */
export function searchQuery(p) {
  const o = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    o.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return o.toString();
}

/** Results for what is typed (the palette asks for groups, the Advanced Search page for pages of one set of types). */
export function useSearch(params, { enabled = true } = {}) {
  const qs = searchQuery(params);
  return useQuery({ queryKey: ['search', qs], queryFn: () => unwrap(api.get(`/ui/search?${qs}`)), enabled, retry: false, placeholderData: keepPreviousData, staleTime: 5_000 });
}
export const useSearchTypes = (enabled = true) => useQuery({ queryKey: ['search', 'types'], queryFn: () => unwrap(api.get('/ui/search/types')), enabled, retry: false, staleTime: 5 * 60_000 });
export const useCommands = (route, enabled = true) => useQuery({ queryKey: ['search', 'commands', route ?? ''], queryFn: () => unwrap(api.get(`/ui/search/commands${route ? `?route=${encodeURIComponent(route)}` : ''}`)), enabled, retry: false, staleTime: 60_000 });

/** Say which result was opened (marks the search in the analytics and adds the record to the recent records). A convenience: failures are ignored.
 * `client` (the query client) makes the recent records and favourites of the shell read again. */
export const clickResult = (body, client) => api.post('/ui/search/click', body).then((r) => { client?.invalidateQueries({ queryKey: ['shell', 'recent'] }); return r; }).catch(() => null);

export const useSearchStatus = (enabled = true) => useQuery({ queryKey: ['search', 'status'], queryFn: () => unwrap(api.get('/ui/search/status')), enabled, retry: false, refetchInterval: (q) => (q.state.data?.jobs?.some((j) => ['QUEUED', 'RUNNING'].includes(j.status)) ? 2000 : false) });
export const useSearchAnalytics = (days, enabled = true) => useQuery({ queryKey: ['search', 'analytics', days], queryFn: () => unwrap(api.get(`/ui/search/analytics?days=${days}`)), enabled, retry: false });
export function useReindex() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ entity, reason }) => unwrap(api.post(`/ui/search/reindex/${entity}`, { reason }, idem())), onSuccess: () => qc.invalidateQueries({ queryKey: ['search', 'status'] }) });
}

// ---- saved filters of the Advanced Search page (the saved-view service of the List Report, list code ui.search) ----
const viewsKey = ['ui', 'saved-views', 'ui.search'];
export const useSearchViews = () => useQuery({ queryKey: viewsKey, queryFn: () => unwrap(api.get('/ui/saved-views?list=ui.search')), retry: false });
export function useSaveSearchView() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body) => unwrap(api.post('/ui/saved-views', { list: 'ui.search', ...body })), onSuccess: () => qc.invalidateQueries({ queryKey: viewsKey }) });
}
export function useDeleteSearchView() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v) => unwrap(api.delete(`/ui/saved-views/${v.id}`, {}, { version: v.version })), onSuccess: () => qc.invalidateQueries({ queryKey: viewsKey }) });
}
