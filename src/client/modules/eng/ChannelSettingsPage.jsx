import { useEffect, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useChannels, useProposeChannels, useSendSample, useSyncWhatsapp } from '../../platform/comm/api.js';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { CHANNEL } from './CommunicationLogPage.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Channel Settings (part 04.07, section 7.2): which connector sends each channel first and which takes over when it fails, the registered sender, the pace, the DLT templates that text messages
// must match, and the WhatsApp templates the provider has approved. A change is sent for approval by the system administrator; what is in force stays until then.
const TYPE = { EMAIL: 'email', SMS: 'sms', WHATSAPP: 'whatsapp' };
const toDraft = (c) => ({ channel: c.channel, primaryConnector: c.active?.primaryConnector ?? '', secondaryConnector: c.active?.secondaryConnector ?? '', senderId: c.active?.senderId ?? '', dltEntityId: c.active?.dltEntityId ?? '', ratePerMinute: c.active?.ratePerMinute ?? 600, enabled: c.active ? c.active.enabled : c.channel === 'PUSH' });

export default function ChannelSettingsPage() {
  usePageTitle('Channel Settings');
  const q = useChannels();
  const propose = useProposeChannels();
  const sample = useSendSample();
  const sync = useSyncWhatsapp();
  const [draft, setDraft] = useState(null);
  const [dlt, setDlt] = useState([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [to, setTo] = useState({ channel: 'SMS', to: '' });
  const [sent, setSent] = useState(null);
  const d = q.data;
  useEffect(() => {
    if (!d) return;
    setDraft(d.channels.map(toDraft));
    setDlt(d.dlt.map((t) => ({ templateCode: t.templateCode, dltTemplateId: t.dltTemplateId, senderId: t.senderId ?? '', bodyPattern: t.bodyPattern })));
  }, [d]);
  if (q.error?.status === 403) return <NoPermission what="the channel settings" permission="comm.channel.view" />;
  if (q.isPending || !draft) return <Skeleton label="Loading the channel settings" rows={4} />;
  if (q.isError) return <ErrorState title="The channel settings could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  const waiting = Boolean(d.pendingBatch);
  const off = !d.canEdit || waiting;
  const patch = (i, p) => setDraft(draft.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const patchDlt = (i, p) => setDlt(dlt.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const connectors = (channel) => d.connectors.filter((c) => c.type === TYPE[channel]);
  const submit = (e) => {
    e.preventDefault();
    setError(null);
    setNotice('');
    const channels = draft.map((c) => ({ channel: c.channel, ...(c.channel === 'PUSH' ? {} : { primaryConnector: c.primaryConnector || null, secondaryConnector: c.secondaryConnector || null }), senderId: c.senderId || null, dltEntityId: c.dltEntityId || null, ratePerMinute: Number(c.ratePerMinute), enabled: c.enabled }));
    propose.mutate({ channels, dltTemplates: dlt.map((t) => ({ ...t, senderId: t.senderId || null })), reason }, {
      onSuccess: () => { setNotice('Sent for approval by the system administrator. The settings in force are unchanged until then.'); setReason(''); },
      onError: (er) => setError(errorInfo(er)),
    });
  };
  return (
    <section aria-labelledby="cs-title" data-testid="channel-settings">
      <PageHeader id="cs-title" title={"Channel Settings"} subtitle={"Choose which connector sends each channel first and which takes over if it fails. Text messages must match a registered DLT template; WhatsApp messages need an approved template."} />
      {notice && <p role="status" className="notice" data-testid="cs-notice">{notice}</p>}
      {waiting && <p role="status" className="notice" data-testid="cs-pending">A change of the channel settings is waiting for approval (proposed by {d.pendingBatch.by}: {d.pendingBatch.reason}). Nothing else can be changed until it is decided.</p>}
      <form className="form-grid" onSubmit={submit} aria-label="Channel settings">
        {draft.map((c, i) => (
          <fieldset key={c.channel} className="card" data-testid={`cs-${c.channel}`}>
            <legend>{CHANNEL[c.channel]} {d.channels[i].pending ? <StatusBadge status="submitted" label="Change waiting" /> : null}</legend>
            <label className="field"><span><input type="checkbox" checked={c.enabled} disabled={off} onChange={(e) => patch(i, { enabled: e.target.checked })} /> Switched on</span></label>
            {c.channel === 'PUSH' ? <p className="muted small">Push goes to the devices people have registered; it uses no connector.</p> : (
              <div className="wf-inline">
                <label className="field"><span>First connector</span><select value={c.primaryConnector} disabled={off} onChange={(e) => patch(i, { primaryConnector: e.target.value, ...(e.target.value && !d.channels[i].active ? { enabled: true } : {}) })}><option value="">None</option>{connectors(c.channel).map((k) => <option key={k.code} value={k.code}>{k.code}</option>)}</select></label>
                <label className="field"><span>If it fails, then</span><select value={c.secondaryConnector} disabled={off} onChange={(e) => patch(i, { secondaryConnector: e.target.value })}><option value="">No second connector</option>{connectors(c.channel).filter((k) => k.code !== c.primaryConnector).map((k) => <option key={k.code} value={k.code}>{k.code}</option>)}</select></label>
              </div>
            )}
            {c.channel === 'SMS' && <div className="wf-inline">
              <Field label="Sender ID (header)" name={`channels.${i}.senderId`} error={error}><input value={c.senderId} maxLength={11} disabled={off} onChange={(e) => patch(i, { senderId: e.target.value })} /></Field>
              <Field label="DLT entity ID" name={`channels.${i}.dltEntityId`} error={error}><input value={c.dltEntityId} maxLength={30} disabled={off} onChange={(e) => patch(i, { dltEntityId: e.target.value })} /></Field>
            </div>}
            <Field label="Messages per minute" name={`channels.${i}.ratePerMinute`} error={error}><input type="number" min="1" max="6000" value={c.ratePerMinute} disabled={off} onChange={(e) => patch(i, { ratePerMinute: e.target.value })} /></Field>
            {error?.fields?.[`channels.${i}.primaryConnector`] && <p role="alert" className="error small">{error.fields[`channels.${i}.primaryConnector`]}</p>}
            {error?.fields?.[`channels.${i}.secondaryConnector`] && <p role="alert" className="error small">{error.fields[`channels.${i}.secondaryConnector`]}</p>}
          </fieldset>
        ))}
        <fieldset className="card" data-testid="cs-dlt">
          <legend>DLT templates (text messages)</legend>
          {d.pendingDlt.length > 0 && <p className="muted small">{d.pendingDlt.length} template(s) waiting for approval.</p>}
          {dlt.length === 0 && <p className="muted">No template is registered, so no text message can be sent.</p>}
          {dlt.map((t, i) => (
            <div key={i} className="wf-inline" data-testid={`cs-dlt-${i}`}>
              <label className="field"><span>Notification</span><select value={t.templateCode} disabled={off} onChange={(e) => patchDlt(i, { templateCode: e.target.value })}>{[...new Set([t.templateCode, ...d.smsTemplates])].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <Field label="DLT template ID" name={`dltTemplates.${i}.dltTemplateId`} error={error}><input value={t.dltTemplateId} disabled={off} onChange={(e) => patchDlt(i, { dltTemplateId: e.target.value })} /></Field>
              <Field label="Registered text (use {#var#} for each variable)" name={`dltTemplates.${i}.bodyPattern`} error={error}><input value={t.bodyPattern} disabled={off} onChange={(e) => patchDlt(i, { bodyPattern: e.target.value })} /></Field>
              {!off && <button type="button" className="btn btn-small" onClick={() => setDlt(dlt.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          {!off && <button type="button" className="btn" onClick={() => setDlt([...dlt, { templateCode: d.smsTemplates[0] ?? '', dltTemplateId: '', senderId: '', bodyPattern: '' }])}>Add a DLT template</button>}
        </fieldset>
        {d.canEdit && !waiting && <>
          <Field label="Reason for the change" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
          {error?.form && <p role="alert" className="error">{error.form}</p>}
          <button type="submit" className="btn btn-primary" disabled={propose.isPending}>Send for approval</button>
        </>}
      </form>
      <section className="card" aria-label="WhatsApp templates" data-testid="cs-wa">
        <h2>WhatsApp templates</h2>
        {d.canEdit && <button type="button" className="btn" disabled={sync.isPending} onClick={() => { setError(null); sync.mutate(undefined, { onSuccess: (r) => setNotice(`${r.synced} template(s) read from the provider.`), onError: (er) => setError(errorInfo(er)) }); }}>Sync from the provider</button>}
        {d.whatsapp.length === 0 ? <p className="muted">No template has been read yet.</p> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="WhatsApp templates">
            <table className="grid"><thead><tr><th>Name</th><th>Language</th><th>Category</th><th>Status</th><th>Notification</th></tr></thead>
              <tbody>{d.whatsapp.map((w) => <tr key={w.id}><th scope="row" data-label="Name">{w.name}</th><td data-label="Language">{w.language}</td><td data-label="Category">{w.category}</td><td data-label="Status"><StatusBadge status={w.status === 'APPROVED' ? 'approved' : w.status === 'REJECTED' ? 'rejected' : 'submitted'} label={w.status} /></td><td data-label="Notification">{w.templateCode ?? 'not matched'}</td></tr>)}</tbody></table>
          </div>
        )}
      </section>
      {d.canEdit && <form className="card wf-inline" aria-label="Send a sample" data-testid="cs-sample" onSubmit={(e) => { e.preventDefault(); setSent(null); sample.mutate(to, { onSuccess: (m) => setSent(m), onError: (er) => setError(errorInfo(er)) }); }}>
        <label className="field"><span>Channel</span><select value={to.channel} onChange={(e) => setTo({ ...to, channel: e.target.value })}>{Object.keys(TYPE).map((k) => <option key={k} value={k}>{CHANNEL[k]}</option>)}</select></label>
        <label className="field"><span>Send a sample to</span><input value={to.to} onChange={(e) => setTo({ ...to, to: e.target.value })} placeholder="+919800000000 or a@b.com" /></label>
        <button type="submit" className="btn" disabled={sample.isPending || to.to.length < 3}>Send sample</button>
        {sent && <p role="status" data-testid="cs-sample-result">{sent.status}{sent.error ? `: ${sent.error}` : ''}{sent.connector ? ` via ${sent.connector}` : ''}</p>}
      </form>}
    </section>
  );
}
