import { useRef, useState } from 'react';
import { useChangeConnector, useConnector, useConnectorCatalog, useCreateConnector, useDisableConnector, useSampleConnector, useTestConnector } from '../api/index.js';
import { formatDateTime } from '../../../platform/format.js';
import { Field, FormDialog, Link, QueryState, can, errorInfo, navigateTo, usePageTitle } from './ui.jsx';

const LIMITS = [
  ['timeoutMs', 'Timeout (ms)', 100, 120000, 10000],
  ['maxRetries', 'Retries after a failure', 0, 10, 2],
  ['retryBackoffMs', 'First back-off (ms, doubles each retry)', 0, 60000, 500],
  ['rateLimitPerMinute', 'Calls per minute', 1, 100000, 60],
  ['breakerThreshold', 'Failures before the circuit opens', 1, 100, 5],
  ['breakerResetSeconds', 'Seconds before it tries again', 1, 3600, 60],
  ['retentionDays', 'Keep the call log (days)', 7, 3650, 90],
];

/** Settings, limits and credentials of one connector: the same fields to create one and to ask for a change. */
function SettingsFields({ provider, current, error, creating }) {
  return (
    <>
      <fieldset>
        <legend>Provider settings</legend>
        {provider.configFields.map((f) => (
          <Field key={f.name} label={`${f.label}${f.required ? ' *' : ''}`} name="config" error={error} hint={f.help}>
            <input name={`cfg_${f.name}`} defaultValue={current?.config?.[f.name] ?? ''} required={f.required} maxLength={500} />
          </Field>
        ))}
      </fieldset>
      <fieldset>
        <legend>Limits and retry policy</legend>
        <div className="row">
          {LIMITS.map(([name, label, min, max, dflt]) => (
            <Field key={name} label={label} name={name} error={error}>
              <input name={name} type="number" min={min} max={max} defaultValue={current?.[name] ?? dflt} required />
            </Field>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Credentials (write-only)</legend>
        <p className="muted small">{creating ? 'Values are encrypted when saved and can never be shown again.' : 'Leave a box empty to keep the current value. A value entered here replaces it once the request is approved.'}</p>
        {provider.secrets.map((s) => (
          <div className="row" key={s.name}>
            <Field label={`${s.label}${s.required ? ' *' : ''}`} name={`secrets.${s.name}`} error={error}>
              <input name={`secret_${s.name}`} type="password" autoComplete="new-password" minLength={4} maxLength={4000} placeholder={current?.secrets?.some((x) => x.key === s.name) ? 'Set - enter a new value to rotate' : ''} required={creating && s.required} />
            </Field>
            <Field label="Expires on" name={`secretExpiry.${s.name}`} error={error}><input name={`expiry_${s.name}`} type="date" /></Field>
          </div>
        ))}
      </fieldset>
    </>
  );
}

function readForm(f, provider) {
  const config = Object.fromEntries(provider.configFields.map((c) => [c.name, String(f.get(`cfg_${c.name}`) ?? '').trim()]).filter(([, v]) => v !== ''));
  const secrets = Object.fromEntries(provider.secrets.map((s) => [s.name, String(f.get(`secret_${s.name}`) ?? '')]).filter(([, v]) => v !== ''));
  const secretExpiry = Object.fromEntries(provider.secrets.map((s) => [s.name, String(f.get(`expiry_${s.name}`) ?? '')]).filter(([k, v]) => v !== '' && secrets[k]));
  const limits = Object.fromEntries(LIMITS.map(([name]) => [name, Number(f.get(name))]));
  return { config, secrets, secretExpiry, limits };
}

function CreateConnector() {
  usePageTitle('New Connector');
  const catalog = useConnectorCatalog();
  const create = useCreateConnector();
  const [type, setType] = useState('email');
  const [providerName, setProviderName] = useState('');
  const [error, setError] = useState(null);
  const typeInfo = (catalog.data ?? []).find((t) => t.type === type);
  const provider = typeInfo?.providers.find((p) => p.provider === (providerName || typeInfo.providers[0]?.provider));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const { config, secrets, secretExpiry, limits } = readForm(f, provider);
    try {
      await create.mutateAsync({ code: String(f.get('code')).trim(), type, name: String(f.get('name')).trim(), provider: provider.provider, environment: String(f.get('environment')), config, ...limits, enabled: f.get('enabled') === 'on', secrets, secretExpiry, reason: String(f.get('reason')) });
      navigateTo('/admin/integrations');
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Integrations &rsaquo; New connector</nav>
      <div className="page-head"><h1 id="page-title">New connector</h1></div>
      <p className="muted">The connector is created switched off. It starts working when the System Administrator approves it{typeInfo?.needsCfo ? ', and then the CFO (bank and GST connectors)' : ''}. <Link to="/admin/integrations">Cancel</Link></p>
      <QueryState query={catalog} what="the connector catalogue" permission="core.connectors.view" />
      {typeInfo && provider && (
        <form onSubmit={submit} className="form-grid" aria-label="New connector">
          <fieldset>
            <legend>Connector</legend>
            <div className="row">
              <Field label="Type *" name="type" error={error}>
                <select name="type" value={type} onChange={(e) => { setType(e.target.value); setProviderName(''); }}>
                  {catalog.data.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Provider *" name="provider" error={error}>
                <select name="provider" value={provider.provider} onChange={(e) => setProviderName(e.target.value)}>
                  {typeInfo.providers.map((p) => <option key={p.provider} value={p.provider}>{p.label}</option>)}
                </select>
              </Field>
            </div>
            <p className="muted small">{provider.description}</p>
            <div className="row">
              <Field label="Code *" name="code" error={error} hint="Lower-case, for example mail.main. Other parts refer to the connector by this code."><input name="code" required minLength={3} maxLength={41} pattern="[a-z][a-z0-9_.\-]{2,40}" /></Field>
              <Field label="Name *" name="name" error={error}><input name="name" required minLength={2} maxLength={100} /></Field>
              <Field label="Environment *" name="environment" error={error}>
                <select name="environment" defaultValue="development"><option>development</option><option>staging</option><option>production</option></select>
              </Field>
            </div>
          </fieldset>
          <SettingsFields key={provider.provider} provider={provider} error={error} creating />
          <label className="check"><input name="enabled" type="checkbox" /> Switch it on as soon as it is approved</label>
          <Field label="Reason (required, min 5 characters)" name="reason" error={error}><textarea name="reason" rows="2" required minLength={5} maxLength={500} /></Field>
          {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
          <div className="actions">
            <button type="button" className="btn" onClick={() => navigateTo('/admin/integrations')}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'Sending...' : 'Request connector'}</button>
          </div>
        </form>
      )}
    </section>
  );
}

function ViewConnector({ id, session }) {
  const connector = useConnector(id);
  const catalog = useConnectorCatalog();
  const change = useChangeConnector();
  const test = useTestConnector();
  const sample = useSampleConnector();
  const disable = useDisableConnector();
  const dialog = useRef(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const canConfigure = can(session, 'core.connectors.configure');
  const c = connector.data;
  usePageTitle(c ? `Connector ${c.code}` : 'Connector');
  const typeInfo = (catalog.data ?? []).find((t) => t.type === c?.type);
  const [providerName, setProviderName] = useState('');
  const provider = typeInfo?.providers.find((p) => p.provider === (providerName || c?.provider));

  const run = async (label, fn) => {
    setNotice('');
    try {
      setNotice(await fn());
    } catch (err) {
      const info = errorInfo(err);
      setNotice(`${label} failed: ${info.form}${info.correlationId ? ` (Correlation ID ${info.correlationId})` : ''}`);
    }
  };

  const submitChange = async (e) => {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget; // React drops currentTarget once the handler awaits
    const f = new FormData(formEl);
    const { config, secrets, secretExpiry, limits } = readForm(f, provider);
    try {
      await change.mutateAsync({ id, changes: { name: String(f.get('name')).trim(), provider: provider.provider, environment: String(f.get('environment')), config, ...limits, enabled: f.get('enabled') === 'on' }, secrets, secretExpiry, reason: String(f.get('reason')) });
      setNotice('Change requested. It takes effect when approved under Approvals; nothing changes before then.');
      // the requested values stay on screen while the change waits for approval; only the secret and the reason are cleared
      formEl.querySelectorAll('input[name^="secret_"], textarea[name="reason"]').forEach((el) => { el.value = ''; });
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Integrations &rsaquo; Connector</nav>
      <div className="page-head"><h1 id="page-title">{c ? c.code : 'Connector'}</h1></div>
      <p className="muted"><Link to="/admin/integrations">Back to connectors</Link> &middot; <Link to="/admin/integrations/log">Integration log</Link></p>
      <p role="status" className="notice" data-testid="config-notice">{notice}</p>
      <QueryState query={connector} what="the connector" permission="core.connectors.view" />
      {c && (
        <>
          <div className="tiles" role="group" aria-label="Connector state">
            <div className="tile tile-neutral"><span className="tile-value" data-testid="state-status">{{ PENDING: 'Waiting', DISABLED: 'Off', ENABLED: 'On' }[c.status]}</span><span className="tile-label">Status</span></div>
            <div className={`tile ${c.health.status === 'ok' ? 'tile-ok' : c.health.status ? 'tile-error' : 'tile-neutral'}`}><span className="tile-value" data-testid="state-health">{c.health.status === 'ok' ? 'Healthy' : c.health.status ? 'Failing' : 'Not tested'}</span><span className="tile-label">Health</span>{c.health.message && <span className="muted small">{c.health.message}</span>}</div>
            <div className={`tile ${c.breaker?.state === 'open' ? 'tile-error' : 'tile-neutral'}`}><span className="tile-value">{c.breaker ? { closed: 'Closed', open: 'Open', half_open: 'Testing' }[c.breaker.state] : '-'}</span><span className="tile-label">Circuit breaker</span></div>
            <div className="tile tile-neutral"><span className="tile-value">{c.callsLastMinute} / {c.rateLimitPerMinute}</span><span className="tile-label">Calls in the last minute</span></div>
          </div>
          <div className="actions">
            <button type="button" className="btn" disabled={!canConfigure || c.status === 'PENDING' || test.isPending} onClick={() => run('Test', async () => { const o = await test.mutateAsync(id); return `Test connection: ${o.status === 'ok' ? 'works' : 'failed'} - ${o.message} (${o.durationMs} ms)`; })}>Test connection</button>
            {c.providerInfo?.canSample && <button type="button" className="btn" disabled={!canConfigure || c.status !== 'ENABLED' || sample.isPending} onClick={() => run('Sample', async () => { const o = await sample.mutateAsync(id); return `Sample message sent through the connector (${o.durationMs} ms, ${o.attempts} attempt). See the integration log.`; })}>Send sample message</button>}
            <button type="button" className="btn" disabled={!canConfigure || c.status !== 'ENABLED'} onClick={() => { setError(null); dialog.current?.showModal(); }}>Switch off now</button>
          </div>
          {c.openRequest && <p className="state state-warn" role="status">A change request for this connector is waiting for approval. <Link to="/admin/approvals">Open Approvals</Link>{c.pendingSecrets.length ? ` (new credential: ${c.pendingSecrets.join(', ')})` : ''}</p>}

          <h2>Credentials</h2>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Credentials of this connector. Values are never shown.</caption>
              <thead><tr><th>Credential</th><th>State</th><th>Last rotated</th><th>Expires</th></tr></thead>
              <tbody>
                {c.secrets.length === 0 && <tr><td colSpan="4">No credential is set.</td></tr>}
                {c.secrets.map((s) => (
                  <tr key={s.key} data-testid={`secret-${s.key}`}>
                    <td data-label="Credential"><code>{s.key}</code></td>
                    <td data-label="State"><span className={`chip ${s.expired ? 'chip-fail' : 'chip-pass'}`}>{s.expired ? 'Expired' : 'Set (hidden)'}</span></td>
                    <td data-label="Last rotated">{s.rotatedAt ? formatDateTime(s.rotatedAt) : '-'}</td>
                    <td data-label="Expires">{s.expiresAt ? formatDateTime(s.expiresAt) : 'No expiry'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Values are encrypted at rest and returned by no screen or API. Each use is recorded in the audit trail.</p>

          <details className="card">
            <summary><strong>Inbound webhook</strong></summary>
            <p>Send signed JSON to <code>{c.webhook.path}</code> with <code>x-timestamp</code> (seconds) and <code>x-signature</code> = HMAC-SHA256 of <code>&lt;timestamp&gt;.&lt;body&gt;</code> using the webhook signing secret; <code>x-delivery-id</code> makes a retry harmless. {c.webhook.ready ? 'A signing secret is set.' : 'No signing secret is set, so webhooks are refused.'}</p>
          </details>

          <h2>Ask for a change</h2>
          <p className="muted small">{c.needsCfo ? 'Needs the System Administrator and then the CFO.' : 'Needs the System Administrator.'} Provider {c.providerInfo?.label ?? c.provider}, environment {c.environment}, created by {c.createdBy}.</p>
          {canConfigure && provider ? (
            <form onSubmit={submitChange} className="form-grid" aria-label="Change connector">
              <fieldset>
                <legend>Connector</legend>
                <div className="row">
                  <Field label="Name *" name="name" error={error}><input name="name" defaultValue={c.name} required minLength={2} maxLength={100} /></Field>
                  <Field label="Provider" name="provider" error={error}>
                    <select value={provider.provider} onChange={(e) => setProviderName(e.target.value)}>
                      {typeInfo.providers.map((p) => <option key={p.provider} value={p.provider}>{p.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Environment" name="environment" error={error}>
                    <select name="environment" defaultValue={c.environment}><option>development</option><option>staging</option><option>production</option></select>
                  </Field>
                </div>
              </fieldset>
              <SettingsFields key={provider.provider} provider={provider} current={c} error={error} />
              <label className="check"><input name="enabled" type="checkbox" defaultChecked={c.status === 'ENABLED'} /> Switched on</label>
              <Field label="Reason (required, min 5 characters)" name="reason" error={error}><textarea name="reason" rows="2" required minLength={5} maxLength={500} /></Field>
              {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={change.isPending}>{change.isPending ? 'Sending...' : 'Request change'}</button></div>
            </form>
          ) : <p className="muted">Only the IT Administrator can ask for changes.</p>}

          <FormDialog dialogRef={dialog} title={`Switch off ${c.code}`} error={error} busy={disable.isPending} submitLabel="Switch off"
            onSubmit={async (f) => { setError(null); try { await disable.mutateAsync({ id, reason: String(f.get('reason')) }); dialog.current?.close(); setNotice('Switched off. Switching it on again needs an approved request.'); } catch (err) { setError(errorInfo(err)); } }}>
            <p className="muted">Modules that use it get a clear error until it is switched on again.</p>
          </FormDialog>
        </>
      )}
    </section>
  );
}

export default function ConnectorConfigPage({ session }) {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (params.get('new') === '1') {
    return can(session, 'core.connectors.configure') ? <CreateConnector /> : (
      <section aria-labelledby="page-title"><div className="page-head"><h1 id="page-title">New connector</h1></div><div className="state" role="alert"><h2>You do not have access to create connectors</h2><p>This needs the core.connectors.configure permission (IT Administrator). <Link to="/admin/integrations">Back to connectors</Link></p></div></section>
    );
  }
  if (!id) {
    return <section aria-labelledby="page-title"><div className="page-head"><h1 id="page-title">Connector</h1></div><div className="state"><h2>No connector chosen</h2><p><Link to="/admin/integrations">Choose one from the list</Link>.</p></div></section>;
  }
  return <ViewConnector id={id} session={session} />;
}
