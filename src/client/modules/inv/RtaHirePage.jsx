import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { COUNT_TONE, fmtDate, fmtQty, fmtRs, iv, ra, saveCsv } from './api.js';
import { useRunner } from './InvParts.jsx';

// Hire charges (hired in and internal) and damage and loss recoveries (part 16.08, FR-03, FR-04, FR-05): charges by quantity-days, the vendor's bill checked against them, and the recoveries sent for approval.
function Hire({ t, perms }) {
  const [kind, setKind] = useState(''); const [bills, setBills] = useState({}); const { error, note, busy, run } = useRunner(); const q = useQuery({ queryKey: ['inv', 'rta-hire', kind], queryFn: () => ra.hire(kind ? { kind } : {}), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('ra.hireTitle')} permission="inv.rta_hire.view" />; if (q.isPending) return <Skeleton label={t('ra.hireTitle')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const bill = (id, k, v) => setBills((x) => ({ ...x, [id]: { ...(x[id] ?? {}), [k]: v } }));
  return (
    <div data-testid="rta-hire">
      {error?.form && <p className="field-error" role="alert" data-testid="hire-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="hire-note">{note}</p>}
      <div className="actions-row no-print"><label>{t('ra.kind')} <select value={kind} onChange={(ev) => setKind(ev.target.value)} style={{ minHeight: 44 }} data-testid="hire-kind"><option value="">{t('rs.all')}</option><option value="HIRE_IN">{t('ra.k.HIRE_IN')}</option><option value="INTERNAL">{t('ra.k.INTERNAL')}</option></select></label>
        {perms.includes('inv.rta_hire.export') && <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => saveCsv('hire-charges.csv', [[t('ra.kind'), t('item'), t('ra.vendor'), t('ra.project'), t('i.qty'), t('ra.from'), t('ra.to'), t('ra.days'), t('ra.rate'), t('ra.basis'), t('r.value')], ...d.rows.map((r) => [r.kind, r.item, r.vendor ?? '', r.project ?? '', r.qty, r.startDate, r.endDate ?? '', r.days, r.rate == null ? '' : r.rate / 100, r.rateBasis, r.amount == null ? '' : r.amount / 100])])} data-testid="hire-export">{t('i.exportCsv')}</button>}</div>
      {d.totals.hireIn != null && <div className="kpi-row" role="list" data-testid="hire-totals"><div role="listitem" className="kpi-tile" data-testid="hire-total-in"><span className="kpi-value">{fmtRs(d.totals.hireIn)}</span><span className="kpi-label">{t('ra.k.HIRE_IN')}</span></div><div role="listitem" className="kpi-tile" data-testid="hire-total-internal"><span className="kpi-value">{fmtRs(d.totals.internal)}</span><span className="kpi-label">{t('ra.k.INTERNAL')}</span></div><div role="listitem" className="kpi-tile"><span className="kpi-value">{d.totals.open}</span><span className="kpi-label">{t('ra.openPeriods')}</span></div></div>}
      {d.rows.length === 0 ? <div className="mdm-panel" data-testid="hire-empty"><h2>{t('ra.hireEmptyTitle')}</h2><p>{t('ra.hireEmptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="hire-table"><caption>{t('ra.hireTitle')}</caption><thead><tr><th>{t('ra.kind')}</th><th>{t('item')}</th><th>{t('ra.vendor')}</th><th className="num">{t('i.qty')}</th><th>{t('ra.from')}</th><th>{t('ra.to')}</th><th className="num">{t('ra.days')}</th><th className="num">{t('ra.rate')}</th><th className="num">{t('r.value')}</th><th>{t('ra.bill')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id} data-testid={`hire-row-${r.id}`}><td data-label={t('ra.kind')}>{t(`ra.k.${r.kind}`)}</td><td data-label={t('item')}>{r.item}</td><td data-label={t('ra.vendor')}>{r.vendor ?? r.project ?? '—'}</td><td className="num" data-label={t('i.qty')}>{fmtQty(r.qty)}</td><td data-label={t('ra.from')}>{fmtDate(r.startDate)}</td><td data-label={t('ra.to')}>{r.endDate ? fmtDate(r.endDate) : t('ra.running')}</td><td className="num" data-label={t('ra.days')}>{r.days}</td><td className="num" data-label={t('ra.rate')}>{r.rate == null ? '—' : `${fmtRs(r.rate)} / ${t(`ra.b1.${r.rateBasis}`)}`}</td><td className="num" data-label={t('r.value')} data-testid={`hire-amount-${r.id}`}>{r.amount == null ? '—' : fmtRs(r.amount)}</td>
            <td data-label={t('ra.bill')}>{r.billStatus ? <span data-testid={`hire-bill-${r.id}`}>{r.billNo} · {t(`ra.bs.${r.billStatus}`)}{r.billDiff ? ` (${fmtRs(r.billDiff)})` : ''}</span> : r.kind === 'HIRE_IN' && perms.includes('inv.rta_hire.verify') ? <span className="actions-row"><input aria-label={t('ra.billNo')} placeholder={t('ra.billNo')} value={bills[r.id]?.no ?? ''} onChange={(ev) => bill(r.id, 'no', ev.target.value)} style={{ minHeight: 40, width: 90 }} data-testid={`hire-billno-${r.id}`} /><input aria-label={t('ra.billAmount')} placeholder={t('ra.billAmount')} type="number" min="0" step="any" value={bills[r.id]?.amount ?? ''} onChange={(ev) => bill(r.id, 'amount', ev.target.value)} style={{ minHeight: 40, width: 100 }} data-testid={`hire-billamt-${r.id}`} /><button type="button" className="btn" disabled={busy || !bills[r.id]?.no || !bills[r.id]?.amount} onClick={() => run(() => ra.bill(r.id, { billNo: bills[r.id].no, billAmount: Number(bills[r.id].amount) }), t('ra.billChecked'))} data-testid={`hire-verify-${r.id}`}>{t('ra.verify')}</button></span> : '—'}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}
function Recoveries({ t }) {
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const q = useQuery({ queryKey: ['inv', 'rta-recoveries'], queryFn: () => ra.recoveries({}), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('ra.recoveriesTitle')} permission="inv.rta_recovery.view" />; if (q.isPending) return <Skeleton label={t('ra.recoveriesTitle')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const decide = (taskId, action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div data-testid="rta-recoveries">
      {error?.form && <p className="field-error" role="alert" data-testid="rec-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="rec-note">{note}</p>}
      {d.totals.recover != null && <div className="kpi-row" role="list" data-testid="rec-totals"><div role="listitem" className="kpi-tile" data-testid="rec-total-recover"><span className="kpi-value">{fmtRs(d.totals.recover)}</span><span className="kpi-label">{t('ra.toRecover')}</span></div><div role="listitem" className="kpi-tile" data-testid="rec-total-writeoff"><span className="kpi-value">{fmtRs(d.totals.writeOff)}</span><span className="kpi-label">{t('ra.toWriteOff')}</span></div><div role="listitem" className="kpi-tile"><span className="kpi-value">{d.totals.open}</span><span className="kpi-label">{t('ra.kpi.recoveries')}</span></div></div>}
      {d.rows.some((r) => r.taskId) && <label>{t('comment')}<input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="rec-comment" /></label>}
      {d.rows.length === 0 ? <div className="mdm-panel" data-testid="rec-empty"><h2>{t('ra.recEmptyTitle')}</h2><p>{t('ra.recEmptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="rec-table"><caption>{t('ra.recoveriesTitle')}</caption><thead><tr><th>{t('ra.recovery')}</th><th>{t('item')}</th><th>{t('ra.cause')}</th><th className="num">{t('i.qty')}</th><th className="num">{t('r.value')}</th><th>{t('ra.party')}</th><th>{t('ra.disposition')}</th><th>{t('tr.status')}</th><th /></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id} data-testid={`rec-row-${r.id}`}><td data-label={t('ra.recovery')}>{r.docNo}<div className="muted"><Link to={`/inv/rta-movements?id=${r.movementId}`}>{r.movement}</Link></div></td><td data-label={t('item')}>{r.item}</td><td data-label={t('ra.cause')}>{t(`ra.rk.${r.kind}`)}</td><td className="num" data-label={t('i.qty')}>{fmtQty(r.qty)}</td><td className="num" data-label={t('r.value')}>{r.amount == null ? '—' : fmtRs(r.amount)}</td><td data-label={t('ra.party')}>{r.party ?? '—'}</td>
            <td data-label={t('ra.disposition')}>{r.can.edit ? <select value={r.disposition} onChange={(ev) => run(() => ra.recUpdate(r.id, { disposition: ev.target.value, rowVersion: r.rowVersion }))} style={{ minHeight: 40 }} aria-label={t('ra.disposition')} data-testid={`rec-disp-${r.id}`}><option value="RECOVER">{t('ra.d.RECOVER')}</option><option value="WRITE_OFF">{t('ra.d.WRITE_OFF')}</option></select> : t(`ra.d.${r.disposition}`)}</td>
            <td data-label={t('tr.status')}><StatusBadge status={COUNT_TONE[r.status]} label={t(`ra.rs.${r.status}`)} /></td>
            <td><span className="actions-row">{r.can.submit && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => ra.recAct(r.id, 'submit'), t('submitted'))} data-testid={`rec-submit-${r.id}`}>{t('sendForApproval')}</button>}{r.taskId && <><button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide(r.taskId, 'approve')} data-testid={`rec-approve-${r.id}`}>{t('approve')}</button><button type="button" className="btn" disabled={busy} onClick={() => decide(r.taskId, 'reject')}>{t('reject')}</button></>}</span></td></tr>)}</tbody></table></div>)}
    </div>
  );
}
export default function RtaHirePage() {
  const t = useT('inv'); usePageTitle(t('ra.hireTitle')); const sp = useSearch(); const tab = sp.get('tab') === 'recoveries' ? 'recoveries' : 'hire'; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (session.isSuccess && !perms.includes('inv.rta_hire.view') && !perms.includes('inv.rta_recovery.view')) return <NoPermission what={t('ra.hireTitle')} permission="inv.rta_hire.view" />;
  return (
    <section aria-labelledby="rh-h" data-testid="rta-hire-page"><h1 id="rh-h">{t('ra.hireTitle')}</h1><p className="muted">{t('ra.hireIntro')}</p>
      <div className="actions-row no-print">{[['hire', 'ra.tabHire'], ['recoveries', 'ra.recoveriesTitle']].map(([k, l]) => <Link key={k} to={`/inv/rta-hire?tab=${k}`} aria-current={tab === k ? 'page' : undefined} data-testid={`rta-hire-tab-${k}`}>{t(l)}</Link>)} <Link to="/inv/rta">{t('ra.title')}</Link></div>
      {tab === 'hire' ? <Hire t={t} perms={perms} /> : <Recoveries t={t} />}
    </section>
  );
}
