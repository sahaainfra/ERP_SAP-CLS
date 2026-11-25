import { api } from '../../platform/api/index.js';

// Shared by the closeout pages of module M26: the API calls and the status words shown with the shared tones.
export const read = async (path) => (await api.get(`/close${path}`)).data;
export const post = async (path, body = {}) => (await api.post(`/close${path}`, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } })).data;
export const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };
export const TONE = { CONSTRUCTION: 'DRAFT', MC: 'SUBMITTED', RFC: 'AT_RISK', RFSU: 'APPROVED', OPEN: 'DRAFT', PASSED: 'APPROVED', FAILED: 'REJECTED', CANCELLED: 'CANCELLED', PLANNED: 'DRAFT', SUBMITTED: 'SUBMITTED', APPROVED: 'AT_RISK', ISSUED: 'APPROVED', REJECTED: 'REJECTED', RECTIFIED: 'SUBMITTED', CLOSED: 'APPROVED', ACTIVE: 'SUBMITTED' };
