import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../platform/api/index.js';
import { queryKeys } from '../../../platform/query/keys.js';

// Data hooks of segregation of duties, elevated access and access reviews (part 02.05).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (promise) => (await promise).data;
const qs = (params) => Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const filt = (filters) => Object.fromEntries(Object.entries(filters ?? {}).filter(([, v]) => v).map(([k, v]) => [`filter[${k}]`, v]));
const listQuery = (key, path, { page = 1, pageSize = 25, q = '', sort = '', filters = {} } = {}, extra = {}) => {
  const params = { page, pageSize, q, sort, ...filt(filters) };
  return useQuery({ queryKey: key(params), queryFn: () => api.get(`${path}?${qs(params)}`), placeholderData: (p) => p, retry: false, refetchOnMount: 'always', ...extra });
};
const K = queryKeys.iam.privileged;

export const useSodRules = (opts) => listQuery(K.rules, '/iam/sod-rules', opts);
export const useSodRule = (id) => useQuery({ queryKey: K.rule(id), queryFn: () => unwrap(api.get(`/iam/sod-rules/${id}`)), enabled: Boolean(id), retry: false, refetchOnMount: 'always' });
export const useSodTest = (params) => useQuery({ queryKey: K.test(params), queryFn: () => unwrap(api.get(`/iam/sod-rules/test?${qs(params)}`)), enabled: Boolean(params.userId), retry: false });
export const useSodViolations = (opts) => listQuery(K.violations, '/iam/sod-violations', opts);
export const useSodViolation = (id) => useQuery({ queryKey: K.violation(id), queryFn: () => unwrap(api.get(`/iam/sod-violations/${id}`)), enabled: Boolean(id), retry: false, refetchOnMount: 'always' });
export const useDormant = (opts) => listQuery(K.dormant, '/iam/dormant-accounts', opts);
export const useElevations = (opts) => listQuery(K.elevations, '/iam/elevations', opts, { refetchInterval: 30_000 });
export const useElevation = (id) => useQuery({ queryKey: K.elevation(id), queryFn: () => unwrap(api.get(`/iam/elevations/${id}`)), enabled: Boolean(id), retry: false, refetchOnMount: 'always' });
export const useElevationRoles = () => useQuery({ queryKey: K.elevationRoles(), queryFn: () => unwrap(api.get('/iam/elevation-roles')), retry: false, staleTime: 300_000 });
export const useCampaigns = (opts) => listQuery(K.campaigns, '/iam/access-reviews', opts);
export const useCampaign = (id) => useQuery({ queryKey: K.campaign(id), queryFn: () => unwrap(api.get(`/iam/access-reviews/${id}`)), enabled: Boolean(id), retry: false, refetchOnMount: 'always' });
export const useCampaignItems = (id, opts) => listQuery((p) => K.items(id, p), `/iam/access-reviews/${id}/items`, opts, { enabled: Boolean(id) });
export const useMyReviewItems = (opts) => listQuery(K.mine, '/iam/access-reviews/mine', opts);

function useWrite(fn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: queryKeys.iam.all }), qc.invalidateQueries({ queryKey: queryKeys.core.requests.all })]) });
}
export const useRequestRuleChange = () => useWrite(({ ruleId, ...body }) => unwrap(ruleId ? api.put(`/iam/sod-rules/${ruleId}`, body, idem()) : api.post('/iam/sod-rules', body, idem())));
export const useSwitchOffRule = () => useWrite(({ id, reason }) => unwrap(api.delete(`/iam/sod-rules/${id}`, idem(), { reason })));
export const useScanViolations = () => useWrite(() => unwrap(api.post('/iam/sod-violations/scan', {}, idem())));
export const useResolveViolation = () => useWrite(({ id, ...body }) => unwrap(api.post(`/iam/sod-violations/${id}/resolve`, body, idem())));
export const useScanDormant = () => useWrite(() => unwrap(api.post('/iam/dormant-accounts/scan', {}, idem())));
export const useRequestElevation = () => useWrite((body) => unwrap(api.post('/iam/elevations', body, idem())));
export const useDecideElevation = () => useWrite(({ id, ...body }) => unwrap(api.post(`/iam/elevations/${id}/decision`, body, idem())));
export const useCancelElevation = () => useWrite((id) => unwrap(api.post(`/iam/elevations/${id}/cancel`, {}, idem())));
export const useRevokeElevation = () => useWrite(({ id, ...body }) => unwrap(api.post(`/iam/elevations/${id}/revoke`, body, idem())));
export const useStartCampaign = () => useWrite((body) => unwrap(api.post('/iam/access-reviews', body, idem())));
export const useDecideReview = () => useWrite((body) => unwrap(api.post('/iam/access-reviews/decisions', body, idem())));
export const useReassignReview = () => useWrite(({ id, ...body }) => unwrap(api.post(`/iam/access-reviews/${id}/reassign`, body, idem())));
export const useCloseCampaign = () => useWrite((id) => unwrap(api.post(`/iam/access-reviews/${id}/close`, {}, idem())));
export const useCancelCampaign = () => useWrite(({ id, reason }) => unwrap(api.post(`/iam/access-reviews/${id}/cancel`, { reason }, idem())));
