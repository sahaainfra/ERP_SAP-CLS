import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/index.js';

// Data hooks of the Object Page (part 03.04): each part of a record is its own query, so a tab loads only when opened and the page
// refreshes only what an action changed.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
export const objectKey = (type, id, part = '') => ['object', type, id, part];

export const useObjectPart = (type, id, part, { enabled = true, query = '', refetchInterval = false } = {}) =>
  useQuery({ queryKey: [...objectKey(type, id, part), query], queryFn: async () => (await api.get(`/ui/objects/${type}/${id}/${part}${query}`)).data, enabled, retry: false, refetchInterval });

/** Refresh every part of a record (after an action changed it). */
export function useRefreshObject(type, id) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['object', type, id] });
}

export function useAddComment(type, id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body) => (await api.post(`/ui/objects/${type}/${id}/comments`, { body }, idem())).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['object', type, id] }),
  });
}

export function useDocumentLinks(type, id) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['object', type, id] });
  return {
    link: useMutation({ mutationFn: async ({ requirementCode, fileId }) => (await api.post(`/ui/objects/${type}/${id}/documents`, { requirementCode, fileId }, idem())).data, onSuccess: done }),
    unlink: useMutation({ mutationFn: async (linkId) => (await api.delete(`/ui/objects/${type}/${id}/documents/${linkId}`)).data, onSuccess: done }),
  };
}

/** The current time, refreshed on an interval (for countdowns). */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** "Due in 5 h 12 min" or "Overdue by 2 h 3 min" for a due time. */
export function countdown(dueAt, now) {
  const ms = Date.parse(dueAt) - now;
  const mins = Math.floor(Math.abs(ms) / 60_000);
  const text = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  return { overdue: ms < 0, text: ms < 0 ? `Overdue by ${text}` : `Due in ${text}`, soon: ms >= 0 && ms < 4 * 3_600_000 };
}
