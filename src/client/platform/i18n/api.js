import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/index.js';

// Data hooks of localisation (part 03.09). Components use these, never the API client directly.
const unwrap = async (p) => (await p).data;
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });

export const useCatalogue = (lang, enabled = true) => useQuery({ queryKey: ['i18n', 'catalogue', lang], queryFn: () => unwrap(api.get(`/ui/translations/${lang}/all`)), enabled, retry: false, staleTime: 5 * 60_000 });
export const useLocalePrefs = (enabled = true) => useQuery({ queryKey: ['i18n', 'locale-prefs'], queryFn: () => unwrap(api.get('/ui/locale-preferences')), enabled, retry: false, staleTime: 5 * 60_000 });
export function useSaveLocalePrefs() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body) => unwrap(api.put('/ui/locale-preferences', body)), onSuccess: (data) => qc.setQueryData(['i18n', 'locale-prefs'], data) });
}

// ---- the Translations page ----
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
export const useTranslationList = (params) => useQuery({ queryKey: ['i18n', 'list', params], queryFn: () => unwrap(api.get(`/ui/translations?${qs(params)}`)), retry: false, placeholderData: (prev) => prev });
export const useMissingKeys = () => useQuery({ queryKey: ['i18n', 'missing'], queryFn: () => unwrap(api.get('/ui/translations/missing')), retry: false });
export const usePendingChanges = () => useQuery({ queryKey: ['i18n', 'pending'], queryFn: () => unwrap(api.get('/ui/translations/pending')), retry: false });
export const useTextHistory = (namespace, key) => useQuery({ queryKey: ['i18n', 'history', namespace, key], queryFn: () => unwrap(api.get(`/ui/translations/history?${qs({ namespace, key })}`)), enabled: Boolean(namespace && key), retry: false });
export function useProposeChanges() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body) => unwrap(api.post('/ui/translations/changes', body, idem())), onSuccess: () => qc.invalidateQueries({ queryKey: ['i18n'] }) });
}
export function useDecideChange() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, action, comment }) => unwrap(api.post(`/core/change-requests/${id}/act`, { action, comment }, idem())), onSuccess: () => qc.invalidateQueries({ queryKey: ['i18n'] }) });
}
/** Send a translator's .xlsx; without `commit` it only says what would change. */
export const importWorkbook = (file, { commit = false, reason = '' } = {}) => api.post(`/ui/translations/import?${qs({ commit: commit ? 1 : 0, reason })}`, file, { raw: true, headers: { 'content-type': 'application/octet-stream' } }).then((r) => r.data);
export const downloadWorkbookUrl = '/api/v1/ui/translations/export';
