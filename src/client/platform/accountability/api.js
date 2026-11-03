import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';

// Data hooks of accountability (part 04.05).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false).map(([k, v]) => [k, String(v)])).toString();
const KEY = ['acc'];
const A = '/acc';

export const useRaciScopes = () => useQuery({ queryKey: [...KEY, 'scopes'], queryFn: () => unwrap(api.get(`${A}/raci/scopes`)), retry: false, staleTime: 30_000 });
export const useRaci = (scope) => useQuery({ queryKey: [...KEY, 'raci', scope], queryFn: () => unwrap(api.get(`${A}/raci?${qs(scope)}`)), enabled: Boolean(scope?.scopeType), retry: false });
export const useGaps = (filters) => useQuery({ queryKey: [...KEY, 'gaps', filters], queryFn: () => unwrap(api.get(`${A}/raci/gaps?${qs(filters)}`)), retry: false });
export const useMe = (filters) => useQuery({ queryKey: [...KEY, 'me', filters], queryFn: () => unwrap(api.get(`${A}/me?${qs(filters)}`)), retry: false });
export const useScores = (filters) => useQuery({ queryKey: [...KEY, 'scores', filters], queryFn: () => unwrap(api.get(`${A}/scores?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useLedger = (filters) => useQuery({ queryKey: [...KEY, 'ledger', filters], queryFn: () => unwrap(api.get(`${A}/ledger?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const scoresUrl = (format, filters) => `/api/v1${A}/scores/export?${qs({ ...filters, format })}`;
const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: ['workflow'] }); } });
};
export const useProposeRaci = () => useWrite((body) => unwrap(api.post(`${A}/raci/changes`, body, idem())));
export const useApplyTemplate = () => useWrite((body) => unwrap(api.post(`${A}/raci/apply-template`, body, idem())));
export { authHeaders };
