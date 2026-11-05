import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../api/index.js';
import { browserTransport, uploadFile } from '../files/upload.js';

// Data hooks of the Messages app (part 05.01). Everything is under the query key `msg`, so one real-time event refreshes the list and the open conversation together.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
export const MSG = ['msg'];

export const useConversations = (filters = {}, { refetchInterval = false } = {}) =>
  useQuery({ queryKey: ['msg', 'list', filters], queryFn: async () => (await api.get(`/msg/conversations?${q(filters)}`)).data, retry: false, refetchInterval });
export const useConversation = (id) =>
  useQuery({ queryKey: ['msg', 'details', id], queryFn: async () => (await api.get(`/msg/conversations/${id}`)).data, enabled: Boolean(id), retry: false });
export const useMessages = (id, around) =>
  useQuery({ queryKey: ['msg', 'messages', id, around ?? null], queryFn: async () => (await api.get(`/msg/conversations/${id}/messages?limit=60${around ? `&around=${around}` : ''}`)).data, enabled: Boolean(id), retry: false });
export const useUnread = () =>
  useQuery({ queryKey: ['msg', 'unread'], queryFn: async () => (await api.get('/msg/unread')).data, retry: false });
export const usePeople = (qText) =>
  useQuery({ queryKey: ['msg', 'people', qText], queryFn: async () => (await api.get(`/msg/people?${q({ q: qText })}`)).data.rows, retry: false });

export function useMessageActions(convId) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: MSG });
  const m = (fn) => useMutation({ mutationFn: fn, onSuccess: done });
  return {
    send: m(async (b) => (await api.post(`/msg/conversations/${convId}/messages`, b, idem())).data),
    edit: m(async ({ id, body }) => (await api.patch(`/msg/messages/${id}`, { body }, idem())).data),
    remove: m(async ({ id, reason }) => (await api.delete(`/msg/messages/${id}?${q({ reason })}`, idem())).data),
    react: m(async ({ id, emoji, on }) => (await api.post(`/msg/messages/${id}/reactions`, { emoji, on }, idem())).data),
    forward: m(async ({ id, conversationIds }) => (await api.post(`/msg/messages/${id}/forward`, { conversationIds }, idem())).data),
    read: useMutation({ mutationFn: async () => (await api.post(`/msg/conversations/${convId}/read`, {}, idem())).data, onSuccess: () => { qc.invalidateQueries({ queryKey: ['msg', 'list'] }); qc.invalidateQueries({ queryKey: ['msg', 'unread'] }); } }),
    settings: m(async (b) => (await api.put(`/msg/conversations/${convId}/settings`, b, idem())).data),
    rename: m(async (title) => (await api.patch(`/msg/conversations/${convId}`, { title }, idem())).data),
    archive: m(async (archived) => (await api.post(`/msg/conversations/${convId}/archive`, { archived }, idem())).data),
    addMembers: m(async (users) => (await api.post(`/msg/conversations/${convId}/members`, { users }, idem())).data),
    removeMember: m(async (user) => (await api.delete(`/msg/conversations/${convId}/members/${encodeURIComponent(user)}`, idem())).data),
    role: m(async ({ user, role }) => (await api.patch(`/msg/conversations/${convId}/members/${encodeURIComponent(user)}`, { role }, idem())).data),
  };
}
export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (b) => (await api.post('/msg/conversations', b, idem())).data, onSuccess: () => qc.invalidateQueries({ queryKey: MSG }) });
}
/** Upload a file to the conversation through the file service; resolves with the file record whose id goes into the message. */
export const uploadToConversation = (file, convId, onProgress) => uploadFile(file, { transport: browserTransport(authHeaders), entity: 'msg_conversation', entityId: convId, onProgress });

// ---- part 05.02 ----
export const useSearch = (filters, enabled) =>
  useQuery({ queryKey: ['msg', 'search', filters], queryFn: async () => (await api.get(`/msg/search?${q(filters)}`)).data, enabled, retry: false });
export const useStarred = (enabled) =>
  useQuery({ queryKey: ['msg', 'starred'], queryFn: async () => (await api.get('/msg/starred')).data, enabled, retry: false });
export const usePins = (id) =>
  useQuery({ queryKey: ['msg', 'pins', id], queryFn: async () => (await api.get(`/msg/conversations/${id}/pins`)).data, enabled: Boolean(id), retry: false });
export const useMedia = (id, kind, enabled = true) =>
  useQuery({ queryKey: ['msg', 'media', id, kind], queryFn: async () => (await api.get(`/msg/conversations/${id}/media?kind=${kind}`)).data, enabled: Boolean(id) && enabled, retry: false });
export const usePresence = (users) =>
  useQuery({ queryKey: ['msg', 'presence', [...users].sort().join(',')], queryFn: async () => (await api.get(`/msg/presence?users=${users.join(',')}`)).data.rows, enabled: users.length > 0, refetchInterval: 30_000, retry: false });
export const useReceipts = (messageId, enabled) =>
  useQuery({ queryKey: ['msg', 'receipts', messageId], queryFn: async () => (await api.get(`/msg/messages/${messageId}/receipts`)).data, enabled, retry: false });
export const useCalls = (id) =>
  useQuery({ queryKey: ['msg', 'calls', id], queryFn: async () => (await api.get(`/msg/conversations/${id}/calls`)).data, enabled: Boolean(id), retry: false });
export const useMeSettings = () =>
  useQuery({ queryKey: ['msg', 'me'], queryFn: async () => (await api.get('/msg/me/settings')).data, retry: false });

export function useFeatureActions(convId) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: MSG });
  return {
    star: useMutation({ mutationFn: async ({ id, on }) => (await api.post(`/msg/messages/${id}/star`, { on }, idem())).data, onSuccess: done }),
    pin: useMutation({ mutationFn: async ({ id, on }) => (await api.post(`/msg/messages/${id}/pin`, { on }, idem())).data, onSuccess: done }),
    hide: useMutation({ mutationFn: async (id) => (await api.post(`/msg/messages/${id}/hide`, {}, idem())).data, onSuccess: done }),
    me: useMutation({ mutationFn: async (b) => (await api.put('/msg/me/settings', b, idem())).data, onSuccess: () => qc.invalidateQueries({ queryKey: ['msg', 'me'] }) }),
    startCall: useMutation({ mutationFn: async (type) => (await api.post(`/msg/conversations/${convId}/calls`, { type }, idem())).data, onSuccess: done }),
  };
}
export const sendTyping = (id) => api.post(`/msg/conversations/${id}/typing`, {}).catch(() => {});
export const markDelivered = (id, upTo) => api.post(`/msg/conversations/${id}/delivered`, { upTo }).catch(() => {});
export const beat = (status) => api.post('/msg/presence', { status }).catch(() => {});
export const callApi = {
  join: async (id) => (await api.post(`/msg/calls/${id}/join`, {}, idem())).data,
  decline: async (id) => (await api.post(`/msg/calls/${id}/decline`, {}, idem())).data,
  end: async (id) => (await api.post(`/msg/calls/${id}/end`, {}, idem())).data,
  get: async (id) => (await api.get(`/msg/calls/${id}`)).data,
  ringing: async () => (await api.get('/msg/calls/ringing')).data.rows,
  signal: (id, body) => api.post(`/msg/calls/${id}/signal`, body).catch(() => {}),
};
export const configApi = {
  get: async () => (await api.get('/msg/config')).data,
  propose: async (b) => (await api.post('/msg/config/changes', b, idem())).data,
  holds: async () => (await api.get('/msg/holds')).data.rows,
  place: async (id, reason) => (await api.post(`/msg/conversations/${id}/hold`, { reason }, idem())).data,
  release: async (id, reason) => (await api.post(`/msg/holds/${id}/release`, { reason }, idem())).data,
};
