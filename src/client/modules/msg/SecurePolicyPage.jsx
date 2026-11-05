import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { authHeaders } from '../../platform/api/index.js';
import { secApi } from '../../platform/secure/engine.js';
import { Field, can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';

// Secure Messaging Policy (Administration, part 05.03, FR-07): which roles may start secure conversations, the limits, the disappearing times, how long delivery facts are kept, and the compliance stance: the content of a
// secure conversation is not available to administrators or to AI, only metadata is kept. A change is a new version approved by a second person and in force from its date. The IT administrator can also revoke a lost device.
const STATUS = { ACTIVE: ['COMPLETED', 'In force'], PENDING: ['IN_REVIEW', 'Waiting for approval'], SCHEDULED: ['IN_REVIEW', 'Approved, starts later'], RETIRED: ['DRAFT', 'Replaced'], REJECTED: ['REJECTED', 'Rejected'] };
const TIMES = [[0, 'Off'], [3600, '1 hour'], [86_400, '1 day'], [604_800, '7 days'], [2_592_000, '30 days']];
const NUM = [['maxGroupMembers', 'Most people in a secure conversation', 2, 20], ['maxDevicesPerUser', 'Devices a person may have', 1, 10], ['maxAttachmentMb', 'Largest encrypted file (MB)', 1, 50], ['metadataRetentionDays', 'Keep delivery facts for (days)', 7, 3650], ['undeliveredRetentionDays', 'Drop messages nobody fetched after (days)', 1, 90]];

function Devices() {
  const qc = useQueryClient();
  const [user, setUser] = useState('');
  const q = useQuery({ queryKey: ['sec', 'all', user], queryFn: () => secApi.all(user), retry: false });
  const [error, setError] = useState(null);
  const revoke = async (d) => { const why = window.prompt(`Why is the device "${d.name}" of ${d.user} being revoked?`) ?? ''; if (why.trim().length < 5) return; try { await secApi.revoke(d.id, why.trim()); qc.invalidateQueries({ queryKey: ['sec'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="dev-title" data-testid="admin-devices"><h2 id="dev-title">Devices</h2>
      <p className="muted small">A lost device is revoked here (or by its owner): it is removed from every future conversation and what waited for it is dropped. Its history cannot be recovered, by design.</p>
      <Field label="Show the devices of (user name)" name="user" error={null}><input type="search" value={user} onChange={(e) => setUser(e.target.value)} data-testid="dev-user" /></Field>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {q.isPending && <Skeleton label="Loading devices" rows={2} />}
      {q.data && (q.data.length === 0 ? <p className="muted">No device matches.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Devices"><table className="grid"><thead><tr><th>Person</th><th>Device</th><th>Fingerprint</th><th>Last used</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{q.data.map((d) => <tr key={d.id} data-testid="dev-row"><th scope="row" data-label="Person">{d.user}</th><td data-label="Device">{d.name}</td><td data-label="Fingerprint"><code>{d.fingerprint.slice(0, 12)}…</code></td><td data-label="Last used">{d.lastSeenAt ? formatDateTime(d.lastSeenAt) : '—'}</td><td data-label="Status">{d.revokedAt ? `Revoked ${formatDate(d.revokedAt)}` : 'Active'}</td><td>{!d.revokedAt && <button type="button" className="btn btn-small" onClick={() => revoke(d)} data-testid="dev-revoke">Revoke</button>}</td></tr>)}</tbody></table></div>
      ))}
    </section>
  );
}

export default function SecurePolicyPage({ session }) {
  usePageTitle('Secure Messaging Policy');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sec', 'policy'], queryFn: secApi.policy, retry: false });
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  useEffect(() => { if (q.data && !f) setF({ ...q.data.policy, rolesText: q.data.policy.creatorRoles.join(', '), effectiveFrom: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10), reason: '' }); }, [q.data, f]);
  if (q.error?.status === 403) return <NoPermission what="the secure messaging policy" permission="sec.policy.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending || !f) return <Skeleton label="Loading the policy" rows={4} />;
  const d = q.data;
  const set = (p) => setF((cur) => ({ ...cur, ...p }));
  const toggleTime = (s) => { const has = f.allowedDisappearSeconds.includes(s); const next = has ? f.allowedDisappearSeconds.filter((x) => x !== s) : [...f.allowedDisappearSeconds, s].sort((a, b) => a - b); set({ allowedDisappearSeconds: next, defaultDisappearSeconds: next.includes(f.defaultDisappearSeconds) ? f.defaultDisappearSeconds : (next[0] ?? 0) }); };
  const submit = async (e) => {
    e.preventDefault(); setError(null); setNotice('');
    const body = { ...Object.fromEntries(NUM.map(([k]) => [k, Number(f[k])])), enabled: Boolean(f.enabled), creatorRoles: f.rolesText.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean), allowAttachments: Boolean(f.allowAttachments), defaultDisappearSeconds: Number(f.defaultDisappearSeconds), allowedDisappearSeconds: f.allowedDisappearSeconds.map(Number), screenshotWarning: Boolean(f.screenshotWarning), effectiveFrom: f.effectiveFrom, reason: f.reason };
    try { const r = await secApi.propose(body); setNotice(`Version ${r.version} was sent for approval. It changes nothing until a second person approves it.`); qc.invalidateQueries({ queryKey: ['sec', 'policy'] }); setF(null); } catch (er) { setError(errorInfo(er)); }
  };
  const exportJson = async () => { const res = await fetch('/api/v1/sec/policy/export', { headers: authHeaders() }); const url = URL.createObjectURL(await res.blob()); Object.assign(document.createElement('a'), { href: url, download: 'secure-messaging-policy.json' }).click(); URL.revokeObjectURL(url); };
  const editable = d.canEdit && !d.pending;
  return (
    <section aria-labelledby="sp-title" data-testid="secure-policy">
      <h1 id="sp-title">Secure Messaging Policy</h1>
      <p className="muted">Version {d.policy.version || 'default'} is in force{d.policy.effectiveFrom ? ` since ${formatDate(d.policy.effectiveFrom)}` : ''}. Secure messaging is <strong>{d.policy.enabled && d.licenceApproved ? 'on' : 'off'}</strong>.</p>
      {!d.licenceApproved && <p className="notice is-warning" role="status" data-testid="sp-licence">It cannot be switched on until the open-source licence review is approved (Administration, Open-Source Licence Register).</p>}
      <p className="notice small" data-testid="sp-stance">Compliance stance: the content of secure conversations is encrypted on the devices of the people in them. Administrators, the company and AI features cannot read it, and no export of it exists. Only metadata (who, when, how big) is kept, for the days below. A lost device cannot be recovered.</p>
      {d.pending && <p role="status" className="notice" data-testid="sp-pending">Version {d.pending.version} waits for approval (sent by {d.pending.by}). Only one change can wait at a time.</p>}
      {notice && <p role="status" className="notice" data-testid="sp-notice">{notice}</p>}
      <form className="card form-grid" onSubmit={submit} noValidate aria-label="Secure messaging policy" data-testid="sp-form">
        <fieldset disabled={!editable}><legend>Who and how</legend>
          <label className="field field-inline"><span>Secure messaging is on</span><input type="checkbox" checked={Boolean(f.enabled)} disabled={!d.licenceApproved} onChange={(e) => set({ enabled: e.target.checked })} data-testid="sp-enabled" /></label>
          <Field label="Roles that may start a secure conversation (role codes, comma separated)" name="creatorRoles" error={error}><input value={f.rolesText} onChange={(e) => set({ rolesText: e.target.value })} data-testid="sp-roles" /></Field>
          {NUM.map(([k, label, min, max]) => <Field key={k} label={label} name={k} error={error}><input type="number" min={min} max={max} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} data-testid={`sp-${k}`} /></Field>)}
          <label className="field field-inline"><span>Encrypted attachments are allowed</span><input type="checkbox" checked={Boolean(f.allowAttachments)} onChange={(e) => set({ allowAttachments: e.target.checked })} /></label>
          <label className="field field-inline"><span>Show the screenshot warning</span><input type="checkbox" checked={Boolean(f.screenshotWarning)} onChange={(e) => set({ screenshotWarning: e.target.checked })} /></label>
        </fieldset>
        <fieldset disabled={!editable}><legend>Disappearing messages</legend>
          {TIMES.map(([s, l]) => <label key={s} className="field field-inline"><span>{l} allowed</span><input type="checkbox" checked={f.allowedDisappearSeconds.includes(s)} onChange={() => toggleTime(s)} /></label>)}
          <Field label="Default for a new conversation" name="defaultDisappearSeconds" error={error}><select value={f.defaultDisappearSeconds} onChange={(e) => set({ defaultDisappearSeconds: Number(e.target.value) })}>{TIMES.filter(([s]) => f.allowedDisappearSeconds.includes(s)).map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select></Field>
        </fieldset>
        <fieldset disabled={!editable}><legend>This change</legend>
          <Field label="In force from" name="effectiveFrom" error={error}><input type="date" value={f.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} /></Field>
          <Field label="Reason (required)" name="reason" error={error}><textarea rows="2" value={f.reason} maxLength={500} onChange={(e) => set({ reason: e.target.value })} data-testid="sp-reason" /></Field>
        </fieldset>
        {error?.form && <p className="field-error" role="alert" data-testid="sp-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
        <div className="actions">{d.canEdit && <button type="submit" className="btn btn-primary btn-large" disabled={!editable || f.reason.trim().length < 5} data-testid="sp-submit">Send for approval</button>}<button type="button" className="btn" onClick={exportJson} data-testid="sp-export">Export the policy</button></div>
      </form>
      <h2>History</h2>
      {d.history.length === 0 ? <EmptyState compact title="No change yet" message="The defaults are in force (secure messaging off). A change you send for approval appears here." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="History of the policy"><table className="grid"><thead><tr><th>Version</th><th>Status</th><th>In force from</th><th>By</th><th>Reason</th><th>Sent</th></tr></thead>
          <tbody>{d.history.map((h) => <tr key={h.id} data-testid="sp-history-row"><th scope="row" data-label="Version">{h.version}</th><td data-label="Status"><StatusBadge status={STATUS[h.status][0]} label={STATUS[h.status][1]} /></td><td data-label="In force from">{formatDate(h.effectiveFrom)}</td><td data-label="By">{h.by}</td><td data-label="Reason">{h.reason}</td><td data-label="Sent">{formatDateTime(h.at)}</td></tr>)}</tbody></table></div>
      )}
      {can(session, 'sec.device.manage') && <Devices />}
    </section>
  );
}
