import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/index.js';

// Server-side hooks of the offline engine pages (part 04.15): the person's commands and conflicts, and the devices list. The queue on the phone itself is read from the engine (`engine.js`).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== false).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export const useCommands = (filters = {}, { enabled = true } = {}) =>
  useQuery({ queryKey: ['off', 'commands', filters], queryFn: async () => (await api.get(`/off/commands?${q(filters)}`)).data, enabled, retry: false });
export const useConflictDetail = (id, { enabled = true } = {}) =>
  useQuery({ queryKey: ['off', 'command', id], queryFn: async () => (await api.get(`/off/commands/${id}`)).data, enabled, retry: false });
export const useDevices = (filters = {}) =>
  useQuery({ queryKey: ['off', 'devices', filters], queryFn: async () => (await api.get(`/off/devices?${q({ all: true, ...filters })}`)).data, retry: false });
export const useConfirmations = (enabled) =>
  useQuery({ queryKey: ['off', 'confirmations'], queryFn: async () => (await api.get('/off/confirmations')).data, enabled, retry: false });

export function useOffActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['off'] });
  return {
    resolve: useMutation({ mutationFn: async ({ id, ...b }) => (await api.post(`/off/commands/${id}/resolve`, b, idem())).data, onSuccess: done }),
    revoke: useMutation({ mutationFn: async ({ id, reason }) => (await api.post(`/off/devices/${id}/revoke`, { reason }, idem())).data, onSuccess: done }),
    decide: useMutation({ mutationFn: async ({ id, ...b }) => (await api.post(`/off/commands/${id}/confirm`, b, idem())).data, onSuccess: done }),
  };
}
