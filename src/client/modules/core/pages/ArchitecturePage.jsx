import { useEffect, useMemo, useState } from 'react';
import { useArchitecture } from '../api/index.js';
import Markdown from '../../../platform/Markdown.jsx';
import { headingText, parseMarkdown, slug } from '../../../platform/markdown.js';
import { toCsv } from '../../../platform/format.js';
import PageHeader from '../../../platform/design/PageHeader.jsx';

const SKELETON = [0, 1, 2, 3, 4];

function Problem({ title, children, error, onRetry }) {
  return (
    <div className={`state ${onRetry ? 'state-error' : ''}`} role="alert">
      <h2>{title}</h2>
      {children}
      {error?.correlationId && <p className="muted">Correlation ID: <code>{error.correlationId}</code></p>}
      {onRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export default function ArchitecturePage() {
  const query = useArchitecture();
  const [filter, setFilter] = useState('');
  const d = query.data;

  useEffect(() => {
    document.title = 'Architecture & API Conventions - Technical Console - ERP';
  }, []);

  const contents = useMemo(
    () => (d ? parseMarkdown(d.markdown).filter((b) => b.t === 'heading' && b.level === 2).map((b) => ({ text: headingText(b), id: slug(headingText(b)) })) : []),
    [d],
  );
  const codes = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (d?.errorCodes ?? []).filter((e) => !needle || `${e.code} ${e.status} ${e.meaning}`.toLowerCase().includes(needle));
  }, [d, filter]);

  const exportCodes = () => {
    const csv = toCsv(['Code', 'HTTP status', 'Meaning', 'What to do'], codes.map((e) => [e.code, e.status, e.meaning, e.action]));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: 'error-codes.csv' }).click();
    URL.revokeObjectURL(url);
  };

  let body;
  if (query.isError) {
    const e = query.error;
    if (e.status === 403) {
      body = (
        <Problem title="You do not have access to the architecture guide">
          <p>It needs the core.arch.view permission (System Administrator or IT Administrator).</p>
        </Problem>
      );
    } else if (e.status === 404) {
      body = (
        <Problem title="The architecture guide is not enabled" error={e}>
          <p>{e.message}</p>
        </Problem>
      );
    } else {
      body = (
        <Problem title="Could not load the architecture guide" error={e} onRetry={() => query.refetch()}>
          <p>{e.message}</p>
        </Problem>
      );
    }
  } else if (!d) {
    body = (
      <div className="skeleton" aria-busy="true" aria-label="Loading the architecture guide">
        {SKELETON.map((i) => <div key={i} className="skeleton-row" />)}
      </div>
    );
  } else {
    body = (
      <>
        <nav aria-label="On this page" className="toc">
          <strong>On this page</strong>
          <ul>
            {contents.map((c) => <li key={c.id}><a href={`#${c.id}`}>{c.text}</a></li>)}
            <li><a href="#modules-in-this-installation">Modules in this installation</a></li>
            <li><a href="#error-codes">Error codes</a></li>
            <li><a href="#pagination-contract">Pagination contract</a></li>
          </ul>
        </nav>

        <Markdown source={d.markdown} />

        <h2 id="modules-in-this-installation">Modules in this installation</h2>
        <div className="table-wrap">
          <table data-testid="modules-table">
            <thead><tr><th>Module</th><th>Name</th><th>API prefix</th><th>Resources</th><th>Tables</th><th>Status</th></tr></thead>
            <tbody>
              {d.modules.map((m) => (
                <tr key={m.code}>
                  <td data-label="Module"><code>{m.code}</code></td>
                  <td data-label="Name">{m.name}</td>
                  <td data-label="API prefix"><code>{m.routePrefix}</code></td>
                  <td data-label="Resources">{m.resources.join(', ')}</td>
                  <td data-label="Tables">{m.tables.join(', ')}</td>
                  <td data-label="Status">{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 id="error-codes">Error codes</h2>
        <div className="toolbar">
          <label className="field field-inline">
            <span className="sr-only">Filter error codes</span>
            <input type="search" placeholder="Filter by code, status or text" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <button type="button" className="btn" onClick={exportCodes} disabled={codes.length === 0}>Export CSV</button>
        </div>
        {codes.length === 0 ? (
          <div className="state">
            <h3>No error code matches</h3>
            <button type="button" className="btn" onClick={() => setFilter('')}>Clear filter</button>
          </div>
        ) : (
          <div className="table-wrap">
            <table data-testid="error-codes-table">
              <thead><tr><th>Code</th><th>HTTP</th><th>Meaning</th><th>What to do</th></tr></thead>
              <tbody>
                {codes.map((e) => (
                  <tr key={e.code}>
                    <td data-label="Code"><code>{e.code}</code></td>
                    <td data-label="HTTP">{e.status}</td>
                    <td data-label="Meaning">{e.meaning}</td>
                    <td data-label="What to do">{e.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 id="pagination-contract">Pagination contract</h2>
        <p>Maximum page size <strong>{d.pagination.limits.maxPageSize}</strong>, default {d.pagination.limits.defaultPageSize}. Query parameters:</p>
        <ul>{d.pagination.request.map((r) => <li key={r}>{r}</li>)}</ul>
        <p>Response: <code>{d.pagination.response}</code></p>
      </>
    );
  }

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Technical Console &rsaquo; Architecture</nav>
      <PageHeader id="page-title" title={"Architecture & API Conventions Guide"} subtitle={"For developers and administrators. Rendered from docs/erp/ARCHITECTURE.md."} />
      {body}
    </section>
  );
}
