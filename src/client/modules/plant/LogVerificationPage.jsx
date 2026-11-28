import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtQty, lg, pl } from './api.js';
import { useRunner } from './PlantParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Log verification (part 17.03, FR-02): the logs waiting for the person. The flags of each log are in front of the verifier; logs without flags can be approved together, a flagged one is opened, and anything is returned or rejected with a reason.
export default function LogVerificationPage() {
  const t = useT('plant'); usePageTitle(t('l.verifyTitle')); const qc = useQueryClient(); const q = useQuery({ queryKey: ['plant', 'worklist'], queryFn: () => lg.worklist({ pageSize: 100 }), retry: false }); const { error, run, busy, note } = useRunner(); const [sel, setSel] = useState(new Set());
  if (q.error?.status === 403) return <NoPermission what={t('l.verifyTitle')} permission="plant.log.approve" />; if (q.isPending) return <Skeleton label={t('l.verifyTitle')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const rows = (q.data.data ?? []).filter((r) => r.taskId); const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = async () => { const picked = rows.filter((r) => sel.has(r.id)); await run(async () => { for (const r of picked) await pl.decide(r.taskId, 'approve'); return true; }, t('l.bulkDone', { n: picked.length })); setSel(new Set()); qc.invalidateQueries({ queryKey: ['plant', 'worklist'] }); };
  const act = (r, action) => { const c = globalThis.prompt(t('why')); if (c && c.length >= 5) run(() => pl.decide(r.taskId, action, c), t(`done.${action}`)).then(() => qc.invalidateQueries({ queryKey: ['plant', 'worklist'] })); };
  return (
    <section aria-labelledby="lv-h" data-testid="plant-verify"><PageHeader id="lv-h" title={t('l.verifyTitle')} subtitle={t('l.verifyIntro')} />{note && <p className="mdm-banner" role="status" data-testid="lv-note">{note}</p>}{error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {rows.length === 0 ? <div className="mdm-panel" data-testid="lv-empty"><h2>{t('l.verifyEmptyTitle')}</h2><p className="muted">{t('l.verifyEmptyBody')}</p><Link to="/plant/logs">{t('l.logsTitle')}</Link></div> : <>
        <div className="actions-row no-print"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || sel.size === 0} onClick={bulk} data-testid="lv-bulk">{t('l.approveSelected', { n: sel.size })}</button></div>
        <div className="table-scroll"><table className="data-table" data-testid="lv-table"><thead><tr><th><span className="sr-only">{t('l.select')}</span></th><th>{t('l.log')}</th><th>{t('assetCode')}</th><th>{t('l.date')}</th><th className="num">{t('l.working')}</th><th className="num">{t('l.meterRunLabel')}</th><th>{t('l.flagged')}</th><th /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} data-testid="lv-row" data-flags={r.anomalies.length}><td><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} disabled={r.anomalies.length > 0} aria-label={`${t('l.select')} ${r.docNo}`} data-testid="lv-check" style={{ minWidth: 24, minHeight: 24 }} /></td><td><Link to={`/plant/logs?id=${r.id}`}>{r.docNo}</Link></td><td>{r.assetCode}</td><td>{fmtDate(r.date)} · {r.shiftLabel}</td><td className="num">{fmtQty(r.workingHrs)}</td><td className="num">{fmtQty(r.meterRun)}</td>
            <td>{r.anomalies.length === 0 ? '—' : <span className="field-error">{r.anomalies.map((a) => a.message).join('; ')}</span>}</td><td><button type="button" className="btn" onClick={() => act(r, 'return')}>{t('return')}</button> <button type="button" className="btn" onClick={() => act(r, 'reject')}>{t('reject')}</button></td></tr>)}</tbody></table></div></>}
    </section>
  );
}
