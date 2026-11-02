import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/index.js';

// Data hooks of the workflow engine (part 04.01).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
const KEY = ['workflow'];
const W = '/workflow';

export const useDefinitions = (filters) => useQuery({ queryKey: [...KEY, 'definitions', filters], queryFn: () => unwrap(api.get(`${W}/definitions?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useDefinition = (id) => useQuery({ queryKey: [...KEY, 'definition', id], queryFn: () => unwrap(api.get(`${W}/definitions/${id}`)), enabled: Boolean(id), retry: false });
export const useDefinitionOptions = () => useQuery({ queryKey: [...KEY, 'options'], queryFn: () => unwrap(api.get(`${W}/definitions/options`)), retry: false, staleTime: 60_000 });
export const useCompare = (a, b) => useQuery({ queryKey: [...KEY, 'compare', a, b], queryFn: () => unwrap(api.get(`${W}/definitions/${a}/compare/${b}`)), enabled: Boolean(a && b && a !== b), retry: false });
export const useDocTypes = () => useQuery({ queryKey: [...KEY, 'doc-types'], queryFn: () => unwrap(api.get(`${W}/doc-types`)), retry: false, staleTime: 60_000 });
export const useInstance = (id) => useQuery({ queryKey: [...KEY, 'instance', id], queryFn: () => unwrap(api.get(`${W}/instances/${id}`)), enabled: Boolean(id), retry: false });
export const useInstances = (filters) => useQuery({ queryKey: [...KEY, 'instances', filters], queryFn: () => unwrap(api.get(`${W}/instances?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useMonitor = (filters) => useQuery({ queryKey: [...KEY, 'monitor', filters], queryFn: () => unwrap(api.get(`${W}/monitor?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useTasks = (mine) => useQuery({ queryKey: [...KEY, 'tasks', mine], queryFn: () => unwrap(api.get(`${W}/tasks?mine=${mine}&limit=50`)), retry: false });
export const findDocument = (docType, docId) => unwrap(api.get(`${W}/documents/${encodeURIComponent(docType)}/${encodeURIComponent(docId)}`));
export const monitorUrl = (format, filters) => `/api/v1${W}/monitor?${qs({ ...filters, format })}`;

const useWrite = (fn, extraKeys = []) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); for (const k of extraKeys) qc.invalidateQueries({ queryKey: k }); } });
};
export const useDraftFrom = () => useWrite((docType) => unwrap(api.post(`${W}/definitions/draft`, { docType }, idem())));
export const useSaveDefinition = () => useWrite(({ id, definition, version }) => unwrap(api.put(`${W}/definitions/${id}`, { definition, version }, idem())));
export const useDeleteDefinition = () => useWrite((id) => unwrap(api.delete(`${W}/definitions/${id}`, idem())));
export const useActivate = () => useWrite((id) => unwrap(api.post(`${W}/definitions/${id}/activate`, {}, idem())));
export const useAct = () => useWrite(({ taskId, ...body }) => unwrap(api.post(`${W}/tasks/${taskId}/act`, body, idem())), [['eng']]);
export const useAssign = () => useWrite(({ taskId, ...body }) => unwrap(api.post(`${W}/tasks/${taskId}/assign`, body, idem())));
export const useInstanceAction = () => useWrite(({ id, action, ...body }) => unwrap(api.post(`${W}/instances/${id}/${action}`, body, idem())), [['eng']]);

// The sample document type (module eng): the reference for how a module uses the engine.
const E = '/eng/sample-docs';
export const useSampleDocs = (filters) => useQuery({ queryKey: ['eng', 'sample-docs', filters], queryFn: () => unwrap(api.get(`${E}?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useSampleDoc = (id) => useQuery({ queryKey: ['eng', 'sample-doc', id], queryFn: () => unwrap(api.get(`${E}/${id}`)), enabled: Boolean(id), retry: false });
const useEng = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: ['eng'] }); qc.invalidateQueries({ queryKey: KEY }); } });
};
export const useCreateSampleDoc = () => useEng((body) => unwrap(api.post(E, body, idem())));
export const useUpdateSampleDoc = () => useEng(({ id, ...body }) => unwrap(api.put(`${E}/${id}`, body, idem())));
export const useSubmitSampleDoc = () => useEng(({ id, ...body }) => unwrap(api.post(`${E}/${id}/submit`, body, idem())));
export const useAmendSampleDoc = () => useEng((id) => unwrap(api.post(`${E}/${id}/amend`, {}, idem())));

// Part 04.02: the approval matrix, authority limits, delegations, escalation paths and SLA settings.
export const useMatrixList = (filters) => useQuery({ queryKey: [...KEY, 'matrix', 'list', filters], queryFn: () => unwrap(api.get(`${W}/matrix?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useMatrix = (id) => useQuery({ queryKey: [...KEY, 'matrix', 'one', id], queryFn: () => unwrap(api.get(`${W}/matrix/${id}`)), enabled: Boolean(id), retry: false });
export const useMatrixCompare = (a, b) => useQuery({ queryKey: [...KEY, 'matrix', 'compare', a, b], queryFn: () => unwrap(api.get(`${W}/matrix/${a}/compare/${b}`)), enabled: Boolean(a && b && a !== b), retry: false });
export const useMatrixHistory = (docType) => useQuery({ queryKey: [...KEY, 'matrix', 'history', docType], queryFn: () => unwrap(api.get(`${W}/matrix/history/${encodeURIComponent(docType)}`)), enabled: Boolean(docType), retry: false });
export const useCreateMatrix = () => useWrite((body) => unwrap(api.post(`${W}/matrix`, body, idem())));
export const useSaveMatrix = () => useWrite(({ id, ...body }) => unwrap(api.put(`${W}/matrix/${id}`, body, idem())));
export const useDeleteMatrix = () => useWrite((id) => unwrap(api.delete(`${W}/matrix/${id}`, idem())));
export const useActivateMatrix = () => useWrite(({ id, effectiveFrom }) => unwrap(api.post(`${W}/matrix/${id}/activate`, { effectiveFrom }, idem())));
export const validateMatrix = (id) => unwrap(api.post(`${W}/matrix/${id}/validate`, {}));
export const simulate = (body) => unwrap(api.post(`${W}/matrix/simulate`, body));
export const useLimits = () => useQuery({ queryKey: [...KEY, 'limits'], queryFn: () => unwrap(api.get(`${W}/authority-limits`)), retry: false });
export const useLimitHistory = (filters) => useQuery({ queryKey: [...KEY, 'limits', 'history', filters], queryFn: () => unwrap(api.get(`${W}/authority-limits/history?${qs(filters)}`)), retry: false });
export const useProposeLimits = () => useWrite((body) => unwrap(api.post(`${W}/authority-limits/changes`, body, idem())));
export const useDelegations = (filters) => useQuery({ queryKey: [...KEY, 'delegations', filters], queryFn: () => unwrap(api.get(`${W}/delegations?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useCreateDelegation = () => useWrite((body) => unwrap(api.post(`${W}/delegations`, body, idem())));
export const useRevokeDelegation = () => useWrite(({ id, reason }) => unwrap(api.post(`${W}/delegations/${id}/revoke`, { reason }, idem())));
export const usePaths = () => useQuery({ queryKey: [...KEY, 'paths'], queryFn: () => unwrap(api.get(`${W}/escalation-paths`)), retry: false });
export const useSla = () => useQuery({ queryKey: [...KEY, 'sla'], queryFn: () => unwrap(api.get(`${W}/sla-settings`)), retry: false });
export const useProposePath = () => useWrite((body) => unwrap(api.post(`${W}/escalation-paths/changes`, body, idem())));
export const useProposeSla = () => useWrite((body) => unwrap(api.post(`${W}/sla-settings/changes`, body, idem())));
