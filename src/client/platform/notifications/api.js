import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';

// Data hooks of the notification engine (part 04.06).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false).map(([k, v]) => [k, String(v)])).toString();
export const NTF = ['ntf'];
const N = '/ntf';

export const useNotifications = (filters) => useQuery({ queryKey: [...NTF, 'list', filters], queryFn: () => unwrap(api.get(`${N}/notifications?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const usePreferences = () => useQuery({ queryKey: [...NTF, 'preferences'], queryFn: () => unwrap(api.get(`${N}/preferences`)), retry: false });
export const useTemplates = (filters) => useQuery({ queryKey: [...NTF, 'templates', filters], queryFn: () => unwrap(api.get(`${N}/templates?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useTemplate = (code) => useQuery({ queryKey: [...NTF, 'template', code], queryFn: () => unwrap(api.get(`${N}/templates/${code}`)), enabled: Boolean(code), retry: false });
export const useDeliveries = (filters) => useQuery({ queryKey: [...NTF, 'deliveries', filters], queryFn: () => unwrap(api.get(`${N}/deliveries?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useDeliverySummary = (filters) => useQuery({ queryKey: [...NTF, 'delivery-summary', filters], queryFn: () => unwrap(api.get(`${N}/deliveries/summary?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const deliveriesUrl = (format, filters) => `/api/v1${N}/deliveries/export?${qs({ ...filters, format })}`;
export { authHeaders };

const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: NTF }); qc.invalidateQueries({ queryKey: ['shell'] }); } });
};
export const useMark = () => useWrite(({ id, action }) => unwrap(api.post(`${N}/notifications/${id}/${action}`, {}, idem())));
export const useReadAll = () => useWrite((body) => unwrap(api.post(`${N}/notifications/read-all`, body ?? {}, idem())));
export const useSendTest = () => useWrite(() => unwrap(api.post(`${N}/notifications/test`, {}, idem())));
export const useSavePreferences = () => useWrite((body) => unwrap(api.put(`${N}/preferences`, body, idem())));
export const usePreviewTemplate = () => useMutation({ mutationFn: (body) => unwrap(api.post(`${N}/templates/preview`, body)) });
export const useProposeTemplate = () => useWrite((body) => unwrap(api.post(`${N}/templates/changes`, body, idem())));
export const useRetryDelivery = () => useWrite((id) => unwrap(api.post(`${N}/deliveries/${id}/retry`, {}, idem())));
