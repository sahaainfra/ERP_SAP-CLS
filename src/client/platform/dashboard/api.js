import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/index.js';
import { refreshMs } from './layout.js';
import { lowBandwidthSaves } from '../device/lowBandwidth.js';

// Data hooks of the dashboard framework (part 03.07). Components use these, never the API client directly.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (p) => (await p).data;
const dashKey = (code) => ['dashboard', code];

export const useCatalogue = () => useQuery({ queryKey: ['dashboard', 'catalogue'], queryFn: () => unwrap(api.get('/ui/widgets')), retry: false, staleTime: 60_000 });
export const useDashboardList = () => useQuery({ queryKey: ['dashboard', 'list'], queryFn: () => unwrap(api.get('/ui/dashboards')), retry: false });
export const useDashboard = (code) => useQuery({ queryKey: dashKey(code), queryFn: () => unwrap(api.get(`/ui/dashboards/${code}`)), retry: false });

/** The data of one widget, refreshed by its own interval while the page is visible (FR-06). `asOf` in the result is the time the server read it. */
export function useWidgetData(code, query, { refreshSec = 0 } = {}) {
  return useQuery({
    queryKey: ['dashboard', 'widget', code, query],
    queryFn: () => unwrap(api.get(`/ui/widgets/${code}/data${query ? `?${query}` : ''}`)),
    retry: false,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[2] === code ? prev : undefined), // keep the last figures while a filter reloads, never another widget's
    // low-bandwidth mode with ff.perf.p16604 (part 166.4, FR-03): no refresh by itself; the widget's refresh button still reads it again
    refetchInterval: () => (lowBandwidthSaves() ? false : refreshMs(refreshSec, typeof document !== 'undefined' && document.hidden)),
    refetchOnWindowFocus: () => !lowBandwidthSaves(),
  });
}

export function useSavePersonal(code) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body) => unwrap(api.put(`/ui/dashboards/${code}/personal`, body)), onSuccess: (data) => qc.setQueryData(dashKey(code), data) });
}
export function useResetPersonal(code) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => unwrap(api.delete(`/ui/dashboards/${code}/personal`)), onSuccess: (data) => qc.setQueryData(dashKey(code), data) });
}

// ---- the designer (Config) ----
export const useRoleDefaults = (code, enabled = true) => useQuery({ queryKey: ['dashboard', 'designer', code], queryFn: () => unwrap(api.get(`/ui/dashboards/${code}/role-defaults`)), enabled, retry: false });
export function useProposeRoleDefault(code) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body) => unwrap(api.post(`/ui/dashboards/${code}/role-defaults`, body, idem())), onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', 'designer', code] }) });
}
export const useRoleHistory = (code, role) => useQuery({ queryKey: ['dashboard', 'history', code, role], queryFn: () => unwrap(api.get(`/ui/dashboards/${code}/history?role=${encodeURIComponent(role)}`)), enabled: Boolean(role), retry: false });
/** Decide a waiting change of a default (another administrator approves, or rejects with a comment). */
export function useDecideDashboardChange(code) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, comment }) => unwrap(api.post(`/core/change-requests/${id}/act`, { action, comment }, idem())),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: dashKey(code) }); },
  });
}
