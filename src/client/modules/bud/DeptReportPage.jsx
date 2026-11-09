import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { dp, download, inr } from './api.js';
import { ShareBar, useSearch } from './parts.jsx';

// Department Budget vs Actual (part 12.04, FR-03): the approved budget of each cost centre against what the general ledger has posted, by cost centre, account or month, to a month of the year; every row opens the budget lines and ledger documents behind it.
const BY = ['cost_centre', 'account', 'month'];
export default function DeptReportPage() {
  const t = useT('bud');
  usePageTitle(t('dr.title'));
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const sp = useSearch();
  const oq = useQuery({ queryKey: ['bud', 'dept-options'], queryFn: dp.options, retry: false });
  const [fyId, setFyId] = useState(Number(sp.get('fyId')) || ''); const [costCentreId, setCostCentreId] = useState(Number(sp.get('costCentreId')) || ''); const [by, setBy] = useState('cost_centre'); const [upTo, setUpTo] = useState(12); const [open, setOpen] = useState(null);
  const fy = oq.data?.fys.find((x) => x.id === Number(fyId)) ?? null; const effectiveFy = fyId || oq.data?.fys[0]?.id || '';
  const qs = new URLSearchParams({ fyId: String(effectiveFy), by, upTo: String(upTo), ...(costCentreId ? { costCentreId: String(costCentreId) } : {}) }).toString();
  const q = useQuery({ queryKey: ['bud', 'dept-report', qs], queryFn: () => dp.report(qs), enabled: Boolean(effectiveFy), retry: false });
  const dq = useQuery({ queryKey: ['bud', 'dept-docs', effectiveFy, costCentreId, open?.key], queryFn: () => dp.docs(new URLSearchParams({ fyId: String(effectiveFy), ...(open?.by === 'cost_centre' ? { costCentreId: String(open.id) } : costCentreId ? { costCentreId: String(costCentreId) } : {}), ...(open?.by === 'account' ? { accountId: String(open.id) } : {}), ...(open?.by === 'month' ? { periodNo: String(open.id) } : {}) }).toString()), enabled: Boolean(effectiveFy && open), retry: false });
  if (q.error?.status === 403 || oq.error?.status === 403) return <NoPermission what={t('dr.title')} permission="bud.dept_report.view" />;
  const d = q.data; const periods = (fy ?? oq.data?.fys[0])?.periods ?? [];
  return (
    <section aria-labelledby="dr-h" data-testid="dept-report">
      <h1 id="dr-h">{t('dr.title')}</h1>
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('cmp.params')}>
        <div className="form-grid">
          <Field label={t('dp.fy')} name="fyId"><select value={effectiveFy} onChange={(e) => { setFyId(Number(e.target.value)); setOpen(null); }} data-testid="dr-fy">{(oq.data?.fys ?? []).map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></Field>
          <Field label={t('dp.costCentre')} name="costCentreId"><select value={costCentreId} onChange={(e) => { setCostCentreId(e.target.value ? Number(e.target.value) : ''); setOpen(null); }} data-testid="dr-cc"><option value="">{t('dr.allCc')}</option>{(oq.data?.costCentres ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
          <Field label={t('views.by')} name="by"><select value={by} onChange={(e) => { setBy(e.target.value); setOpen(null); }} data-testid="dr-by">{BY.map((k) => <option key={k} value={k}>{t(`dr.by.${k}`)}</option>)}</select></Field>
          <Field label={t('dr.upTo')} name="upTo"><select value={upTo} onChange={(e) => setUpTo(Number(e.target.value))} data-testid="dr-upto">{periods.map((p) => <option key={p.id} value={p.periodNo}>{p.name}</option>)}</select></Field>
        </div>
        {d && perms.includes('bud.dept_report.export') && <div className="actions"><button type="button" className="btn" onClick={() => download(`/dept-report/export?${qs}`, `department-budget-vs-actual-${d.fy}.csv`)} data-testid="dr-export">{t('cmp.export')}</button></div>}
      </form>
      {(oq.isPending || (effectiveFy && q.isPending)) && <Skeleton label={t('dr.title')} rows={4} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {oq.isSuccess && oq.data.fys.length === 0 && <p className="muted" data-testid="dr-nofy">{t('dr.noFy')}</p>}
      {d && (
        <>
          {!d.actualsLive && <p className="mdm-banner" role="status" data-testid="dr-notlive">{t('dr.notLive')}</p>}
          {d.noBudget > 0 && <p className="mdm-banner" role="alert" data-testid="dr-nobudget">{t('dr.noBudget', { n: d.noBudget })}</p>}
          <p className="muted" data-testid="dr-source">{d.budgets.length ? t('dr.source', { n: d.budgets.length, to: d.upToName }) : t('dr.noApproved')} {d.budgets.map((b) => <span key={b.id}><Link to={`/bud/dept-budget?id=${b.id}`}>{b.docNo} v{b.versionNo}</Link> </span>)}</p>
          {d.rows.length === 0 ? <p className="muted" data-testid="dr-none">{t('dr.none')}</p> : (
            <div className="table-scroll"><table className="data-table" data-testid="dr-table"><caption className="sr-only">{t('dr.title')}</caption>
              <thead><tr><th>{t(`dr.by.${by}`)}</th><th className="num">{t('dr.budget')}</th><th className="num">{t('av.actual')}</th><th className="num">{t('dr.variance')}</th><th>{t('led.used')}</th></tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={r.key} data-testid="dr-row" data-over={r.over ? '1' : '0'}>
                  <td><button type="button" className="btn" onClick={() => setOpen({ key: r.key, id: r.id, by, label: r.label })} data-testid="dr-drill">{r.label}</button>{r.unbudgeted ? <span className="field-error"> · {t('dr.unbudgeted')}</span> : null}</td>
                  <td className="num">{inr(r.budget)}</td><td className="num">{inr(r.actual)}</td><td className={`num${r.over ? ' field-error' : ''}`}>{inr(r.variance)}</td>
                  <td style={{ minWidth: '6rem' }}>{r.usedPct == null ? '—' : <><ShareBar pct={r.usedPct} label={`${r.usedPct} %`} /> {r.usedPct} %</>}</td>
                </tr>))}
                <tr><th scope="row">{t('f.total')}</th><td className="num" data-testid="dr-t-budget">{inr(d.totals.budget)}</td><td className="num" data-testid="dr-t-actual">{inr(d.totals.actual)}</td><td className={`num${d.totals.over ? ' field-error' : ''}`} data-testid="dr-t-variance">{inr(d.totals.variance)}</td><td>{d.totals.usedPct == null ? '—' : `${d.totals.usedPct} %`}</td></tr></tbody></table></div>
          )}
          {open && (
            <div className="mdm-panel" data-testid="dr-docs"><h2>{t('dr.documents', { label: open.label })}</h2>
              {dq.isPending ? <Skeleton label={t('dr.documents', { label: open.label })} rows={2} /> : dq.isError ? <ErrorState error={dq.error} onRetry={dq.refetch} /> : (
                <>
                  <div className="table-scroll"><table className="data-table" data-testid="dr-budget-lines"><caption>{t('dr.budgetLines')}</caption><thead><tr><th>{t('f.docNo')}</th><th>{t('dp.costCentre')}</th><th>{t('dp.account')}</th><th>{t('dr.month')}</th><th className="num">{t('f.amount')}</th></tr></thead>
                    <tbody>{dq.data.budget.map((l, i) => <tr key={i}><td><Link to={`/bud/dept-budget?id=${l.budgetId}`}>{l.docNo}</Link></td><td>{l.costCentre}</td><td>{l.account}</td><td>{l.period}</td><td className="num">{inr(l.amount)}</td></tr>)}</tbody></table></div>
                  <div className="table-scroll"><table className="data-table" data-testid="dr-actual-lines"><caption>{t('dr.actualLines')}</caption><thead><tr><th>{t('led.doc')}</th><th>{t('dp.costCentre')}</th><th>{t('dp.account')}</th><th>{t('led.date')}</th><th className="num">{t('f.amount')}</th></tr></thead>
                    <tbody>{dq.data.actuals.map((a) => <tr key={a.id} data-testid="dr-actual"><td>{a.docRef ?? `${a.sourceType} ${a.sourceId}`}</td><td>{a.costCentre}</td><td>{a.account}</td><td>{a.date}</td><td className="num">{inr(a.amount)}</td></tr>)}</tbody></table></div>
                </>
              )}
              <div className="actions"><button type="button" className="btn" onClick={() => setOpen(null)}>{t('act.close')}</button></div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
