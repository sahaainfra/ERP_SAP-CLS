import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/index.js';

// Data hooks of the screen migration tracker (part 03.10).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
const KEY = ['migration'];

export const useTracker = (filters) => useQuery({ queryKey: [...KEY, 'list', filters], queryFn: () => unwrap(api.get(`/ui/page-migration?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const usePendingRoutes = () => useQuery({ queryKey: [...KEY, 'pending'], queryFn: () => unwrap(api.get('/ui/page-migration/pending')), retry: false });
/** The old addresses and where they lead now (read once when the browser lands on an address that is no page). */
export const fetchRedirects = () => unwrap(api.get('/ui/page-migration/redirects'));

const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
};
export const useAddDefect = () => useWrite(({ code, ...body }) => unwrap(api.post(`/ui/page-migration/${code}/defects`, body, idem())));
export const useResolveDefect = () => useWrite(({ code, defectId, ...body }) => unwrap(api.post(`/ui/page-migration/${code}/defects/${defectId}/resolve`, body, idem())));
export const useTransition = () => useWrite(({ code, ...body }) => unwrap(api.post(`/ui/page-migration/${code}/status`, body, idem())));
export const useSignoff = () => useWrite(({ module, ...body }) => unwrap(api.post(`/ui/page-migration/modules/${module}/signoff`, body, idem())));
export const useProposeRoute = () => useWrite(({ code, ...body }) => unwrap(api.post(`/ui/page-migration/${code}/route`, body, idem())));
export const useDecideRoute = () => useWrite(({ id, action, comment }) => unwrap(api.post(`/core/change-requests/${id}/act`, { action, comment }, idem())));
export const exportUrl = (format, filters) => `/api/v1/ui/page-migration/export?${qs({ format, ...filters })}`;
