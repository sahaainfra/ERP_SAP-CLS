import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../platform/api/index.js';

// Data hooks of the route registry and the security settings (part 02.07).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (promise) => (await promise).data;
const qs = (params) => Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const filt = (filters) => Object.fromEntries(Object.entries(filters ?? {}).filter(([, v]) => v).map(([k, v]) => [`filter[${k}]`, v]));

export const useRoutes = ({ page = 1, pageSize = 50, q = '', filters = {} } = {}) => {
  const params = { page, pageSize, q, sort: 'path', ...filt(filters) };
  return useQuery({ queryKey: ['core', 'security', 'routes', params], queryFn: () => api.get(`/core/routes?${qs(params)}`), placeholderData: (p) => p, retry: false, refetchOnMount: 'always' });
};
export const useSecuritySettings = () => useQuery({ queryKey: ['core', 'security', 'settings'], queryFn: () => unwrap(api.get('/core/security-settings')), retry: false, refetchOnMount: 'always' });

function useWrite(fn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['core', 'security'] }), qc.invalidateQueries({ queryKey: ['core', 'requests'] })]) });
}
export const useSelfTest = () => useWrite(() => unwrap(api.post('/core/routes/self-test', {}, idem())));
export const useRequestSettingsChange = () => useWrite((body) => unwrap(api.post('/core/security-settings/change-requests', body, idem())));
