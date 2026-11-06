import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { aw, dayIST, inr, rankPreview } from './api.js';

// Bid Opening Results (business development, part 08.03, FR-04, T-01): every bidder read out at the opening with its price; the server ranks the qualified prices (L1 the lowest, equal prices share the rank) and works out how far each is from L1.
// The bidders other than us become the competitor database of the analysis.
const blankRow = (isUs = false) => ({ name: '', isUs, qualified: true, quoted: '', note: '' });
export default function BidResultsPage() {
  const t = useT('bd');
  const qc = useQueryClient();
  const tenderId = Number(new URLSearchParams(window.location.search).get('tenderId')) || null;
  const q = useQuery({ queryKey: ['bd', 'results', tenderId], queryFn: () => aw.results(tenderId), enabled: Boolean(tenderId), retry: false });
  usePageTitle(t('res.title'));
  const [rows, setRows] = useState([]); const [openedOn, setOpenedOn] = useState(dayIST(0)); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  useEffect(() => {
    if (!q.data) return;
    setRows(q.data.rows.length ? q.data.rows.map((r) => ({ name: r.bidder, isUs: r.isUs, qualified: r.qualified, quoted: r.quoted ?? '', note: r.note ?? '', partnerId: r.partnerId })) : [{ ...blankRow(true), name: t('res.us') }, blankRow(), blankRow()]);
    if (q.data.rows[0]?.openedOn) setOpenedOn(q.data.rows[0].openedOn);
  }, [q.data]);
  if (!tenderId) return <ErrorState error={new Error(t('bid.noTender'))} />;
  if (q.error?.status === 403) return <NoPermission what={t('res.title')} permission="bd.award.view" />;
  if (q.isPending) return <Skeleton label={t('res.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const ranks = rankPreview(rows); const edit = r.canEdit;
  const set = (i, patch) => setRows(rows.map((x, k) => (k === i ? { ...x, ...patch } : patch.isUs ? { ...x, isUs: false } : x)));
  const save = async (e) => {
    e.preventDefault(); setError(null); setNote(null);
    try { await aw.saveResults(tenderId, { openedOn, bidders: rows.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), isUs: x.isUs, qualified: x.qualified, quoted: x.quoted === '' ? null : Number(x.quoted), note: x.note.trim() || null, ...(x.partnerId ? { partnerId: x.partnerId } : {}) })) }); setNote(t('res.saved')); qc.invalidateQueries({ queryKey: ['bd'] }); } catch (x) { setError(errorInfo(x)); }
  };
  return (
    <section aria-labelledby="res-title" data-testid="bid-results">
      <h1 id="res-title">{t('res.title')}</h1>
      <p className="muted"><Link to={`/bd/tender?id=${tenderId}`}>{r.tenderNo}</Link>{r.ourRank ? <> · <strong data-testid="res-our-rank">{t('res.ourRank', { rank: `L${r.ourRank}`, pct: r.ourDiffPct ?? 0 })}</strong></> : null}{r.l1 != null ? ` · L1 ${inr(r.l1)}` : ''}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="res-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="res-note">{note}</p>}
      <form onSubmit={save} aria-label={t('res.title')}>
        <Field label={t('res.openedOn')} name="openedOn" error={error}><input type="date" value={openedOn} max={dayIST(0)} onChange={(e) => setOpenedOn(e.target.value)} disabled={!edit} data-testid="res-opened" /></Field>
        <div className="table-wrap">
          <table className="data-table" data-testid="res-table">
            <thead><tr><th scope="col">{t('res.rank')}</th><th scope="col">{t('res.bidder')}</th><th scope="col">{t('res.usCol')}</th><th scope="col">{t('res.qualified')}</th><th scope="col">{t('res.quoted')}</th><th scope="col">{t('res.diff')}</th><th scope="col">{t('comp.note')}</th>{edit && <th scope="col"><span className="sr-only">{t('act.remove')}</span></th>}</tr></thead>
            <tbody>{rows.map((x, i) => (
              <tr key={i} data-testid={`res-row-${i}`} className={x.isUs ? 'row-highlight' : ''}>
                <td data-label={t('res.rank')} data-testid={`res-rank-${i}`}>{ranks[i].rank ? `L${ranks[i].rank}` : '—'}</td>
                <td data-label={t('res.bidder')}><input value={x.name} onChange={(e) => set(i, { name: e.target.value })} disabled={!edit} aria-label={t('res.bidder')} data-testid={`res-name-${i}`} /></td>
                <td data-label={t('res.usCol')}><input type="radio" name="isUs" checked={x.isUs} onChange={() => set(i, { isUs: true })} disabled={!edit} aria-label={t('res.usCol')} /></td>
                <td data-label={t('res.qualified')}><input type="checkbox" checked={x.qualified} onChange={(e) => set(i, { qualified: e.target.checked })} disabled={!edit} aria-label={t('res.qualified')} /></td>
                <td data-label={t('res.quoted')}><input type="number" min="0" step="0.01" value={x.quoted} onChange={(e) => set(i, { quoted: e.target.value })} disabled={!edit} aria-label={t('res.quoted')} data-testid={`res-quoted-${i}`} /></td>
                <td data-label={t('res.diff')} data-testid={`res-diff-${i}`}>{ranks[i].diff == null ? '—' : `${ranks[i].diff}%`}</td>
                <td data-label={t('comp.note')}><input value={x.note} onChange={(e) => set(i, { note: e.target.value })} disabled={!edit} aria-label={t('comp.note')} /></td>
                {edit && <td><button type="button" className="btn btn-small" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={t('act.remove')}>✕</button></td>}
              </tr>))}</tbody>
          </table>
        </div>
        {edit && <div className="actions"><button type="button" className="btn" onClick={() => setRows([...rows, blankRow()])} data-testid="res-add">{t('res.add')}</button><button type="submit" className="btn btn-primary" data-testid="res-save">{t('act.save')}</button></div>}
      </form>
      <p className="small">{r.stage === 'SUBMITTED' && <Link to={`/bd/award?tenderId=${tenderId}`}>{t('aw.record')}</Link>} · <Link to="/bd/competitors">{t('comp.title')}</Link></p>
    </section>
  );
}
