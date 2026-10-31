import { api } from '../api/index.js';

// Export and print logging (part 02.06, FR-05): the server keeps a record of who exported or printed what. The browser tells it
// at the moment of the export. A failed report never stops the export, and a company that has not switched the feature on
// simply answers 404, which is ignored.
const idem = () => ({ headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });

/** Tell the server that this person exported (or printed) a report. `filters` are the filters the report was showing. */
export function logExport({ report, format = 'csv', rows = 0, filters = {}, sensitive = false }) {
  const flat = Object.fromEntries(Object.entries(filters).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v]));
  return api.post('/core/audit/export-log', { report: String(report).slice(0, 120), format, rows, filters: flat, sensitive }, idem()).catch(() => null);
}

/** Log every print of a page (the browser's print dialog), with the page's address. */
export function installPrintLogging() {
  if (typeof window === 'undefined' || window.__erpPrintLogging) return;
  window.__erpPrintLogging = true;
  window.addEventListener('beforeprint', () => { logExport({ report: window.location.pathname, format: 'print', sensitive: window.location.pathname.startsWith('/admin') }); });
}
