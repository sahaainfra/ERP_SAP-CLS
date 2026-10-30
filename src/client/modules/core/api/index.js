import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../platform/api/index.js';
import { queryKeys } from '../../../platform/query/keys.js';

// Data hooks of the core module. Components never call fetch or the API client directly for screen data:
// they use these hooks, so caching, loading and error states behave the same everywhere.

export const useSession = () =>
  useQuery({ queryKey: queryKeys.session(), queryFn: async () => (await api.get('/core/session')).data });

export const useAbout = () =>
  useQuery({ queryKey: queryKeys.core.about(), queryFn: async () => (await api.get('/core/about')).data, retry: false });

export const useIntegritySummary = () =>
  useQuery({ queryKey: queryKeys.core.integrity.summary(), queryFn: async () => (await api.get('/core/integrity/summary')).data });

/** The history of one check: its latest results, newest first. */
export const useIntegrityRuns = ({ check, pageSize = 10 }) =>
  useQuery({
    queryKey: queryKeys.core.integrity.runs({ check, pageSize }),
    queryFn: () => api.get(`/core/integrity/runs?page=1&pageSize=${pageSize}&filter[check_code]=${encodeURIComponent(check)}`),
    enabled: Boolean(check),
  });

/** Run every check now. A fresh Idempotency-Key per click means a double click or a retry cannot run it twice. */
export function useRunIntegrity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/core/integrity/run', {}, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.core.integrity.all }),
  });
}

export const useArchitecture = () =>
  useQuery({ queryKey: queryKeys.core.architecture(), queryFn: async () => (await api.get('/core/architecture')).data });

export function useFlagList({ page, q, pageSize = 25 }) {
  const params = { page, pageSize, q };
  return useQuery({
    queryKey: queryKeys.core.flags.list(params),
    queryFn: () => api.get(`/core/feature-flags?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`),
    placeholderData: (previous) => previous,
  });
}

/** Evaluate one flag for the signed-in user's company; false until loaded or if undefined. */
export function useFeatureFlag(key) {
  const { data } = useQuery({
    queryKey: queryKeys.core.flags.evaluate([key]),
    queryFn: async () => (await api.get(`/core/feature-flags/evaluate?keys=${encodeURIComponent(key)}`)).data,
  });
  return data?.[key] === true;
}

/** Change a flag. On success every flag list and evaluation is refetched, so scoped screens update at once. */
export function useSetFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, scope, enabled, reason, version }) =>
      api.patch(`/core/feature-flags/${key}`, { scope, enabled, reason, version }, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.core.flags.all }),
    onError: (err) => {
      if (err.status === 409) qc.invalidateQueries({ queryKey: queryKeys.core.flags.all });
    },
  });
}

/** Every page of the current search, for export. Not cached: an export is a one-off. */
export async function fetchAllFlags(q) {
  const all = [];
  for (let p = 1; p <= 50; p++) {
    const res = await api.get(`/core/feature-flags?page=${p}&pageSize=200&q=${encodeURIComponent(q)}`);
    all.push(...res.data);
    if (p >= res.meta.totalPages) break;
  }
  return all;
}
