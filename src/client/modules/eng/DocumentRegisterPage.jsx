import { useMemo, useState } from 'react';
import Icon from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { authHeaders, bulkSheet, documentsUrl, downloadTemplate, downloadZip, useApplyTemplate, useCreateFolder, useDocTypes, useDocuments, useFolders } from '../../platform/documents/api.js';
import { Field, Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { LEVELS, STATUS, docLink } from './documents-common.js';

// Document Register (part 04.10, section 7.1): the folders of a project on the left, the documents in them on the right, with filters, saved-looking choices in the address of the page, bulk
// download as a zip, an Excel sheet that registers many at once, and the export of what is listed. Only what the person may see is listed (a confidential document is not even counted).
const EMPTY = { status: '', docType: '', confidentiality: '', q: '', expiring: '', checkedOut: false, sort: 'newest' };
const PAGE = 25;

function Tree({ nodes, chosen, onChoose }) {
  const kids = (parent) => nodes.filter((n) => (n.parentId ?? null) === parent);
  const walk = (parent) => <ul>{kids(parent).map((n) => (
    <li key={n.id}><button type="button" className={`btn btn-small${chosen === n.id ? ' btn-primary' : ''}`} aria-pressed={chosen === n.id} onClick={() => onChoose(chosen === n.id ? null : n.id)} data-testid={`folder-${n.id}`}>{n.name} <span className="muted small">{n.documents}</span></button>{kids(n.id).length > 0 && walk(n.id)}</li>))}</ul>;
  return <nav className="doc-tree" aria-label="Folders">{walk(null)}</nav>;
}

function BulkDialog({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (commit) => { setBusy(true); setError(''); try { const out = await bulkSheet(file, commit); setResult({ ...out, commit }); if (commit) onDone(out); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return (
    <section className="card" aria-label="Register many documents" data-testid="bulk-dialog">
      <div className="wf-inline"><h2>Register many documents</h2><button type="button" className="btn btn-small" onClick={onClose}>Close</button></div>
      <p className="muted">Fill one row for each document in an Excel sheet (the sheet below shows the columns), check it, then register them. Each becomes a draft; attach its file on its page.</p>
      <button type="button" className="btn" onClick={downloadTemplate}>Download the sheet</button>
      <label className="field"><span>Your sheet (.xlsx)</span><input type="file" accept=".xlsx" data-testid="bulk-file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} /></label>
      <div className="actions"><button type="button" className="btn" disabled={!file || busy} onClick={() => run(false)}>Check the sheet</button><button type="button" className="btn btn-primary" disabled={!file || busy || !result || result.commit || result.problems > 0 && result.rows.every((r) => !r.ok)} onClick={() => run(true)}>Register the correct rows</button></div>
      {error && <p role="alert" className="error" data-testid="bulk-error">{error}</p>}
      {result && (
        <div data-testid="bulk-result">
          <p role="status">{result.commit ? `${result.created} document(s) registered.` : `${result.rows.filter((r) => r.ok).length} row(s) are correct.`}{result.problems ? ` ${result.problems} row(s) have a problem.` : ''}</p>
          <ul>{result.rows.map((r) => <li key={r.line}>Row {r.line}: {r.title || '(no title)'} {r.ok ? (r.docNo ? `registered as ${r.docNo}` : 'is correct') : <span className="error">{r.problems.join(' ')}</span>}</li>)}</ul>
        </div>)}
    </section>
  );
}

export default function DocumentRegisterPage({ session }) {
  usePageTitle('Document Register');
  const [project, setProject] = useState('');
  const [folder, setFolder] = useState(null);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState([]);
  const [bulk, setBulk] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const [newFolder, setNewFolder] = useState('');
  const types = useDocTypes();
  const tree = useFolders(project ? Number(project) : null);
  const manage = can(session, 'doc.document.manage');
  const query = useMemo(() => ({ ...filters, projectId: project, folderId: folder, includeSub: folder ? 1 : '', limit: PAGE, offset: (page - 1) * PAGE }), [filters, project, folder, page]);
  const list = useDocuments(query);
  const template = useApplyTemplate();
  const mkFolder = useCreateFolder();
  if (list.error?.status === 403) return <NoPermission what="the document register" permission="doc.document.view" />;
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); setPicked([]); };
  const download = async (format) => {
    const res = await fetch(documentsUrl(format, { projectId: project, folderId: folder, docType: filters.docType, status: filters.status, q: filters.q }), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `documents.${format}` }).click();
    URL.revokeObjectURL(url);
  };
  const zip = async () => { setError(null); try { const r = await downloadZip(picked); setNotice(`${r.included} file(s) downloaded${r.left ? `; ${r.left} document(s) had no file you may download (they are listed in the zip)` : ''}.`); } catch (e) { setError({ form: e.message }); } };
  const folders = tree.data ?? [];
  return (
    <section aria-labelledby="dr-title" data-testid="doc-register">
      <h1 id="dr-title">Document Register</h1>
      <p className="muted">Every controlled document, with its current revision, its status and who holds it. You see the documents of your projects, up to the level of confidentiality you are trusted with.</p>
      {notice && <p role="status" className="notice" data-testid="dr-notice">{notice}</p>}
      {error?.form && <p role="alert" className="error" data-testid="dr-error">{error.form}</p>}
      <div className="srch-tools">
        {can(session, 'doc.document.create') && <button type="button" className="btn btn-primary" onClick={() => navigateTo(`/documents/new${project ? `?project=${project}` : ''}`)}><Icon name="erp.action.create" size={16} /> New document</button>}
        {can(session, 'doc.document.create') && <button type="button" className="btn" onClick={() => setBulk(!bulk)} aria-expanded={bulk}>Register many from Excel</button>}
        <button type="button" className="btn" onClick={() => download('xlsx')}><Icon name="erp.action.export" size={16} /> Export XLSX</button>
        <button type="button" className="btn" onClick={() => download('csv')}>Export CSV</button>
        <button type="button" className="btn" onClick={() => download('pdf')}>Export PDF</button>
      </div>
      {bulk && <BulkDialog onClose={() => setBulk(false)} onDone={(o) => setNotice(`${o.created} document(s) registered from the sheet.`)} />}
      <div className="doc-register">
        <aside aria-label="Project and folders">
          <LookupField id="dr-project" label="Project" lookup="iam/projects" value={project} onChange={(v) => { setProject(v); setFolder(null); setPage(1); setPicked([]); }} />
          {project && <button type="button" className="btn btn-small" onClick={() => { setProject(''); setFolder(null); }}>Show all projects</button>}
          {project && tree.isPending && <Skeleton label="Loading the folders" rows={2} />}
          {project && folders.length === 0 && !tree.isPending && <p className="muted small" data-testid="no-folders">This project has no folders yet.{manage ? '' : ' The document controller can make them.'}</p>}
          {project && folders.length === 0 && manage && !tree.isPending && <button type="button" className="btn" disabled={template.isPending} onClick={() => { setError(null); template.mutate({ projectId: Number(project), template: 'PROJECT_STANDARD' }, { onSuccess: (r) => setNotice(`${r.folders} standard folders made.`), onError: (e) => setError(errorInfo(e)) }); }}>Make the standard folders</button>}
          {folders.length > 0 && <Tree nodes={folders} chosen={folder} onChoose={(id) => { setFolder(id); setPage(1); setPicked([]); }} />}
          {project && manage && <form className="wf-inline" aria-label="New folder" onSubmit={(e) => { e.preventDefault(); setError(null); mkFolder.mutate({ projectId: Number(project), ...(folder ? { parentId: folder } : {}), name: newFolder }, { onSuccess: () => { setNewFolder(''); setNotice('Folder made.'); }, onError: (er) => setError(errorInfo(er)) }); }}>
            <Field label={folder ? 'New folder inside the chosen one' : 'New folder'} name="name" error={error}><input value={newFolder} maxLength={80} onChange={(e) => setNewFolder(e.target.value)} /></Field><button type="submit" className="btn btn-small" disabled={!newFolder.trim()}>Add</button></form>}
        </aside>
        <div>
          <form className="srch-form" role="search" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
            <label className="field"><span>Type</span><select value={filters.docType} onChange={(e) => set({ docType: e.target.value })}><option value="">Any type</option>{(types.data?.types ?? []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></label>
            <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field"><span>Confidentiality</span><select value={filters.confidentiality} onChange={(e) => set({ confidentiality: e.target.value })}><option value="">Any</option>{Object.entries(LEVELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field"><span>Valid for less than</span><select value={filters.expiring} onChange={(e) => set({ expiring: e.target.value })}><option value="">No limit</option><option value="30">30 days</option><option value="90">90 days</option><option value="0">Already expired</option></select></label>
            <label className="field"><span>Words</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
            <label className="field"><span><input type="checkbox" checked={filters.checkedOut} onChange={(e) => set({ checkedOut: e.target.checked })} /> Checked out</span></label>
            <label className="field"><span>Order</span><select value={filters.sort} onChange={(e) => set({ sort: e.target.value })}><option value="newest">Newest first</option><option value="number">Number</option><option value="title">Title</option><option value="expiry">Expiry</option><option value="updated">Last changed</option></select></label>
            {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
          </form>
          {picked.length > 0 && <div className="srch-tools" role="group" aria-label="For the chosen documents"><span>{picked.length} chosen</span><button type="button" className="btn" onClick={zip}>Download as a zip</button><button type="button" className="btn" onClick={() => setPicked([])}>Clear the choice</button></div>}
          {list.isPending && <Skeleton label="Loading the register" rows={4} />}
          {list.isError && list.error?.status !== 403 && <ErrorState title="The register could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
          {d && (d.rows.length === 0 ? <EmptyState title="No document here" message="Documents appear here when they are registered. Change the filters, choose another folder, or register one." action={can(session, 'doc.document.create') ? { label: 'New document', onClick: () => navigateTo('/documents/new') } : undefined} /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Documents">
              <table className="grid">
                <thead><tr><th><span className="sr-only">Choose</span></th><th>Number</th><th>Title</th><th>Type</th><th>Rev</th><th>Status</th><th>Confidentiality</th><th>Valid until</th><th>Holder</th></tr></thead>
                <tbody>{d.rows.map((r) => (
                  <tr key={r.id} data-testid={`doc-${r.id}`}>
                    <td data-label="Choose"><input type="checkbox" aria-label={`Choose ${r.docNo}`} checked={picked.includes(r.id)} onChange={() => setPicked(picked.includes(r.id) ? picked.filter((x) => x !== r.id) : [...picked, r.id])} /></td>
                    <th scope="row" data-label="Number"><Link to={docLink(r.id)}>{r.docNo}</Link></th>
                    <td data-label="Title">{r.title}<br /><span className="muted small">{r.discipline ?? ''}</span></td><td data-label="Type">{r.typeName}</td><td data-label="Rev">{r.revision ?? '—'}</td>
                    <td data-label="Status"><StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} /></td><td data-label="Confidentiality">{LEVELS[r.confidentiality]}</td>
                    <td data-label="Valid until">{r.validUntil ? formatDate(r.validUntil) : ''}{r.daysToExpiry !== null && r.daysToExpiry < 0 ? <span className="error small"> expired</span> : r.daysToExpiry !== null && r.daysToExpiry <= 30 ? <span className="small"> {r.daysToExpiry} day(s)</span> : ''}</td>
                    <td data-label="Holder">{r.checkedOutBy ? <StatusBadge status="returned" label={`Checked out: ${r.checkedOutBy}`} /> : ''}</td>
                  </tr>))}</tbody>
              </table>
            </div>))}
          <div className="pager"><span>{d?.total ?? 0} document(s), page {page} of {pages}</span>
            <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
        </div>
      </div>
    </section>
  );
}
