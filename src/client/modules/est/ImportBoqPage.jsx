import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { est, parsePasted, qty } from './api.js';
import { EstimatePicker, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { useFlagOn } from '../../platform/shell/api.js';
import { useLongFormDraft } from '../../platform/forms/useLongFormDraft.js';
import { DraftBanner } from '../../platform/forms/layout.jsx';

// Import Client BOQ (part 09.01, FR-02): the rows of the client's bill of quantities pasted from Excel (section, section name, item number, description, unit, quantity, the client's rate) are checked by the server
// (missing fields, item numbers twice or already in the estimate) and shown before anything is added; then they become unpriced items of the draft. A workbook can also go through the Import Center (type EST_BOQ).
export default function ImportBoqPage() {
  const t = useT('est');
  const qc = useQueryClient();
  usePageTitle(t('imp.title'));
  const qid = Number(useSearch().get('id')) || null;
  const [id, setId] = useState(qid); const [text, setText] = useState(''); const [replace, setReplace] = useState(false); const [res, setRes] = useState(null); const [error, setError] = useState(null);
  const lq = useQuery({ queryKey: ['est', 'drafts'], queryFn: () => est.list({ 'filter[status]': 'DRAFT', pageSize: 100 }), retry: false });
  const eq = useQuery({ queryKey: ['est', 'estimate', id], queryFn: () => est.get(id), enabled: Boolean(id), retry: false });
  const rows = parsePasted(text);
  // PACK-09: the pasted rows are kept as a draft on the server, and leaving with rows not yet added asks first
  const pack09 = useFlagOn('ff.forms.pack09');
  const ld = useLongFormDraft({ formCode: 'est.boq_import', values: { id, text, replace }, enabled: pack09, title: eq.data?.ref ?? '' });
  const send = async (commit) => {
    setError(null); setRes(null);
    try { const r = await est.boq(id, { rows, commit, replace, version: eq.data.rowVersion }); setRes(r); if (r.committed) { qc.invalidateQueries({ queryKey: ['est'] }); setText(''); if (pack09) await ld.done().catch(() => null); } } catch (x) { setError(errorInfo(x)); }
  };
  if (lq.isPending) return <Skeleton label={t('imp.title')} rows={3} />;
  if (lq.isError) return <ErrorState error={lq.error} onRetry={lq.refetch} />;
  const drafts = (lq.data?.data ?? []).filter((r) => ['DRAFT', 'RETURNED'].includes(r.status));
  return (
    <section aria-labelledby="imp-h" data-testid="boq-import">
      <PageHeader id="imp-h" title={t('imp.title')} subtitle={t('imp.help')} />
      {pack09 && <DraftBanner draft={ld.draft} onResume={() => { const p = ld.resume(); if (p) { setId(p.id ?? null); setText(p.text ?? ''); setReplace(Boolean(p.replace)); setRes(null); } }} onDiscard={ld.discard} />}
      <div className="mdm-panel mdm-fields" onBlur={pack09 ? ld.onBlur : undefined}>
        <EstimatePicker id="imp-estimate" value={id} onChange={(v) => { setId(v); setRes(null); }} rows={drafts.some((d) => d.id === id) || !id ? drafts : [...drafts, { id, ref: eq.data?.ref ?? `#${id}`, title: eq.data?.title ?? '', statusLabel: eq.data?.statusLabel ?? '' }]} label={t('imp.estimate')} />
        {eq.data && <p className="small">{t('imp.has', { n: eq.data.items.length })} <Link to={`/est/estimate?id=${id}`}>{eq.data.ref}</Link></p>}
        <Field label={t('imp.paste')} name="rows" error={error} hint={t('imp.columns')}><textarea rows={10} value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} spellCheck={false} data-testid="imp-text" /></Field>
        <label><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} data-testid="imp-replace" /> {t('imp.replace')}</label>
        <p className="small" data-testid="imp-count">{t('imp.count', { n: rows.length })}</p>
        <div className="actions"><button type="button" className="btn" disabled={!id || !rows.length} onClick={() => send(false)} data-testid="imp-check">{t('imp.check')}</button><button type="button" className="btn btn-primary" disabled={!id || !rows.length || !res || res.problems.length > 0} onClick={() => send(true)} data-testid="imp-commit">{t('imp.commit')}</button></div>
        <p className="small"><Link to="/import">{t('imp.center')}</Link></p>
      </div>
      {error?.form && <p className="field-error" role="alert" data-testid="imp-error">{error.form}</p>}
      {res && (
        <div className="mdm-panel" data-testid="imp-result">
          {res.committed ? <p className="mdm-banner" role="status" data-testid="imp-done">{t('imp.done', { n: res.rows })} <button type="button" className="btn btn-small" onClick={() => navigateTo(`/est/estimate?id=${id}`)} data-testid="imp-open">{t('imp.open')}</button></p>
            : res.problems.length ? <ul className="field-error" data-testid="imp-problems">{res.problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
              : <p role="status" data-testid="imp-ok">{t('imp.ok', { n: res.rows, s: res.sections })}</p>}
          {!res.committed && res.preview?.length > 0 && (
            <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">{t('items.section')}</th><th scope="col">{t('items.no')}</th><th scope="col">{t('items.description')}</th><th scope="col">{t('items.uom')}</th><th scope="col">{t('items.qty')}</th><th scope="col">{t('imp.clientRate')}</th></tr></thead>
              <tbody>{res.preview.map((r, i) => <tr key={i}><td data-label={t('items.section')}>{r.sectionCode}</td><td data-label={t('items.no')}>{r.itemNo}</td><td data-label={t('items.description')}>{r.description}</td><td data-label={t('items.uom')}>{r.uom}</td><td data-label={t('items.qty')}>{qty(r.qty)}</td><td data-label={t('imp.clientRate')}>{r.clientRate ?? '—'}</td></tr>)}</tbody></table></div>)}
        </div>)}
    </section>
  );
}
