import { useRef, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime, toCsv } from '../../platform/format.js';
import { useDevices, useOffActions } from '../../platform/offline/api.js';
import { Field, FormDialog, Pager, downloadCsv, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { DEVICE_STATUS, ago } from './offline-common.js';

// Devices (Administration, part 04.15): the browsers registered for offline work, with the person, the last sync, the clock difference and the status. Revoking a device makes its next contact remove its offline data
// (BR-03). The IT administrator sees every device; a person sees their own.
const PAGE = 25;

export default function DevicesPage() {
  usePageTitle('Devices');
  const [filters, setFilters] = useState({ status: '', q: '' });
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const list = useDevices({ ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const act = useOffActions();
  if (list.error?.status === 403) return <NoPermission what="the devices" permission="off.device.manage" />;
  const d = list.data;
  const set = (p) => { setFilters((f) => ({ ...f, ...p })); setPage(1); };
  const exportCsv = () => downloadCsv('devices.csv', toCsv(['Person', 'Device', 'Platform', 'Registered', 'Last sync', 'Clock difference (s)', 'Status'], (d?.rows ?? []).map((r) => [r.user, r.name, r.platform ?? '', r.registeredAt, r.lastSyncAt ?? '', Math.round(r.clockDriftMs / 1000), r.status])));
  const open = (row) => { setTarget(row); setReason(''); setError(null); dialog.current?.showModal?.(); };
  const revoke = async () => {
    setError(null);
    try { await act.revoke.mutateAsync({ id: target.id, reason }); dialog.current?.close?.(); setNotice(`${target.name || 'The device'} of ${target.user} was revoked. Its offline data is removed at its next contact.`); setTarget(null); } catch (er) { setError(errorInfo(er)); }
  };
  return (
    <section aria-labelledby="dv-title" data-testid="devices">
      <h1 id="dv-title">Devices</h1>
      <p className="muted">Browsers registered for offline work. Revoking a device removes its offline data the next time it connects.</p>
      {notice && <p role="status" className="notice" data-testid="dv-notice">{notice}</p>}
      {d && <p className="muted" data-testid="dv-counts">{d.counts.active} active, {d.counts.revoked} revoked.</p>}
      <form className="srch-form" role="search" aria-label="Filter the devices" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option><option value="ACTIVE">Active</option><option value="REVOKED">Revoked</option></select></label>
        <label className="field"><span>Person or device</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        <button type="button" className="btn" onClick={exportCsv} disabled={!d?.rows.length}>Export CSV</button>
      </form>
      {list.isPending && <Skeleton label="Loading the devices" rows={3} />}
      {list.isError && <ErrorState title="The devices could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {d && (d.rows.length === 0 ? <EmptyState title="No device" message="A device appears here when a person opens the application on it with offline work switched on." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Devices">
          <table className="grid">
            <thead><tr><th>Person</th><th>Device</th><th>Last sync</th><th className="num">Clock (s)</th><th>Waiting</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} data-testid={`dv-row-${r.id}`}>
                <th scope="row" data-label="Person">{r.user}</th><td data-label="Device">{r.name || r.platform || r.deviceId.slice(0, 12)}</td><td data-label="Last sync">{ago(r.lastSyncAt)}</td>
                <td className="num" data-label="Clock (s)">{Math.round(r.clockDriftMs / 1000)}</td><td data-label="Waiting">{r.pending}</td>
                <td data-label="Status"><StatusBadge status={DEVICE_STATUS[r.status][0]} label={DEVICE_STATUS[r.status][1]} />{r.revokedAt && <span className="muted small"> {formatDateTime(r.revokedAt)}</span>}</td>
                <td>{!r.revokedAt && <button type="button" className="btn btn-small" onClick={() => open(r)} data-testid={`dv-revoke-${r.id}`}>Revoke</button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      <Pager meta={d ? { total: d.total, page, totalPages: Math.max(1, Math.ceil(d.total / PAGE)) } : null} page={page} setPage={setPage} noun="device(s)" />
      <FormDialog dialogRef={dialog} title={`Revoke the device of ${target?.user ?? ''}`} onSubmit={revoke} error={error} busy={act.revoke.isPending} submitLabel="Revoke the device" reason={false}>
        <p>The person is signed out of offline work on this device and its saved forms and masters are deleted at its next contact. Changes not yet sent from it are lost.</p>
        <Field label="Reason" name="reason" error={error}><input value={reason} required minLength={3} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="dv-reason" /></Field>
      </FormDialog>
    </section>
  );
}
