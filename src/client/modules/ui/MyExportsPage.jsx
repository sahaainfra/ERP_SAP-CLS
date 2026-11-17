import { useState } from 'react';
import { useMyExports } from './api.js';
import { QueryState, usePageTitle } from '../core/pages/ui.jsx';
import { authHeaders } from '../../platform/api/index.js';
import Icon from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { formatDateTime } from '../../platform/format.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

const STATUS_LABEL = { QUEUED: 'Waiting', RUNNING: 'Being prepared', DONE: 'Ready', FAILED: 'Failed', EXPIRED: 'Expired' };
const STATUS_TONE = { QUEUED: 'SUBMITTED', RUNNING: 'IN_REVIEW', DONE: 'COMPLETED', FAILED: 'REJECTED', EXPIRED: 'CANCELLED' };

/**
 * My Exports (part 03.03, FR-06): exports too large for a direct download are prepared in the background and wait here for 7 days. Only
 * the person who asked sees and downloads them; the list refreshes itself while one is being prepared.
 */
export default function MyExportsPage() {
  usePageTitle('My Exports');
  const exports = useMyExports();
  const [notice, setNotice] = useState('');
  const rows = exports.data ?? [];
  const download = async (e) => {
    setNotice('');
    const res = await fetch(`/api/v1/ui/exports/${e.id}/download`, { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { const j = await res.json().catch(() => null); setNotice(j?.error?.message ?? `The server answered ${res.status}`); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: e.fileName }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">My account &rsaquo; My Exports</nav>
      <PageHeader id="page-title" title={"My Exports"} subtitle={"Exports with more rows than a direct download allows are prepared in the background. They use the filters, sort and masks you had when you asked, and are kept for 7 days."} />
      <p role="status" className="notice">{notice}</p>
      <QueryState query={exports} what="your exports" permission="a signed-in account" />
      {exports.data && rows.length === 0 && <div className="state"><h2>No background exports</h2><p>Large exports from any list appear here when they are ready. Smaller ones download at once.</p></div>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">My exports</caption>
            <thead><tr><th scope="col">List</th><th scope="col">Format</th><th scope="col" className="num">Rows</th><th scope="col">Asked</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Download</span></th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} data-testid={`export-${e.id}`}>
                  <td data-label="List">{e.list}</td>
                  <td data-label="Format">{e.format.toUpperCase()}</td>
                  <td data-label="Rows" className="num">{e.rows}</td>
                  <td data-label="Asked">{formatDateTime(e.createdAt)}{e.expiresAt && e.status === 'DONE' ? <><br /><span className="muted small">kept until {formatDateTime(e.expiresAt)}</span></> : null}</td>
                  <td data-label="Status"><StatusBadge status={STATUS_TONE[e.status]} label={STATUS_LABEL[e.status]} />{e.error && <><br /><span className="ff-error">{e.error}</span></>}</td>
                  <td data-label="Download">{e.status === 'DONE' && <button type="button" className="btn btn-small" onClick={() => download(e)}><Icon name="erp.action.export" size={16} />Download</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
