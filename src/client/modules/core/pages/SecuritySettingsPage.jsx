import { useEffect, useState } from 'react';
import { formatDateTime } from '../../../platform/format.js';
import RecordHistory from '../../../platform/audit/RecordHistory.jsx';
import { useRequestSettingsChange, useSecuritySettings } from '../api/security.js';
import { Field, Link, QueryState, downloadCsv, errorInfo, usePageTitle } from './ui.jsx';

const CLASSES = [['auth', 'Sign-in (password, captcha, reset, PIN)'], ['otp', 'Second step (code, enrolment, backup codes)'], ['export', 'Exports'], ['write', 'Changes to data'], ['read', 'Reading data'], ['webhook', 'Incoming webhooks']];
const REFERRER = ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'];

/** The rate limits, security headers, CORS allow-list and export threshold. A change is a request the system administrator or the director approves. */
export default function SecuritySettingsPage() {
  usePageTitle('Security Settings');
  const q = useSecuritySettings();
  const request = useRequestSettingsChange();
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const d = q.data;
  useEffect(() => { if (d && !form) setForm(structuredClone(d.settings)); }, [d, form]);
  const set = (path, value) => setForm((f) => { const next = structuredClone(f); let o = next; const keys = path.split('.'); for (const k of keys.slice(0, -1)) o = o[k]; o[keys.at(-1)] = value; return next; });
  const num = (path) => (e) => set(path, e.target.value === '' ? '' : Number(e.target.value));

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setNotice('');
    try {
      const reason = String(new FormData(e.currentTarget).get('reason'));
      const out = await request.mutateAsync({ settings: { ...form, cors: { allowedOrigins: form.cors.allowedOrigins } }, reason });
      setNotice(`Request ${out.id} was raised. It needs the system administrator or the director to approve it on the Approvals page; the settings stay as they are until then.`);
      e.currentTarget.reset();
    } catch (err) { setError(errorInfo(err)); }
  };
  const loadFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setForm(JSON.parse(await file.text())); setNotice(`Loaded ${file.name}. Check it and send it for approval.`); } catch { setNotice('That file is not valid JSON.'); }
    e.target.value = '';
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Security &rsaquo; Settings</nav>
      <div className="page-head"><h1 id="page-title">Security Settings</h1></div>
      <p className="muted">How many requests of each kind are allowed per minute, the headers sent with every page, which other sites may call the API, and when an export of people&rsquo;s records needs approval. Changes are approved by someone other than the person who asks, and each one is kept in the history below.</p>
      <p role="status" className="notice" data-testid="settings-notice">{notice}</p>
      <QueryState query={q} what="the security settings" permission="core.routes.view" />
      {d && form && (
        <>
          {d.pending && <p className="notice" role="status" data-testid="pending-change">Change request {d.pending.id} ({d.pending.title}) is {d.pending.status.toLowerCase()}: it needs {d.pending.chain[d.pending.currentStep - 1]?.replace('|', ' or ')}. See <Link to="/admin/approvals">Approvals</Link>.</p>}
          <p className="muted small">Version {d.version}{d.updatedAt ? `, changed ${formatDateTime(d.updatedAt)} by ${d.updatedBy}` : ', the built-in values'}. {d.customised ? 'Some values differ from the built-in ones.' : 'No value has been changed.'}</p>
          <form className="card" aria-labelledby="settings-title" onSubmit={submit}>
            <h2 id="settings-title">Rate limits (requests per minute)</h2>
            <div className="table-wrap"><table><caption className="sr-only">Rate limits</caption>
              <thead><tr><th>Kind of request</th><th>Per address</th><th>Per person</th></tr></thead>
              <tbody>{CLASSES.map(([c, label]) => (
                <tr key={c}><td data-label="Kind">{label}</td>
                  <td data-label="Per address"><input type="number" min="1" max="100000" aria-label={`${label}, per address`} value={form.rateLimits[c].ipPerMinute} onChange={num(`rateLimits.${c}.ipPerMinute`)} disabled={!d.canConfigure} /></td>
                  <td data-label="Per person"><input type="number" min="1" max="100000" aria-label={`${label}, per person`} value={form.rateLimits[c].userPerMinute} onChange={num(`rateLimits.${c}.userPerMinute`)} disabled={!d.canConfigure} /></td></tr>
              ))}</tbody></table></div>

            <h2>Security headers</h2>
            <div className="form-grid">
              <Field label="Content security policy" name="csp" error={error} hint="Scripts only from this application. A policy that allows inline scripts is refused."><textarea rows="4" value={form.headers.csp} onChange={(e) => set('headers.csp', e.target.value)} disabled={!d.canConfigure} /></Field>
              <Field label="HSTS (days)" name="hstsMaxAgeDays" error={error}><input type="number" min="1" max="730" value={form.headers.hstsMaxAgeDays} onChange={num('headers.hstsMaxAgeDays')} disabled={!d.canConfigure} /></Field>
              <label className="field"><span>HSTS covers sub-domains</span><input type="checkbox" checked={form.headers.hstsIncludeSubDomains} onChange={(e) => set('headers.hstsIncludeSubDomains', e.target.checked)} disabled={!d.canConfigure} /></label>
              <Field label="Referrer policy" name="referrerPolicy" error={error}><select value={form.headers.referrerPolicy} onChange={(e) => set('headers.referrerPolicy', e.target.value)} disabled={!d.canConfigure}>{REFERRER.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
              <Field label="Permissions policy" name="permissionsPolicy" error={error}><input value={form.headers.permissionsPolicy} onChange={(e) => set('headers.permissionsPolicy', e.target.value)} disabled={!d.canConfigure} /></Field>
            </div>

            <h2>Other sites allowed to call the API (CORS)</h2>
            <Field label="Allowed origins, one per line" name="allowedOrigins" error={error} hint="Only the site's own address is allowed unless it is listed. Use the origin only, such as https://erp.example.com.">
              <textarea rows="3" value={form.cors.allowedOrigins.join('\n')} onChange={(e) => set('cors.allowedOrigins', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} disabled={!d.canConfigure} />
            </Field>

            <h2>Exports</h2>
            <Field label="Export of people's records needs approval above (records)" name="personalApprovalThreshold" error={error}><input type="number" min="1" max="1000000" value={form.exports.personalApprovalThreshold} onChange={num('exports.personalApprovalThreshold')} disabled={!d.canConfigure} /></Field>

            {d.canConfigure ? (
              <>
                <Field label="Reason (required, min 5 characters) *" name="reason" error={error}><textarea name="reason" rows="2" required minLength={5} maxLength={500} /></Field>
                {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
                <div className="actions">
                  <button type="button" className="btn" onClick={() => setForm(structuredClone(d.defaults))}>Use the built-in values</button>
                  <button type="button" className="btn" onClick={() => downloadCsv('security-settings.json', JSON.stringify(form, null, 2), 'application/json')}>Export as JSON</button>
                  <label className="btn">Load from a file<input type="file" accept="application/json" onChange={loadFile} className="sr-only" /></label>
                  <button type="submit" className="btn btn-primary" disabled={request.isPending}>{request.isPending ? 'Sending...' : 'Send for approval'}</button>
                </div>
              </>
            ) : <p className="muted">Your role can read these settings; the IT administrator changes them.</p>}
          </form>

          <section className="card" aria-labelledby="secrets-title" data-testid="secrets">
            <h2 id="secrets-title">Secrets</h2>
            <p className="muted">Secrets live in the environment of the server ({d.environment}), never in the database or the browser, and are never shown. To rotate one, follow <code>docs/erp/SECRETS.md</code>.</p>
            <ul>{d.secrets.map((s) => <li key={s.name}><code>{s.name}</code>: {s.set ? 'set' : 'not set'} <span className="muted">(from the {s.source})</span></li>)}</ul>
          </section>
          <RecordHistory entity="core_security_settings" id="1" title="Change history" />
        </>
      )}
    </section>
  );
}
