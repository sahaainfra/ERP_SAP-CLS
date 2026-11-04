import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';

// Data hooks of task management (part 04.08).
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false).map(([k, v]) => [k, String(v)])).toString();
export const TSK = ['tsk'];
const B = '/tsk';

export const useTasks = (filters) => useQuery({ queryKey: [...TSK, 'list', filters], queryFn: () => unwrap(api.get(`${B}/tasks?${qs(filters)}`)), retry: false, placeholderData: (prev) => prev });
export const useTaskCounts = () => useQuery({ queryKey: [...TSK, 'counts'], queryFn: () => unwrap(api.get(`${B}/tasks/counts`)), retry: false });
export const useTask = (id) => useQuery({ queryKey: [...TSK, 'task', id], queryFn: () => unwrap(api.get(`${B}/tasks/${id}`)), enabled: Boolean(id), retry: false });
export const useRoutePreview = (q, enabled) => useQuery({ queryKey: [...TSK, 'route', q], queryFn: () => unwrap(api.get(`${B}/tasks/route?${qs(q)}`)), enabled, retry: false, placeholderData: (prev) => prev });
export const useTeamDashboard = (filters) => useQuery({ queryKey: [...TSK, 'dashboard', filters], queryFn: () => unwrap(api.get(`${B}/dashboard?${qs(filters)}`)), retry: false });
export const useRouting = () => useQuery({ queryKey: [...TSK, 'routing'], queryFn: () => unwrap(api.get(`${B}/routing`)), retry: false });
export const tasksUrl = (format, filters) => `/api/v1${B}/tasks/export?${qs({ ...filters, format })}`;
export { authHeaders };

const useWrite = (fn) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: TSK }); qc.invalidateQueries({ queryKey: ['shell'] }); qc.invalidateQueries({ queryKey: ['work'] }); } });
};
export const useCreateTask = () => useWrite((body) => unwrap(api.post(`${B}/tasks`, body, idem())));
export const useInstruct = () => useWrite((body) => unwrap(api.post(`${B}/instructions`, body, idem())));
export const useTaskAct = () => useWrite(({ id, action, reason }) => unwrap(api.post(`${B}/tasks/${id}/${action}`, reason ? { reason } : {}, idem())));
export const useUpdateTask = () => useWrite(({ id, ...body }) => unwrap(api.patch(`${B}/tasks/${id}`, body, idem())));
export const useTaskComment = () => useWrite(({ id, body }) => unwrap(api.post(`${B}/tasks/${id}/comments`, { body }, idem())));
export const useTaskChecklist = () => useWrite(({ id, ...body }) => unwrap(api.post(`${B}/tasks/${id}/checklist`, body, idem())));
export const useTaskDepend = () => useWrite(({ id, ...body }) => unwrap(api.post(`${B}/tasks/${id}/dependencies`, body, idem())));
export const useTaskPeople = () => useWrite(({ id, ...body }) => unwrap(api.put(`${B}/tasks/${id}/people`, body, idem())));
export const useProposeRouting = () => useWrite((body) => unwrap(api.post(`${B}/routing/changes`, body, idem())));
