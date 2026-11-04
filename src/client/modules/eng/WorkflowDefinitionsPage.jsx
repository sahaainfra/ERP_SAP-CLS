import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useDefinitionOptions, useDefinitions, useDraftFrom } from '../../platform/workflow/api.js';
import { Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { DEF_STATUS } from './common.js';

// Workflow Definitions (part 04.01, section 7.1): the definitions of every document type, their versions and status. A new version starts as a copy of the
// active one and becomes active only after its approval chain (the system administrator, the owner of the process, the IT administrator) has approved it.
const PAGE = 25;

export default function WorkflowDefinitionsPage({ session }) {
  usePageTitle('Workflow Definitions');
  const [filters, setFilters] = useState({ docType: '', status: '', q: '' });
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const list = useDefinitions({ ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const options = useDefinitionOptions();
  const draft = useDraftFrom();
  const canDefine = can(session, 'eng.workflow.define');
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  if (list.error?.status === 403) return <NoPermission what="the workflow definitions" permission="eng.workflow.view" />;
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const newVersion = (docType) => draft.mutate(docType, { onSuccess: (d) => navigateTo(`/admin/workflows/editor?id=${d.id}`, { force: true }), onError: (e) => setError(errorInfo(e)) });
  const clear = Object.values(filters).some(Boolean);
  return (
    <section aria-labelledby="wd-title" data-testid="workflow-definitions">
      <h1 id="wd-title">Workflow Definitions</h1>
      <p className="muted">How each kind of document is approved: its steps, who decides, how long they have. A document keeps the version it was submitted under; a new version needs its own approval before it is used.</p>
      {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
      {list.isPending && <Skeleton label="Loading the definitions" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The definitions could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {data && (
        <>
          <form className="srch-form" role="search" aria-label="Filter the definitions" onSubmit={(e) => e.preventDefault()}>
            <label className="field"><span>Document type</span><select value={filters.docType} onChange={(e) => set({ docType: e.target.value })}><option value="">All document types</option>{(options.data?.docTypes ?? data.docTypes).map((t) => <option key={t.docType} value={t.docType}>{t.label}</option>)}</select></label>
            <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{Object.entries(DEF_STATUS).map(([k, [, label]]) => <option key={k} value={k}>{label}</option>)}</select></label>
            <label className="field"><span>Name</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
            {clear && <button type="button" className="btn" onClick={() => { setFilters({ docType: '', status: '', q: '' }); setPage(1); }}>Clear filters</button>}
          </form>
          {canDefine && (
            <div className="srch-tools">
              <label className="field"><span>Make a new version of</span>
                <select value="" onChange={(e) => e.target.value && newVersion(e.target.value)} disabled={draft.isPending} data-testid="wd-new"><option value="">Choose a document type</option>{data.docTypes.map((t) => <option key={t.docType} value={t.docType}>{t.label}</option>)}</select>
              </label>
            </div>
          )}
          {data.rows.length === 0 ? (
            <EmptyState title="No definition yet" message={canDefine ? 'A document type starts with the chain its module ships with when its first document is submitted. Make a new version of a type to design your own.' : 'Definitions appear here once a document type has been used.'} />
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Definitions">
              <table className="grid">
                <thead><tr><th>Document type</th><th className="num">Version</th><th>Name</th><th>Status</th><th className="num">Steps</th><th className="num">Running</th><th>Changed</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} data-testid={`wd-row-${r.id}`}>
                      <th scope="row" data-label="Document type">{r.docLabel}<br /><code className="small">{r.docType}</code></th>
                      <td className="num" data-label="Version">{r.version}</td><td data-label="Name">{r.name}</td>
                      <td data-label="Status"><StatusBadge status={DEF_STATUS[r.status][0]} label={DEF_STATUS[r.status][1]} /></td>
                      <td className="num" data-label="Steps">{r.stepCount}</td><td className="num" data-label="Running">{r.running}</td>
                      <td data-label="Changed">{(r.updatedAt ?? r.createdAt)?.slice(0, 10)}<br /><span className="muted small">{r.activatedBy ? `activated by ${r.activatedBy}` : r.createdBy}</span></td>
                      <td><Link to={`/admin/workflows/editor?id=${r.id}`}>{canDefine && ['DRAFT', 'REJECTED'].includes(r.status) ? 'Edit' : 'View'}<span className="sr-only"> {r.docLabel} version {r.version}</span></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pager"><span>{data.total} definition(s), page {page} of {pages}</span>
            <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
          <p className="muted small"><Link to="/admin/workflows/monitor">Workflow Monitor</Link> shows the documents running through these definitions.</p>
        </>
      )}
    </section>
  );
}
