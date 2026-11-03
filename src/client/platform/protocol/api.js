import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';

// Data hooks of the Protocol & Control Engine (part 04.04).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false).map(([k, v]) => [k, String(v)])).toString();
const KEY = ['pcs'];
const P = '/pcs';

export const useControls = (filters) => useQuery({ queryKey: [...KEY, 'controls', filters], queryFn: () => unwrap(api.get(`${P}/control-points?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useControl = (code) => useQuery({ queryKey: [...KEY, 'control', code], queryFn: () => unwrap(api.get(`${P}/control-points/${code}`)), enabled: Boolean(code), retry: false });
export const useControlOptions = () => useQuery({ queryKey: [...KEY, 'options'], queryFn: () => unwrap(api.get(`${P}/control-points/options`)), retry: false, staleTime: 60_000 });
export const useReasonCodes = (all = false) => useQuery({ queryKey: [...KEY, 'reasons', all], queryFn: () => unwrap(api.get(`${P}/reason-codes?${qs({ all })}`)), retry: false });
export const useExceptions = (filters) => useQuery({ queryKey: [...KEY, 'exceptions', filters], queryFn: () => unwrap(api.get(`${P}/exceptions?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useException = (id) => useQuery({ queryKey: [...KEY, 'exception', id], queryFn: () => unwrap(api.get(`${P}/exceptions/${id}`)), enabled: Boolean(id), retry: false });
export const useControlsDashboard = (filters) => useQuery({ queryKey: [...KEY, 'dashboard', filters], queryFn: () => unwrap(api.get(`${P}/dashboard?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useCycle = (entity, id) => useQuery({ queryKey: [...KEY, 'cycle', entity, id], queryFn: () => unwrap(api.get(`${P}/cycle/${entity}/${id}`)), enabled: Boolean(entity && id), retry: false });
export const exportUrl = (format, filters) => `/api/v1${P}/exceptions/export?${qs({ ...filters, format })}`;

const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ['workflow'] }); qc.invalidateQueries({ queryKey: ['ui', 'reason-codes'] }); } });
};
export const useCreateControl = () => useWrite((body) => unwrap(api.post(`${P}/control-points`, body, idem())));
export const useUpdateControl = () => useWrite(({ code, ...body }) => unwrap(api.put(`${P}/control-points/${code}`, body, idem())));
export const useRemoveControl = () => useWrite((code) => unwrap(api.delete(`${P}/control-points/${code}`, idem())));
export const useSaveReason = () => useWrite((body) => unwrap(api.post(`${P}/reason-codes`, body, idem())));
export const useCreateException = () => useWrite((body) => unwrap(api.post(`${P}/exceptions`, body, idem())));
export const useUpdateException = () => useWrite(({ id, ...body }) => unwrap(api.put(`${P}/exceptions/${id}`, body, idem())));
export const useSubmitException = () => useWrite(({ id, ...body }) => unwrap(api.post(`${P}/exceptions/${id}/submit`, body, idem())));
export const useCancelException = () => useWrite(({ id, ...body }) => unwrap(api.post(`${P}/exceptions/${id}/cancel`, body, idem())));
export { authHeaders };

/** What a screen needs from the error of a blocked action to offer an exception: the control and the record, or null for any other error. */
export function exceptionFromError(err) {
  if (err?.code !== 'EXCEPTION_REQUIRED') return null;
  const d = Object.fromEntries((err.details ?? []).map((x) => [x.field, x.message]));
  return { code: d.control, entity: d.entity, entityId: d.entityId, evidenceRequired: d.evidenceRequired === 'true', level: Number(d.escalationLevel), emergencyAllowed: d.emergencyAllowed === 'true', message: err.message };
}
