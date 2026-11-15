import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { parseSorRows, rates } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Schedule of Rates (Administration, part 06.06, FR-02): the books (CPWD DSR, state PWD and client SORs) in editions, and the items of the chosen edition with search. The estimator creates a book, adds
// its items (pasted from a spreadsheet, or the Excel import "Schedule of rates items") to the draft edition, puts it in use (the previous edition is superseded) and starts a new edition for the next year.
// An analysis links to an item of an active edition to compare its rate (FR-06).
const STATUS = { DRAFT: ['DRAFT', 'Draft'], ACTIVE: ['ACTIVE', 'In use'], SUPERSEDED: ['ARCHIVED', 'Superseded'] };
export default function SchedulesOfRatesPage() {
  usePageTitle('Schedule of Rates');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mdm', 'rates', 'books'], queryFn: rates.books, retry: false });
  const [sel, setSel] = useState(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const book = useQuery({ queryKey: ['mdm', 'rates', 'book', sel, search], queryFn: () => rates.book(sel, { q: search || undefined }), enabled: Boolean(sel), retry: false });
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what="the schedules of rates" permission="mdm.analyse.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the schedules" rows={4} />;
  const d = q.data;
  const run = async (fn, msg) => { setError(null); try { const out = await fn(); setNote(msg(out)); qc.invalidateQueries({ queryKey: ['mdm', 'rates'] }); return out; } catch (err) { setError(errorInfo(err)); return null; } };
  const create = async (e) => { e.preventDefault(); const out = await run(() => rates.createBook({ code: form.code, name: form.name, authority: form.authority, year: Number(form.year), region: form.region || null }), (b) => `Created ${b.code} (draft). Add its items, then put it in use.`); if (out) { setForm(null); setSel(out.id); } };
  const rows = parseSorRows(text);
  const b = book.data;
  return (
    <section aria-labelledby="sor-title" data-testid="schedules-of-rates" className="fin-page">
      <PageHeader id="sor-title" title={"Schedule of Rates"} actions={<>{d.canEdit && <div className="actions-row"><button type="button" className="btn btn-primary btn-small" onClick={() => { setError(null); setForm({ code: '', name: '', authority: 'CPWD', year: new Date().getFullYear(), region: '' }); }} data-testid="sor-new">New schedule</button><Link to="/import">Import items from Excel</Link></div>}</>} />
      {note && <p className="mdm-banner" role="status" data-testid="sor-note">{note}</p>}
      {error?.form && !form && <p className="field-error" role="alert" data-testid="sor-error">{error.form}</p>}
      {form && (
        <form onSubmit={create} aria-label="New schedule" className="fin-form" data-testid="sor-form">
          <div className="mdm-fields">
            <Field label="Code (required)" name="code" error={error} hint="For example DSR-DL"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} data-testid="sor-f-code" /></Field>
            <Field label="Name (required)" name="name" error={error}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="sor-f-name" /></Field>
            <Field label="Authority" name="authority" error={error}><select value={form.authority} onChange={(e) => setForm({ ...form, authority: e.target.value })}>{d.authorities.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}</select></Field>
            <Field label="Year (required)" name="year" error={error}><input inputMode="numeric" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} data-testid="sor-f-year" /></Field>
            <Field label="State" name="region" error={error}><input value={form.region} maxLength={3} onChange={(e) => setForm({ ...form, region: e.target.value.toUpperCase() })} /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert">{error.form}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="sor-f-save">Create</button></div>
        </form>
      )}
      {d.rows.length === 0 ? <EmptyState title="No schedule yet" message={d.canEdit ? 'Create a schedule (for example CPWD DSR 2025) and load its items.' : 'The estimator keeps the schedules of rates.'} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Schedules"><table className="grid"><thead><tr><th>Schedule</th><th>Authority</th><th>Year</th><th>Edition</th><th>State</th><th className="num">Items</th><th>Status</th></tr></thead>
          <tbody>{d.rows.map((x) => <tr key={x.id} className={sel === x.id ? 'is-selected' : ''} data-testid="sor-book"><th scope="row" data-label="Schedule"><button type="button" className="btn btn-small" onClick={() => { setSel(x.id); setSearch(''); setText(''); }} data-testid="sor-open">{x.code}</button> {x.name}</th><td data-label="Authority">{x.authorityLabel}</td><td data-label="Year">{x.year}</td><td data-label="Edition">{x.edition}</td><td data-label="State">{x.region ?? '—'}</td><td className="num" data-label="Items">{x.items}</td><td data-label="Status"><StatusBadge status={STATUS[x.status][0]} label={STATUS[x.status][1]} /></td></tr>)}</tbody></table></div>)}
      {sel && (book.isPending ? <Skeleton label="Loading the items" rows={4} /> : book.isError ? <ErrorState error={book.error} onRetry={book.refetch} /> : (
        <div data-testid="sor-detail">
          <h2>{b.code} {b.year} edition {b.edition}: {b.name}</h2>
          <div className="actions-row">
            {b.status === 'DRAFT' && d.canEdit && <button type="button" className="btn btn-primary btn-small" disabled={!b.items} onClick={() => run(() => rates.activate(b.id, 'Edition put in use'), (x) => `${x.code} edition ${x.edition} is in use.`)} data-testid="sor-activate">Put in use</button>}
            {b.status !== 'DRAFT' && d.canEdit && <button type="button" className="btn btn-small" onClick={async () => { const x = await run(() => rates.newEdition(b.id, { year: b.year + 1 }), (y) => `Edition ${y.edition} (${y.year}) is a draft with ${y.items} items; change it, then put it in use.`); if (x) setSel(x.id); }} data-testid="sor-edition">New edition</button>}
          </div>
          {b.canEdit && (
            <div className="fin-form" data-testid="sor-paste">
              <Field label="Paste items (item code, description, unit, rate[, parent code]) from a spreadsheet" name="items" error={error}><textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} data-testid="sor-text" /></Field>
              <div className="actions-row"><button type="button" className="btn btn-small" disabled={!rows.length} onClick={async () => { const x = await run(() => rates.putItems(b.id, { items: rows }), (y) => `${y.added} added, ${y.changed} replaced.`); if (x) setText(''); }} data-testid="sor-add">Add {rows.length} item{rows.length === 1 ? '' : 's'}</button></div>
            </div>)}
          <div className="filters" role="search"><label>Search <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item code or words" data-testid="sor-q" /></label></div>
          {b.rows.length === 0 ? <EmptyState title="No item" message={b.canEdit ? 'Paste the items above or import them from Excel.' : 'No item matches.'} /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Items"><table className="grid"><thead><tr><th>Item</th><th>Description</th><th>Unit</th><th className="num">Rate (₹)</th></tr></thead>
              <tbody>{b.rows.map((s) => <tr key={s.id} data-testid="sor-item"><th scope="row" data-label="Item">{s.itemCode}</th><td data-label="Description" style={{ paddingInlineStart: s.parentCode ? '1.5rem' : undefined }}>{s.description}</td><td data-label="Unit">{s.uom ?? ''}</td><td className="num" data-label="Rate (₹)">{s.rate != null ? Number(s.rate).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : ''}</td></tr>)}</tbody></table></div>)}
          {b.total > b.rows.length && <p className="muted small">{b.rows.length} of {b.total} shown; search to narrow.</p>}
        </div>))}
    </section>
  );
}
