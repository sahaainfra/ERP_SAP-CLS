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

// ---- Part 01.03: configuration, financial years, numbering, parameters, holidays ----
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (promise) => (await promise).data;

/** A mutation that sends a fresh Idempotency-Key and refreshes the listed query keys on success. */
function useWrite(fn, invalidate) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
    onError: (err) => {
      if (err.status === 409) invalidate.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
    },
  });
}

export const useCompanySettings = () =>
  useQuery({ queryKey: queryKeys.core.settings(), queryFn: () => unwrap(api.get('/core/company-settings')), retry: false });
export const useSaveCompanySettings = () => useWrite((body) => unwrap(api.put('/core/company-settings', body, idem())), [queryKeys.core.settings()]);

export const useFinancialYears = () =>
  useQuery({ queryKey: queryKeys.core.fy.list(), queryFn: () => api.get('/core/financial-years?page=1&pageSize=50'), retry: false });
export const useFinancialYear = (id) =>
  useQuery({ queryKey: queryKeys.core.fy.one(id), queryFn: () => unwrap(api.get(`/core/financial-years/${id}`)), enabled: Boolean(id) });
export const useCreateFinancialYear = () => useWrite((body) => unwrap(api.post('/core/financial-years', body, idem())), [queryKeys.core.fy.all]);
export const useSetPeriodStatus = () => useWrite(({ id, ...body }) => unwrap(api.post(`/core/periods/${id}/status`, body, idem())), [queryKeys.core.fy.all]);
export const useCloseFinancialYear = () => useWrite(({ id, ...body }) => unwrap(api.post(`/core/financial-years/${id}/close`, body, idem())), [queryKeys.core.fy.all]);
export const useRequestReopen = () => useWrite((body) => unwrap(api.post('/core/period-reopen-requests', body, idem())), [queryKeys.core.requests.all]);

export const useChangeRequests = (params = {}) =>
  useQuery({
    queryKey: queryKeys.core.requests.list(params),
    queryFn: () => api.get(`/core/change-requests?page=1&pageSize=50${params.status ? `&filter[status]=${params.status}` : ''}`),
    retry: false,
  });
export const useActOnRequest = () =>
  useWrite(({ id, ...body }) => unwrap(api.post(`/core/change-requests/${id}/act`, body, idem())), [queryKeys.core.requests.all, queryKeys.core.fy.all, queryKeys.core.numbering.all, queryKeys.core.ops.all]);

export const useDocumentTypes = () =>
  useQuery({ queryKey: queryKeys.core.numbering.types(), queryFn: () => unwrap(api.get('/core/document-types')), retry: false });
export const useNumberSeries = () =>
  useQuery({ queryKey: queryKeys.core.numbering.series(), queryFn: () => unwrap(api.get('/core/number-series')), retry: false });
export const useCreateDocType = () => useWrite((body) => unwrap(api.post('/core/document-types', body, idem())), [queryKeys.core.numbering.all]);
export const useCreateSeries = () => useWrite((body) => unwrap(api.post('/core/number-series', body, idem())), [queryKeys.core.numbering.all]);
export const useUpdateSeries = () => useWrite(({ id, ...body }) => unwrap(api.patch(`/core/number-series/${id}`, body, idem())), [queryKeys.core.numbering.all]);
export const useRequestSeriesChange = () => useWrite(({ id, ...body }) => unwrap(api.post(`/core/number-series/${id}/change-requests`, body, idem())), [queryKeys.core.requests.all]);

/** The number that would be issued next, from the server's own formatter, so a preview never differs from the real number. */
export const useNumberPreview = (params) =>
  useQuery({
    queryKey: queryKeys.core.numbering.preview(params),
    queryFn: () => unwrap(api.get(`/core/numbering/preview?${new URLSearchParams(params)}`)),
    enabled: Boolean(params?.docType),
    retry: false,
  });

export const useParameterDefinitions = () =>
  useQuery({ queryKey: queryKeys.core.parameters.definitions(), queryFn: () => unwrap(api.get('/core/parameters/definitions')), retry: false });
export const useParameters = (key) =>
  useQuery({
    queryKey: queryKeys.core.parameters.list({ key }),
    queryFn: () => unwrap(api.get(`/core/parameters${key ? `?filter[key]=${encodeURIComponent(key)}` : ''}`)),
    retry: false,
  });
export const useSetParameter = () => useWrite((body) => unwrap(api.post('/core/parameters', body, idem())), [queryKeys.core.parameters.all]);

export const useHolidayCalendars = () =>
  useQuery({ queryKey: queryKeys.core.holidays.calendars(), queryFn: () => unwrap(api.get('/core/holiday-calendars')), retry: false });
export const useHolidayCalendar = (id, year) =>
  useQuery({
    queryKey: queryKeys.core.holidays.one(id, year),
    queryFn: () => unwrap(api.get(`/core/holiday-calendars/${id}?from=${year}-01-01&to=${year}-12-31`)),
    enabled: Boolean(id),
  });
export const useCreateCalendar = () => useWrite((body) => unwrap(api.post('/core/holiday-calendars', body, idem())), [queryKeys.core.holidays.all]);
export const useAddHoliday = () => useWrite(({ calendarId, ...body }) => unwrap(api.post(`/core/holiday-calendars/${calendarId}/holidays`, body, idem())), [queryKeys.core.holidays.all]);
export const useDeleteHoliday = () => useWrite((id) => unwrap(api.delete(`/core/holidays/${id}`, idem())), [queryKeys.core.holidays.all]);
export const useImportHolidays = () => useWrite(({ calendarId, rows }) => unwrap(api.post(`/core/holiday-calendars/${calendarId}/import`, { rows }, idem())), [queryKeys.core.holidays.all]);

// ---- Part 01.04: event bus, dead letters, background jobs and schedules ----
const LIVE = 5000; // the console refreshes itself, so lag and failures are seen as they happen

export const useEventMetrics = () =>
  useQuery({ queryKey: queryKeys.core.ops.metrics(), queryFn: () => unwrap(api.get('/core/events/metrics')), refetchInterval: LIVE, retry: false });
export const useEventTypes = () =>
  useQuery({ queryKey: queryKeys.core.ops.types(), queryFn: () => unwrap(api.get('/core/events/types')), retry: false });
export const useEvents = (params) =>
  useQuery({
    queryKey: queryKeys.core.ops.events(params),
    queryFn: () => api.get(`/core/events?page=${params.page}&pageSize=${params.pageSize ?? 25}&q=${encodeURIComponent(params.q ?? '')}`),
    placeholderData: (previous) => previous,
    refetchInterval: LIVE,
    retry: false,
  });
export const useDeadLetters = (params) =>
  useQuery({
    queryKey: queryKeys.core.ops.dlq(params),
    queryFn: () => api.get(`/core/events/dlq?page=${params.page}&pageSize=25&filter[status]=${params.status}`),
    placeholderData: (previous) => previous,
    refetchInterval: LIVE,
    retry: false,
  });
export const useRedrive = () => useWrite(({ id, reason }) => unwrap(api.post(`/core/events/dlq/${id}/redrive`, { reason }, idem())), [queryKeys.core.ops.all]);
export const useDiscard = () => useWrite(({ id, reason }) => unwrap(api.post(`/core/events/dlq/${id}/discard`, { reason }, idem())), [queryKeys.core.ops.all]);
export const useReplay = () => useWrite((body) => unwrap(api.post('/core/events/replay', body, idem())), [queryKeys.core.ops.all]);

export const useJobs = (params) =>
  useQuery({
    queryKey: queryKeys.core.ops.jobs(params),
    queryFn: () => api.get(`/core/jobs?page=${params.page}&pageSize=25${params.status ? `&filter[status]=${params.status}` : ''}`),
    placeholderData: (previous) => previous,
    refetchInterval: LIVE,
    retry: false,
  });
export const useCancelJob = () => useWrite(({ id, reason }) => unwrap(api.post(`/core/jobs/${id}/cancel`, { reason }, idem())), [queryKeys.core.ops.all]);
export const useRetryJob = () => useWrite(({ id, reason }) => unwrap(api.post(`/core/jobs/${id}/retry`, { reason }, idem())), [queryKeys.core.ops.all]);

export const useSchedules = () =>
  useQuery({ queryKey: queryKeys.core.ops.schedules(), queryFn: () => unwrap(api.get('/core/schedules')), refetchInterval: LIVE * 3, retry: false });
export const useCronPreview = (cron) =>
  useQuery({
    queryKey: queryKeys.core.ops.cron({ cron }),
    queryFn: () => unwrap(api.get(`/core/schedules/preview?cron=${encodeURIComponent(cron)}&count=5`)),
    enabled: Boolean(cron?.trim()),
    retry: false,
  });
export const useRequestScheduleChange = () =>
  useWrite(({ id, ...body }) => unwrap(api.post(`/core/schedules/${id}/change-requests`, body, idem())), [queryKeys.core.requests.all, queryKeys.core.ops.all]);
