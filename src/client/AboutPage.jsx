import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { formatDateTime } from './format.js';

export default function AboutPage({ session }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', data: null, error: null });
    try {
      const res = await api('GET', '/core/about');
      setState({ status: 'ready', data: res.data, error: null });
    } catch (error) {
      setState({ status: error.status === 403 ? 'forbidden' : 'error', data: null, error });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, session?.user, session?.roles?.join(',')]);

  useEffect(() => {
    document.title = 'About - Administration - ERP';
  }, []);

  const d = state.data;
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; About</nav>
      <div className="page-head"><h1 id="page-title">About &amp; Build Information</h1></div>
      <p className="muted">Shown to administrators only. Quote the build ID when you report a problem.</p>

      {state.status === 'loading' && (
        <div className="skeleton" aria-busy="true" aria-label="Loading build information">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton-row" />)}
        </div>
      )}
      {state.status === 'forbidden' && (
        <div className="state" role="alert">
          <h2>You do not have access to build information</h2>
          <p>Viewing it needs the core.about.view permission (System Administrator or IT Administrator).</p>
        </div>
      )}
      {state.status === 'error' && (
        <div className="state state-error" role="alert">
          <h2>Could not load build information</h2>
          <p>{state.error.message}</p>
          {state.error.correlationId && <p className="muted">Correlation ID: <code>{state.error.correlationId}</code></p>}
          <button type="button" className="btn" onClick={load}>Try again</button>
        </div>
      )}
      {d && (
        <>
          <dl className="facts">
            <div><dt>Version</dt><dd data-testid="about-version">{d.version}</dd></div>
            <div><dt>Build ID</dt><dd data-testid="about-build"><code>{d.buildId}</code></dd></div>
            <div><dt>Commit</dt><dd><code>{d.commit}</code></dd></div>
            <div><dt>Built at</dt><dd>{d.builtAt ? formatDateTime(d.builtAt) : 'Local development run'}</dd></div>
            <div><dt>Deployed at</dt><dd>{d.deployedAt ? formatDateTime(d.deployedAt) : 'Not a deployed release'}</dd></div>
            <div><dt>Environment</dt><dd>{d.environment}</dd></div>
            <div><dt>Runtime</dt><dd>Node {d.node}</dd></div>
          </dl>
          <h2>Migrations applied ({d.migrations.length})</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Migration</th><th>Applied at</th></tr></thead>
              <tbody>
                {d.migrations.map((m) => (
                  <tr key={m.id}>
                    <td data-label="Migration"><code>{m.id}</code></td>
                    <td data-label="Applied at">{formatDateTime(m.appliedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
