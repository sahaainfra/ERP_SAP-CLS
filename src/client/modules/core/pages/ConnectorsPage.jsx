import { useRef, useState } from 'react';
import { useConnectorCatalog, useConnectors, useDisableConnector, useTestConnector } from '../api/index.js';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { FormDialog, Link, Pager, QueryState, can, downloadCsv, errorInfo, navigateTo, usePageTitle } from './ui.jsx';

const STATUS = { PENDING: ['chip-never', 'Waiting for approval'], DISABLED: ['chip-off', 'Off'], ENABLED: ['chip-on', 'On'] };
const BREAKER = { closed: 'Closed', open: 'Open (paused)', half_open: 'Testing' };

function Health({ c }) {
  if (!c.health.status) return <span className="chip chip-never">Not tested</span>;
  return (
    <>
      <span className={`chip ${c.health.status === 'ok' ? 'chip-pass' : 'chip-fail'}`}>{c.health.status === 'ok' ? 'Healthy' : 'Failing'}</span>
      <div className="muted small">{formatDateTime(c.health.checkedAt)}</div>
    </>
  );
}

export default function ConnectorsPage({ session }) {
  usePageTitle('Integrations');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const connectors = useConnectors({ page, q, type, status });
  const catalog = useConnectorCatalog();
  const test = useTestConnector();
  const disable = useDisableConnector();
  const dialog = useRef(null);
  const [target, setTarget] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const canConfigure = can(session, 'core.connectors.configure');
  const rows = connectors.data?.data ?? [];

  const runTest = async (c) => {
    setNotice('');
    try {
      const out = await test.mutateAsync(c.id);
      setNotice(`${c.code}: ${out.status === 'ok' ? 'connection works' : 'connection failed'} - ${out.message} (${out.durationMs} ms)`);
    } catch (err) {
      setNotice(`${c.code}: ${errorInfo(err).form}`);
    }
  };

  const submitDisable = async (f) => {
    setError(null);
    try {
      await disable.mutateAsync({ id: target.id, reason: String(f.get('reason')) });
      dialog.current?.close();
      setNotice(`${target.code} is switched off. Switching it on again needs an approved request.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  const exportCsv = () =>
    downloadCsv('connectors.csv', toCsv(
      ['Code', 'Name', 'Type', 'Provider', 'Environment', 'Status', 'Health', 'Last tested (IST)'],
      rows.map((c) => [c.code, c.name, c.type, c.provider, c.environment, c.status, c.health.status ?? 'not tested', c.health.checkedAt ? formatDateTime(c.health.checkedAt) : '']),
    ));

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Integrations &rsaquo; Connectors</nav>
      <div className="page-head">
        <h1 id="page-title">Connectors</h1>
        <button type="button" className="btn btn-primary" disabled={!canConfigure} title={canConfigure ? '' : 'Needs core.connectors.configure (IT Administrator)'} onClick={() => navigateTo('/admin/integrations/connector?new=1')}>New connector</button>
      </div>
      <p className="muted">Outside services the ERP talks to: email, SMS, WhatsApp, GST, banks, biometric devices, maps, OCR and AI. Credentials are encrypted and never shown. New connectors and changes need approval. <Link to="/admin/integrations/log">Integration log</Link> &middot; <Link to="/admin/approvals">Approvals</Link></p>
      <p role="status" className="notice">{notice}</p>

      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search connectors</span>
          <input type="search" placeholder="Search code, name or provider" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </label>
        <label className="field field-inline"><span className="sr-only">Type</span>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {(catalog.data ?? []).map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </label>
        <label className="field field-inline"><span className="sr-only">Status</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>
            <option value="ENABLED">On</option><option value="DISABLED">Off</option><option value="PENDING">Waiting for approval</option>
          </select>
        </label>
        <button type="button" className="btn" disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
      </div>

      <QueryState query={connectors} what="connectors" permission="core.connectors.view" />
      {connectors.data && rows.length === 0 && (
        <div className="state">
          <h2>No connectors{q || type || status ? ' match' : ''}</h2>
          <p>{q || type || status ? 'Nothing matches those filters.' : 'No outside service is connected yet. Add the first one; it starts working once approved.'}</p>
          {canConfigure && !q && !type && !status && <button type="button" className="btn btn-primary" onClick={() => navigateTo('/admin/integrations/connector?new=1')}>New connector</button>}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Connectors with their status and health</caption>
              <thead><tr><th>Connector</th><th>Type</th><th>Provider</th><th>Environment</th><th>Status</th><th>Health</th><th>Circuit</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((c) => {
                  const [chip, label] = STATUS[c.status];
                  return (
                    <tr key={c.id} data-testid={`connector-${c.code}`}>
                      <td data-label="Connector"><a href={`/admin/integrations/connector?id=${c.id}`} onClick={(e) => { e.preventDefault(); navigateTo(`/admin/integrations/connector?id=${c.id}`); }}><strong>{c.code}</strong></a><div className="muted small">{c.name}</div></td>
                      <td data-label="Type">{c.type}</td>
                      <td data-label="Provider">{c.provider}</td>
                      <td data-label="Environment">{c.environment}</td>
                      <td data-label="Status"><span className={`chip ${chip}`}>{label}</span></td>
                      <td data-label="Health"><Health c={c} /></td>
                      <td data-label="Circuit">{c.breaker ? BREAKER[c.breaker.state] : '-'}</td>
                      <td data-label="Actions">
                        <div className="actions">
                          <button type="button" className="btn btn-small" disabled={!canConfigure || c.status === 'PENDING' || test.isPending} onClick={() => runTest(c)} aria-label={`Test connection ${c.code}`}>Test connection</button>
                          <button type="button" className="btn btn-small" disabled={!canConfigure || c.status !== 'ENABLED'} onClick={() => { setTarget(c); setError(null); dialog.current?.showModal(); }} aria-label={`Switch off ${c.code}`}>Switch off</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager meta={connectors.data.meta} page={page} setPage={setPage} noun="connectors" />
        </>
      )}

      <FormDialog dialogRef={dialog} title={`Switch off ${target?.code ?? ''}`} error={error} busy={disable.isPending} submitLabel="Switch off" onSubmit={submitDisable}>
        <p className="muted">Modules that use this connector will get a clear error until it is switched on again, which needs an approved request.</p>
      </FormDialog>
    </section>
  );
}
