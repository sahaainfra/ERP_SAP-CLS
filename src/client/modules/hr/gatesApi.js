import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../../platform/api/index.js';

// Part 07.14 (built in 166.6): the data hooks of the gates G1–G4. The server checks every right (hr.gate.view, hr.gate.review, hr.gate.export).
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const unwrap = async (p) => (await p).data;
const keys = { list: ['hr', 'gates'], one: (code) => ['hr', 'gates', code] };

export const useGates = () => useQuery({ queryKey: keys.list, queryFn: () => unwrap(api.get('/hr/gates')), retry: false });
export const useGate = (code) => useQuery({ queryKey: keys.one(code), queryFn: () => unwrap(api.get(`/hr/gates/${code}`)), enabled: Boolean(code), retry: false });

export function useReviewCriterion(code) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ criterion, status, note, version }) => unwrap(api.post(`/hr/gates/${code}/criteria/${encodeURIComponent(criterion)}`, { status, ...(note ? { note } : {}), ...(version ? { version } : {}) }, idem())),
    onSuccess: (data) => { qc.setQueryData(keys.one(code), data); qc.invalidateQueries({ queryKey: keys.list }); },
  });
}
export function useSubmitGate(code) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ comment }) => unwrap(api.post(`/hr/gates/${code}/submit`, comment ? { comment } : {}, idem())),
    onSuccess: (data) => { qc.setQueryData(keys.one(code), data); qc.invalidateQueries({ queryKey: keys.list }); },
  });
}

/** A file the server sends (an evidence document, the PDF report), fetched with the person's credentials and opened or saved. */
export async function openFile(path, { save = null } = {}) {
  const res = await fetch(`/api/v1${path}`, { headers: authHeaders() });
  if (!res.ok) {
    let message = `The file could not be opened (${res.status}).`;
    try { message = (await res.json()).error?.message ?? message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const url = URL.createObjectURL(await res.blob());
  if (save) Object.assign(document.createElement('a'), { href: url, download: save }).click();
  else window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
