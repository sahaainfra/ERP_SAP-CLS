import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { Field, Link, downloadCsv, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { mdm, todayIST } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// The register of one common master (part 06.02): units, GST rates, HSN/SAC, TDS sections, states (with districts), currencies (with exchange rates), banks, payment terms, lookup lists. One page component
// driven by the master's definition from the server: filters, search, "as of" for the dated masters, the rows with their source (system or the company's own) and dates, a form to add or change a row, and the
// history of a row with its change requests. A statutory master (GST, HSN/SAC, TDS) is changed by a proposal from a date, approved by an accounts manager and the CFO (it says so before sending).
// Import and export go through the Excel engine (04.13) with this master's import type; Export CSV downloads the rows on screen with the filters.
const PAGES = {
  uom: { title: 'Units of Measure', masters: ['uom'] },
  'gst-rates': { title: 'GST Rates', masters: ['gst-rates'] },
  'hsn-sac': { title: 'HSN/SAC Codes', masters: ['hsn-sac'] },
  'tds-sections': { title: 'TDS/TCS Sections', masters: ['tds-sections'] },
  states: { title: 'States & Places of Supply', masters: ['states', 'districts'] },
  currencies: { title: 'Currencies & Exchange Rates', masters: ['currencies', 'exchange-rates'] },
  banks: { title: 'Banks & IFSC', masters: ['banks'] },
  'payment-terms': { title: 'Payment & Delivery Terms', masters: ['payment-terms'] },
  lookups: { title: 'Lookup Lists', masters: ['lookup-lists', 'lookups'] },
  'tds-forms': { title: 'TDS Forms', masters: ['tds-forms'] },
  'statutory-calendar': { title: 'Statutory Calendar', masters: ['statutory-calendar'] },
  'labour-rules': { title: 'Labour Code Rules', masters: ['labour-rules'] },
  'pay-components': { title: 'Pay Components', masters: ['pay-components'] },
};
const IMPORT = { uom: 'MDM_UOM', 'gst-rates': 'MDM_GST_RATE', 'hsn-sac': 'MDM_HSN_SAC', 'tds-sections': 'MDM_TDS_SECTION', states: 'MDM_STATE', districts: 'MDM_DISTRICT', currencies: 'MDM_CURRENCY', 'exchange-rates': 'MDM_EXCHANGE_RATE', banks: 'MDM_BANK', 'payment-terms': 'MDM_PAYMENT_TERM', lookups: 'MDM_LOOKUP' };
const show = (fd, v) => (v == null || v === '' ? '—' : fd.type === 'bool' ? (v ? 'Yes' : 'No') : fd.type === 'percent' ? `${v}%` : fd.type === 'money' ? `₹${Number(v).toLocaleString('en-IN')}` : fd.type === 'json' ? (v.length ? v.map((m) => `${m.label} ${m.pct}% (${m.days} d)`).join('; ') : '—') : fd.type === 'enum' ? (fd.options.find(([k]) => k === v)?.[1] ?? v) : String(v));

/** @param {{ page: string }} props */
export default function CommonMasterPage({ page }) {
  const p = PAGES[page];
  usePageTitle(p.title);
  const cat = useQuery({ queryKey: ['mdm', 'common', 'catalogue'], queryFn: mdm.catalogue, retry: false });
  if (cat.error?.status === 403) return <NoPermission what="the common masters" permission="mdm.record.view" />;
  if (cat.isError) return <ErrorState error={cat.error} onRetry={cat.refetch} />;
  if (cat.isPending) return <Skeleton label={`Loading ${p.title}`} rows={4} />;
  const defs = p.masters.map((m) => cat.data.rows.find((d) => d.code === m));
  if (defs.some((d) => !d)) return <EmptyState title={`${p.title} is not enabled for your company`} message="The master is switched on with its feature flag." />;
  return (
    <section aria-labelledby="cm-title" data-testid={`cm-page-${page}`}>
      <PageHeader id="cm-title" title={p.title} />
      {defs[0].approval && <p className="mdm-banner" role="note">A change of {defs[0].label} applies from a date and is approved by an accounts manager and then the CFO. A document dated before the change keeps the rate it had.</p>}
      {defs.map((d, i) => <Register key={d.code} def={d} sub={i > 0} />)}
      {page === 'lookups' && cat.data.rows.find((d) => d.code === 'lookups').canEdit && <p><Link to="/admin/master-data/lookup-manager">Open the Lookup List Manager</Link> to edit a list's values with their Hindi labels.</p>}
    </section>
  );
}

function Register({ def, sub }) {
  const [f, setF] = useState({ q: '', asOf: '', status: 'current', filter: '', offset: 0, limit: 25 });
  const filterKey = def.filters[0];
  const filterField = def.fields.find((x) => x.key === filterKey);
  const params = { q: f.q, asOf: def.dated ? f.asOf : undefined, status: f.status, ...(filterKey && f.filter ? { [filterKey]: f.filter } : {}), limit: f.limit, offset: f.offset };
  const q = useQuery({ queryKey: ['mdm', 'common', def.code, params], queryFn: () => mdm.common(def.code, params), retry: false, placeholderData: (x) => x });
  const [open, setOpen] = useState(null);
  const formRef = useRef(null);
  const set = (x) => setF((cur) => ({ ...cur, offset: 0, ...x }));
  const cols = def.fields.filter((x) => x.type !== 'json' || def.code === 'payment-terms').slice(0, 8);
  const exportCsv = async () => {
    const all = await mdm.common(def.code, { ...params, limit: 200, offset: 0 });
    const head = [...def.fields.map((x) => x.label), 'Applies from', 'Applies until', 'Source'];
    const esc = (v) => { const s = String(v ?? ''); const t = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    downloadCsv(`${def.code}.csv`, [head, ...all.rows.map((r) => [...def.fields.map((x) => (x.type === 'json' ? JSON.stringify(r[x.key]) : r[x.key])), r.effectiveFrom, r.effectiveTo, r.system ? 'System' : 'Company'])].map((row) => row.map(esc).join(',')).join('\n'));
  };
  const H = sub ? 'h2' : 'h2';
  return (
    <section aria-labelledby={`cm-${def.code}`} className={sub ? 'mdm-card' : ''} data-testid={`cm-${def.code}`}>
      <div className="page-head"><H id={`cm-${def.code}`}>{def.label}</H>
        {def.canEdit && <button type="button" className="btn btn-primary" onClick={() => formRef.current?.open(null)} data-testid={`cm-new-${def.code}`}>{def.approval ? 'Propose a new row' : 'New'}</button>}
        {IMPORT[def.code] && <span className="small"><Link to="/import">Import or export Excel</Link> <span className="muted">(choose “{def.label} (master data)”)</span></span>}
        <button type="button" className="btn" onClick={exportCsv} data-testid={`cm-csv-${def.code}`}>Export CSV</button>
      </div>
      <form className="srch-form" role="search" aria-label={`Filter ${def.label}`} onSubmit={(e) => e.preventDefault()}>
        <Field label="Search" name="q" error={null}><input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} data-testid={`cm-q-${def.code}`} /></Field>
        {filterField && <Field label={filterField.label} name="filter" error={null}>{filterField.options ? <select value={f.filter} onChange={(e) => set({ filter: e.target.value })}><option value="">All</option>{filterField.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : <input value={f.filter} onChange={(e) => set({ filter: e.target.value.toUpperCase() })} placeholder="Code" data-testid={`cm-filter-${def.code}`} />}</Field>}
        {def.dated && <Field label="As of" name="asOf" error={null} hint="The rows in force on that date"><input type="date" value={f.asOf} onChange={(e) => set({ asOf: e.target.value })} data-testid={`cm-asof-${def.code}`} /></Field>}
        <Field label="Show" name="status" error={null}><select value={f.status} onChange={(e) => set({ status: e.target.value })} data-testid={`cm-status-${def.code}`}><option value="current">In force</option>{def.approval && <option value="pending">Waiting for approval</option>}<option value="all">All, with ended and rejected</option></select></Field>
      </form>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label={`Loading ${def.label}`} rows={3} /> : q.data.rows.length === 0 ? <EmptyState compact title="Nothing here" message={f.q || f.filter ? 'Nothing matches these filters.' : def.canEdit ? `Add the first row with ${def.approval ? 'Propose a new row' : 'New'}, or import a file.` : 'No rows yet.'} /> : (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={def.label}><table className="grid"><thead><tr>{cols.map((x) => <th key={x.key} className={['percent', 'money', 'rate', 'int', 'decimal'].includes(x.type) ? 'num' : ''}>{x.label}</th>)}{def.dated && <th>Applies</th>}<th>Source</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{q.data.rows.map((r) => (
              <tr key={r.id} data-testid={`cm-row-${def.code}`}>
                {cols.map((x, i) => (i === 0 ? <th key={x.key} scope="row" data-label={x.label}>{show(x, r[x.key])}</th> : <td key={x.key} data-label={x.label} className={['percent', 'money', 'rate', 'int', 'decimal'].includes(x.type) ? 'num' : ''}>{show(x, r[x.key])}</td>))}
                {def.dated && <td data-label="Applies">{formatDate(r.effectiveFrom)}{r.effectiveTo ? ` to ${formatDate(r.effectiveTo)}` : ' onwards'}{r.status !== 'ACTIVE' && <> <StatusBadge status={r.status === 'PENDING' ? 'IN_REVIEW' : r.status} label={r.status === 'PENDING' ? 'Waiting for approval' : r.status.toLowerCase()} /></>}</td>}
                <td data-label="Source">{r.system ? 'System' : 'Company'}{!def.dated && r.status !== 'ACTIVE' ? ` · ${r.status.toLowerCase()}` : ''}</td>
                <td><button type="button" className="btn btn-small" onClick={() => setOpen(r.id)} data-testid={`cm-open-${def.code}`}>{def.canEdit ? 'Open' : 'View'}</button></td>
              </tr>))}</tbody></table></div>
          <div className="pager"><span>{q.data.total} row(s){q.data.asOf ? ` in force on ${formatDate(q.data.asOf)}` : ''}</span><button type="button" className="btn" disabled={f.offset === 0} onClick={() => setF({ ...f, offset: Math.max(0, f.offset - f.limit) })}>Previous</button><button type="button" className="btn" disabled={f.offset + f.limit >= q.data.total} onClick={() => setF({ ...f, offset: f.offset + f.limit })}>Next</button>
            <label className="check">Rows <select value={f.limit} onChange={(e) => setF({ ...f, offset: 0, limit: Number(e.target.value) })}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>
        </>
      )}
      {open && <RowPanel def={def} id={open} onClose={() => setOpen(null)} onEdit={(row) => formRef.current?.open(row)} />}
      <RowForm ref={formRef} def={def} />
    </section>
  );
}

function RowPanel({ def, id, onClose, onEdit }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mdm', 'common', def.code, 'row', id], queryFn: () => mdm.commonRow(def.code, id), retry: false });
  const [error, setError] = useState(null);
  if (q.isPending) return <aside className="mdm-panel"><Skeleton label="Loading the row" rows={2} /></aside>;
  if (q.isError) return <aside className="mdm-panel"><ErrorState error={q.error} onRetry={q.refetch} /></aside>;
  const r = q.data;
  const retire = async () => { const why = window.prompt('Why is this row no longer used?') ?? ''; if (why.trim().length < 5) return; setError(null); try { await mdm.commonRetire(def.code, id, { reason: why.trim(), version: r.rowVersion }); qc.invalidateQueries({ queryKey: ['mdm', 'common'] }); onClose(); } catch (e) { setError(errorInfo(e)); } };
  return (
    <aside className="mdm-panel" aria-labelledby="cmr-title" data-testid="cm-panel">
      <div className="page-head"><h3 id="cmr-title">{def.key.map((k) => r[k]).join(' / ')}</h3><span className="muted small">{r.system ? 'System row (a change makes your company its own copy)' : 'Your company\'s row'}</span><button type="button" className="btn btn-small" onClick={onClose}>Close</button></div>
      <dl className="kv-list">{def.fields.map((x) => <div className="kv" key={x.key}><dt>{x.label}</dt><dd data-testid={`cmr-${x.key}`}>{show(x, r[x.key])}</dd></div>)}<div className="kv"><dt>Applies</dt><dd>{formatDate(r.effectiveFrom)}{r.effectiveTo ? ` to ${formatDate(r.effectiveTo)}` : ' onwards'}</dd></div></dl>
      <div className="actions-row">
        {r.canEdit && r.status === 'ACTIVE' && <button type="button" className="btn btn-primary" onClick={() => onEdit(r)} data-testid="cmr-change">{def.approval ? 'Propose a change from a date' : 'Change'}</button>}
        {r.canEdit && r.status === 'ACTIVE' && !def.approval && <button type="button" className="btn" onClick={retire} data-testid="cmr-retire">No longer used</button>}
      </div>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {r.history.length > 1 && <><h4>History</h4><div className="table-wrap" tabIndex={0} role="region" aria-label="History"><table className="grid"><thead><tr><th>Applies from</th><th>Until</th><th>State</th><th>Source</th>{def.fields.filter((x) => !def.key.includes(x.key)).slice(0, 4).map((x) => <th key={x.key}>{x.label}</th>)}</tr></thead>
        <tbody>{r.history.map((h) => <tr key={h.id} data-testid="cmr-history"><td data-label="Applies from">{formatDate(h.effectiveFrom)}</td><td data-label="Until">{h.effectiveTo ? formatDate(h.effectiveTo) : '—'}</td><td data-label="State">{h.status.toLowerCase()}</td><td data-label="Source">{h.system ? 'System' : 'Company'}</td>{def.fields.filter((x) => !def.key.includes(x.key)).slice(0, 4).map((x) => <td key={x.key} data-label={x.label}>{show(x, h[x.key])}</td>)}</tr>)}</tbody></table></div></>}
      {r.requests.length > 0 && <><h4>Change requests</h4><ul className="mdm-list">{r.requests.map((c) => <li key={c.id}><Link to={`/admin/master-data/change-requests?view=all&open=${c.id}`}>#{c.id} from {formatDate(c.effectiveFrom)}</Link> · {c.status.toLowerCase()} · {c.justification}</li>)}</ul></>}
    </aside>
  );
}

/** Add or change a row. The fields follow the master's definition; a statutory change asks for its date and a justification. */
function RowForm({ ref, def }) {
  const qc = useQueryClient();
  const dlg = useRef(null);
  const [row, setRow] = useState(null);
  const [data, setData] = useState({});
  const [meta, setMeta] = useState({ effectiveFrom: todayIST(), justification: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  if (ref) ref.current = { open: (r) => { setRow(r); setData(r ? Object.fromEntries(def.fields.map((x) => [x.key, x.type === 'json' ? JSON.stringify(r[x.key] ?? []) : r[x.key] ?? ''])) : { ...(def.code === 'lookups' ? { active: true } : {}) }); setMeta({ effectiveFrom: todayIST(), justification: '' }); setError(null); setDone(null); dlg.current?.showModal(); } };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    const payload = {};
    for (const x of def.fields) {
      if (row && def.key.includes(x.key)) continue;
      let v = data[x.key];
      if (x.type === 'json') { try { v = v ? JSON.parse(v) : []; } catch { setError({ form: `${x.label}: write the milestones as a list, for example [{"label":"On delivery","pct":80,"days":0}]`, fields: { [x.key]: 'not a list' } }); setBusy(false); return; } }
      if (x.type === 'int' && v !== '' && v != null) v = Number(v);
      if (row && String(v ?? '') === String(x.type === 'json' ? JSON.stringify(row[x.key] ?? []) : row[x.key] ?? '')) continue;
      payload[x.key] = v === '' ? null : v;
    }
    try {
      const out = row ? await mdm.commonUpdate(def.code, row.id, { data: payload, version: row.rowVersion, ...(def.approval ? { effectiveFrom: meta.effectiveFrom } : {}), justification: meta.justification || undefined })
        : await mdm.commonCreate(def.code, { data: payload, ...(def.approval ? { effectiveFrom: meta.effectiveFrom } : {}), justification: meta.justification || undefined });
      qc.invalidateQueries({ queryKey: ['mdm'] });
      setDone(out.applied ? 'Saved.' : `Sent for approval (request ${out.changeRequestId}): an accounts manager and then the CFO approve it. It applies from ${formatDate(out.effectiveFrom)}.`);
    } catch (err) { setError(errorInfo(err)); } finally { setBusy(false); }
  };
  const input = (x) => {
    const common = { name: x.key, value: data[x.key] ?? '', onChange: (e) => setData({ ...data, [x.key]: x.type === 'bool' ? e.target.checked : e.target.value }), required: x.required, disabled: Boolean(row) && def.key.includes(x.key), 'data-testid': `cmf-${x.key}`, 'aria-invalid': Boolean(error?.fields?.[x.key]) };
    if (x.type === 'enum') return <select {...common}><option value="">Choose</option>{x.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
    if (x.type === 'bool') return <input type="checkbox" {...common} value={undefined} checked={Boolean(data[x.key])} />;
    if (x.type === 'date') return <input type="date" {...common} />;
    if (x.type === 'json') return <textarea rows="3" {...common} />;
    if (x.type === 'ref') return <RefSelect refCode={x.ref} {...common} />;
    return <input inputMode={['percent', 'money', 'rate', 'int', 'decimal'].includes(x.type) ? 'decimal' : undefined} maxLength={x.max ?? undefined} autoComplete="off" {...common} />;
  };
  return (
    <dialog ref={dlg} className="dialog dialog-wide" aria-labelledby={`cmf-title-${def.code}`} data-testid={`cm-form-${def.code}`}>
      <form onSubmit={submit}>
        <h2 id={`cmf-title-${def.code}`}>{row ? `Change ${def.key.map((k) => row[k]).join(' / ')}` : `New: ${def.label.toLowerCase()}`}</h2>
        {done ? <><p role="status" data-testid="cmf-done">{done}</p><div className="actions"><button type="button" className="btn btn-primary" onClick={() => dlg.current?.close()}>Close</button></div></> : <>
          {row?.system && !def.approval && <p className="muted small">This is a system row: saving makes your company's own copy; other companies keep the system row.</p>}
          <div className="mdm-fields">{def.fields.map((x) => <Field key={x.key} label={`${x.label}${x.required ? ' (required)' : ''}`} name={x.key} error={error} hint={x.hint}>{input(x)}</Field>)}</div>
          {def.approval && <Field label="Applies from (required)" name="effectiveFrom" error={error} hint={row ? `After ${formatDate(row.effectiveFrom)}, the date of the current row` : null}><input type="date" value={meta.effectiveFrom} required onChange={(e) => setMeta({ ...meta, effectiveFrom: e.target.value })} data-testid="cmf-from" /></Field>}
          <Field label={def.approval ? 'Justification (required: the notification or the reason, min 10 characters)' : 'Reason (optional)'} name="justification" error={error}><textarea rows="2" value={meta.justification} required={def.approval} minLength={def.approval ? 10 : undefined} maxLength={500} onChange={(e) => setMeta({ ...meta, justification: e.target.value })} data-testid="cmf-why" /></Field>
          {error?.form && <p className="field-error" role="alert" data-testid="cmf-error">{error.form}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy} data-testid="cmf-submit">{busy ? 'Saving...' : def.approval ? 'Send for approval' : 'Save'}</button></div>
        </>}
      </form>
    </dialog>
  );
}

function RefSelect({ refCode, ...props }) {
  const q = useQuery({ queryKey: ['mdm', 'common', refCode, 'options'], queryFn: () => mdm.common(refCode, { limit: 200, offset: 0 }), retry: false, staleTime: 60_000 });
  const keyOf = (r) => r.code ?? r.section;
  return <select {...props}><option value="">Choose</option>{(q.data?.rows ?? []).map((r) => <option key={r.id} value={keyOf(r)}>{keyOf(r)} {r.name ?? r.description ?? ''}</option>)}</select>;
}
