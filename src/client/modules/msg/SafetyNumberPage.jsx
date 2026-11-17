import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { acceptKeys, ensureDevice, localDevice, numberFor, secApi } from '../../platform/secure/engine.js';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Safety Number Verification (part 05.03, section 7.2, FR-04): the 60 digits two people compare to be sure nobody sits between them, whether this device trusts the keys it has seen, a warning when they changed,
// and the person's own devices (a lost one is revoked here, BR-02). The number changes when either person adds or revokes a device.
const param = (k) => new URLSearchParams(window.location.search).get(k);
const STATE = { same: ['COMPLETED', 'Keys unchanged'], new: ['IN_REVIEW', 'First time seen'], changed: ['REJECTED', 'Keys changed'] };

function Peer({ session, user, onDone }) {
  const q = useQuery({ queryKey: ['sec', 'number', user], queryFn: () => numberFor(session, user), retry: false });
  const [typed, setTyped] = useState('');
  if (q.isPending) return <Skeleton label={`Working out the safety number with ${user}`} rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const n = q.data;
  const entered = typed.replace(/\D/g, '');
  const mark = async (verified) => { await acceptKeys(session, user, n.theirs, verified); await q.refetch(); onDone?.(); };
  return (
    <section className="card" aria-labelledby={`sn-${user}`} data-testid="safety-peer">
      <h2 id={`sn-${user}`}>With {n.name ?? user}</h2>
      <p><StatusBadge status={STATE[n.state][0]} label={STATE[n.state][1]} /> {n.stored?.verified && n.state !== 'changed' ? <span className="muted"> · you verified this number</span> : <span className="muted"> · not verified yet</span>}</p>
      {n.state === 'changed' && <p className="notice is-warning" role="alert" data-testid="safety-changed">Their devices changed since you last accepted them ({n.added.length} added, {n.removed.length} removed). Compare the number below with them before you trust it.</p>}
      <p className="muted small">Both of you see the same number. Read it aloud or compare it in person; if it is the same on both screens, nobody sits between you.</p>
      <ol className="safety-grid" aria-label={`Safety number with ${n.name ?? user}`} data-testid="safety-digits">{n.groups.map((g, i) => <li key={i}>{g}</li>)}</ol>
      <Field label="Type the number they read to you (optional)" name="typed" error={null}><input inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="safety-typed" /></Field>
      {entered.length > 0 && <p role="status" data-testid="safety-match">{entered === n.digits ? 'It matches.' : entered.length < 60 ? 'Keep typing…' : 'It does not match: do not trust this conversation.'}</p>}
      <p className="muted small">Their devices: {n.devices.map((d) => `#${d.deviceNo} ${d.fingerprint.slice(0, 8)}…`).join(', ') || 'none'}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => mark(true)} disabled={n.state === 'same' && n.stored?.verified} data-testid="safety-verify">Mark as verified</button>
        {n.state === 'changed' && <button type="button" className="btn" onClick={() => mark(false)} data-testid="safety-accept">Accept the new keys without verifying</button>}
      </div>
    </section>
  );
}

function MyDevices({ session }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sec', 'mine'], queryFn: async () => ({ rows: await secApi.mine(), local: await localDevice(session) }), retry: false });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['sec'] });
  const setup = async () => { setBusy(true); setError(null); try { await ensureDevice(session); refresh(); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } };
  const revoke = async (d) => { const why = window.prompt(`Why is "${d.name}" being revoked? (for example: phone lost)`) ?? ''; if (why.trim().length < 5) return; try { await secApi.revoke(d.id, why.trim()); refresh(); } catch (e) { setError(errorInfo(e)); } };
  if (q.isPending) return <Skeleton label="Loading your devices" rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const localId = q.data.local?.deviceId;
  return (
    <section aria-labelledby="my-devices" data-testid="my-devices">
      <h2 id="my-devices">Your devices</h2>
      <p className="muted small">Each device has its own keys. If you lose one, revoke it: it is removed from every future conversation. What was stored on it cannot be recovered; that is by design.</p>
      {!q.data.local && <p><button type="button" className="btn btn-primary" onClick={setup} disabled={busy} data-testid="device-setup">Set up secure messaging on this device</button></p>}
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {q.data.rows.length === 0 ? <p className="muted">No device is set up yet.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Your devices"><table className="grid"><thead><tr><th>Device</th><th>Fingerprint</th><th>Set up</th><th>Last used</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{q.data.rows.map((d) => <tr key={d.id} data-testid="device-row"><th scope="row" data-label="Device">{d.name}{d.id === localId ? ' (this browser)' : ''}</th><td data-label="Fingerprint"><code>{d.fingerprint.slice(0, 12)}…</code></td><td data-label="Set up">{formatDateTime(d.registeredAt)}</td><td data-label="Last used">{d.lastSeenAt ? formatDateTime(d.lastSeenAt) : '—'}</td><td data-label="Status">{d.revokedAt ? `Revoked ${formatDateTime(d.revokedAt)}` : 'Active'}</td><td>{!d.revokedAt && <button type="button" className="btn btn-small" onClick={() => revoke(d)} data-testid="device-revoke">Revoke</button>}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

export default function SafetyNumberPage({ session }) {
  usePageTitle('Safety Number Verification');
  const conv = Number(param('c')) || null;
  const one = param('u');
  const d = useQuery({ queryKey: ['sec', 'details', conv], queryFn: () => secApi.details(conv), enabled: Boolean(conv), retry: false });
  const [users, setUsers] = useState([]);
  useEffect(() => { if (one) setUsers([one]); else if (d.data) setUsers(d.data.members.map((m) => m.user).filter((u) => u.toLowerCase() !== session.user.toLowerCase())); }, [one, d.data, session.user]);
  return (
    <section aria-labelledby="sv-title" data-testid="safety-page">
      <PageHeader id="sv-title" title={"Safety Number Verification"} />
      {!conv && !one && <p className="muted">Open a secure conversation and choose <strong>Safety number</strong> to compare the number with the people in it. Your own devices are below.</p>}
      {d.isError && <ErrorState error={d.error} onRetry={d.refetch} />}
      {d.isPending && conv && <Skeleton label="Loading the conversation" rows={2} />}
      {users.map((u) => <Peer key={u} session={session} user={u} />)}
      <MyDevices session={session} />
    </section>
  );
}
