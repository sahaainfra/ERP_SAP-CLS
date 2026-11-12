import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { at, download, fmtDate, fmtRs, saveCsv } from './api.js';

// Custody statement by person and calibration due (part 16.09, FR-03, FR-05): what a person holds (used at exit clearance), and the instruments and tools whose calibration or inspection is due or overdue.
function Statement({ t, perms }) {
  const oq = useQuery({ queryKey: ['inv', 'asset-options'], queryFn: at.options, retry: false }); const [emp, setEmp] = useState(''); const q = useQuery({ queryKey: ['inv', 'custody-statement', emp], queryFn: () => at.statement(emp), retry: false, enabled: !!emp });
  const s = q.data;
  return (
    <div data-testid="custody-statement"><div className="mdm-panel no-print"><Field label={t('at.person')} name="emp" error={null}><select value={emp} onChange={(ev) => setEmp(ev.target.value)} style={{ minHeight: 44 }} data-testid="cs-person"><option value="">—</option>{(oq.data?.employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select></Field></div>
      {!emp ? <p className="muted" data-testid="cs-pick">{t('at.pickPerson')}</p> : q.isPending ? <Skeleton label={t('at.custodyTitle')} rows={3} /> : q.error?.status === 403 ? <NoPermission what={t('at.custodyTitle')} permission="inv.small_asset.statement" /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (<>
        <h2 data-testid="cs-name">{s.employee.code} · {s.employee.name}</h2><p className={s.clear ? 'mdm-banner' : 'field-error'} role="status" data-testid="cs-clear">{s.clear ? t('at.clear') : t('at.notClear', { n: s.assets.length + s.waiting.length })}</p>
        <div className="actions-row no-print"><button type="button" className="btn" onClick={() => download(`/custody-statement/print?employeeId=${emp}`, `custody-${s.employee.code}.pdf`)} data-testid="cs-print">{t('g.print')}</button>{perms.includes('inv.small_asset.export') && <button type="button" className="btn" onClick={() => saveCsv('custody-statement.csv', [[t('at.tag'), t('item'), t('at.serial'), t('at.condition'), t('at.since'), t('at.value')], ...s.assets.map((a) => [a.tag, a.item, a.serialNo ?? '', a.condition, a.since ?? '', a.value / 100])])}>{t('i.exportCsv')}</button>}</div>
        {s.assets.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="cs-table"><caption>{t('at.custodyTitle')}</caption><thead><tr><th>{t('at.tag')}</th><th>{t('item')}</th><th>{t('at.serial')}</th><th>{t('at.condition')}</th><th>{t('at.since')}</th><th className="num">{t('at.value')}</th></tr></thead><tbody>{s.assets.map((a) => <tr key={a.assetId} data-testid={`cs-row-${a.tag}`}><td data-label={t('at.tag')}>{perms.includes('inv.small_asset.view') ? <Link to={`/inv/small-assets?id=${a.assetId}`}>{a.tag}</Link> : a.tag}</td><td data-label={t('item')}>{a.item}</td><td data-label={t('at.serial')}>{a.serialNo ?? '—'}</td><td data-label={t('at.condition')}>{t(`at.c.${a.condition}`)}</td><td data-label={t('at.since')}>{a.since ? fmtDate(a.since) : '—'}</td><td className="num" data-label={t('at.value')}>{fmtRs(a.value)}</td></tr>)}<tr><td colSpan={5}><strong>{t('at.total')}</strong></td><td className="num" data-testid="cs-total">{fmtRs(s.totalValue)}</td></tr></tbody></table></div>}
        {s.waiting.length > 0 && <p data-testid="cs-waiting">{t('at.waitingList', { list: s.waiting.map((w) => `${w.tag} ${w.item}`).join(', ') })}</p>}
        {s.recoveries.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="cs-recoveries"><caption>{t('at.recoveries')}</caption><thead><tr><th>{t('at.lossTitle')}</th><th>{t('at.lossKind')}</th><th className="num">{t('cn.amount')}</th><th>{t('tr.status')}</th></tr></thead><tbody>{s.recoveries.map((r) => <tr key={r.docNo}><td data-label={t('at.lossTitle')}>{r.docNo}</td><td data-label={t('at.lossKind')}>{t(`at.lk.${r.kind}`)}</td><td className="num" data-label={t('cn.amount')}>{fmtRs(r.amount)}</td><td data-label={t('tr.status')}>{t(`at.ls.${r.status}`)}</td></tr>)}</tbody></table></div>}</>)}
    </div>
  );
}
function Calibration({ t }) {
  const [days, setDays] = useState('15'); const q = useQuery({ queryKey: ['inv', 'calibration-due', days], queryFn: () => at.calibration(days === '' ? undefined : Number(days)), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('at.calTitle')} permission="inv.small_asset.view" />; if (q.isPending) return <Skeleton label={t('at.calTitle')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data;
  return (
    <div data-testid="calibration-due"><div className="mdm-panel no-print"><Field label={t('at.withinDays')} name="days" error={null}><input type="number" min="0" max="365" value={days} onChange={(ev) => setDays(ev.target.value)} style={{ minHeight: 44 }} data-testid="cal-days" /></Field></div>
      <div className="kpi-row" role="list" data-testid="cal-kpis"><div role="listitem" className="kpi-tile" data-testid="cal-overdue"><span className="kpi-value">{d.totals.overdue}</span><span className="kpi-label">{t('at.overdue')}</span></div><div role="listitem" className="kpi-tile" data-testid="cal-soon"><span className="kpi-value">{d.totals.dueSoon}</span><span className="kpi-label">{t('at.dueSoon')}</span></div></div>
      {d.rows.length === 0 ? <div className="mdm-panel" data-testid="cal-empty"><h2>{t('at.calEmptyTitle')}</h2><p>{t('at.calEmptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="cal-table"><caption>{t('at.calTitle')}</caption><thead><tr><th>{t('at.tag')}</th><th>{t('item')}</th><th>{t('at.dueFor')}</th><th>{t('at.due')}</th><th className="num">{t('at.daysLeft')}</th><th>{t('at.with')}</th><th /></tr></thead><tbody>{d.rows.map((r) => <tr key={`${r.assetId}-${r.kind}`} className={r.status === 'OVERDUE' ? 'is-warn' : ''} data-testid={`cal-row-${r.tag}-${r.kind}`}><td data-label={t('at.tag')}><Link to={`/inv/small-assets?id=${r.assetId}`}>{r.tag}</Link></td><td data-label={t('item')}>{r.item}</td><td data-label={t('at.dueFor')}>{t(`at.k.${r.kind}`)}</td><td data-label={t('at.due')}>{fmtDate(r.due)}</td><td className="num" data-label={t('at.daysLeft')}>{r.daysLeft}</td><td data-label={t('at.with')}>{r.custodian ?? '—'}</td><td>{r.blocksIssue ? t('at.blocksIssue') : ''}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}
export default function CustodyPage() {
  const t = useT('inv'); usePageTitle(t('at.custodyTitle')); const sp = useSearch(); const tab = sp.get('tab') === 'calibration' ? 'calibration' : 'statement'; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (session.isSuccess && !perms.includes('inv.small_asset.view') && !perms.includes('inv.small_asset.statement') && !perms.includes('inv.small_asset.acknowledge')) return <NoPermission what={t('at.custodyTitle')} permission="inv.small_asset.statement" />;
  return (
    <section aria-labelledby="cu-h" data-testid="custody"><h1 id="cu-h">{t('at.custodyTitle')}</h1><p className="muted">{t('at.custodyIntro')}</p>
      <div className="actions-row no-print">{[['statement', 'at.statementTab'], ['calibration', 'at.calTitle']].map(([k, l]) => <Link key={k} to={`/inv/custody?tab=${k}`} aria-current={tab === k ? 'page' : undefined} data-testid={`custody-tab-${k}`}>{t(l)}</Link>)} <Link to="/inv/small-assets">{t('at.title')}</Link></div>
      {tab === 'statement' ? <Statement t={t} perms={perms} /> : <Calibration t={t} />}
    </section>
  );
}
