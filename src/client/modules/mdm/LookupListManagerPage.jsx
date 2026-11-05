import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { mdm } from './api.js';

// Lookup List Manager (Administration, part 06.02, FR-08): choose a list (priorities, document categories, disciplines, trades, skills, defect categories, delay causes, weather types, incident types and
// any list added under Lookup Lists), edit its values with their Hindi labels and order in a grid, add a value, switch one off. Saving sends the whole list with a reason: new values are added, changed ones
// updated, removed ones made inactive (never deleted, so old records keep their code). The system administrator keeps the lists; a value shows in Hindi to people who work in Hindi.
const blank = () => ({ code: '', labelEn: '', labelHi: '', sortOrder: null, active: true, isNew: true });
export default function LookupListManagerPage() {
  usePageTitle('Lookup List Manager');
  const qc = useQueryClient();
  const lists = useQuery({ queryKey: ['mdm', 'lists'], queryFn: mdm.lists, retry: false });
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('list') ?? '');
  const values = useQuery({ queryKey: ['mdm', 'list', code], queryFn: () => mdm.listValues(code, { all: 'true', lang: 'en' }), enabled: Boolean(code), retry: false });
  const [rows, setRows] = useState([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (values.data) setRows(values.data.rows.map((r) => ({ code: r.code, labelEn: r.labelEn, labelHi: r.labelHi ?? '', sortOrder: r.sortOrder, active: r.active, isNew: false }))); }, [values.data]);
  useEffect(() => { if (!code && lists.data?.rows?.length) setCode(lists.data.rows[0].code); }, [lists.data, code]);
  if (lists.error?.status === 403) return <NoPermission what="the lookup lists" permission="mdm.record.view" />;
  if (lists.isError) return <ErrorState error={lists.error} onRetry={lists.refetch} />;
  if (lists.isPending) return <Skeleton label="Loading the lookup lists" rows={3} />;
  const canEdit = lists.data.canEdit;
  const set = (i, p) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= rows.length) return; const next = [...rows]; [next[i], next[j]] = [next[j], next[i]]; setRows(next); };
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null); setNote(null);
    try {
      const out = await mdm.saveList(code, { values: rows.filter((r) => r.code.trim()).map((r, i) => ({ code: r.code.trim().toUpperCase(), labelEn: r.labelEn.trim(), labelHi: r.labelHi.trim() || null, sortOrder: (i + 1) * 10, active: r.active })), reason });
      setNote(`Saved: ${out.added} added, ${out.changed} changed, ${out.inactivated} made inactive.`); setReason('');
      qc.invalidateQueries({ queryKey: ['mdm'] });
    } catch (err) { setError(errorInfo(err)); } finally { setBusy(false); }
  };
  const list = lists.data.rows.find((l) => l.code === code);
  return (
    <section aria-labelledby="llm-title" data-testid="mdm-lookup-manager">
      <h1 id="llm-title">Lookup List Manager</h1>
      <p className="muted">The values every form offers for these lists. A value is never deleted: switch it off and old records keep showing it.</p>
      <Field label="List" name="list" error={null}><select value={code} onChange={(e) => { setCode(e.target.value); setNote(null); setError(null); }} data-testid="llm-list">{lists.data.rows.map((l) => <option key={l.code} value={l.code}>{l.name} ({l.values})</option>)}</select></Field>
      {list && <p className="muted small">Code {list.code}{list.nameHi ? ` · ${list.nameHi}` : ''}{list.system ? ' · system list' : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="llm-note">{note}</p>}
      {values.isPending && code ? <Skeleton label="Loading the values" rows={4} /> : values.isError ? <ErrorState error={values.error} onRetry={values.refetch} /> : (
        <form onSubmit={save} aria-label="Values of the list">
          {rows.length === 0 ? <EmptyState compact title="No value yet" message="Add the first value." /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Values"><table className="grid"><thead><tr><th>Code</th><th>Label (English)</th><th>Label (Hindi)</th><th>Active</th><th><span className="sr-only">Order</span></th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={`${i}-${r.isNew ? 'n' : r.code}`} className={r.active ? '' : 'muted'} data-testid="llm-row">
                  <th scope="row" data-label="Code">{r.isNew && canEdit ? <input aria-label="Code" value={r.code} maxLength={30} onChange={(e) => set(i, { code: e.target.value.toUpperCase() })} required data-testid="llm-code" /> : r.code}</th>
                  <td data-label="Label (English)">{canEdit ? <input aria-label={`English label of ${r.code || 'the new value'}`} value={r.labelEn} maxLength={80} required onChange={(e) => set(i, { labelEn: e.target.value })} data-testid="llm-en" /> : r.labelEn}</td>
                  <td data-label="Label (Hindi)">{canEdit ? <input aria-label={`Hindi label of ${r.code || 'the new value'}`} lang="hi" value={r.labelHi} maxLength={80} onChange={(e) => set(i, { labelHi: e.target.value })} data-testid="llm-hi" /> : r.labelHi || '—'}</td>
                  <td data-label="Active">{canEdit ? <input type="checkbox" aria-label={`${r.code} active`} checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} /> : r.active ? 'Yes' : 'No'}</td>
                  <td>{canEdit && <><button type="button" className="btn btn-small" aria-label={`Move ${r.code} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button type="button" className="btn btn-small" aria-label={`Move ${r.code} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button></>}</td>
                </tr>))}</tbody></table></div>
          )}
          {canEdit && <>
            <button type="button" className="btn btn-small" onClick={() => setRows([...rows, blank()])} data-testid="llm-add">Add a value</button>
            <Field label="Reason (required, min 5 characters)" name="reason" error={error}><textarea rows="2" value={reason} required minLength={5} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="llm-reason" /></Field>
            {error?.form && <p className="field-error" role="alert" data-testid="llm-error">{error.form}</p>}
            <div className="actions"><button type="button" className="btn" onClick={() => values.refetch()}>Undo changes</button><button type="submit" className="btn btn-primary" disabled={busy} data-testid="llm-save">{busy ? 'Saving...' : 'Save the list'}</button></div>
          </>}
        </form>
      )}
    </section>
  );
}
