import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/index.js';
import { queryKeys } from '../query/keys.js';
import { lowBandwidthSaves } from '../device/lowBandwidth.js';

// Data hooks of the application shell (part 03.05). Components use these, never the API client directly.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (p) => (await p).data;
export const shellKeys = { nav: ['shell', 'navigation'], context: ['shell', 'context'], favourites: ['shell', 'favourites'], recent: ['shell', 'recent'], launchpad: ['shell', 'launchpad'], bell: ['shell', 'bell'], registry: ['shell', 'registry'] };

export const useNavigation = (enabled = true) => useQuery({ queryKey: shellKeys.nav, queryFn: () => unwrap(api.get('/ui/navigation')), enabled, retry: false, staleTime: 60_000 });
export const useContextOptions = (enabled = true) => useQuery({ queryKey: shellKeys.context, queryFn: () => unwrap(api.get('/ui/context-options')), enabled, retry: false, staleTime: 60_000 });
export const useFavourites = (enabled = true) => useQuery({ queryKey: shellKeys.favourites, queryFn: () => unwrap(api.get('/ui/favourites')), enabled, retry: false });
export const useRecent = (enabled = true) => useQuery({ queryKey: shellKeys.recent, queryFn: () => unwrap(api.get('/ui/recent')), enabled, retry: false });
export const useLaunchpad = (enabled = true) => useQuery({ queryKey: shellKeys.launchpad, queryFn: () => unwrap(api.get('/ui/launchpad')), enabled, retry: false });
/** The bell: how many requests wait for this person (refreshed every minute until the notification service of 04.06 exists). */
/** Part 166.3: what waits for a site person today, for the Field Home's task cards (refreshed every two minutes while the page is open). */
export const useFieldToday = (enabled = true) => useQuery({ queryKey: ['shell', 'field-today'], queryFn: () => unwrap(api.get('/ui/field/today')), enabled, retry: false, refetchInterval: () => (lowBandwidthSaves() ? false : 120_000) }); // none in low-bandwidth mode (166.4)
export const useBell = (enabled = true) => useQuery({ queryKey: shellKeys.bell, queryFn: () => unwrap(api.get('/ui/bell')), enabled, retry: false, refetchInterval: 60_000 });

export function useSetContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => unwrap(api.put('/ui/context', body)),
    onSuccess: (data) => qc.setQueryData(shellKeys.context, data),
  });
}

export function useFavouriteActions() {
  const qc = useQueryClient();
  const done = () => { qc.invalidateQueries({ queryKey: shellKeys.favourites }); qc.invalidateQueries({ queryKey: shellKeys.launchpad }); };
  return {
    add: useMutation({ mutationFn: (body) => unwrap(api.post('/ui/favourites', body, idem())), onSuccess: done }),
    remove: useMutation({ mutationFn: (id) => unwrap(api.delete(`/ui/favourites/${id}`)), onSuccess: done }),
    order: useMutation({ mutationFn: (ids) => unwrap(api.put('/ui/favourites/order', { ids })), onSuccess: done }),
  };
}

/** Say that the person opened a record, so it appears under their recent records. Failures are ignored: it is a convenience. */
export function recordVisit(body) {
  return api.post('/ui/recent', body).catch(() => null);
}

// ---- the registry's Config page ----
export const useRegistry = (enabled = true) => useQuery({ queryKey: shellKeys.registry, queryFn: () => unwrap(api.get('/ui/navigation/registry')), enabled, retry: false });
export const useRegistryHistory = (code) => useQuery({ queryKey: [...shellKeys.registry, 'history', code], queryFn: () => unwrap(api.get(`/ui/navigation/registry/${code}/history`)), enabled: Boolean(code), retry: false });
export function useProposeChange() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body) => unwrap(api.post('/ui/navigation/changes', body, idem())), onSuccess: () => qc.invalidateQueries({ queryKey: shellKeys.registry }) });
}
export function useImportRegistry() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body) => unwrap(api.post('/ui/navigation/registry/import', body, idem())), onSuccess: () => qc.invalidateQueries({ queryKey: shellKeys.registry }) });
}
export const exportRegistry = () => unwrap(api.get('/ui/navigation/registry/export'));
/** Decide a registry change request (another administrator approves, or rejects with a comment). */
export function useDecideChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, comment }) => unwrap(api.post(`/core/change-requests/${id}/act`, { action, comment }, idem())),
    onSuccess: () => { qc.invalidateQueries({ queryKey: shellKeys.registry }); qc.invalidateQueries({ queryKey: shellKeys.nav }); },
  });
}

/** Whether a feature flag is ON for the person: false until it is known (so a part that is still loading is drawn as if it were off). */
export function useFlag(key, enabled = true) {
  const q = useQuery({ queryKey: queryKeys.core.flags.evaluate([key]), queryFn: async () => (await api.get(`/core/feature-flags/evaluate?keys=${encodeURIComponent(key)}`)).data, enabled, retry: false });
  return { on: q.data?.[key] === true, known: q.isSuccess || q.isError };
}
export const useFlagOn = (key, enabled = true) => useFlag(key, enabled).on;

/** Whether the application shell of part 03.05 is switched on: 'loading' until the flag is known, then 'on' or 'off'. */
export function useShellMode(enabled = true) {
  const q = useQuery({ queryKey: queryKeys.core.flags.evaluate(['ff.ui.p0305']), queryFn: async () => (await api.get('/core/feature-flags/evaluate?keys=ff.ui.p0305')).data, enabled, retry: false });
  if (q.isSuccess) return q.data?.['ff.ui.p0305'] === true ? 'on' : 'off';
  return q.isError ? 'off' : 'loading';
}
