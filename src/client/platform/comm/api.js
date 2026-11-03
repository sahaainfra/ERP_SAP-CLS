import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';

// Data hooks of the communication gateway (part 04.07).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false).map(([k, v]) => [k, String(v)])).toString();
export const COMM = ['comm'];
const M = '/comm';

export const useMessages = (filters) => useQuery({ queryKey: [...COMM, 'messages', filters], queryFn: () => unwrap(api.get(`${M}/messages?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useMessage = (id) => useQuery({ queryKey: [...COMM, 'message', id], queryFn: () => unwrap(api.get(`${M}/messages/${id}`)), enabled: Boolean(id), retry: false });
export const useMessageSummary = (filters) => useQuery({ queryKey: [...COMM, 'summary', filters], queryFn: () => unwrap(api.get(`${M}/messages/summary?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const messagesUrl = (format, filters) => `/api/v1${M}/messages/export?${qs({ ...filters, format })}`;
export const useChannels = () => useQuery({ queryKey: [...COMM, 'channels'], queryFn: () => unwrap(api.get(`${M}/channels`)), retry: false });
export const useConsents = (filters) => useQuery({ queryKey: [...COMM, 'consents', filters], queryFn: () => unwrap(api.get(`${M}/consents?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useConsentHistory = (id) => useQuery({ queryKey: [...COMM, 'consent-history', id], queryFn: () => unwrap(api.get(`${M}/consents/${id}/history`)), enabled: Boolean(id), retry: false });
export { authHeaders };

const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: COMM }); } });
};
export const useRetryMessage = () => useWrite((id) => unwrap(api.post(`${M}/messages/${id}/retry`, {}, idem())));
export const useProposeChannels = () => useWrite((body) => unwrap(api.post(`${M}/channels/changes`, body, idem())));
export const useSendSample = () => useWrite((body) => unwrap(api.post(`${M}/channels/sample`, body, idem())));
export const useSyncWhatsapp = () => useWrite(() => unwrap(api.post(`${M}/whatsapp/templates/sync`, {}, idem())));
export const useSetConsent = () => useWrite((body) => unwrap(api.post(`${M}/consents`, body, idem())));
export const useImportConsents = () => useWrite((body) => unwrap(api.post(`${M}/consents/import`, body, idem())));
