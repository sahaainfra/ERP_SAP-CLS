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
export const useMessages = (id) =>
  useQuery({ queryKey: ['msg', 'messages', id], queryFn: async () => (await api.get(`/msg/conversations/${id}/messages?limit=60`)).data, enabled: Boolean(id), retry: false });
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
