import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { CHANGE_TONE, STATUS_TONE, bc, inr } from './api.js';
import { ProjectSelect, useSearch } from './parts.jsx';

// Budget Version Comparison and History (part 12.02, FR-05): two approved versions of a budget compared by line, cost head or WBS with the change of each and a bar of the largest moves; the versions in order with the change that made each, and every change request of the project.
export default function ComparePage() {
  const t = useT('bud');
  usePageTitle(t('cmp.title'));
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const params = useSearch();
  const [projectId, setProjectId] = useState(Number(params.get('projectId')) || ''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [by, setBy] = useState('line'); const [changedOnly, setChangedOnly] = useState(true);
  const qs = new URLSearchParams({ projectId: String(projectId), by, ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const q = useQuery({ queryKey: ['bud', 'compare', qs], queryFn: () => bc.compare(qs), enabled: Boolean(projectId), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cmp.title')} permission="bud.budget.view" />;
  const d = q.data; const rows = (d?.rows ?? []).filter((r) => !changedOnly || r.changed); const max = Math.max(1, ...rows.map((r) => Math.abs(Number(r.delta))));
  const download = async () => { const { authHeaders } = await import('../../platform/api/index.js'); const res = await fetch(`/api/v1/bud/compare/export?${qs}`, { headers: authHeaders() }); const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = `budget-compare-${d?.projectCode ?? ''}.csv`; a.click(); };
  return (
    <section aria-labelledby="cmp-h" data-testid="bc-compare-page">
      <h1 id="cmp-h">{t('cmp.title')}</h1>
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('cmp.params')}>
        <div className="form-grid">
          <ProjectSelect value={projectId} onChange={(v) => { setProjectId(v ? Number(v) : ''); setFrom(''); setTo(''); }} testId="cmp-project" />
          <Field label={t('cmp.from')} name="from"><select value={from} onChange={(e) => setFrom(e.target.value)} data-testid="cmp-from"><option value="">{t('cmp.previous')}</option>{(d?.versions ?? []).map((v) => <option key={v.id} value={v.id}>{v.docNo} v{v.versionNo}</option>)}</select></Field>
          <Field label={t('cmp.to')} name="to"><select value={to} onChange={(e) => setTo(e.target.value)} data-testid="cmp-to"><option value="">{t('cmp.current')}</option>{(d?.versions ?? []).map((v) => <option key={v.id} value={v.id}>{v.docNo} v{v.versionNo}</option>)}</select></Field>
          <Field label={t('views.by')} name="by"><select value={by} onChange={(e) => setBy(e.target.value)} data-testid="cmp-by">{['line', 'cost_head', 'wbs'].map((k) => <option key={k} value={k}>{t(`cmp.by.${k}`)}</option>)}</select></Field>
        </div>
        <label><input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} data-testid="cmp-changed" /> {t('cmp.changedOnly')}</label>
        {d && perms.includes('bud.budget.export') && <div className="actions"><button type="button" className="btn" onClick={download} data-testid="cmp-export">{t('cmp.export')}</button></div>}
      </form>
      {!projectId && <p className="muted" data-testid="cmp-empty">{t('cmp.choose')}</p>}
      {projectId && q.isPending && <Skeleton label={t('cmp.title')} rows={4} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {d && (
        <>
          <p data-testid="cmp-summary">{d.from ? `${d.from.docNo} v${d.from.versionNo}` : '—'} → {d.to ? `${d.to.docNo} v${d.to.versionNo}` : '—'} · ₹ {inr(d.totalBefore)} → ₹ {inr(d.totalAfter)} · <strong>₹ {inr(d.totalDelta)}</strong> · {t('cmp.changed', { n: d.changedRows })}</p>
          {!d.from && <p className="muted" data-testid="cmp-first">{t('cmp.first')}</p>}
          <div className="table-scroll"><table className="data-table" data-testid="cmp-table"><caption className="sr-only">{t('cmp.title')}</caption>
            <thead><tr><th>{t(`cmp.by.${by}`)}</th><th className="num">{t('chg.before')}</th><th className="num">{t('chg.after')}</th><th className="num">{t('cmp.delta')}</th><th>{t('views.bar')}</th></tr></thead>
            <tbody>{rows.map((r) => { const v = Number(r.delta); return <tr key={r.key} data-testid="cmp-row" data-changed={r.changed ? '1' : '0'}><td>{r.label}</td><td className="num">{inr(r.before)}</td><td className="num">{inr(r.after)}</td><td className="num">{inr(r.delta)}</td><td style={{ minWidth: '6rem' }}><span role="img" aria-label={`${r.delta}`} style={{ display: 'block', height: '0.6rem', width: `${(Math.abs(v) / max) * 100}%`, background: v < 0 ? 'var(--erp-color-status-error-solid)' : 'var(--erp-color-status-success-solid)', borderRadius: '0.3rem' }} /></td></tr>; })}
              <tr><th scope="row">{t('gen.t.total')}</th><td className="num">{inr(d.totalBefore)}</td><td className="num">{inr(d.totalAfter)}</td><td className="num" data-testid="cmp-total-delta">{inr(d.totalDelta)}</td><td /></tr></tbody></table></div>
          <h2>{t('cmp.versions')}</h2>
          <div className="table-scroll"><table className="data-table" data-testid="cmp-versions"><thead><tr><th>{t('f.docNo')}</th><th>{t('f.version')}</th><th>{t('f.status')}</th><th className="num">{t('f.total')}</th><th>{t('cmp.madeBy')}</th></tr></thead>
            <tbody>{d.versions.map((v) => <tr key={v.id} data-testid="cmp-version"><td><button type="button" className="btn" onClick={() => navigateTo(`/bud/budget?id=${v.id}`)}>{v.docNo}</button></td><td>{v.versionNo}</td><td><StatusBadge status={STATUS_TONE[v.status]} label={t(`st.${v.status}`)} /></td><td className="num">{inr(v.total)}</td><td>{v.change ? <button type="button" className="btn" onClick={() => navigateTo(`/bud/change?id=${v.change.id}`)}>{v.change.docNo} {t(`ctype.${v.change.changeType}`)}</button> : (v.reason ?? t(`vtype.${v.vtype}`))}</td></tr>)}</tbody></table></div>
          <h2>{t('cmp.history')}</h2>
          {d.history.length === 0 ? <p className="muted">{t('chg.emptyBody')}</p> : <div className="table-scroll"><table className="data-table" data-testid="cmp-history"><thead><tr><th>{t('f.docNo')}</th><th>{t('chg.type')}</th><th>{t('chg.title')}</th><th>{t('f.status')}</th><th className="num">{t('chg.totalDelta')}</th><th className="num">{t('chg.pct')}</th></tr></thead>
            <tbody>{d.history.map((h) => <tr key={h.id}><td><button type="button" className="btn" onClick={() => navigateTo(`/bud/change?id=${h.id}`)}>{h.docNo}</button></td><td>{t(`ctype.${h.changeType}`)}</td><td>{h.title}</td><td><StatusBadge status={CHANGE_TONE[h.status]} label={t(`cst.${h.status}`)} /></td><td className="num">{inr(h.totalDelta)}</td><td className="num">{h.pct} %</td></tr>)}</tbody></table></div>}
        </>
      )}
    </section>
  );
}
