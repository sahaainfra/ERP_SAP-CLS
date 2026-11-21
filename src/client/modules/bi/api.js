import { api, authHeaders } from '../../platform/api/index.js';

export const bi = {
  catalogue: async () => (await api.get('/bi/reports')).data,
  report: async (params) => (await api.get(`/bi/reports/project-status?${new URLSearchParams(params)}`)).data,
  dataset: async () => (await api.get('/bi/datasets/project-status')).data,
  preview: async (params) => (await api.post('/bi/datasets/project-status/preview', params)).data,
  saved: async () => (await api.get('/bi/custom-reports')).data,
  save: ({ id, ...body }) => id
    ? api.put(`/bi/custom-reports/${id}`, body)
    : api.post('/bi/custom-reports', body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } }),
  remove: ({ id, version }) => api.delete(`/bi/custom-reports/${id}?version=${version}`),
  subscriptions: async () => (await api.get('/bi/subscriptions')).data,
  saveSubscription: ({ id, ...body }) => id
    ? api.put(`/bi/subscriptions/${id}`, body)
    : api.post('/bi/subscriptions', body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } }),
  changeSubscription: ({ id, status, version }) => api.patch(`/bi/subscriptions/${id}`, { status, version }),
  removeSubscription: ({ id, version }) => api.delete(`/bi/subscriptions/${id}?version=${version}`),
  usage: async (days) => (await api.get(`/bi/usage?days=${days}`)).data,
};

export function downloadProjectStatus(params, custom = false) {
  const source = custom ? 'datasets' : 'reports';
  return downloadReport(`/api/v1/bi/${source}/project-status/export?${new URLSearchParams(params)}`, `project-status.${params.format}`);
}

export async function downloadReport(urlPath, filename) {
  const res = await fetch(urlPath, {
    headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() },
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}));
    throw Object.assign(new Error(error?.message ?? 'The report could not be exported.'), { correlationId: error?.correlationId });
  }
  if (res.status === 202) return true;
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), {
    href: url,
    download: /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? filename,
  }).click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return false;
}
