import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../../../platform/api/index.js';
import { queryKeys } from '../../../platform/query/keys.js';

// Data hooks of user management (part 02.03).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (promise) => (await promise).data;
const qs = (params) => Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const base = '/iam/users';

export const listParams = ({ page = 1, pageSize = 25, q = '', sort = 'displayName', filters = {} }) =>
  ({ page, pageSize, q, sort, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [`filter[${k}]`, v])) });

export const useUsers = (opts) => {
  const params = listParams(opts);
  return useQuery({ queryKey: queryKeys.iam.users.list(params), queryFn: () => api.get(`${base}?${qs(params)}`), placeholderData: (p) => p, retry: false });
};
export const useUser = (id) => useQuery({ queryKey: queryKeys.iam.users.item(id), queryFn: () => unwrap(api.get(`${base}/${id}`)), enabled: Boolean(id), retry: false });
export const useUserRoles = () => useQuery({ queryKey: queryKeys.iam.users.roles(), queryFn: () => unwrap(api.get(`${base}/roles`)), retry: false, staleTime: 300_000 });
export const useUserSessions = (id) => useQuery({ queryKey: queryKeys.iam.users.sessions(id), queryFn: () => unwrap(api.get(`${base}/${id}/sessions`)), enabled: Boolean(id), retry: false });
export const useUserLoginEvents = (id, page = 1) => useQuery({ queryKey: queryKeys.iam.users.events(id, page), queryFn: () => api.get(`${base}/${id}/login-events?${qs({ page, pageSize: 25 })}`), enabled: Boolean(id), placeholderData: (p) => p, retry: false });
export const useUserTimeline = (id) => useQuery({ queryKey: queryKeys.iam.users.timeline(id), queryFn: () => unwrap(api.get(`${base}/${id}/timeline`)), enabled: Boolean(id), retry: false });
export const useDeactivationCheck = (id, enabled) => useQuery({ queryKey: queryKeys.iam.users.check(id), queryFn: () => unwrap(api.get(`${base}/${id}/deactivation-check`)), enabled: Boolean(id) && enabled, retry: false, gcTime: 0 });
export const checkDuplicates = (params) => unwrap(api.get(`${base}/duplicates?${qs(params)}`));

function useWrite(fn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: queryKeys.iam.all }), qc.invalidateQueries({ queryKey: queryKeys.core.requests.all })]) });
}

export const useCreateUser = () => useWrite((body) => unwrap(api.post(base, body, idem())));
export const useUpdateUser = () => useWrite(({ id, ...body }) => unwrap(api.patch(`${base}/${id}`, body)));
export const useInviteUser = () => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/${id}/invite`, body, idem())));
export const useRevokeInvitation = () => useWrite((id) => unwrap(api.delete(`${base}/${id}/invitation`)));
export const useSuspendUser = () => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/${id}/suspend`, body, idem())));
export const useReactivateUser = () => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/${id}/reactivate`, body, idem())));
export const useDeactivateUser = () => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/${id}/deactivate`, body, idem())));
export const useRequestRoles = () => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/${id}/role-requests`, body, idem())));
export const useRevokeRoles = () => useWrite(({ id, ...body }) => unwrap(api.post(`${base}/${id}/roles/revoke`, body, idem())));
export const useBulkUsers = () => useWrite((body) => unwrap(api.post(`${base}/bulk`, body, idem())));
export const useUpdateMe = () => useWrite((body) => unwrap(api.patch('/iam/me', body)));

/** Send a CSV file for checking (`validate`) or importing (`commit`). The body is the file's text. */
export async function importUsers(text, { mode, skipInvalid = false, invite = false }) {
  const params = qs({ mode, skipInvalid: skipInvalid ? 'true' : '', invite: invite ? 'true' : '' });
  const res = await fetch(`/api/v1/iam/users/import?${params}`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'text/csv', ...(mode === 'commit' ? { 'idempotency-key': globalThis.crypto.randomUUID() } : {}) }, body: text });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error ?? {};
    throw Object.assign(new Error(e.message ?? `The server answered ${res.status}.`), { status: res.status, details: e.details ?? [], correlationId: e.correlationId ?? null });
  }
  return json.data;
}
export const importTemplateUrl = '/api/v1/iam/users/import/template';
