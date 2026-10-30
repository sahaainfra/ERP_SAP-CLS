import { useRef, useState } from 'react';
import {
  useActOnRequest, useChangeRequests, useFileOverview, useFileSettings, useRequestFileSettingsChange, useRescanFile,
} from '../api/index.js';
import { formatDateTime } from '../../../platform/format.js';
import { Field, FormDialog, QueryState, Tile, can, downloadCsv, errorInfo, usePageTitle } from './ui.jsx';

const CATEGORIES = ['image', 'document', 'drawing', 'video'];
const RETENTION = ['permanent', 'statutory', 'standard', 'short'];
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

function Requests({ session }) {
  const requests = useChangeRequests({});
  const act = useActOnRequest();
  const [message, setMessage] = useState('');
  const rows = (requests.data?.data ?? []).filter((r) => r.type === 'file_settings_change');
  const roles = [session?.roles ?? []].flat().join(',').split(',');
  const decide = async (r, action) => {
    setMessage('');
    try {
      await act.mutateAsync({ id: r.id, action, comment: action === 'reject' ? 'Not approved' : 'Approved', version: r.version });
      setMessage(`Request ${r.id} ${action === 'approve' ? 'approved and applied' : 'rejected'}.`);
    } catch (err) {
      setMessage(errorInfo(err).form);
    }
  };
  if (rows.length === 0 && !message) return null;
  return (
    <section aria-labelledby="hist-title" className="card">
      <h2 id="hist-title">Change requests and history</h2>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Requests to change the file storage settings</caption>
          <thead><tr><th className="num">Request</th><th>Status</th><th>What</th><th>Reason</th><th>By</th><th>When (IST)</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const step = r.chain[r.currentStep - 1];
              const mine = r.status === 'SUBMITTED' && roles.includes(step) && r.requestedBy !== session?.user;
              return (
                <tr key={r.id} data-testid={`file-request-${r.id}`}>
                  <td data-label="Request" className="num">{r.id}</td>
                  <td data-label="Status"><span className={`chip ${r.status === 'APPROVED' ? 'chip-on' : r.status === 'SUBMITTED' ? 'chip-status-soft-closed' : 'chip-off'}`}>{r.status === 'SUBMITTED' ? `Waiting for ${step}` : r.status.charAt(0) + r.status.slice(1).toLowerCase()}</span></td>
                  <td data-label="What"><code>{Object.keys(r.payload.changes).join(', ')}</code></td>
                  <td data-label="Reason">{r.reason}</td>
                  <td data-label="By">{r.requestedBy}</td>
                  <td data-label="When">{formatDateTime(r.requestedAt)}</td>
                  <td>
                    {mine && (
                      <>
                        <button type="button" className="link" disabled={act.isPending} onClick={() => decide(r, 'approve')} aria-label={`Approve request ${r.id}`}>Approve</button>
                        <button type="button" className="link" disabled={act.isPending} onClick={() => decide(r, 'reject')} aria-label={`Reject request ${r.id}`}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p role="status" className="notice">{message}</p>
    </section>
  );
}

export default function FileSettingsPage({ session }) {
  usePageTitle('File Storage Settings');
  const overview = useFileOverview();
  const settings = useFileSettings();
  const rescan = useRescanFile();
  const request = useRequestFileSettingsChange();
  const canConfigure = can(session, 'core.files.configure');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const s = settings.data?.settings;

  const submit = async (f) => {
    setError(null);
    const allowed = settings.data.types.map((t) => t.extension).filter((e) => f.get(`ext-${e}`) === 'on');
    const changes = {
      allowedExtensions: allowed,
      maxSizeMb: Object.fromEntries(CATEGORIES.map((c) => [c, Number(f.get(`size-${c}`))])),
      retention: Object.fromEntries(CATEGORIES.map((c) => [c, String(f.get(`ret-${c}`))])),
      urlTtlSeconds: Number(f.get('ttl')),
    };
    try {
      await request.mutateAsync({ changes, reason: String(f.get('reason')) });
      dialog.current?.close();
      setNotice('Change sent for approval by the IT Administrator. The settings stay as they are until it is approved.');
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const exportSettings = () => downloadCsv('file-settings.json', JSON.stringify(s, null, 2));
  const doRescan = async (id) => {
    setNotice('');
    try {
      await rescan.mutateAsync(id);
      setNotice('The file was queued for another scan.');
    } catch (err) {
      setNotice(err.message);
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Configuration &rsaquo; File Storage Settings</nav>
      <div className="page-head">
        <h1 id="page-title">File Storage Settings</h1>
        <button type="button" className="btn" onClick={exportSettings} disabled={!s}>Export settings</button>
        <button type="button" className="btn btn-primary" disabled={!canConfigure || !s} title={canConfigure ? '' : 'Needs core.files.configure (System Administrator)'} onClick={() => { setError(null); dialog.current?.showModal(); }}>Request a change</button>
      </div>
      <p className="muted">Which files may be attached, how large they can be, how long they are kept, and how files are scanned. Changes are maker-checker: the System Administrator asks, the IT Administrator approves.</p>
      <p role="status" className="notice">{notice}</p>

      <QueryState query={overview} what="the file overview" permission="core.files.admin" />
      {overview.data && (
        <>
          <div className="tiles" role="group" aria-label="Scan status">
            <Tile label="Clean files" value={overview.data.statuses.CLEAN.files} status="ok" hint={mb(overview.data.statuses.CLEAN.bytes)} testId="tile-clean" />
            <Tile label="Waiting for scan" value={overview.data.statuses.PENDING.files} status={overview.data.statuses.PENDING.files > 0 ? 'warn' : 'ok'} testId="tile-pending" />
            <Tile label="Quarantined" value={overview.data.statuses.INFECTED.files} status={overview.data.statuses.INFECTED.files > 0 ? 'error' : 'ok'} testId="tile-infected" />
            <Tile label="Scan failed" value={overview.data.statuses.ERROR.files} status={overview.data.statuses.ERROR.files > 0 ? 'error' : 'ok'} testId="tile-error" />
            <Tile label="Uploads in progress" value={overview.data.openUploads} />
          </div>
          <p className={overview.data.clamAvConnected ? 'muted' : 'state state-warn'} data-testid="scanner-note">
            Storage: <strong>{overview.data.storage}</strong>. Scanners: <strong>{overview.data.scanners.join(', ')}</strong>.{' '}
            {overview.data.clamAvConnected ? 'ClamAV is connected.' : 'Only the built-in test-signature scanner is active: it catches test files, not real malware. Set CLAMAV_HOST to connect a ClamAV daemon before real use.'}
          </p>
          {overview.data.byCategory.length > 0 && (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Stored files by category</caption>
                <thead><tr><th>Category</th><th className="num">Files</th><th className="num">Size</th></tr></thead>
                <tbody>{overview.data.byCategory.map((c) => <tr key={c.category}><td data-label="Category">{c.category}</td><td data-label="Files" className="num">{c.files}</td><td data-label="Size" className="num">{mb(c.bytes)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <h2>Files needing attention</h2>
          {overview.data.attention.length === 0 ? <p className="muted">No quarantined files, failed scans or files waiting for more than five minutes.</p> : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Quarantined, failed or stuck files</caption>
                <thead><tr><th>File</th><th>Record</th><th>Result</th><th>Uploaded by</th><th>When (IST)</th><th /></tr></thead>
                <tbody>
                  {overview.data.attention.map((f) => (
                    <tr key={f.id} data-testid={`attention-${f.name}`}>
                      <td data-label="File">{f.name}</td><td data-label="Record">{f.linkedEntity} {f.linkedId}</td>
                      <td data-label="Result"><span className="chip chip-status-closed">{f.scanStatus === 'INFECTED' ? 'Quarantined' : f.scanStatus === 'ERROR' ? 'Scan failed' : 'Waiting'}</span><div className="muted small">{f.scanDetail}</div></td>
                      <td data-label="Uploaded by">{f.uploadedBy}</td><td data-label="When">{formatDateTime(f.uploadedAt)}</td>
                      <td>{f.canRescan && <button type="button" className="link" disabled={rescan.isPending} onClick={() => doRescan(f.id)} aria-label={`Scan ${f.name} again`}>Scan again</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h2>Current settings</h2>
      <QueryState query={settings} what="the file settings" permission="core.files.admin" />
      {s && (
        <div data-testid="current-settings">
          <p className="muted small">{settings.data.custom ? `Customised (version ${settings.data.version}).` : 'Defaults: no change has been approved yet.'} Download links last <strong>{s.urlTtlSeconds} seconds</strong>.</p>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Size limit and retention class by category</caption>
              <thead><tr><th>Category</th><th className="num">Size limit (MB)</th><th>Retention class</th><th>Allowed types</th></tr></thead>
              <tbody>
                {CATEGORIES.map((c) => (
                  <tr key={c} data-testid={`setting-${c}`}>
                    <td data-label="Category">{c}</td><td data-label="Size limit" className="num">{s.maxSizeMb[c]}</td><td data-label="Retention">{s.retention[c]}</td>
                    <td data-label="Allowed types">{settings.data.types.filter((t) => t.category === c).map((t) => <span key={t.extension} className={`chip ${s.allowedExtensions.includes(t.extension) ? 'chip-on' : 'chip-off'}`} title={s.allowedExtensions.includes(t.extension) ? 'Allowed' : 'Not allowed'}>.{t.extension}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Requests session={session} />

      <FormDialog dialogRef={dialog} title="Request a change to the file settings" error={error} busy={request.isPending} submitLabel="Send for approval" onSubmit={submit}>
        {s && (
          <>
            <fieldset>
              <legend>Allowed file types</legend>
              <div className="checks">
                {settings.data.types.map((t) => <label key={t.extension} className="check"><input type="checkbox" name={`ext-${t.extension}`} defaultChecked={s.allowedExtensions.includes(t.extension)} /> .{t.extension}</label>)}
              </div>
              <FieldError name="changes" error={error} />
            </fieldset>
            {CATEGORIES.map((c) => (
              <div className="row" key={c}>
                <Field label={`${c} size limit (MB)`} name="changes" error={null}><input name={`size-${c}`} type="number" min="1" max={settings.data.hardCeilingMb} defaultValue={s.maxSizeMb[c]} required /></Field>
                <Field label={`${c} retention class`} name="changes" error={null}>
                  <select name={`ret-${c}`} defaultValue={s.retention[c]}>{RETENTION.map((r) => <option key={r}>{r}</option>)}</select>
                </Field>
              </div>
            ))}
            <Field label="Download link life (seconds)" name="changes" error={null} hint="30 to 3600"><input name="ttl" type="number" min="30" max="3600" defaultValue={s.urlTtlSeconds} required /></Field>
          </>
        )}
      </FormDialog>
    </section>
  );
}

function FieldError({ error }) {
  const msgs = (error?.fields ? Object.values(error.fields) : []).filter(Boolean);
  return msgs.length ? <span className="field-error">{msgs[0]}</span> : null;
}
