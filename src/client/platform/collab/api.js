import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/index.js';

// Data hooks of comments, mentions, the activity timeline and record trace links (part 04.14). Each tab of a record loads its own data when it is opened.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : v)}`).join('&');
export const colKey = (entity, id, part = '') => ['col', entity, String(id), part];

export const useComments = (entity, id, { enabled = true } = {}) =>
  useQuery({ queryKey: colKey(entity, id, 'comments'), queryFn: async () => (await api.get(`/col/comments?${q({ entity, id })}`)).data, enabled, retry: false });

export const useTimeline = (entity, id, filters, { enabled = true } = {}) =>
  useQuery({ queryKey: [...colKey(entity, id, 'timeline'), filters], queryFn: async () => (await api.get(`/col/timeline?${q({ entity, id, ...filters })}`)).data, enabled, retry: false });

export const useTrace = (entity, id, depth, { enabled = true } = {}) =>
  useQuery({ queryKey: [...colKey(entity, id, 'trace'), depth], queryFn: async () => (await api.get(`/col/trace?${q({ entity, id, depth })}`)).data, enabled, retry: false });

export const useProjectFeed = (filters, { enabled = true } = {}) =>
  useQuery({ queryKey: ['col', 'feed', filters], queryFn: async () => (await api.get(`/col/feed?${q(filters)}`)).data, enabled, retry: false });

export const useMentions = (filters = {}) =>
  useQuery({ queryKey: ['col', 'mentions', filters], queryFn: async () => (await api.get(`/col/mentions?${q(filters)}`)).data, retry: false });

export function useCollabActions(entity, id) {
  const qc = useQueryClient();
  const done = () => { qc.invalidateQueries({ queryKey: ['col', entity, String(id)] }); qc.invalidateQueries({ queryKey: ['col', 'mentions'] }); };
  return {
    post: useMutation({ mutationFn: async (b) => (await api.post('/col/comments', { entity, id: String(id), ...b }, idem())).data, onSuccess: done }),
    edit: useMutation({ mutationFn: async ({ commentId, ...b }) => (await api.patch(`/col/comments/${commentId}`, b, idem())).data, onSuccess: done }),
    remove: useMutation({ mutationFn: async ({ commentId, reason }) => (await api.delete(`/col/comments/${commentId}?${q({ reason })}`, idem())).data, onSuccess: done }),
    react: useMutation({ mutationFn: async ({ commentId, ...b }) => (await api.post(`/col/comments/${commentId}/reactions`, b, idem())).data, onSuccess: done }),
    link: useMutation({ mutationFn: async (b) => (await api.post('/col/trace/links', b, idem())).data, onSuccess: done }),
    unlink: useMutation({ mutationFn: async ({ linkId, reason }) => (await api.delete(`/col/trace/links/${linkId}?${q({ reason })}`, idem())).data, onSuccess: done }),
  };
}

export function useMarkMentionsRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (b) => (await api.post('/col/mentions/read', b, idem())).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['col', 'mentions'] }) });
}
