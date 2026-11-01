import { useState } from 'react';
import { fetchAllDrafts, useDiscardDrafts, useMyDrafts } from './api.js';
import { downloadCsv, navigateTo, Pager, QueryState, usePageTitle } from '../core/pages/ui.jsx';
import Icon from '../../platform/design/Icon.jsx';
import { formatDateTime, toCsv } from '../../platform/format.js';
import { formPageFor } from '../../platform/forms/index.js';

const SAVED_BY = { autosave: 'Kept automatically', blur: 'Kept on leaving a field', manual: 'Saved by you' };

/**
 * My Drafts (part 03.02, FR-07): every form a person left unfinished, on any device, newest first. Resume opens the form with the draft
 * waiting; discard removes drafts (one or many). Only the person's own drafts are ever listed.
 */
export default function MyDraftsPage() {
  usePageTitle('My Drafts');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [formCode, setFormCode] = useState('');
  const [sort, setSort] = useState('-savedAt');
  const [selected, setSelected] = useState(() => new Set());
  const [notice, setNotice] = useState('');
  const list = useMyDrafts({ page, pageSize, q, sort, formCode });
  const discard = useDiscardDrafts();
  const rows = list.data?.data ?? [];
  const forms = list.data?.forms ?? [];
  const allChosen = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const remove = async (ids) => {
    if (!window.confirm(`Discard ${ids.length === 1 ? 'this draft' : `${ids.length} drafts`}? This cannot be undone.`)) return;
    try {
      const r = await discard.mutateAsync(ids);
      setSelected(new Set());
      setNotice(`${r.discarded} draft(s) discarded.${r.notFound ? ` ${r.notFound} had already gone (saved or discarded elsewhere).` : ''}`);
    } catch (err) {
      setNotice(`${err.message}${err.correlationId ? ` (Correlation ID ${err.correlationId})` : ''}`);
    }
  };
  const exportCsv = async () => {
    const all = await fetchAllDrafts({ q, formCode });
    downloadCsv('my-drafts.csv', toCsv(['Form', 'Title', 'Record', 'Saved at', 'How', 'Size (KB)'], all.map((d) => [d.formName, d.title, d.entityKey || 'new', formatDateTime(d.savedAt), SAVED_BY[d.savedBy], Math.ceil(d.bytes / 1024)])));
  };
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">My account &rsaquo; My Drafts</nav>
      <div className="page-head"><h1 id="page-title">My Drafts</h1></div>
      <p className="muted">Forms you started and have not saved yet. A draft is kept every 30 seconds while you type and whenever you leave a field, so it survives a closed tab, a crashed browser or a change of device.</p>
      <p role="status" className="notice" data-testid="drafts-notice">{notice}</p>
      <div className="toolbar">
        <input type="search" aria-label="Search drafts" placeholder="Search title or form" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select aria-label="Form" value={formCode} onChange={(e) => { setFormCode(e.target.value); setPage(1); }}>
          <option value="">Form: any</option>
          {forms.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="-savedAt">Most recent first</option><option value="savedAt">Oldest first</option><option value="title">Title</option><option value="formCode">Form</option>
        </select>
        <select aria-label="Rows per page" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
        </select>
        <button type="button" className="btn" onClick={exportCsv} disabled={!rows.length}><Icon name="erp.action.export" size={16} />Export CSV</button>
        {selected.size > 0 && <button type="button" className="btn" onClick={() => remove([...selected])} disabled={discard.isPending}><Icon name="erp.action.delete" size={16} />Discard {selected.size} selected</button>}
      </div>
      <QueryState query={list} what="your drafts" permission="a signed-in account" />
      {list.data && rows.length === 0 && (
        <div className="state">
          <h2>{q || formCode ? 'No drafts match' : 'No drafts'}</h2>
          <p>{q || formCode ? 'Change the search or the form filter.' : 'When you start a form and leave it unfinished, it waits here.'}</p>
          {!q && !formCode && <button type="button" className="btn btn-primary" onClick={() => navigateTo('/admin/sample-requests?new=1')}>Start a sample material request</button>}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="visually-hidden">My drafts</caption>
              <thead>
                <tr>
                  <th scope="col"><input type="checkbox" aria-label="Select every draft on this page" checked={allChosen} onChange={() => setSelected(allChosen ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                  <th scope="col">Form</th><th scope="col">Title</th><th scope="col">Record</th><th scope="col">Saved</th><th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const to = formPageFor(d.formCode, d.entityKey);
                  return (
                    <tr key={d.id} data-testid={`draft-${d.id}`}>
                      <td data-label="Select"><input type="checkbox" aria-label={`Select the draft ${d.title || d.formName}`} checked={selected.has(d.id)} onChange={() => toggle(d.id)} /></td>
                      <td data-label="Form">{d.formName}</td>
                      <td data-label="Title">{d.title || <span className="muted">Untitled</span>}</td>
                      <td data-label="Record">{d.entityKey ? `Changes to #${d.entityKey}` : 'New'}</td>
                      <td data-label="Saved">{formatDateTime(d.savedAt)}<br /><span className="muted small">{SAVED_BY[d.savedBy]}</span></td>
                      <td data-label="Actions">
                        <span className="actions">
                          {to ? <button type="button" className="btn btn-small btn-primary" onClick={() => navigateTo(to)}>Resume</button> : <span className="muted small">Form not available here</span>}
                          <button type="button" className="btn btn-small" onClick={() => remove([d.id])} aria-label={`Discard the draft ${d.title || d.formName}`}>Discard</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="drafts" />
        </>
      )}
    </section>
  );
}
