import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useCreateMatrix, useMatrixList } from '../../platform/workflow/api.js';
import { Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { DEF_STATUS } from './common.js';

// Approval Matrix (part 04.02, section 7.1): the routing of each kind of document, its versions and the dates they take effect. A version is a draft until its
// approval chain (the system administrator, then the chief financial officer or the process owner) has approved it; running approvals keep the chain they started with.
const PAGE = 25;
const SCOPE = { COMPANY: 'The whole company', DEPARTMENT: 'A department', PROJECT: 'A project' };

export default function ApprovalMatrixPage({ session }) {
  usePageTitle('Approval Matrix');
  const [filters, setFilters] = useState({ docType: '', status: '', scopeType: '', q: '' });
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const list = useMatrixList({ ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const create = useCreateMatrix();
  const canManage = can(session, 'eng.matrix.manage');
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  if (list.error?.status === 403) return <NoPermission what="the approval matrix" permission="eng.matrix.view" />;
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const draft = (docType) => create.mutate({ docType }, { onSuccess: (m) => navigateTo(`/admin/approval-matrix/editor?id=${m.id}`, { force: true }), onError: (e) => setError(errorInfo(e)) });
  return (
    <section aria-labelledby="am-title" data-testid="approval-matrix">
      <h1 id="am-title">Approval Matrix</h1>
      <p className="muted">Who approves each kind of document, by amount and by the facts of the document. The first rule that fits decides. A new version needs approval and takes effect from a date; documents already in approval keep their chain.</p>
      {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
      {list.isPending && <Skeleton label="Loading the matrix" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The matrix could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {data && (
        <>
          <form className="srch-form" role="search" aria-label="Filter the matrix" onSubmit={(e) => e.preventDefault()}>
            <label className="field"><span>Document type</span><select value={filters.docType} onChange={(e) => set({ docType: e.target.value })}><option value="">All document types</option>{data.docTypes.map((t) => <option key={t.docType} value={t.docType}>{t.label}</option>)}</select></label>
            <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{Object.entries(DEF_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field"><span>Applies to</span><select value={filters.scopeType} onChange={(e) => set({ scopeType: e.target.value })}><option value="">Anywhere</option>{Object.entries(SCOPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field"><span>Name</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
            {Object.values(filters).some(Boolean) && <button type="button" className="btn" onClick={() => { setFilters({ docType: '', status: '', scopeType: '', q: '' }); setPage(1); }}>Clear filters</button>}
          </form>
          {canManage && (
            <div className="srch-tools">
              <label className="field"><span>Make a new version of</span>
                <select value="" disabled={create.isPending} data-testid="am-new" onChange={(e) => e.target.value && draft(e.target.value)}><option value="">Choose a document type</option>{data.docTypes.map((t) => <option key={t.docType} value={t.docType}>{t.label}</option>)}</select></label>
            </div>
          )}
          {data.rows.length === 0 ? <EmptyState title="No matrix matches" message="Change the filters above." action={{ label: 'Clear filters', onClick: () => setFilters({ docType: '', status: '', scopeType: '', q: '' }) }} /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Matrix versions">
              <table className="grid">
                <thead><tr><th>Document type</th><th>Applies to</th><th className="num">Version</th><th>Status</th><th>Effective from</th><th>Effective to</th><th className="num">Rules</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {data.rows.map((m) => (
                    <tr key={m.id} data-testid={`am-row-${m.id}`}>
                      <th scope="row" data-label="Document type">{m.docLabel}<br /><code className="small">{m.docType}</code></th>
                      <td data-label="Applies to">{SCOPE[m.scopeType]}{m.scopeId ? ` ${m.scopeId}` : ''}</td><td className="num" data-label="Version">{m.version}</td>
                      <td data-label="Status"><StatusBadge status={DEF_STATUS[m.status][0]} label={DEF_STATUS[m.status][1]} /></td>
                      <td data-label="Effective from">{m.effectiveFrom ?? 'not set'}</td><td data-label="Effective to">{m.effectiveTo ?? 'open'}</td><td className="num" data-label="Rules">{m.ruleCount}</td>
                      <td><Link to={`/admin/approval-matrix/editor?id=${m.id}`}>{canManage && ['DRAFT', 'REJECTED'].includes(m.status) ? 'Edit' : 'View'}<span className="sr-only"> {m.docLabel} version {m.version}</span></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pager"><span>{data.total} version(s), page {page} of {pages}</span>
            <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
          <p className="muted small"><Link to="/admin/approval-simulator">Approval Simulator</Link> shows the chain a document would get. <Link to="/admin/authority-limits">Authority Limits</Link> and <Link to="/admin/escalation">Escalation Paths &amp; SLA</Link> are changed the same way.</p>
        </>
      )}
    </section>
  );
}
