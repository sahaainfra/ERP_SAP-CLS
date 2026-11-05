import { useMemo, useRef, useState } from 'react';
import Icon from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { authHeaders, jobsExportUrl, saveFrom, uploadFile, useImportTypes, useJobs } from '../../platform/excel/api.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { JOB_STATUS, ON_EXISTING, jobLink } from './excel-common.js';

// Import Center (part 04.13, section 7.1): the imports the person may run (download the template, fill it, upload it), and the history of the jobs. Nothing is saved by an upload: the file is checked and
// the job page shows the preview, the errors and the commit. Templates and history come from the engine; the person sees only what their rights allow.
const EMPTY = { status: '', importType: '', q: '', scope: 'all', sort: 'newest' };
const PAGES = [25, 50, 100];

function Upload({ types, chosen, onChoose }) {
  const [file, setFile] = useState(null);
  const [onExisting, setOnExisting] = useState('ERROR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const t = types.find((x) => x.code === chosen);
  const go = async (e) => {
    e.preventDefault(); setError(null); setBusy(true);
    try { const j = await uploadFile({ type: chosen, file, onExisting }); navigateTo(jobLink(j.id)); } catch (er) { setError(errorInfo(er)); setBusy(false); }
  };
  return (
    <form className="card form-grid" onSubmit={go} aria-label="Upload a filled template" data-testid="upload-form">
      <h2>Upload a filled template</h2>
      <Field label="What you are importing" name="type" error={error}>
        <select value={chosen} onChange={(e) => { onChoose(e.target.value); setOnExisting('ERROR'); }} data-testid="upload-type"><option value="">Choose the import</option>{types.filter((x) => x.canImport).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select>
      </Field>
      {t && t.onExisting.length > 1 && (
        <Field label="Records that already exist" name="onExisting" error={error}>
          <select value={onExisting} onChange={(e) => setOnExisting(e.target.value)} data-testid="upload-existing">{t.onExisting.map((k) => <option key={k} value={k}>{ON_EXISTING[k]}</option>)}</select>
        </Field>)}
      <Field label="The filled template (.xlsx, at most 10 MB)" name="file" error={error}>
        <input ref={ref} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="upload-file" />
      </Field>
      {error?.form && <p role="alert" className="error" data-testid="upload-error">{error.form}{error.correlationId ? ` (reference ${error.correlationId})` : ''}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={!chosen || !file || busy} data-testid="upload-go"><Icon name="erp.action.import" size={16} /> Upload and check</button></div>
    </form>
  );
}

export default function ImportCenterPage() {
  usePageTitle('Import Center');
  const types = useImportTypes();
  const [filters, setFilters] = useState(EMPTY);
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const query = useMemo(() => ({ ...filters, limit, offset: (page - 1) * limit }), [filters, limit, page]);
  const jobs = useJobs(query);
  if (types.error?.status === 403) return <NoPermission what="the Import Center" permission="xl.import.use" />;
  const d = jobs.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / limit)) : 1;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const file = async (path, name) => { setError(null); setNotice(''); try { setNotice(`${await saveFrom(path, name)} is ready.`); } catch (e) { setError(errorInfo(e)); } };
  const exportJobs = async (format) => {
    const res = await fetch(jobsExportUrl(format, { status: filters.status, importType: filters.importType }), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `import-history.${format}` }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <section aria-labelledby="ic-title" data-testid="import-center">
      <h1 id="ic-title">Import Center</h1>
      <p className="muted">Bring many records in from Excel without bypassing a rule: download the template, fill it, upload it, review the preview and the errors, then commit. Every record is created through the module that owns it, so it meets the same checks, rights and approvals as one typed by hand.</p>
      {notice && <p role="status" className="notice" data-testid="ic-notice">{notice}</p>}
      {error?.form && <p role="alert" className="error" data-testid="ic-error">{error.form}{error.correlationId ? ` (reference ${error.correlationId})` : ''}</p>}
      <h2>Templates</h2>
      {types.isPending && <Skeleton label="Loading the templates" rows={3} />}
      {types.isError && types.error?.status !== 403 && <ErrorState title="The templates could not be loaded" error={types.error} onRetry={() => types.refetch()} />}
      {types.data && (types.data.types.length === 0 ? <EmptyState title="Nothing to import" message="No import is open to you. An import needs its own right (for example org.designation.import); ask the administrator." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Import templates">
          <table className="grid" data-testid="template-table">
            <thead><tr><th>Import</th><th>Module</th><th>Version</th><th>Columns</th><th>Last upload</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{types.data.types.map((t) => (
              <tr key={t.code} data-testid={`type-${t.code}`}>
                <th scope="row" data-label="Import">{t.label}<br /><span className="muted small">{t.description}</span></th><td data-label="Module">{t.module}</td><td data-label="Version">{t.version}</td>
                <td data-label="Columns">{t.columns.map((c) => c.label + (c.required ? ' *' : '')).join(', ')}</td>
                <td data-label="Last upload">{t.lastJob ? `${JOB_STATUS[t.lastJob.status][1]}, ${formatDateTime(t.lastJob.at)}` : ''}</td>
                <td data-label="Actions" className="srch-tools">
                  {t.canImport && <button type="button" className="btn btn-small" onClick={() => file(`/templates/${t.code}/download`, `${t.code}.xlsx`)} data-testid={`download-${t.code}`}>Download template</button>}
                  {t.canImport && <button type="button" className="btn btn-small btn-primary" onClick={() => { setChosen(t.code); document.querySelector('[data-testid="upload-form"]')?.scrollIntoView?.({ block: 'center' }); }}>Upload</button>}
                  {t.canExport && <button type="button" className="btn btn-small" onClick={() => file(`/templates/${t.code}/export`, `${t.code}-data.xlsx`)}>Export the data</button>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>))}
      {types.data?.types.some((t) => t.canImport) && <Upload types={types.data.types} chosen={chosen} onChoose={setChosen} />}
      <h2>History</h2>
      <div className="srch-tools"><button type="button" className="btn" onClick={() => exportJobs('xlsx')}><Icon name="erp.action.export" size={16} /> Export XLSX</button><button type="button" className="btn" onClick={() => exportJobs('csv')}>Export CSV</button><button type="button" className="btn" onClick={() => exportJobs('pdf')}>Export PDF</button></div>
      <form className="srch-form" role="search" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Import</span><select value={filters.importType} onChange={(e) => set({ importType: e.target.value })}><option value="">Any import</option>{(types.data?.types ?? []).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></label>
        <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{Object.entries(JOB_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {d?.canViewAll && <label className="field"><span>Whose jobs</span><select value={filters.scope} onChange={(e) => set({ scope: e.target.value })}><option value="all">Everybody&apos;s</option><option value="mine">Mine</option></select></label>}
        <label className="field"><span>File or person</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        <label className="field"><span>Order</span><select value={filters.sort} onChange={(e) => set({ sort: e.target.value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="type">Import</option><option value="status">Status</option></select></label>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
      </form>
      {jobs.isPending && <Skeleton label="Loading the history" rows={3} />}
      {jobs.isError && jobs.error?.status !== 403 && <ErrorState title="The history could not be loaded" error={jobs.error} onRetry={() => jobs.refetch()} />}
      {d && (d.rows.length === 0 ? <EmptyState title="No import yet" message="Upload a filled template to start. Each upload is kept here with its result." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Import jobs">
          <table className="grid" data-testid="jobs-table">
            <thead><tr><th>Job</th><th>Import</th><th>File</th><th>Status</th><th>Rows</th><th>Started</th></tr></thead>
            <tbody>{d.rows.map((j) => (
              <tr key={j.id} data-testid={`job-${j.id}`}>
                <th scope="row" data-label="Job"><Link to={jobLink(j.id)}>#{j.id}</Link></th><td data-label="Import">{j.typeLabel}</td><td data-label="File">{j.fileName}</td>
                <td data-label="Status"><StatusBadge status={JOB_STATUS[j.status][0]} label={JOB_STATUS[j.status][1]} /></td>
                <td data-label="Rows">{j.totalRows} <span className="muted small">({j.validRows} correct, {j.errorRows} with errors)</span></td>
                <td data-label="Started">{formatDateTime(j.startedAt)}<br /><span className="muted small">{j.startedBy}</span></td>
              </tr>))}</tbody>
          </table>
        </div>))}
      <div className="pager"><span>{d?.total ?? 0} job(s), page {page} of {pages}</span>
        <select aria-label="Rows on a page" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>{PAGES.map((n) => <option key={n} value={n}>{n} a page</option>)}</select>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>
  );
}
