import { useRef, useState } from 'react';
import { clearSession } from '../../../platform/api/index.js';
import { formatDateTime } from '../../../platform/format.js';
import { Field, FormDialog, Link, QueryState, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useForgetDevice, useMyDevices, useMyEvents, useMySessions, useRevokeMine, useSetPin, useSignOutOthers } from '../api/index.js';

const RESULT = { success: 'Signed in', failure: 'Wrong details', locked: 'Locked', suspicious: 'Unusual sign-in', mfa_failed: 'Wrong second-step code', refresh_reuse: 'Session ended (token reuse)', password_changed: 'Password changed', password_reset: 'Password reset' };

export default function SessionsPage() {
  usePageTitle('My Sessions & Devices');
  const sessions = useMySessions();
  const devices = useMyDevices();
  const events = useMyEvents();
  const revoke = useRevokeMine();
  const others = useSignOutOthers();
  const forget = useForgetDevice();
  const setPin = useSetPin();
  const pinDialog = useRef(null);
  const [pinFor, setPinFor] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const act = async (fn, ok) => {
    setNotice('');
    try {
      const out = await fn();
      setNotice(typeof ok === 'function' ? ok(out) : ok);
    } catch (err) {
      setNotice(errorInfo(err).form);
    }
  };

  const rows = sessions.data ?? [];
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Account &rsaquo; My Sessions &amp; Devices</nav>
      <div className="page-head">
        <h1 id="page-title">My Sessions &amp; Devices</h1>
        <button type="button" className="btn" disabled={rows.length < 2 || others.isPending} onClick={() => act(() => others.mutateAsync(), (o) => `${o.ended} other session(s) signed out.`)}>Sign out all other sessions</button>
      </div>
      <p className="muted">Every place you are signed in. If you do not recognise one, sign it out and change your password. <Link to="/account/security">Security &amp; MFA</Link></p>
      <p role="status" className="notice" data-testid="sessions-notice">{notice}</p>

      <h2>Active sessions</h2>
      <QueryState query={sessions} what="your sessions" permission="a signed-in account" />
      {sessions.data && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Your active sessions</caption>
            <thead><tr><th>Device</th><th>Address</th><th>Signed in</th><th>Last active</th><th>Ends</th><th /></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} data-testid={`session-${s.current ? 'current' : 'other'}`}>
                  <td data-label="Device">{s.device ?? 'Unknown'}{s.current && <> <span className="chip chip-pass">This session</span></>}<div className="muted small">{s.method === 'pin' ? 'PIN unlock' : s.mfa ? 'Password and second step' : 'Password'}</div></td>
                  <td data-label="Address">{s.ip ?? '-'}</td>
                  <td data-label="Signed in">{formatDateTime(s.createdAt)}</td>
                  <td data-label="Last active">{formatDateTime(s.lastSeenAt)}</td>
                  <td data-label="Ends">{formatDateTime(s.expiresAt)}</td>
                  <td data-label="Sign out">
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={revoke.isPending}
                      aria-label={s.current ? 'Sign out of this session' : `Sign out ${s.device ?? 'this'} session`}
                      onClick={() => act(async () => { await revoke.mutateAsync(s.id); if (s.current) clearSession(); }, 'Session signed out.')}
                    >
                      Sign out
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Devices</h2>
      <QueryState query={devices} what="your devices" permission="a signed-in account" />
      {devices.data && devices.data.length === 0 && <p className="muted">No device is registered yet.</p>}
      {devices.data?.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Your registered devices</caption>
            <thead><tr><th>Device</th><th>First seen</th><th>Last seen</th><th>Remembered until</th><th>PIN</th><th /></tr></thead>
            <tbody>
              {devices.data.map((d) => (
                <tr key={d.id} data-testid={`device-${d.id}`}>
                  <td data-label="Device">{d.name}</td>
                  <td data-label="First seen">{formatDateTime(d.registeredAt)}</td>
                  <td data-label="Last seen">{d.lastSeenAt ? formatDateTime(d.lastSeenAt) : '-'}</td>
                  <td data-label="Remembered until">{d.trustedUntil ? formatDateTime(d.trustedUntil) : 'Not remembered'}</td>
                  <td data-label="PIN">{d.hasPin ? 'Set' : 'None'}</td>
                  <td data-label="Actions">
                    <div className="actions">
                      <button type="button" className="btn btn-small" disabled={!d.trustedUntil} title={d.trustedUntil ? '' : 'Tick "Remember this device" when you sign in to use a PIN here'} onClick={() => { setPinFor(d); setError(null); pinDialog.current?.showModal(); }}>{d.hasPin ? 'Change PIN' : 'Set PIN'}</button>
                      <button type="button" className="btn btn-small" disabled={forget.isPending} aria-label={`Forget ${d.name}`} onClick={() => act(() => forget.mutateAsync(d.id), 'Device forgotten; its sessions were signed out.')}>Forget</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Recent sign-in activity</h2>
      <QueryState query={events} what="your sign-in history" permission="a signed-in account" />
      {events.data && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Your recent sign-in activity</caption>
            <thead><tr><th>When (IST)</th><th>What</th><th>Device</th><th>Address</th><th>Note</th></tr></thead>
            <tbody>
              {events.data.map((e, i) => (
                <tr key={i} className={e.result === 'suspicious' ? 'row-bad' : ''}>
                  <td data-label="When">{formatDateTime(e.at)}</td><td data-label="What">{RESULT[e.result] ?? e.result}</td><td data-label="Device">{e.device ?? '-'}</td><td data-label="Address">{e.ip ?? '-'}{e.country ? ` (${e.country})` : ''}</td><td data-label="Note">{e.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormDialog
        dialogRef={pinDialog}
        title={`PIN for ${pinFor?.name ?? 'this device'}`}
        error={error}
        busy={setPin.isPending}
        submitLabel="Save PIN"
        reason={false}
        onSubmit={async (f) => {
          setError(null);
          try {
            await setPin.mutateAsync({ id: pinFor.id, pin: String(f.get('pin')) });
            pinDialog.current?.close();
            setNotice('PIN saved. On this device you can now unlock with it instead of your password.');
          } catch (err) {
            setError(errorInfo(err));
          }
        }}
      >
        <p className="muted">For quick attendance and daily reports on this device. Five wrong tries remove it. Not available for roles that need a second step.</p>
        <Field label="PIN (4 to 8 digits)" name="pin" error={error}><input name="pin" type="password" inputMode="numeric" pattern="\d{4,8}" required autoComplete="off" /></Field>
      </FormDialog>
    </section>
  );
}
