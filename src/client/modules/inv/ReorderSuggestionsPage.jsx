import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { fmtDate, fmtQty, ro, saveCsv } from './api.js';
import { useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Reorder Suggestions (part 16.07, FR-02, BR-01): a worklist, urgent first. A person turns suggestions into DRAFT material requests (one per store) and sends them; nothing is ordered automatically.
const tone = { OPEN: 'IN_REVIEW', CONVERTED: 'APPROVED', DISMISSED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export default function ReorderSuggestionsPage() {
  const t = useT('inv'); usePageTitle(t('rs.title')); const session = useSession(); const perms = session.data?.permissions ?? []; const [status, setStatus] = useState('OPEN'); const [picked, setPicked] = useState([]); const { error, note, busy, run } = useRunner();
  const lq = useQuery({ queryKey: ['inv', 'suggestions', status], queryFn: () => ro.suggestions(status), retry: false }); const sq = useQuery({ queryKey: ['inv', 'suggestion-summary'], queryFn: ro.summary, retry: false });
  if (lq.error?.status === 403) return <NoPermission what={t('rs.title')} permission="inv.reorder.view" />;
  const rows = [...(Array.isArray(lq.data) ? lq.data : lq.data?.rows ?? [])].sort((a, b) => (a.priority === b.priority ? a.requiredBy.localeCompare(b.requiredBy) : a.priority === 'URGENT' ? -1 : 1)); const can = perms.includes('inv.reorder.suggest'); const k = sq.data;
  const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const dismiss = (s) => { const r = window.prompt(t('why')); if (r) run(() => ro.dismiss(s.id, r), t('rs.dismissed')); };
  return (
    <section aria-labelledby="rs-h" data-testid="reorder-suggestions"><PageHeader id="rs-h" title={t('rs.title')} subtitle={t('rs.intro')} />
      {error?.form && <p className="field-error" role="alert" data-testid="rs-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="rs-note">{note}</p>}
      {k && <div className="kpi-row" role="list" data-testid="rs-kpis">{['open', 'urgent', 'converted'].map((key) => <div key={key} role="listitem" className="kpi-tile" data-testid={`rs-kpi-${key}`}><span className="kpi-value">{k[key]}</span><span className="kpi-label">{t(`rs.kpi.${key}`)}</span></div>)}</div>}
      <div className="actions-row no-print"><label>{t('tr.status')} <select value={status} onChange={(ev) => { setStatus(ev.target.value); setPicked([]); }} style={{ minHeight: 44 }} data-testid="rs-status"><option value="OPEN">{t('rs.s.OPEN')}</option><option value="">{t('rs.all')}</option></select></label>
        {can && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(async () => { const r = await ro.run(); return r; }, t('rs.checked'))} data-testid="rs-run">{t('rs.run')}</button>}
        {can && <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy || picked.length === 0} onClick={async () => { const r = await run(() => ro.convert(picked), t('rs.converted')); if (r) setPicked([]); }} data-testid="rs-convert">{t('rs.convert', { n: picked.length })}</button>}
        {perms.includes('inv.reorder.export') && <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => saveCsv('reorder-suggestions.csv', [[t('rs.suggestion'), t('tr.store'), t('item'), t('rs.projected'), t('ro.reorderLevel'), t('rs.suggested'), t('rs.neededBy'), t('rs.priority')], ...rows.map((s) => [s.docNo, s.store, s.item, s.projectedQty, s.reorderLevel, s.suggestedQty, s.requiredBy, s.priority])])} data-testid="rs-export">{t('i.exportCsv')}</button>}</div>
      {lq.isPending ? <Skeleton label={t('rs.title')} rows={3} /> : lq.isError ? <ErrorState error={lq.error} onRetry={lq.refetch} /> : rows.length === 0 ? <div className="mdm-panel" data-testid="rs-empty"><h2>{t('rs.emptyTitle')}</h2><p>{t('rs.emptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="rs-table"><caption>{t('rs.title')}</caption><thead><tr>{can && <th />}<th>{t('rs.priority')}</th><th>{t('rs.suggestion')}</th><th>{t('tr.store')}</th><th>{t('item')}</th><th className="num">{t('rs.projected')}</th><th className="num">{t('ro.reorderLevel')}</th><th className="num">{t('rs.suggested')}</th><th>{t('rs.neededBy')}</th><th>{t('tr.status')}</th><th /></tr></thead>
          <tbody>{rows.map((s) => <tr key={s.id} className={s.priority === 'URGENT' && s.status === 'OPEN' ? 'is-warn' : ''} data-testid={`rs-row-${s.id}`}>{can && <td>{s.can.convert && <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} aria-label={t('rs.pick')} data-testid={`rs-pick-${s.id}`} />}</td>}
            <td data-label={t('rs.priority')}>{t(`rs.p.${s.priority}`)}</td><td data-label={t('rs.suggestion')}>{s.docNo}</td><td data-label={t('tr.store')}>{s.store}</td><td data-label={t('item')}>{s.item}</td><td className="num" data-label={t('rs.projected')}>{fmtQty(s.projectedQty)}</td><td className="num" data-label={t('ro.reorderLevel')}>{fmtQty(s.reorderLevel)}</td><td className="num" data-label={t('rs.suggested')}>{fmtQty(s.suggestedQty)} {s.uom}</td><td data-label={t('rs.neededBy')}>{fmtDate(s.requiredBy)}</td>
            <td data-label={t('tr.status')}><StatusBadge status={tone[s.status]} label={t(`rs.s.${s.status}`)} />{s.mr && <> <span data-testid={`rs-mr-${s.id}`}><Link to={`/proc/material-requests?id=${s.mr.id}`}>{s.mr.docNo}</Link></span></>}</td>
            <td>{s.can.dismiss && <button type="button" className="btn" disabled={busy} onClick={() => dismiss(s)} data-testid={`rs-dismiss-${s.id}`}>{t('rs.dismiss')}</button>}</td></tr>)}</tbody></table></div>)}
    </section>
  );
}
