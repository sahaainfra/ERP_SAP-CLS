import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { saveFrom, useCancel, useCommit, useErrors, useImportTypes, useJob, usePreview } from '../../platform/excel/api.js';
import { Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { ACTION, JOB_STATUS, ON_EXISTING } from './excel-common.js';

// Import Job (part 04.13, section 7.2): where one upload stands. It shows the progress while the file is checked, then the preview (what each row will do), the errors with their sheet, row, column and reason,
// the error file to correct, and the commit or cancel. After the commit it shows what was created or updated. All of it is read from the job; nothing is kept in the page.
const TABS = [['preview', 'Preview'], ['errors', 'Errors'], ['details', 'Details']];
export default function ImportJobPage({ session }) {
  usePageTitle('Import Job');
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  const [tab, setTab] = useState('preview');
  const [page, setPage] = useState(1);
  const [skip, setSkip] = useState(false);
  const [chunked, setChunked] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const q = useJob(id);
  const types = useImportTypes();
  const commit = useCommit();
  const cancel = useCancel();
  const j = q.data;
  const ready = j && ['PREVIEW', 'PARTIAL', 'COMMITTED', 'COMMITTING'].includes(j.status);
  const preview = usePreview(id, page, tab === 'preview' && ready);
  const errs = useErrors(id, page, tab === 'errors' && Boolean(j));
  if (!can(session, 'xl.import.use')) return <NoPermission what="the Import Center" permission="xl.import.use" />;
  if (!id) return <section aria-labelledby="ij-title" data-testid="import-job"><h1 id="ij-title">Import Job</h1><EmptyState title="No job chosen" message="Open a job from the history of the Import Center." action={{ label: 'Open the Import Center', onClick: () => navigateTo('/import') }} /></section>;
  if (q.isPending) return <Skeleton label="Loading the job" rows={4} />;
  if (q.isError) return <ErrorState title="The job could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  const type = types.data?.types.find((t) => t.code === j.importType);
  const live = ['UPLOADED', 'VALIDATING', 'COMMITTING'].includes(j.status);
  const go = () => { setError(null); setNotice(''); commit.mutate({ id, skipInvalid: skip, ...(chunked ? { mode: 'CHUNKED' } : {}), version: j.rowVersion }, { onSuccess: () => setNotice('The import is being saved.'), onError: (e) => setError(errorInfo(e)) }); };
  const stop = () => { setError(null); cancel.mutate(id, { onSuccess: () => setNotice('The job is cancelled. Nothing was saved.'), onError: (e) => setError(errorInfo(e)) }); };
  const errorFile = async () => { setError(null); try { await saveFrom(`/jobs/${id}/errors?format=xlsx`, 'errors.xlsx'); } catch (e) { setError(errorInfo(e)); } };
  const pageOf = (n, total, size) => (
    <div className="pager"><span>{total} row(s), page {page} of {Math.max(1, Math.ceil(total / size))}</span><button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= Math.ceil(total / size)} onClick={() => setPage(page + 1)}>Next</button>{n}</div>
  );
  return (
    <section aria-labelledby="ij-title" data-testid="import-job" data-status={j.status}>
      <p className="muted small"><Link to="/import">Import Center</Link> › Job #{j.id}</p>
      <h1 id="ij-title">{j.typeLabel}: {j.fileName}</h1>
      <p><StatusBadge status={JOB_STATUS[j.status][0]} label={JOB_STATUS[j.status][1]} /> Started by {j.startedBy} on {formatDateTime(j.startedAt)}. Template version {j.templateVersion}.</p>
      {live && <p role="status" aria-busy="true" data-testid="job-progress">{j.status === 'COMMITTING' ? `Saving the records… ${j.progress}%` : 'Checking the file…'} <progress max="100" value={j.progress} aria-label="Progress" /></p>}
      {notice && <p role="status" className="notice" data-testid="ij-notice">{notice}</p>}
      {error?.form && <p role="alert" className="error" data-testid="ij-error">{error.form}{error.correlationId ? ` (reference ${error.correlationId})` : ''}</p>}
      {j.lastError && <p role="alert" className="error" data-testid="job-last-error">{j.lastError}</p>}
      {j.structure.length > 0 && <div role="alert" className="error" data-testid="job-structure"><p>The file cannot be read as this import:</p><ul>{j.structure.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      {j.warnings.length > 0 && <ul className="muted small" data-testid="job-warnings">{j.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {j.totalRows > 0 && (
        <div className="tiles" data-testid="job-counts" aria-label="Counts">
          <p><strong>{j.totalRows}</strong> row(s) in the file</p><p><strong>{j.validRows}</strong> correct</p><p><strong data-testid="count-errors">{j.errorRows}</strong> with errors</p>
          <p><strong>{j.createRows}</strong> to create</p><p><strong>{j.updateRows}</strong> to update</p><p><strong>{j.skipRows}</strong> left out</p>
        </div>)}
      {j.status === 'COMMITTED' && <p role="status" className="notice" data-testid="job-result">Imported: {j.result.created} created, {j.result.updated} updated, {j.result.skipped} left out{j.result.left ? `, ${j.result.left} with errors not imported` : ''}.{j.result.refs?.length ? ` First records: ${j.result.refs.slice(0, 5).map((r) => r.ref).join(', ')}.` : ''}</p>}
      <div className="actions">
        {j.canCommit && (<>
          {j.errorRows > 0 && <label className="field"><span><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} data-testid="skip-invalid" /> Import only the {j.validRows} correct row(s) and leave the {j.errorRows} with errors out</span></label>}
          {type?.chunked && <label className="field"><span><input type="checkbox" checked={chunked} onChange={(e) => setChunked(e.target.checked)} /> Save in chunks (a stop keeps the chunks saved so far and can be resumed)</span></label>}
          <button type="button" className="btn btn-primary" disabled={commit.isPending || (j.errorRows > 0 && !skip) || j.createRows + j.updateRows === 0} onClick={go} data-testid="commit">{j.status === 'PARTIAL' ? 'Resume the import' : 'Commit the import'}</button>
        </>)}
        {j.canCancel && <button type="button" className="btn" disabled={cancel.isPending} onClick={() => { if (globalThis.confirm('Cancel this job? Nothing has been saved.')) stop(); }} data-testid="cancel">Cancel the job</button>}
        {j.errorCount > 0 && <button type="button" className="btn" onClick={errorFile} data-testid="error-file">Download the error file</button>}
        <button type="button" className="btn" onClick={() => navigateTo('/import')}>Back to the Import Center</button>
      </div>
      <div role="tablist" aria-label="Job" className="srch-tools">{TABS.map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => { setTab(k); setPage(1); }} data-testid={`tab-${k}`}>{l}{k === 'errors' && j.errorCount ? ` (${j.errorCount})` : ''}</button>)}</div>
      {tab === 'preview' && (!ready ? <EmptyState compact title="No preview yet" message={live ? 'The file is being checked. The preview appears here.' : 'This job has no preview: its file was refused.'} /> : preview.isPending ? <Skeleton label="Loading the preview" rows={3} /> : preview.isError ? <ErrorState title="The preview could not be loaded" error={preview.error} onRetry={() => preview.refetch()} /> : (
        <div role="tabpanel">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Preview of the rows"><table className="grid" data-testid="preview-table"><thead><tr><th>Row</th><th>What happens</th>{preview.data.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{preview.data.rows.map((r) => <tr key={r.line} data-testid={`row-${r.line}`}><th scope="row" data-label="Row">{r.line}</th><td data-label="What happens"><StatusBadge status={ACTION[r.action][0]} label={ACTION[r.action][1]} /></td>{preview.data.columns.map((c) => <td key={c.key} data-label={c.label} className={r.errors.some((e) => e.column === c.key) ? 'error' : undefined}>{r.cells[c.key]}</td>)}</tr>)}</tbody></table></div>
          {pageOf(null, preview.data.total, preview.data.limit)}
        </div>))}
      {tab === 'errors' && (errs.isPending ? <Skeleton label="Loading the errors" rows={3} /> : errs.isError ? <ErrorState title="The errors could not be loaded" error={errs.error} onRetry={() => errs.refetch()} /> : errs.data.total === 0 ? <EmptyState compact title="No errors" message="Every row of the file is correct." /> : (
        <div role="tabpanel">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Errors"><table className="grid" data-testid="errors-table"><thead><tr><th>Sheet</th><th>Row</th><th>Column</th><th>Value</th><th>What is wrong</th></tr></thead>
            <tbody>{errs.data.rows.map((e) => <tr key={e.id}><td data-label="Sheet">{e.sheet}</td><th scope="row" data-label="Row">{e.row || ''}</th><td data-label="Column">{e.column}</td><td data-label="Value">{e.value}</td><td data-label="What is wrong">{e.message}</td></tr>)}</tbody></table></div>
          {pageOf(null, errs.data.total, errs.data.limit)}
        </div>))}
      {tab === 'details' && (
        <dl className="verify-facts" data-testid="job-details" role="tabpanel">
          <dt>File</dt><dd>{j.fileName}</dd><dt>Fingerprint</dt><dd><code>{j.fileHash.slice(0, 24)}</code></dd><dt>Existing records</dt><dd>{ON_EXISTING[j.onExisting]}</dd><dt>Mode</dt><dd>{j.mode === 'CHUNKED' ? 'In chunks' : 'All or nothing'}</dd>
          <dt>Checked</dt><dd>{j.validatedAt ? formatDateTime(j.validatedAt) : ''}</dd><dt>Committed</dt><dd>{j.committedAt ? `${formatDateTime(j.committedAt)} by ${j.committedBy}` : ''}</dd>
        </dl>)}
    </section>
  );
}
