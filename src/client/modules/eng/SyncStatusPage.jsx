import { useState } from 'react';
import Icon from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { deviceKey, discard, refreshMasters, retry, sync, useOffline } from '../../platform/offline/engine.js';
import { useConfirmations, useOffActions } from '../../platform/offline/api.js';
import { Link, can, usePageTitle } from '../core/pages/ui.jsx';
import { CMD_STATUS, ago } from './offline-common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Sync Status (Mobile, part 04.15, FR-07): what is waiting on this phone, what became of what was sent, when it last worked, the errors with a way to retry, and a button to send now. A supervisor also sees the old
// commands that wait for confirmation (BR-02).
export default function SyncStatusPage({ session }) {
  usePageTitle('Sync Status');
  const off = useOffline();
  const sup = can(session, 'off.sync.confirm');
  const conf = useConfirmations(sup);
  const act = useOffActions();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const counts = off.queue.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] ?? 0) + 1 }), {});
  const force = async () => { setBusy(true); setMsg(''); try { const r = await sync({ force: true }); await refreshMasters(); setMsg(r?.sent ? `${r.sent} change(s) sent.` : 'Everything is up to date.'); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="ss-title" className="sync-status" data-testid="sync-status">
      <PageHeader id="ss-title" title={"Sync Status"} />
      <ul className="field-status" aria-label="Connection">
        <li data-testid="ss-online" data-online={off.online}><Icon name={off.online ? 'erp.state.sync' : 'erp.action.offline'} size={18} /> {off.online ? 'Online' : 'Offline'}</li>
        <li data-testid="ss-count" data-count={off.queue.length}><Icon name="erp.action.inbox" size={18} /> {off.queue.length === 0 ? 'Nothing is waiting' : `${off.queue.length} in the queue`}</li>
        <li data-testid="ss-last">Last sync: <strong>{off.lastSync ? `${ago(off.lastSync)} (${formatDateTime(off.lastSync)})` : 'never'}</strong></li>
      </ul>
      {off.driftWarning && <p role="alert" className="notice" data-testid="ss-drift">{off.driftWarning}</p>}
      {off.revoked && <p role="alert" className="error">This device was revoked and its offline data removed.</p>}
      {off.locked && <p role="alert" className="error">The offline copy has expired. Press Send now while online to renew it.</p>}
      {off.lastError && <p role="alert" className="error" data-testid="ss-error">{off.lastError.message}</p>}
      <div className="actions">
        <button type="button" className="btn btn-primary btn-large" onClick={force} disabled={busy || off.syncing || !off.online || !off.ready} data-testid="ss-force">{busy || off.syncing ? 'Sending...' : 'Send now'}</button>
        {counts.CONFLICT > 0 && <Link to="/field/sync/conflicts">Decide {counts.CONFLICT} conflict(s)</Link>}
      </div>
      {msg && <p role="status" className="notice">{msg}</p>}
      {off.queue.length === 0 ? <EmptyState compact title="Nothing is waiting" message="Forms you fill in without a connection wait here until they can be sent." action={{ label: 'Open the forms', onClick: () => { window.location.assign('/field/forms'); } }} /> : (
        <ul className="op-comments" aria-label="The queue">
          {off.queue.map((c) => {
            const [tone, text] = CMD_STATUS[c.status] ?? CMD_STATUS.PENDING;
            const waitingPhotos = (c.files ?? []).filter((f) => !f.error); const refusedPhotos = (c.files ?? []).filter((f) => f.error);
            return (
              <li key={c.id} data-testid="ss-item" data-status={c.status}>
                <strong>{c.label}</strong> <StatusBadge status={tone} label={text} />
                <p className="muted small">Captured {formatDateTime(c.createdAt)}{waitingPhotos.length ? ` · ${waitingPhotos.length} photo(s) waiting` : ''}{c.attempts ? ` · tried ${c.attempts} time(s)` : ''}</p>
                {c.error && <p className="field-error" role="alert">{c.error}</p>}
                {refusedPhotos.map((f) => <p key={f.index} className="field-error" role="alert" data-testid="ss-photo-refused">Photo {f.name} was not accepted: {f.error}</p>)}
                <div className="actions">
                  {['ERROR', 'DEFERRED', 'PENDING'].includes(c.status) && <button type="button" className="btn btn-small" disabled={!off.online} onClick={() => retry(c.id)}>Try again</button>}
                  {c.status === 'CONFLICT' && <Link to="/field/sync/conflicts">Decide</Link>}
                  {c.status === 'APPLIED' && refusedPhotos.length > 0 && waitingPhotos.length === 0 && <button type="button" className="btn btn-small" onClick={() => discard(c.id)} data-testid="ss-dismiss">Dismiss</button>}
                  {['ERROR', 'PENDING', 'DEFERRED'].includes(c.status) && <button type="button" className="btn btn-small" onClick={() => { if (window.confirm('Delete this change from the phone? It will not be sent.')) discard(c.id); }}>Delete</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {sup && conf.data?.rows?.length > 0 && (
        <>
          <h2>Old offline work to confirm</h2>
          <ul className="op-comments" aria-label="Waiting for confirmation">
            {conf.data.rows.map((r) => (
              <li key={r.id} data-testid="ss-confirm"><strong>{r.label ?? r.type}</strong> <span className="muted small">by {r.user}, captured {formatDateTime(r.clientCreatedAt)}</span>
                <div className="actions">
                  <button type="button" className="btn btn-primary btn-small" disabled={act.decide.isPending} onClick={() => act.decide.mutate({ id: r.id, decision: 'CONFIRM' })}>Confirm</button>
                  <button type="button" className="btn btn-small" disabled={act.decide.isPending} onClick={() => act.decide.mutate({ id: r.id, decision: 'DECLINE', reason: 'Declined after review' })}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">This device: <code>{deviceKey().slice(0, 12)}</code>{off.device ? ` · registered ${formatDateTime(off.device.registeredAt)}` : ''}. Offline copy valid until {off.expiresAt ? formatDateTime(off.expiresAt) : 'the next contact'}.</p>
    </section>
  );
}
