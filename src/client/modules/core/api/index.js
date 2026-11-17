import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../platform/api/index.js';
import { queryKeys } from '../../../platform/query/keys.js';
import { lowBandwidthSaves } from '../../../platform/device/lowBandwidth.js';

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.core.flags.all }); qc.invalidateQueries({ queryKey: ['shell'] }); }, // the menu follows the flags (part 03.05)
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

/** Every flag key, for the override dialog: the list on screen shows one page, but any flag can be overridden. */
export const useFlagKeys = () =>
  useQuery({ queryKey: [...queryKeys.core.flags.all, 'keys'], queryFn: async () => [...new Set((await fetchAllFlags('')).map((r) => r.key))], staleTime: 30_000 });

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
  useWrite(({ id, ...body }) => unwrap(api.post(`/core/change-requests/${id}/act`, body, idem())), [queryKeys.core.requests.all, queryKeys.core.fy.all, queryKeys.core.numbering.all, queryKeys.core.ops.all, queryKeys.core.files.all, queryKeys.core.calc.all, queryKeys.core.observe.all, queryKeys.core.hub.all]);

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

// ---- Part 01.05: files and attachments ----
export const useFiles = ({ entity, entityId }) =>
  useQuery({
    queryKey: queryKeys.core.files.list(entity, entityId),
    queryFn: () => unwrap(api.get(`/core/files?entity=${entity}&entityId=${entityId}`)),
    enabled: Boolean(entity && entityId),
    // A file is "scanning" for a moment after it arrives: keep looking until every file has a verdict.
    refetchInterval: (query) => (query.state.data?.some((f) => f.scanStatus === 'PENDING') ? 1500 : false),
    retry: false,
  });
/** A short-lived link to a file or its thumbnail. Called when the user opens a file, never cached. */
export const fetchFileUrl = async (id, { variant = 'file', download = false } = {}) => (await api.get(`/core/files/${id}/url?variant=${variant}&download=${download}`)).data;
/** A photo shown in a list: its thumbnail in low-bandwidth mode with ff.perf.p16604 (part 166.4, FR-03), the photo itself when it has none. */
export const fetchPhotoUrl = async (id) => {
  if (lowBandwidthSaves()) { try { return await fetchFileUrl(id, { variant: 'thumbnail' }); } catch { /* no thumbnail: the photo */ } }
  return fetchFileUrl(id);
};
export const useDeleteFile = () => useWrite(({ id, reason }) => unwrap(api.delete(`/core/files/${id}`, idem(), { reason })), [queryKeys.core.files.all]);
export const useFileSettings = () =>
  useQuery({ queryKey: queryKeys.core.files.settings(), queryFn: () => unwrap(api.get('/core/files/settings')), retry: false });
export const useFileOverview = () =>
  useQuery({ queryKey: queryKeys.core.files.overview(), queryFn: () => unwrap(api.get('/core/files/overview')), refetchInterval: 10_000, retry: false });
export const useRescanFile = () => useWrite((id) => unwrap(api.post(`/core/files/${id}/rescan`, {}, idem())), [queryKeys.core.files.all]);
export const useRequestFileSettingsChange = () =>
  useWrite((body) => unwrap(api.post('/core/files/settings/change-requests', body, idem())), [queryKeys.core.requests.all, queryKeys.core.files.all]);

export const useSampleDocuments = (page) =>
  useQuery({ queryKey: queryKeys.core.sampleDocs.list({ page }), queryFn: () => api.get(`/core/sample-documents?page=${page}&pageSize=10`), placeholderData: (previous) => previous, retry: false });
export const useCreateSampleDocument = () => useWrite((body) => unwrap(api.post('/core/sample-documents', body, idem())), [queryKeys.core.sampleDocs.all]);
export const useSubmitSampleDocument = () => useWrite(({ id, version }) => unwrap(api.post(`/core/sample-documents/${id}/submit`, { version }, idem())), [queryKeys.core.sampleDocs.all, queryKeys.core.files.all]);

// ---- Part 01.06: calculation engine, formula registry, units and the sample bill ----
export const useFormulas = ({ q = '', owner = '' }) =>
  useQuery({
    queryKey: queryKeys.core.calc.formulas({ q, owner }),
    queryFn: () => api.get(`/core/formulas?pageSize=200&q=${encodeURIComponent(q)}${owner ? `&filter[owner_module]=${owner}` : ''}`),
    placeholderData: (previous) => previous,
    retry: false,
  });
export const useFormula = (code) =>
  useQuery({ queryKey: queryKeys.core.calc.formula(code), queryFn: () => unwrap(api.get(`/core/formulas/${code}`)), enabled: Boolean(code), retry: false });
export const useTestFormula = () => useMutation({ mutationFn: ({ code, ...body }) => unwrap(api.post(`/core/formulas/${code}/test`, body)) });
export const useCompareVersions = () => useMutation({ mutationFn: ({ code, ...body }) => unwrap(api.post(`/core/formulas/${code}/compare`, body)) });
export const useCreateFormula = () => useWrite((body) => unwrap(api.post('/core/formulas', body, idem())), [queryKeys.core.calc.all]);
export const useCreateVersion = () => useWrite(({ code, ...body }) => unwrap(api.post(`/core/formulas/${code}/versions`, body, idem())), [queryKeys.core.calc.all]);
/** `versionNo` is the formula version in the path; `rowVersion` is the optimistic-lock number the API calls `version`. */
export const useUpdateVersion = () => useWrite(({ code, versionNo, rowVersion, ...body }) => unwrap(api.patch(`/core/formulas/${code}/versions/${versionNo}`, { version: rowVersion, ...body }, idem())), [queryKeys.core.calc.all]);
export const useStartShadow = () => useWrite(({ code, version, reason }) => unwrap(api.post(`/core/formulas/${code}/versions/${version}/shadow`, { reason }, idem())), [queryKeys.core.calc.all]);
export const useStopShadow = () => useWrite(({ code, version, reason }) => unwrap(api.post(`/core/formulas/${code}/versions/${version}/shadow/stop`, { reason }, idem())), [queryKeys.core.calc.all]);
export const useRequestActivation = () =>
  useWrite(({ code, version, reason }) => unwrap(api.post(`/core/formulas/${code}/versions/${version}/activation-requests`, { reason }, idem())), [queryKeys.core.calc.all, queryKeys.core.requests.all]);
export const useShadowSummary = (code, candidate) =>
  useQuery({
    queryKey: queryKeys.core.calc.shadow(code, candidate),
    queryFn: () => unwrap(api.get(`/core/formulas/${code}/shadow-summary${candidate ? `?candidate=${candidate}` : ''}`)),
    enabled: Boolean(code),
    refetchInterval: 10_000,
    retry: false,
  });
export const useCalcTraces = (entity, entityId, enabled = true) =>
  useQuery({ queryKey: queryKeys.core.calc.traces(entity, entityId), queryFn: () => unwrap(api.get(`/core/calc-traces?entity=${entity}&entityId=${entityId}`)), enabled: enabled && Boolean(entityId), retry: false });
export const useUoms = () => useQuery({ queryKey: queryKeys.core.calc.uoms(), queryFn: () => unwrap(api.get('/core/uoms')), retry: false });
export const useConversions = (itemCode = '') =>
  useQuery({ queryKey: queryKeys.core.calc.conversions(itemCode), queryFn: () => unwrap(api.get(`/core/uom-conversions${itemCode ? `?itemCode=${encodeURIComponent(itemCode)}` : ''}`)), retry: false });
export const useConvertUnits = () => useMutation({ mutationFn: (body) => unwrap(api.post('/core/calc/convert', body)) });
export const useCreateConversion = () => useWrite((body) => unwrap(api.post('/core/uom-conversions', body, idem())), [queryKeys.core.calc.all]);
export const useRemoveConversion = () => useWrite((id) => unwrap(api.delete(`/core/uom-conversions/${id}`, idem(), {})), [queryKeys.core.calc.all]);

export const useSampleBills = (page) =>
  useQuery({ queryKey: queryKeys.core.calc.bills({ page }), queryFn: () => api.get(`/core/sample-bills?page=${page}&pageSize=10`), placeholderData: (previous) => previous, retry: false });
export const useCreateBill = () => useWrite((body) => unwrap(api.post('/core/sample-bills', body, idem())), [queryKeys.core.calc.all]);
export const useUpdateBill = () => useWrite(({ id, ...body }) => unwrap(api.patch(`/core/sample-bills/${id}`, body, idem())), [queryKeys.core.calc.all]);
export const useSubmitBill = () => useWrite(({ id, version }) => unwrap(api.post(`/core/sample-bills/${id}/submit`, { version }, idem())), [queryKeys.core.calc.all]);
export const useRecalculateBill = () => useWrite((id) => unwrap(api.post(`/core/sample-bills/${id}/recalculate`, {}, idem())), [queryKeys.core.calc.all]);

/** Pending approval requests of every kind, for the approvals inbox. */
export const usePendingRequests = () =>
  useQuery({ queryKey: queryKeys.core.requests.list({ status: 'SUBMITTED', inbox: true }), queryFn: () => api.get('/core/change-requests?page=1&pageSize=100&filter[status]=SUBMITTED'), refetchInterval: 10_000, retry: false });

// Operations health (part 01.07).

export const useOpsSummary = () =>
  useQuery({ queryKey: queryKeys.core.observe.summary(), queryFn: async () => (await api.get('/core/ops/summary')).data, refetchInterval: 10_000, retry: false });

export const useOpsSlos = () => useQuery({ queryKey: queryKeys.core.observe.slos(), queryFn: async () => (await api.get('/core/ops/slos')).data });
export const useOpsAlertRules = () => useQuery({ queryKey: queryKeys.core.observe.rules(), queryFn: async () => (await api.get('/core/ops/alert-rules')).data });
export const useOpsBaseline = () => useQuery({ queryKey: queryKeys.core.observe.baseline(), queryFn: async () => (await api.get('/core/ops/baseline')).data });

export const useOpsTraces = ({ status = '' } = {}) =>
  useQuery({ queryKey: queryKeys.core.observe.traces({ status }), queryFn: async () => (await api.get(`/core/ops/traces?limit=15${status ? `&status=${status}` : ''}`)).data, refetchInterval: 15_000 });

export const useOpsTrace = (traceId) =>
  useQuery({ queryKey: queryKeys.core.observe.trace(traceId), queryFn: async () => (await api.get(`/core/ops/traces/${traceId}`)).data, enabled: Boolean(traceId), retry: false });

export const useOpsFollow = (correlationId) =>
  useQuery({ queryKey: queryKeys.core.observe.follow(correlationId), queryFn: async () => (await api.get(`/core/ops/follow?correlationId=${encodeURIComponent(correlationId)}`)).data, enabled: Boolean(correlationId), retry: false });

function useOpsMutation(fn) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.core.observe.all }) });
}
export const useOpsEvaluate = () => useOpsMutation(() => api.post('/core/ops/evaluate', {}, idem()));
export const useOpsAcknowledge = () => useOpsMutation((id) => api.post(`/core/ops/alerts/${id}/acknowledge`, {}, idem()));
export const useOpsForceError = () => useOpsMutation(() => api.post('/core/ops/diagnostics/force-error', {}, idem()));
export const useOpsChangeRequest = () =>
  useOpsMutation(({ kind, key, changes, reason }) => api.post(kind === 'alert_rule' ? `/core/ops/alert-rules/${key}/change-requests` : `/core/ops/slo-definitions/${key}/change-requests`, { changes, reason }, idem()));

// Integration hub (part 01.08).
const hubQuery = (params) => Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export const useConnectors = ({ page = 1, pageSize = 25, q = '', type = '', status = '' }) =>
  useQuery({
    queryKey: queryKeys.core.hub.list({ page, pageSize, q, type, status }),
    queryFn: () => api.get(`/core/connectors?${hubQuery({ page, pageSize, q, 'filter[type]': type, 'filter[status]': status })}`),
    placeholderData: (previous) => previous,
    retry: false,
  });
export const useConnectorCatalog = () => useQuery({ queryKey: queryKeys.core.hub.catalog(), queryFn: () => unwrap(api.get('/core/connectors/catalog')), staleTime: 60_000, retry: false });
export const useConnector = (id) => useQuery({ queryKey: queryKeys.core.hub.detail(id), queryFn: () => unwrap(api.get(`/core/connectors/${id}`)), enabled: Boolean(id), retry: false });
export const useConnectorLogs = ({ page = 1, pageSize = 25, q = '', connector = '', status = '', direction = '', from = '', to = '' }) =>
  useQuery({
    queryKey: queryKeys.core.hub.logs({ page, pageSize, q, connector, status, direction, from, to }),
    queryFn: () => api.get(`/core/integration-logs?${hubQuery({ page, pageSize, q, 'filter[connector]': connector, 'filter[status]': status, 'filter[direction]': direction, from, to })}`),
    placeholderData: (previous) => previous,
    retry: false,
  });
export const useConnectorLog = (id) => useQuery({ queryKey: queryKeys.core.hub.log(id), queryFn: () => unwrap(api.get(`/core/integration-logs/${id}`)), enabled: Boolean(id), retry: false });

const hubKeys = [queryKeys.core.hub.all, queryKeys.core.requests.all];
export const useCreateConnector = () => useWrite((body) => unwrap(api.post('/core/connectors', body, idem())), hubKeys);
export const useChangeConnector = () => useWrite(({ id, ...body }) => unwrap(api.post(`/core/connectors/${id}/change-requests`, body, idem())), hubKeys);
export const useDisableConnector = () => useWrite(({ id, ...body }) => unwrap(api.post(`/core/connectors/${id}/disable`, body, idem())), hubKeys);
export const useTestConnector = () => useWrite((id) => unwrap(api.post(`/core/connectors/${id}/test`, {}, idem())), hubKeys);
export const useSampleConnector = () => useWrite((id) => unwrap(api.post(`/core/connectors/${id}/sample`, {}, idem())), hubKeys);
