import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo } from '../core/pages/ui.jsx';
import { RES_TYPES, pl } from './api.js';

// The labour, plant and material of the selected activity (part 13.02, FR-03): a total or a daily rate (the server works out the other from the duration), chosen from the item master or named by trade,
// or taken from the BOQ norms of the activity's BOQ lines (shown first, saved only when the planner says so). A save is one Gantt edit: it can be undone.
const blankRow = (type = 'LABOUR') => ({ type, itemId: '', trade: '', uom: '', basis: 'TOTAL', qty: '', sourceType: 'MANUAL', label: '' });

function ItemPicker({ t, projectId, row, onPick, i }) {
  const [q, setQ] = useState('');
  const oq = useQuery({ queryKey: ['plan', 'resource-options', projectId, row.type, q], queryFn: () => pl.resourceOptions(projectId, row.type, q), retry: false, staleTime: 60_000 });
  return (
    <>
      <Field label={t('r.find')} name={`rq${i}`}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} data-testid="pres-find" /></Field>
      <Field label={t('r.item')} name={`ri${i}`}><select value={row.itemId} onChange={(e) => { const it = oq.data?.items.find((x) => x.id === Number(e.target.value)); onPick({ itemId: e.target.value, uom: it?.uom ?? row.uom, label: it ? `${it.code} ${it.name}` : '' }); }} data-testid="pres-item"><option value="">{row.type === 'LABOUR' ? t('r.byTrade') : '—'}</option>{row.itemId && !oq.data?.items.some((x) => x.id === Number(row.itemId)) && <option value={row.itemId}>{row.label || row.itemId}</option>}{(oq.data?.items ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>
      {(row.type === 'LABOUR' || !row.itemId) && <Field label={row.type === 'LABOUR' ? t('r.trade') : t('r.class')} name={`rt${i}`}><input value={row.trade} onChange={(e) => onPick({ trade: e.target.value })} list={`pres-trades-${i}`} maxLength={80} data-testid="pres-trade" /><datalist id={`pres-trades-${i}`}>{(oq.data?.trades ?? []).map((x) => <option key={x} value={x} />)}</datalist></Field>}
    </>
  );
}

export default function ResourcesPanel({ activity, projectId, canEdit, onSaved }) {
  const t = useT('plan');
  const q = useQuery({ queryKey: ['plan', 'resources', activity.id], queryFn: () => pl.resources(activity.id), retry: false });
  const [rows, setRows] = useState(null); const [norms, setNorms] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState(null);
  if (q.isPending) return <Skeleton label={t('r.title')} rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const editing = rows !== null;
  const start = () => { setNote(null); setError(null); setRows(r.rows.map((x) => ({ type: x.type, itemId: x.itemId ? String(x.itemId) : '', trade: x.trade ?? '', uom: x.uom, basis: x.basis, qty: String(x.basis === 'TOTAL' ? x.qtyTotal : x.qtyPerDay), sourceType: x.sourceType ?? 'MANUAL', label: x.label }))); };
  const set = (i, patch) => setRows(rows.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const loadNorms = async () => { setError(null); setBusy(true); try { setNorms(await pl.norms(activity.id)); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const useNorms = () => { const base = rows ?? []; const add = norms.rows.filter((n) => !base.some((b) => b.type === n.type && String(b.itemId) === String(n.itemId))).map((n) => ({ type: n.type, itemId: String(n.itemId), trade: n.trade ?? '', uom: n.uom, basis: 'TOTAL', qty: String(n.qty), sourceType: 'BOQ_NORM', label: n.label })); setRows([...base, ...add]); setNorms(null); };
  const save = async () => {
    setError(null); setBusy(true);
    try {
      await pl.saveResources(activity.id, { rows: rows.map((x) => ({ type: x.type, itemId: x.itemId ? Number(x.itemId) : null, trade: x.trade.trim() || null, uom: x.uom.trim() || null, basis: x.basis, qty: Number(x.qty), sourceType: x.sourceType })) });
      setRows(null); setNote(t('r.saved')); await q.refetch(); onSaved?.();
    } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  return (
    <div className="mdm-panel" data-testid="pres-panel" role="region" aria-label={t('r.title')}>
      <h2>{t('r.title')} · {activity.code} <span className="muted">({t('r.duration', { n: r.duration })})</span></h2>
      {note && <p className="mdm-banner" role="status" data-testid="pres-note">{note}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="pres-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {!editing && (r.rows.length === 0 ? <p className="muted" data-testid="pres-empty">{t('r.empty')}</p> : (
        <div className="table-scroll"><table className="data-table" data-testid="pres-table"><caption className="sr-only">{t('r.title')}</caption>
          <thead><tr><th>{t('f.type')}</th><th>{t('f.resource')}</th><th className="num">{t('r.total')}</th><th className="num">{t('r.perDay')}</th><th>{t('f.uom')}</th><th>{t('r.source')}</th></tr></thead>
          <tbody>{r.rows.map((x) => <tr key={x.id} data-testid="pres-row"><td>{t(`r.type.${x.type}`)}</td><td>{x.label}</td><td className="num">{x.qtyTotal.toLocaleString('en-IN')}</td><td className="num">{x.qtyPerDay.toLocaleString('en-IN')}</td><td>{x.uom}</td><td>{t(`r.src.${x.sourceType ?? 'MANUAL'}`)}</td></tr>)}</tbody></table></div>
      ))}
      {canEdit && r.editable && !editing && <div className="actions"><button type="button" className="btn" onClick={start} data-testid="pres-edit">{t('r.edit')}</button></div>}
      {editing && (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} aria-label={t('r.edit')} data-testid="pres-form">
          {rows.length === 0 && <p className="muted">{t('r.none')}</p>}
          {rows.map((x, i) => (
            <fieldset key={i} className="form-grid" data-testid="pres-edit-row"><legend className="sr-only">{t('r.row', { n: i + 1 })}</legend>
              <Field label={t('f.type')} name={`rtype${i}`}><select value={x.type} onChange={(e) => set(i, { type: e.target.value, itemId: '', label: '' })} data-testid="pres-type">{RES_TYPES.map((k) => <option key={k} value={k}>{t(`r.type.${k}`)}</option>)}</select></Field>
              <ItemPicker t={t} projectId={projectId} row={x} i={i} onPick={(p) => set(i, p)} />
              <Field label={t('r.basis')} name={`rb${i}`}><select value={x.basis} onChange={(e) => set(i, { basis: e.target.value })} data-testid="pres-basis"><option value="TOTAL">{t('r.basis.TOTAL')}</option><option value="PER_DAY">{t('r.basis.PER_DAY')}</option></select></Field>
              <Field label={t('f.qty')} name={`rqty${i}`}><input type="number" min="0" step="0.001" value={x.qty} onChange={(e) => set(i, { qty: e.target.value })} required data-testid="pres-qty" /></Field>
              <Field label={t('f.uom')} name={`ru${i}`}><input value={x.uom} onChange={(e) => set(i, { uom: e.target.value })} maxLength={20} data-testid="pres-uom" /></Field>
              <div className="actions"><button type="button" className="btn" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={t('r.remove', { n: i + 1 })}>{t('act.remove')}</button></div>
            </fieldset>
          ))}
          <div className="actions">
            <button type="button" className="btn" onClick={() => setRows([...rows, blankRow(rows.at(-1)?.type)])} data-testid="pres-add">{t('r.add')}</button>
            <button type="button" className="btn" onClick={loadNorms} disabled={busy} data-testid="pres-norms">{t('r.fromBoq')}</button>
            <button type="submit" className="btn btn-primary" disabled={busy || rows.some((x) => !(Number(x.qty) > 0) || (!x.itemId && !x.trade.trim()))} data-testid="pres-save">{t('r.save')}</button>
            <button type="button" className="btn" onClick={() => { setRows(null); setNorms(null); setError(null); }}>{t('act.cancel')}</button>
          </div>
        </form>
      )}
      {norms && (
        <div className="mdm-panel" data-testid="pres-norms-result">
          <h3>{t('r.normsTitle', { n: norms.boqLines })}</h3>
          {norms.rows.length === 0 ? <p className="muted">{t('r.noNorms')}</p> : <ul>{norms.rows.map((n) => <li key={`${n.type}${n.itemId}`}>{t(`r.type.${n.type}`)}: {n.label} — {n.qty.toLocaleString('en-IN')} {n.uom} <span className="muted">({n.from.join(', ')})</span></li>)}</ul>}
          {norms.sources.length > 0 && <p className="muted">{t('r.normsFrom')}: {norms.sources.join('; ')}</p>}
          {norms.missing.length > 0 && <p className="muted">{t('r.normsMissing')}: {norms.missing.join('; ')}</p>}
          <div className="actions">{norms.rows.length > 0 && <button type="button" className="btn btn-primary" onClick={useNorms} data-testid="pres-use-norms">{t('r.useNorms')}</button>}<button type="button" className="btn" onClick={() => setNorms(null)}>{t('act.cancel')}</button></div>
        </div>
      )}
    </div>
  );
}
