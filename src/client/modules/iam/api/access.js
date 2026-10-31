import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../platform/api/index.js';
import { queryKeys } from '../../../platform/query/keys.js';

// Data hooks of roles, assignments and the explainer (part 02.04).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (promise) => (await promise).data;
const qs = (params) => Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const filt = (filters) => Object.fromEntries(Object.entries(filters ?? {}).filter(([, v]) => v).map(([k, v]) => [`filter[${k}]`, v]));

export const usePermissions = () => useQuery({ queryKey: queryKeys.iam.access.permissions(), queryFn: () => unwrap(api.get('/iam/permissions')), retry: false, staleTime: 300_000 });
export const useMaskFields = () => useQuery({ queryKey: queryKeys.iam.access.maskFields(), queryFn: () => unwrap(api.get('/iam/mask-fields')), retry: false, staleTime: 300_000 });
export const useRoles = ({ page = 1, pageSize = 25, q = '', sort = 'code', filters = {} } = {}) => {
  const params = { page, pageSize, q, sort, ...filt(filters) };
  return useQuery({ queryKey: queryKeys.iam.access.roles(params), queryFn: () => api.get(`/iam/roles?${qs(params)}`), placeholderData: (p) => p, retry: false, refetchOnMount: 'always' });
};
export const useRole = (id) => useQuery({ queryKey: queryKeys.iam.access.role(id), queryFn: () => unwrap(api.get(`/iam/roles/${id}`)), enabled: Boolean(id), retry: false, refetchOnMount: 'always' });
export const useRoleCompare = (a, b) => useQuery({ queryKey: queryKeys.iam.access.compare(a, b), queryFn: () => unwrap(api.get(`/iam/roles/compare?a=${a}&b=${b}`)), enabled: Boolean(a && b && a !== b), retry: false });
export const useAssignments = ({ page = 1, pageSize = 25, q = '', sort = 'user', filters = {} } = {}) => {
  const params = { page, pageSize, q, sort, ...filt(filters) };
  return useQuery({ queryKey: queryKeys.iam.access.assignments(params), queryFn: () => api.get(`/iam/assignments?${qs(params)}`), placeholderData: (p) => p, retry: false, refetchOnMount: 'always' });
};
export const useEffective = ({ userId, recordType, recordId }) =>
  useQuery({ queryKey: queryKeys.iam.access.effective({ userId, recordType, recordId }), queryFn: () => unwrap(api.get(`/iam/effective?${qs({ userId, recordType, recordId })}`)), enabled: Boolean(userId), retry: false });
export const useLegacyComparison = ({ page = 1, pageSize = 25, q = '', sort = 'user', filters = {} } = {}) => {
  const params = { page, pageSize, q, sort, ...filt(filters) };
  return useQuery({ queryKey: queryKeys.iam.access.legacy(params), queryFn: () => api.get(`/iam/legacy-comparison?${qs(params)}`), placeholderData: (p) => p, retry: false, refetchOnMount: 'always' });
};
export const useMyAccess = () => useQuery({ queryKey: queryKeys.iam.access.mine(), queryFn: () => unwrap(api.get('/iam/me/access')), retry: false, staleTime: 30_000 });

function useWrite(fn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: queryKeys.iam.all }), qc.invalidateQueries({ queryKey: queryKeys.core.requests.all })]) });
}
export const useCreateRole = () => useWrite((body) => unwrap(api.post('/iam/roles', body, idem())));
export const useUpdateRole = () => useWrite(({ id, ...body }) => unwrap(api.patch(`/iam/roles/${id}`, body)));
export const useRequestRoleChange = () => useWrite(({ id, ...body }) => unwrap(api.post(`/iam/roles/${id}/change-requests`, body, idem())));
export const useRequestAssignment = () => useWrite((body) => unwrap(api.post('/iam/assignments', body, idem())));
export const useEndAssignment = () => useWrite(({ id, ...body }) => unwrap(api.post(`/iam/assignments/${id}/end`, body, idem())));
