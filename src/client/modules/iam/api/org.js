import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../platform/api/index.js';
import { queryKeys } from '../../../platform/query/keys.js';

// Data hooks of the organisation master (part 02.02).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (promise) => (await promise).data;
const qs = (params) => Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const base = '/iam/org';

export const useOrgList = (entity, { page = 1, pageSize = 25, q = '', sort = '', filters = {}, enabled = true } = {}) => {
  const params = { page, pageSize, q, sort, ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [`filter[${k}]`, v])) };
  return useQuery({ queryKey: queryKeys.iam.org.list(entity, params), queryFn: () => api.get(`${base}/${entity}?${qs(params)}`), placeholderData: (p) => p, retry: false, enabled });
};
export const useOrgItem = (entity, id) => useQuery({ queryKey: queryKeys.iam.org.item(entity, id), queryFn: () => unwrap(api.get(`${base}/${entity}/${id}`)), enabled: Boolean(id), retry: false });
export const useOrgTree = () => useQuery({ queryKey: queryKeys.iam.org.tree(), queryFn: () => unwrap(api.get(`${base}/tree`)), retry: false });
export const useOrgContext = () => useQuery({ queryKey: queryKeys.iam.org.context(), queryFn: () => unwrap(api.get(`${base}/context`)), retry: false, staleTime: 60_000 });
export const useOrgUsers = (q = '') => useQuery({ queryKey: queryKeys.iam.org.users(q), queryFn: () => unwrap(api.get(`${base}/lookups/users?${qs({ q })}`)), retry: false });
export const useOrgHistory = (entity, id) => useQuery({ queryKey: queryKeys.iam.org.history(entity, id), queryFn: () => unwrap(api.get(`${base}/${entity}/${id}/history`)), enabled: Boolean(id), retry: false });
export const useOrgRequests = (entity, id) => useQuery({ queryKey: queryKeys.iam.org.requests(entity, id), queryFn: () => unwrap(api.get(`${base}/${entity}/${id}/requests`)), enabled: Boolean(id), retry: false });

function useWrite(fn) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: queryKeys.iam.org.all }), qc.invalidateQueries({ queryKey: queryKeys.core.requests.all })]),
  });
}

export const useOrgCreate = (entity) => useWrite((body) => unwrap(api.post(`${base}/${entity}`, body, idem())));
export const useOrgUpdate = (entity) => useWrite(({ id, ...body }) => unwrap(api.patch(`${base}/${entity}/${id}`, body)));
export const useOrgDeactivate = (entity) => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/${entity}/${id}/deactivate`, body, idem())));
export const useOrgActivate = (entity) => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/${entity}/${id}/activate`, body, idem())));
export const useOrgAssign = (entity) => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/${entity}/${id}/assignments`, body, idem())));
export const useOrgCancelAssignment = (entity) => useWrite(({ id, assignmentId }) => unwrap(api.delete(`${base}/${entity}/${id}/assignments/${assignmentId}`)));
export const useProjectStatus = () => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/projects/${id}/status`, body, idem())));
export const useRequestActivation = (entity) => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/${entity}/${id}/activation-requests`, body, idem())));
export const useRequestGeofence = () => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/sites/${id}/geofence/change-requests`, body, idem())));

export const testShape = (body) => unwrap(api.post(`${base}/geofence/test`, body));
export const testSite = (id, body) => unwrap(api.post(`${base}/sites/${id}/geofence/test`, body));
