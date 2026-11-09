import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import AvailabilityPanel from './AvailabilityPanel.jsx';
import { bd, download, inr, lg } from './api.js';
import { ProjectSelect, ShareBar, useSearch } from './parts.jsx';

// Budget vs Committed vs Actual (part 12.03, FR-06): by WBS, cost code, cost head or vendor, with what is left, a bar of the share used, the documents behind a row, and the availability panel for a WBS node, cost code and amount.
const BY = ['wbs', 'cost_code', 'cost_head', 'vendor'];
export default function LedgerPage() {
  const t = useT('bud');
  usePageTitle(t('led.title'));
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const [projectId, setProjectId] = useState(Number(useSearch().get('projectId')) || ''); const [by, setBy] = useState('wbs'); const [open, setOpen] = useState(null);
  const [probe, setProbe] = useState({ wbsId: '', costCodeId: '', amount: '', stage: 'PO' });
  const q = useQuery({ queryKey: ['bud', 'ledger', projectId, by], queryFn: () => lg.report(projectId, by), enabled: Boolean(projectId), retry: false });
  const dq = useQuery({ queryKey: ['bud', 'ledger-docs', projectId, open?.key], queryFn: () => lg.documents(new URLSearchParams({ projectId: String(projectId), ...(open?.by === 'wbs' && open.id ? { wbsId: String(open.id) } : {}), ...(open?.by === 'cost_code' && open.id ? { costCodeId: String(open.id) } : {}), ...(open?.by === 'cost_head' ? {} : {}), ...(open?.by === 'vendor' && open.id ? { vendorRef: String(open.id) } : {}) }).toString()), enabled: Boolean(projectId && open), retry: false });
  const sq = useQuery({ queryKey: ['bud', 'structure', projectId], queryFn: () => bd.wbs(projectId), enabled: Boolean(projectId), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('led.title')} permission="bud.ledger.view" />;
  const d = q.data;
  return (
    <section aria-labelledby="led-h" data-testid="bud-ledger">
      <h1 id="led-h">{t('led.title')}</h1>
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('cmp.params')}>
        <div className="form-grid">
          <ProjectSelect value={projectId} onChange={(v) => { setProjectId(v ? Number(v) : ''); setOpen(null); }} testId="led-project" />
          <Field label={t('views.by')} name="by"><select value={by} onChange={(e) => { setBy(e.target.value); setOpen(null); }} data-testid="led-by">{BY.map((k) => <option key={k} value={k}>{t(`led.by.${k}`)}</option>)}</select></Field>
        </div>
        {d && perms.includes('bud.ledger.export') && <div className="actions"><button type="button" className="btn" onClick={() => download(`/ledger/export?projectId=${projectId}&by=${by}`, `budget-ledger-${d.projectCode}.csv`)} data-testid="led-export">{t('cmp.export')}</button></div>}
      </form>
      {!projectId && <p className="muted" data-testid="led-empty">{t('led.choose')}</p>}
      {projectId && q.isPending && <Skeleton label={t('led.title')} rows={4} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {d && (
        <>
          <p className="muted" data-testid="led-source">{d.budgetDocNo ? t('led.budget', { doc: d.budgetDocNo, v: d.versionNo }) : t('av.noBudget')}</p>
          {d.rows.length === 0 ? <p className="muted" data-testid="led-none">{t('led.none')}</p> : (
            <div className="table-scroll"><table className="data-table" data-testid="led-table"><caption className="sr-only">{t('led.title')}</caption>
              <thead><tr><th>{t(`led.by.${by}`)}</th><th className="num">{t('av.budget')}</th><th className="num">{t('av.committed')}</th><th className="num">{t('av.actual')}</th><th className="num">{t('av.available')}</th><th>{t('led.used')}</th></tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={r.key} data-testid="led-row" data-over={r.over ? '1' : '0'}>
                  <td><button type="button" className="btn" onClick={() => setOpen({ key: r.key, id: r.id, by, label: r.label })} data-testid="led-drill">{r.label}</button></td>
                  <td className="num">{inr(r.budget)}</td><td className="num">{inr(r.committed)}</td><td className="num">{inr(r.actual)}</td><td className={`num${r.over ? ' field-error' : ''}`}>{by === 'vendor' ? '—' : inr(r.available)}</td>
                  <td style={{ minWidth: '6rem' }}>{r.usedPct == null ? '—' : <><ShareBar pct={r.usedPct} label={`${r.usedPct} %`} /> {r.usedPct} %</>}</td>
                </tr>))}
                <tr><th scope="row">{t('gen.t.total')}</th><td className="num" data-testid="led-t-budget">{inr(d.totals.budget)}</td><td className="num" data-testid="led-t-committed">{inr(d.totals.committed)}</td><td className="num" data-testid="led-t-actual">{inr(d.totals.actual)}</td><td className="num" data-testid="led-t-available">{by === 'vendor' ? '—' : inr(d.totals.available)}</td><td /></tr></tbody></table></div>
          )}
          {open && (
            <div className="mdm-panel" data-testid="led-docs"><h2>{t('led.documents', { label: open.label })}</h2>
              {dq.isPending ? <Skeleton label={t('led.documents', { label: open.label })} rows={2} /> : (
                <>
                  <table className="data-table" data-testid="led-commitments"><caption>{t('led.commitments')}</caption><thead><tr><th>{t('led.doc')}</th><th>{t('led.vendor')}</th><th className="num">{t('f.amount')}</th><th className="num">{t('led.consumed')}</th><th className="num">{t('led.open')}</th><th>{t('f.status')}</th></tr></thead>
                    <tbody>{dq.data.commitments.map((c) => <tr key={c.id} data-testid="led-commitment"><td>{c.docRef ?? `${c.sourceType} ${c.sourceId}`}</td><td>{c.vendor ?? '—'}</td><td className="num">{inr(c.amount)}</td><td className="num">{inr(c.consumed)}</td><td className="num">{inr(c.open)}</td><td>{t(`cs.${c.status}`)}</td></tr>)}</tbody></table>
                  <table className="data-table" data-testid="led-actuals"><caption>{t('led.actuals')}</caption><thead><tr><th>{t('led.doc')}</th><th>{t('led.vendor')}</th><th className="num">{t('f.amount')}</th><th className="num">{t('led.consumed')}</th><th>{t('led.date')}</th></tr></thead>
                    <tbody>{dq.data.actuals.map((a) => <tr key={a.id} data-testid="led-actual"><td>{a.docRef ?? `${a.sourceType} ${a.sourceId}`}</td><td>{a.vendor ?? '—'}</td><td className="num">{inr(a.amount)}</td><td className="num">{inr(a.consumedCommitment)}</td><td>{a.date}</td></tr>)}</tbody></table>
                </>
              )}
            </div>
          )}
          <h2>{t('led.probe')}</h2>
          <form className="mdm-panel" onSubmit={(e) => e.preventDefault()} aria-label={t('led.probe')} data-testid="led-probe">
            <div className="form-grid">
              <Field label={t('f.wbs')} name="wbsId"><select value={probe.wbsId} onChange={(e) => setProbe({ ...probe, wbsId: e.target.value })} data-testid="probe-wbs"><option value="">—</option>{(sq.data?.wbs ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>
              <Field label={t('f.costCode')} name="costCodeId"><select value={probe.costCodeId} onChange={(e) => setProbe({ ...probe, costCodeId: e.target.value })} data-testid="probe-code"><option value="">—</option>{(sq.data?.costCodes ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>
              <Field label={t('led.stage')} name="stage"><select value={probe.stage} onChange={(e) => setProbe({ ...probe, stage: e.target.value })} data-testid="probe-stage">{['PR', 'PO', 'WO', 'OTHER'].map((k) => <option key={k} value={k}>{t(`stage.${k}`)}</option>)}</select></Field>
              <Field label={t('f.amount')} name="amount"><input type="number" min="0" step="0.01" value={probe.amount} onChange={(e) => setProbe({ ...probe, amount: e.target.value })} data-testid="probe-amount" /></Field>
            </div>
            <AvailabilityPanel projectId={projectId} wbsId={probe.wbsId ? Number(probe.wbsId) : null} costCodeId={probe.costCodeId ? Number(probe.costCodeId) : null} stage={probe.stage} amount={probe.amount ? Number(probe.amount) : null} />
          </form>
        </>
      )}
    </section>
  );
}
