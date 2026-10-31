import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../platform/api/index.js';

// Data hooks of the audit trail and the security events (part 02.06).
const unwrap = async (promise) => (await promise).data;
const qs = (params) => Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const filt = (filters) => Object.fromEntries(Object.entries(filters ?? {}).filter(([, v]) => v).map(([k, v]) => [`filter[${k}]`, v]));

export const useAuditTrail = ({ page = 1, pageSize = 25, q = '', from = '', to = '', filters = {} } = {}) => {
  const params = { page, pageSize, q, from, to, sort: '-at', ...filt(filters) };
  return useQuery({ queryKey: ['core', 'audit', 'list', params], queryFn: () => api.get(`/core/audit?${qs(params)}`), placeholderData: (p) => p, retry: false, refetchOnMount: 'always' });
};
export const useAuditEntities = () => useQuery({ queryKey: ['core', 'audit', 'entities'], queryFn: () => unwrap(api.get('/core/audit/entities')), retry: false, staleTime: 60_000 });
export const useAuditVerification = () => useQuery({ queryKey: ['core', 'audit', 'verification'], queryFn: () => unwrap(api.get('/core/audit/verification')), retry: false, refetchOnMount: 'always' });
export const useAuditSegments = () => useQuery({ queryKey: ['core', 'audit', 'segments'], queryFn: () => unwrap(api.get('/core/audit/segments')), retry: false });
export const useRecordHistory = (entity, id) => useQuery({ queryKey: ['core', 'audit', 'history', entity, String(id)], queryFn: () => unwrap(api.get(`/core/audit/history?${qs({ entity, id })}`)), enabled: Boolean(entity && id !== undefined && id !== null), retry: false, refetchOnMount: 'always' });
export const useSecurityEvents = ({ page = 1, pageSize = 25, q = '', from = '', to = '', filters = {} } = {}) => {
  const params = { page, pageSize, q, from, to, sort: '-at', ...filt(filters) };
  return useQuery({ queryKey: ['core', 'security-events', params], queryFn: () => api.get(`/core/security-events?${qs(params)}`), placeholderData: (p) => p, retry: false, refetchOnMount: 'always', refetchInterval: 60_000 });
};
export function useVerifyAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.post('/core/audit/verify', {}, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['core', 'audit'] }), qc.invalidateQueries({ queryKey: ['core', 'security-events'] })]),
  });
}
