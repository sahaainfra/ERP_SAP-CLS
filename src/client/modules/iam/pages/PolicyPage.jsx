import { useRef, useState } from 'react';
import { formatDateTime } from '../../../platform/format.js';
import { Field, FormDialog, Link, QueryState, can, downloadCsv, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { usePolicy, useRequestPolicyChange } from '../api/index.js';
import PageHeader from '../../../platform/design/PageHeader.jsx';

/** [section, key, label, kind, hint] */
const FIELDS = [
  ['password', 'minLength', 'Minimum length', 'number', 'Never below 10'],
  ['password', 'expiryDays', 'Password expires after (days)', 'number', '0 means never'],
  ['password', 'historyCount', 'Passwords remembered', 'number', 'At least 5'],
  ['password', 'breachedCheck', 'Breached-password check', ['off', 'local', 'hibp'], 'local = common-password list; hibp = also ask the Pwned Passwords service (5 characters of a hash leave the server)'],
  ['lockout', 'threshold', 'Lock after failed attempts', 'number', '3 to 20'],
  ['lockout', 'baseDelayMinutes', 'First lock (minutes)', 'number', 'Doubles with each further failure'],
  ['lockout', 'maxDelayMinutes', 'Longest lock (minutes)', 'number', ''],
  ['lockout', 'captchaAfter', 'Ask a question after failures', 'number', 'Not above the lock threshold'],
  ['mfa', 'enforced', 'Second step required for the roles below', 'bool', ''],
  ['mfa', 'requiredRoles', 'Roles that need a second step', 'list', 'Role codes separated by commas'],
  ['mfa', 'rememberDeviceDays', 'Remember a device for (days)', 'number', '0 to 30'],
  ['mfa', 'rememberForPrivileged', 'Remembered devices skip the second step for those roles', 'bool', 'Off is safer'],
  ['mfa', 'challengeMinutes', 'Time to finish the second step (minutes)', 'number', ''],
  ['session', 'idleMinutes', 'Sign out after idle minutes', 'number', ''],
  ['session', 'absoluteHours', 'Longest session (hours)', 'number', ''],
  ['session', 'maxConcurrent', 'Sessions at once per person', 'number', 'The oldest ends when exceeded'],
  ['session', 'accessMinutes', 'Access token life (minutes)', 'number', ''],
  ['alerts', 'newDevice', 'Alert on a new device', 'bool', ''],
  ['alerts', 'newCountry', 'Alert on a new country', 'bool', 'Needs the country header from the proxy'],
  ['alerts', 'impossibleTravelHours', 'Impossible travel window (hours)', 'number', '0 turns it off'],
  ['notify', 'connector', 'Email connector for codes and alerts', 'text', 'A connector under Integrations'],
  ['notify', 'smsConnector', 'SMS connector', 'text', ''],
  ['notify', 'whatsappConnector', 'WhatsApp connector', 'text', ''],
  ['sso', 'enabled', 'Single sign-on enabled', 'bool', 'Configuration only until the provider flow is built'],
];
const SECTION_TITLE = { password: 'Passwords', lockout: 'Lockout', mfa: 'Second step (MFA)', session: 'Sessions', alerts: 'Suspicious sign-ins', notify: 'Where messages are sent', sso: 'Single sign-on' }; // secret-scan:allow label text, not a credential

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function draftFrom(settings) {
  const d = structuredClone(settings);
  d.mfa.requiredRoles = d.mfa.requiredRoles.join(', ');
  d.sso.providersJson = JSON.stringify(d.sso.providers, null, 2);
  return d;
}

/** The changes between the saved settings and the form, in the shape the API takes. */
function diffOf(settings, draft) {
  const next = structuredClone(draft);
  next.mfa.requiredRoles = String(draft.mfa.requiredRoles).split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
  try {
    next.sso.providers = JSON.parse(draft.sso.providersJson || '[]');
  } catch {
    throw new Error('The single sign-on providers are not valid JSON.');
  }
  delete next.sso.providersJson;
  const changes = {};
  for (const section of Object.keys(settings)) {
    for (const [k, v] of Object.entries(next[section])) if (!same(v, settings[section][k])) (changes[section] ??= {})[k] = v;
  }
  return changes;
}

export default function PolicyPage({ session }) {
  usePageTitle('Authentication Policy');
  const policy = usePolicy();
  const request = useRequestPolicyChange();
  const dialog = useRef(null);
  const fileInput = useRef(null);
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const canManage = can(session, 'iam.security.manage');
  const p = policy.data;
  const form = draft ?? (p ? draftFrom(p.settings) : null);

  const set = (section, key, value) => setDraft({ ...form, [section]: { ...form[section], [key]: value } });

  const review = () => {
    setError(null);
    try {
      const changes = diffOf(p.settings, form);
      if (Object.keys(changes).length === 0) return setNotice('Nothing has been changed.');
      setPending(changes);
      dialog.current?.showModal();
    } catch (err) {
      setNotice(err.message);
    }
  };

  const importFile = async (file) => {
    setNotice('');
    try {
      const imported = JSON.parse(await file.text());
      const settings = imported.settings ?? imported;
      const merged = structuredClone(p.settings);
      for (const section of Object.keys(merged)) Object.assign(merged[section], settings[section] ?? {});
      setDraft(draftFrom(merged));
      setNotice(`Imported ${file.name}. Review the form and press "Request change".`);
    } catch {
      setNotice('That file is not a settings export.');
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Security &rsaquo; Authentication Policy</nav>
      <PageHeader id="page-title" title={"Authentication Policy"} actions={<><div className="actions">
          <button type="button" className="btn" disabled={!p} onClick={() => downloadCsv('authentication-policy.json', JSON.stringify({ exportedAt: new Date().toISOString(), settings: p.settings }, null, 2), 'application/json')}>Export settings</button>
          <button type="button" className="btn" disabled={!canManage || !p} onClick={() => fileInput.current?.click()}>Import settings</button>
          <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" aria-label="Import settings file" onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} />
        </div></>} subtitle={<>Applies to everyone in the company. A change is a request: the other administrator (System Administrator for the IT Administrator, and the reverse) approves it under <Link to="/admin/approvals">Approvals</Link>, and it is audited. <Link to="/admin/security/login-history">Login history</Link></>} />
      <p role="status" className="notice" data-testid="policy-notice">{notice}</p>
      <QueryState query={policy} what="the authentication policy" permission="iam.security.view" />
      {p && form && (
        <>
          {p.openRequest && <p className="state state-warn" role="status">A policy change is waiting for approval. <Link to="/admin/approvals">Open Approvals</Link></p>}
          <form onSubmit={(e) => { e.preventDefault(); review(); }} className="form-grid" aria-label="Authentication policy">
            {Object.keys(SECTION_TITLE).map((section) => (
              <fieldset key={section} data-testid={`policy-${section}`}>
                <legend>{SECTION_TITLE[section]}</legend>
                <div className="row">
                  {FIELDS.filter((f) => f[0] === section).map(([, key, label, kind, hint]) => (
                    <Field key={key} label={label} name={key} error={null} hint={hint}>
                      {kind === 'bool' ? (
                        <input type="checkbox" name={`${section}.${key}`} checked={Boolean(form[section][key])} disabled={!canManage} onChange={(e) => set(section, key, e.target.checked)} />
                      ) : Array.isArray(kind) ? (
                        <select name={`${section}.${key}`} value={form[section][key]} disabled={!canManage} onChange={(e) => set(section, key, e.target.value)}>{kind.map((o) => <option key={o}>{o}</option>)}</select>
                      ) : (
                        <input name={`${section}.${key}`} type={kind === 'number' ? 'number' : 'text'} value={form[section][key]} disabled={!canManage} onChange={(e) => set(section, key, kind === 'number' ? Number(e.target.value) : e.target.value)} />
                      )}
                    </Field>
                  ))}
                </div>
                {section === 'sso' && (
                  <Field label="Providers (JSON)" name="providers" error={null} hint='For example [{"id":"microsoft","type":"oidc","issuer":"https://login.microsoftonline.com/<tenant>/v2.0","clientId":"..."}]'>
                    <textarea name="sso.providersJson" rows="4" value={form.sso.providersJson} disabled={!canManage} onChange={(e) => set('sso', 'providersJson', e.target.value)} />
                  </Field>
                )}
              </fieldset>
            ))}
            <div className="actions">
              <button type="button" className="btn" disabled={!draft} onClick={() => { setDraft(null); setNotice(''); }}>Discard edits</button>
              <button type="submit" className="btn btn-primary" disabled={!canManage || request.isPending} title={canManage ? '' : 'Needs iam.security.manage'}>Request change</button>
            </div>
          </form>

          <h2>Change history</h2>
          {p.history.length === 0 ? <p className="muted">The default policy has not been changed yet.</p> : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Policy change history</caption>
                <thead><tr><th>When (IST)</th><th>Action</th><th>By</th><th>Reason</th></tr></thead>
                <tbody>{p.history.map((h, i) => <tr key={i}><td data-label="When">{formatDateTime(h.at)}</td><td data-label="Action">{h.action.replace('_', ' ')}</td><td data-label="By">{h.actor}</td><td data-label="Reason">{h.reason}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      <FormDialog
        dialogRef={dialog}
        title="Request a policy change"
        error={error}
        busy={request.isPending}
        submitLabel="Request change"
        onSubmit={async (f) => {
          setError(null);
          try {
            await request.mutateAsync({ changes: pending, reason: String(f.get('reason')) });
            dialog.current?.close();
            setDraft(null);
            setNotice('Change requested. It takes effect when the other administrator approves it.');
          } catch (err) {
            setError(errorInfo(err));
          }
        }}
      >
        <p className="muted">This changes:</p>
        <ul data-testid="policy-diff">
          {pending && Object.entries(pending).flatMap(([section, values]) => Object.entries(values).map(([k, v]) => <li key={`${section}.${k}`}><code>{section}.{k}</code> from <code>{JSON.stringify(p.settings[section][k])}</code> to <code>{JSON.stringify(v)}</code></li>))}
        </ul>
      </FormDialog>
    </section>
  );
}
