import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../platform/api/index.js';
import { queryKeys } from '../../../platform/query/keys.js';

// Data hooks of the iam module (part 02.01): the signed-in person's own account, and the security administration.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (promise) => (await promise).data;
const qs = (params) => Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

function useWrite(fn, invalidate = [queryKeys.iam.all]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

export const useMe = () => useQuery({ queryKey: queryKeys.iam.me(), queryFn: () => unwrap(api.get('/iam/me')), retry: false, refetchOnMount: 'always' });
export const useMySessions = () => useQuery({ queryKey: queryKeys.iam.sessions(), queryFn: () => unwrap(api.get('/iam/me/sessions')), retry: false });
export const useMyDevices = () => useQuery({ queryKey: queryKeys.iam.devices(), queryFn: () => unwrap(api.get('/iam/me/devices')), retry: false });
export const useMyEvents = () => useQuery({ queryKey: queryKeys.iam.events(), queryFn: () => unwrap(api.get('/iam/me/login-events')), retry: false });

export const useRevokeMine = () => useWrite((id) => unwrap(api.delete(`/iam/me/sessions/${id}`)));
export const useSignOutOthers = () => useWrite(() => unwrap(api.post('/iam/me/sessions/sign-out-others', {}, idem())));
export const useForgetDevice = () => useWrite((id) => unwrap(api.delete(`/iam/me/devices/${id}`)));
export const useSetPin = () => useWrite(({ id, pin }) => unwrap(api.post(`/iam/me/devices/${id}/pin`, { pin }, idem())));
export const useChangePassword = () => useWrite((body) => unwrap(api.post('/iam/auth/password/change', body)));

export const useTotpBegin = () => useWrite(() => unwrap(api.post('/iam/me/mfa/totp/begin', {}, idem())), []);
export const useTotpConfirm = () => useWrite((code) => unwrap(api.post('/iam/me/mfa/totp/confirm', { code }, idem())));
export const usePhoneBegin = () => useWrite((body) => unwrap(api.post('/iam/me/mfa/phone/begin', body, idem())), []);
export const usePhoneConfirm = () => useWrite((body) => unwrap(api.post('/iam/me/mfa/phone/confirm', body, idem())));
export const useRegenerateBackup = () => useWrite(() => unwrap(api.post('/iam/me/mfa/backup-codes', {}, idem())));
export const useRemoveFactor = () => useWrite((id) => unwrap(api.delete(`/iam/me/mfa/${id}`)));

export const usePolicy = () => useQuery({ queryKey: queryKeys.iam.policy(), queryFn: () => unwrap(api.get('/iam/admin/policy')), retry: false });
export const useRequestPolicyChange = () => useWrite((body) => unwrap(api.post('/iam/admin/policy/change-requests', body, idem())), [queryKeys.iam.policy(), queryKeys.core.requests.all]);

export const useAdminSessions = ({ page = 1, q = '' }) =>
  useQuery({ queryKey: queryKeys.iam.adminSessions({ page, q }), queryFn: () => api.get(`/iam/admin/sessions?${qs({ page, q })}`), placeholderData: (p) => p, retry: false });
export const useAdminUsers = ({ page = 1, q = '' }) =>
  useQuery({ queryKey: queryKeys.iam.adminUsers({ page, q }), queryFn: () => api.get(`/iam/admin/users?${qs({ page, q })}`), placeholderData: (p) => p, retry: false });
export const useLoginEvents = ({ page = 1, pageSize = 25, q = '', user = '', result = '', from = '', to = '' }) =>
  useQuery({
    queryKey: queryKeys.iam.adminEvents({ page, pageSize, q, user, result, from, to }),
    queryFn: () => api.get(`/iam/admin/login-events?${qs({ page, pageSize, q, 'filter[user]': user, 'filter[result]': result, from, to })}`),
    placeholderData: (p) => p,
    retry: false,
  });
export const useRevokeAny = () => useWrite(({ id, reason }) => unwrap(api.post(`/iam/admin/sessions/${id}/revoke`, { reason }, idem())));
export const useSignOutUser = () => useWrite(({ username, reason }) => unwrap(api.post(`/iam/admin/users/${encodeURIComponent(username)}/sign-out`, { reason }, idem())));
export const useUnlockUser = () => useWrite(({ username, reason }) => unwrap(api.post(`/iam/admin/users/${encodeURIComponent(username)}/unlock`, { reason }, idem())));
