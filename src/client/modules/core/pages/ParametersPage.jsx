import { useRef, useState } from 'react';
import { useParameterDefinitions, useParameters, useSetParameter } from '../api/index.js';
import { formatDate } from '../../../platform/format.js';
import { Field, FormDialog, QueryState, can, errorInfo, usePageTitle } from './ui.jsx';

const todayIso = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

function valueFor(def, raw) {
  if (def.dataType === 'integer') return Number(raw);
  if (def.dataType === 'boolean') return raw === 'true';
  return raw;
}

export default function ParametersPage({ session }) {
  usePageTitle('System Parameters');
  const defs = useParameterDefinitions();
  const [key, setKey] = useState('');
  const rows = useParameters(key);
  const setParam = useSetParameter();
  const [target, setTarget] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const canCompany = can(session, 'core.param.configure');
  const canSystem = can(session, 'core.param.configure_system');

  const edit = (def) => {
    setTarget(def);
    setError(null);
    dialog.current?.showModal();
  };
  const submit = async (f) => {
    setError(null);
    const scopeType = String(f.get('scopeType'));
    try {
      await setParam.mutateAsync({
        key: target.key,
        value: valueFor(target, String(f.get('value'))),
        scopeType,
        scopeId: scopeType === 'company' ? Number(session.companyId) : scopeType === 'system' ? null : Number(f.get('scopeId')),
        effectiveFrom: String(f.get('effectiveFrom')),
        reason: String(f.get('reason')),
      });
      dialog.current?.close();
      setNotice(`Saved. ${target.key} changes from ${formatDate(String(f.get('effectiveFrom')))}; the earlier value is kept as history.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Configuration &rsaquo; System Parameters</nav>
      <h1 id="page-title">System Parameters</h1>
      <p className="muted">Each parameter has a default. A value can be set for the whole system, a company, a project or a site; the most specific one in force on the date wins. A new value starts on its effective date and the old one stays as history.</p>
      <p role="status" className="notice">{notice}</p>
      <QueryState query={defs} what="parameters" permission="core.param.view" />
      {defs.data && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Parameter definitions</caption>
            <thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Allowed range</th><th /></tr></thead>
            <tbody>
              {defs.data.map((d) => (
                <tr key={d.key} data-testid={`param-${d.key}`}>
                  <td data-label="Parameter"><code>{d.key}</code><div className="muted small">{d.description}</div></td>
                  <td data-label="Type">{d.dataType}</td>
                  <td data-label="Default"><code>{JSON.stringify(d.default)}</code></td>
                  <td data-label="Allowed range">{d.min != null || d.max != null ? `${d.min ?? '...'} to ${d.max ?? '...'}` : d.allowed ? d.allowed.join(', ') : '-'}</td>
                  <td>
                    <button type="button" className="link" onClick={() => setKey(key === d.key ? '' : d.key)} aria-label={`Show history of ${d.key}`}>{key === d.key ? 'Hide history' : 'History'}</button>
                    {(canCompany || canSystem) && <button type="button" className="link" onClick={() => edit(d)} aria-label={`Set a value for ${d.key}`}>Set value</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {key && (
        <div>
          <h2>Values of <code>{key}</code></h2>
          <QueryState query={rows} what="parameter values" permission="core.param.view" />
          {rows.data?.length === 0 && <p className="muted">No value has been set; the default applies.</p>}
          {rows.data?.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Scope</th><th>Value</th><th>From</th><th>To</th><th>State</th><th>Set by</th><th>Reason</th></tr></thead>
                <tbody>
                  {rows.data.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Scope">{r.scopeType}{r.scopeId ? ` ${r.scopeId}` : ''}</td><td data-label="Value"><code>{r.value}</code></td>
                      <td data-label="From">{formatDate(r.effectiveFrom)}</td><td data-label="To">{r.effectiveTo ? formatDate(r.effectiveTo) : 'open'}</td>
                      <td data-label="State"><span className={`chip chip-state-${r.state}`}>{r.state}</span></td>
                      <td data-label="Set by">{r.changedBy}</td><td data-label="Reason">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <FormDialog dialogRef={dialog} title={target ? `Set ${target.key}` : ''} error={error} busy={setParam.isPending} onSubmit={submit}>
        {target && (
          <>
            <Field label="Scope" name="scopeType" error={error}>
              <select name="scopeType" defaultValue="company">
                {target.scopes.includes('system') && <option value="system" disabled={!canSystem}>Whole system{canSystem ? '' : ' (IT Administrator only)'}</option>}
                {target.scopes.includes('company') && <option value="company" disabled={!canCompany}>This company</option>}
                {target.scopes.includes('project') && <option value="project">One project</option>}
                {target.scopes.includes('site') && <option value="site">One site</option>}
              </select>
            </Field>
            <Field label="Project or site ID (for those scopes)" name="scopeId" error={error}><input name="scopeId" type="number" min="1" /></Field>
            <Field label="Value" name="value" error={error} hint={target.dataType === 'json' ? 'JSON, for example [0, 6]' : target.dataType}>
              {target.dataType === 'boolean' ? <select name="value"><option>true</option><option>false</option></select> : <input name="value" required />}
            </Field>
            <Field label="Effective from" name="effectiveFrom" error={error} hint="Today or later; the past is never rewritten."><input name="effectiveFrom" type="date" min={todayIso()} defaultValue={todayIso()} required /></Field>
          </>
        )}
      </FormDialog>
    </section>
  );
}
