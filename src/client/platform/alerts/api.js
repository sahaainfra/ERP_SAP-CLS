import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';

// Data hooks of the alert rules and the alert centre (part 04.09).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false).map(([k, v]) => [k, String(v)])).toString();
export const ALR = ['alr'];
const B = '/alr';

export const useRules = () => useQuery({ queryKey: [...ALR, 'rules'], queryFn: () => unwrap(api.get(`${B}/rules`)), retry: false });
export const useRule = (code) => useQuery({ queryKey: [...ALR, 'rule', code], queryFn: () => unwrap(api.get(`${B}/rules/${code}`)), enabled: Boolean(code), retry: false });
export const useBuilder = () => useQuery({ queryKey: [...ALR, 'builder'], queryFn: () => unwrap(api.get(`${B}/builder`)), retry: false, staleTime: 60_000 });
export const useRuns = (filters) => useQuery({ queryKey: [...ALR, 'runs', filters], queryFn: () => unwrap(api.get(`${B}/runs?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useAlerts = (filters) => useQuery({ queryKey: [...ALR, 'alerts', filters], queryFn: () => unwrap(api.get(`${B}/alerts?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useAlertSummary = () => useQuery({ queryKey: [...ALR, 'summary'], queryFn: () => unwrap(api.get(`${B}/alerts/summary`)), retry: false });
export const alertsUrl = (format, filters) => `/api/v1${B}/alerts/export?${qs({ ...filters, format })}`;
export { authHeaders };

const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: ALR }); qc.invalidateQueries({ queryKey: ['work'] }); } });
};
export const useSaveRule = () => useWrite((body) => unwrap(api.post(`${B}/rules`, body, idem())));
export const useAdoptRule = () => useWrite(({ code, ...body }) => unwrap(api.post(`${B}/rules/library/${code}/adopt`, body, idem())));
export const useEnableRule = () => useWrite(({ code, ...body }) => unwrap(api.post(`${B}/rules/${code}/enabled`, body, idem())));
export const useRunRule = () => useWrite((code) => unwrap(api.post(`${B}/rules/${code}/run`, {}, idem())));
export const useDryRun = () => useMutation({ mutationFn: ({ code, draft }) => unwrap(code ? api.post(`${B}/rules/${code}/dry-run`, {}, idem()) : api.post(`${B}/rules/dry-run`, draft, idem())) });
export const useAlertAct = () => useWrite(({ id, action, note }) => unwrap(api.post(`${B}/alerts/${id}/${action}`, note ? { note } : {}, idem())));
export const useAlertBulk = () => useWrite((body) => unwrap(api.post(`${B}/alerts/bulk`, body, idem())));
