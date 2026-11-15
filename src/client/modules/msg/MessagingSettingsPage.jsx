import { useEffect, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { configApi } from '../../platform/messages/api.js';
import { authHeaders } from '../../platform/api/index.js';
import { Field, can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Messaging Settings (Administration, part 05.02, section 7.3): the windows for editing and deleting, how long messages are kept, the limits on files, the policy of read receipts and the call provider. A change is a
// new version that waits for a second person to approve it and is in force from its date; the history of versions stays below. Legal holds on conversations are placed and released here.
const STATUS = { ACTIVE: ['COMPLETED', 'In force'], PENDING: ['IN_REVIEW', 'Waiting for approval'], SCHEDULED: ['IN_REVIEW', 'Approved, starts later'], RETIRED: ['DRAFT', 'Replaced'], REJECTED: ['REJECTED', 'Rejected'] };
const NUM = [['editWindowMinutes', 'Edit window (minutes)', 0, 1440], ['deleteWindowMinutes', 'Delete for everyone window (minutes)', 0, 1440], ['deletedContentRetentionDays', 'Keep the words of deleted messages (days)', 0, 3650],
  ['retentionDays', 'Remove messages older than (days, 0 keeps them)', 0, 36500], ['maxFileMb', 'Largest file (MB)', 1, 100], ['maxVideoMb', 'Largest video (MB)', 1, 500], ['maxVoiceSeconds', 'Longest voice note (seconds)', 10, 1800], ['maxCallParticipants', 'Most people in a call', 2, 8], ['turnTtlSeconds', 'Life of a TURN password (seconds)', 60, 86400]];
const lines = (a) => (a ?? []).join('\n');
const split = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);

function Holds({ canManage }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['msg', 'holds'], queryFn: configApi.holds, retry: false, enabled: canManage });
  const [conv, setConv] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['msg', 'holds'] });
  if (!canManage) return null;
  const place = async (e) => { e.preventDefault(); setError(null); try { await configApi.place(Number(conv), reason); setConv(''); setReason(''); refresh(); } catch (er) { setError(errorInfo(er)); } };
  const release = async (h) => { const why = window.prompt('Why is this hold being released? (another person than the one who placed it)') ?? ''; if (why.trim().length < 5) return; try { await configApi.release(h.id, why.trim()); refresh(); } catch (er) { setError(errorInfo(er)); } };
  return (
    <section aria-labelledby="hold-title" data-testid="holds"><h2 id="hold-title">Legal holds</h2>
      <p className="muted small">A conversation under hold keeps every message, even deleted ones, whatever the retention settings say.</p>
      <form className="srch-form" onSubmit={place} noValidate aria-label="Place a legal hold">
        <Field label="Conversation number" name="conversation" error={error}><input inputMode="numeric" value={conv} onChange={(e) => setConv(e.target.value)} data-testid="hold-conv" /></Field>
        <Field label="Reason" name="reason" error={error}><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="hold-reason" /></Field>
        <button type="submit" className="btn btn-primary" disabled={!conv || reason.trim().length < 5} data-testid="hold-place">Place the hold</button>
      </form>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {q.isPending && <Skeleton label="Loading holds" rows={1} />}
      {q.data && q.data.length === 0 && <p className="muted">No conversation is under hold.</p>}
      {q.data && q.data.length > 0 && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Holds"><table className="grid"><thead><tr><th>Conversation</th><th>Reason</th><th>Placed</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{q.data.map((h) => <tr key={h.id} data-testid="hold-row"><th scope="row" data-label="Conversation">{h.title} (#{h.conversationId})</th><td data-label="Reason">{h.reason}</td><td data-label="Placed">{h.placedBy}, {formatDate(h.placedAt)}</td><td data-label="Status">{h.active ? 'Under hold' : `Released ${formatDate(h.releasedAt)}`}</td><td>{h.active && <button type="button" className="btn btn-small" onClick={() => release(h)}>Release</button>}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

export default function MessagingSettingsPage({ session }) {
  usePageTitle('Messaging Settings');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['msg', 'config'], queryFn: configApi.get, retry: false });
  const [f, setF] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  useEffect(() => { if (q.data && !f) setF({ ...q.data.config, stunText: lines(q.data.config.stunUrls), turnText: lines(q.data.config.turnUrls), effectiveFrom: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10), reason: '' }); }, [q.data, f]);
  if (q.error?.status === 403) return <NoPermission what="the messaging settings" permission="msg.settings.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending || !f) return <Skeleton label="Loading the settings" rows={4} />;
  const d = q.data;
  const set = (p) => setF((cur) => ({ ...cur, ...p }));
  const submit = async (e) => {
    e.preventDefault(); setError(null); setNotice('');
    const body = { ...Object.fromEntries(NUM.map(([k]) => [k, Number(f[k])])), enforceReadReceipts: Boolean(f.enforceReadReceipts), callsEnabled: Boolean(f.callsEnabled), callProvider: f.callProvider, providerBaseUrl: f.providerBaseUrl ?? '', stunUrls: split(f.stunText), turnUrls: split(f.turnText), turnSecret: f.turnSecret ?? '', recording: 'OFF', effectiveFrom: f.effectiveFrom, reason: f.reason };
    try { const r = await configApi.propose(body); setNotice(`Version ${r.version} was sent for approval. It changes nothing until a second person approves it.`); qc.invalidateQueries({ queryKey: ['msg', 'config'] }); setF(null); } catch (er) { setError(errorInfo(er)); }
  };
  const exportJson = async () => { const res = await fetch('/api/v1/msg/config/export', { headers: authHeaders() }); const url = URL.createObjectURL(await res.blob()); Object.assign(document.createElement('a'), { href: url, download: 'messaging-settings.json' }).click(); URL.revokeObjectURL(url); };
  const editable = d.canEdit && !d.pending;
  return (
    <section aria-labelledby="ms-title" data-testid="messaging-settings">
      <PageHeader id="ms-title" title={"Messaging Settings"} subtitle={<>Version {d.config.version || 'default'} is in force{d.config.effectiveFrom ? ` since ${formatDate(d.config.effectiveFrom)}` : ''}. A change is approved by a second person and applies from the date you choose.</>} />
      {d.pending && <p role="status" className="notice" data-testid="ms-pending">Version {d.pending.version} waits for approval (sent by {d.pending.by}). Only one change can wait at a time.</p>}
      {notice && <p role="status" className="notice" data-testid="ms-notice">{notice}</p>}
      <form className="card form-grid" onSubmit={submit} noValidate aria-label="Messaging settings" data-testid="ms-form">
        <fieldset disabled={!editable}><legend>Windows, retention and limits</legend>
          {NUM.map(([k, label, min, max]) => <Field key={k} label={label} name={k} error={error}><input type="number" min={min} max={max} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} data-testid={`ms-${k}`} /></Field>)}
          <label className="field field-inline"><span>Require read receipts (people cannot hide that they read)</span><input type="checkbox" checked={Boolean(f.enforceReadReceipts)} onChange={(e) => set({ enforceReadReceipts: e.target.checked })} data-testid="ms-enforce" /></label>
        </fieldset>
        <fieldset disabled={!editable}><legend>Calls</legend>
          <label className="field field-inline"><span>Calls are allowed</span><input type="checkbox" checked={Boolean(f.callsEnabled)} onChange={(e) => set({ callsEnabled: e.target.checked })} /></label>
          <Field label="Provider" name="callProvider" error={error}><select value={f.callProvider} onChange={(e) => set({ callProvider: e.target.value })} data-testid="ms-provider"><option value="WEBRTC">Built in (WebRTC with your STUN and TURN servers)</option><option value="EXTERNAL">An external meeting provider</option></select></Field>
          {f.callProvider === 'EXTERNAL' && <Field label="Address of the provider (https://)" name="providerBaseUrl" error={error}><input value={f.providerBaseUrl} onChange={(e) => set({ providerBaseUrl: e.target.value })} data-testid="ms-provider-url" /></Field>}
          <Field label="STUN servers (one a line)" name="stunUrls" error={error}><textarea rows="2" value={f.stunText} onChange={(e) => set({ stunText: e.target.value })} /></Field>
          <Field label="TURN servers (one a line)" name="turnUrls" error={error}><textarea rows="2" value={f.turnText} onChange={(e) => set({ turnText: e.target.value })} /></Field>
          <Field label="TURN shared secret (leave as it is to keep the present one)" name="turnSecret" error={error}><input type="password" autoComplete="off" value={f.turnSecret ?? ''} placeholder={d.config.turnSecret ? '••••••' : ''} onChange={(e) => set({ turnSecret: e.target.value })} /></Field>
          <p className="muted small">Calls are never recorded.</p>
        </fieldset>
        <fieldset disabled={!editable}><legend>This change</legend>
          <Field label="In force from" name="effectiveFrom" error={error}><input type="date" value={f.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} data-testid="ms-from" /></Field>
          <Field label="Reason (required)" name="reason" error={error}><textarea rows="2" value={f.reason} maxLength={500} onChange={(e) => set({ reason: e.target.value })} data-testid="ms-reason" /></Field>
        </fieldset>
        {error?.form && <p className="field-error" role="alert" data-testid="ms-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
        <div className="actions">{d.canEdit && <button type="submit" className="btn btn-primary btn-large" disabled={!editable || f.reason.trim().length < 5} data-testid="ms-submit">Send for approval</button>}<button type="button" className="btn" onClick={exportJson} data-testid="ms-export">Export the settings</button></div>
      </form>
      <h2>History</h2>
      {d.history.length === 0 ? <EmptyState compact title="No change yet" message="The defaults are in force. A change you send for approval appears here." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="History of the settings"><table className="grid"><thead><tr><th>Version</th><th>Status</th><th>In force from</th><th>By</th><th>Reason</th><th>Sent</th></tr></thead>
          <tbody>{d.history.map((h) => <tr key={h.id} data-testid="ms-history-row"><th scope="row" data-label="Version">{h.version}</th><td data-label="Status"><StatusBadge status={STATUS[h.status][0]} label={STATUS[h.status][1]} /></td><td data-label="In force from">{formatDate(h.effectiveFrom)}</td><td data-label="By">{h.by}</td><td data-label="Reason">{h.reason}</td><td data-label="Sent">{formatDateTime(h.at)}</td></tr>)}</tbody></table></div>
      )}
      <Holds canManage={can(session, 'msg.legal_hold.manage')} />
    </section>
  );
}
