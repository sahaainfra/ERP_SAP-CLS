import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { Tabs } from '../proj/parts.jsx';
import { DIMENSIONS, KINDS, PROFILES, STATUS_TONE, TYPES, bd, inr, openPrint } from './api.js';
import { ShareBar, useSearch } from './parts.jsx';

// Budget Workbench (part 12.01): the lines of a budget (generated values beside the adjusted ones, every adjustment with its reason), the views by WBS, cost head, resource, work package and control account, the phasing chart, the margin against the contract value, and the versions and approval.
const TABS = ['lines', 'views', 'phasing', 'margin', 'versions'];
function Chart({ periods, label }) {
  const W = 640; const H = 220; const pad = 36; const n = Math.max(periods.length, 2);
  const x = (i) => pad + (i * (W - 2 * pad)) / (n - 1); const y = (v) => H - pad - (v * (H - 2 * pad)) / 100;
  const pts = periods.map((p, i) => `${x(i)},${y(p.cumulativePct)}`).join(' ');
  return (
    <figure data-testid="bd-chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ width: '100%', height: 'auto', maxHeight: '16rem' }}>
        {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} stroke="var(--erp-color-border-subtle)" /><text x={4} y={y(v) + 4} fontSize="10" fill="var(--erp-color-text-muted)">{v}%</text></g>)}
        {periods.length > 1 && <polyline points={pts} fill="none" stroke="var(--erp-color-status-info-solid)" strokeWidth="2.5" data-testid="bd-chart-line" />}
        {periods.map((p, i) => (i % Math.ceil(periods.length / 6) === 0 || i === periods.length - 1) ? <text key={p.period} x={x(i)} y={H - 10} fontSize="10" textAnchor="middle" fill="var(--erp-color-text-muted)">{p.period.slice(2)}</text> : null)}
      </svg>
    </figure>
  );
}
export default function BudgetPage() {
  const t = useT('bud');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['bud', 'budget', id], queryFn: () => bd.get(id), enabled: Boolean(id), retry: false });
  const [tab, setTab] = useState('lines'); const [by, setBy] = useState('wbs'); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [adj, setAdj] = useState(null); const [add, setAdd] = useState(null); const [ph, setPh] = useState({ profile: 'SCURVE', from: '', to: '' });
  const pid = q.data?.projectId;
  const vq = useQuery({ queryKey: ['bud', 'views', id, by], queryFn: () => bd.views(id, by), enabled: Boolean(id) && q.isSuccess && tab === 'views', retry: false });
  const pq = useQuery({ queryKey: ['bud', 'phasing', id], queryFn: () => bd.phasing(id), enabled: Boolean(id) && q.isSuccess && tab === 'phasing', retry: false });
  const hq = useQuery({ queryKey: ['bud', 'history', id], queryFn: () => bd.history(id), enabled: Boolean(id) && q.isSuccess && tab === 'versions', retry: false });
  const sq = useQuery({ queryKey: ['bud', 'structure', pid], queryFn: () => bd.wbs(pid), enabled: Boolean(pid) && Boolean(add), retry: false });
  usePageTitle(q.data ? `${q.data.docNo} ${q.data.name}` : t('page.title'));
  if (!id) return <section aria-labelledby="bd-h" data-testid="bd-none"><h1 id="bd-h">{t('page.title')}</h1><p className="muted"><Link to="/bud/budgets">{t('nav.budgets')}</Link></p></section>;
  if (q.error?.status === 403) return <NoPermission what={t('nav.budgets')} permission="bud.budget.view" />;
  if (q.isPending) return <Skeleton label={t('page.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const b = q.data; const c = b.can; const m = b.margin;
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bud'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  const saveAdj = (e) => { e.preventDefault(); run(async () => { await bd.updateLine(adj.id, { qty: Number(adj.qty), rate: Number(adj.rate), reason: adj.reason.trim() }); setAdj(null); }, t('lines.adjusted')); };
  const saveAdd = (e) => { e.preventDefault(); run(async () => { await bd.addLine(b.id, { lineKind: add.lineKind, wbsId: add.lineKind === 'DIRECT' && add.wbsId ? Number(add.wbsId) : null, costCodeId: add.costCodeId ? Number(add.costCodeId) : null, resourceType: add.resourceType, resourceName: add.resourceName.trim(), uom: add.uom.trim() || null, qty: add.qty === '' ? null : Number(add.qty), amount: add.amount === '' ? null : Number(add.amount), reason: add.reason.trim() }); setAdd(null); }, t('lines.added')); };
  const phase = (e) => { e.preventDefault(); run(() => bd.phase(b.id, { method: 'SCURVE', profile: ph.profile, from: ph.from || null, to: ph.to || null }), t('phasing.done')); };
  const lines = b.lines;
  return (
    <section aria-labelledby="bd-h" data-testid="budget" data-status={b.status} data-number={b.docNo} data-version={b.versionNo}>
      <header>
        <h1 id="bd-h">{b.docNo} · {b.name} <StatusBadge status={STATUS_TONE[b.status]} label={t(`st.${b.status}`)} /></h1>
        <p className="muted">{b.projectCode} {b.projectName} · {t(`vtype.${b.vtype}`)} · {t('f.version')} {b.versionNo}{b.locked ? ` · ${t('page.locked')}` : ''}{b.pack ? ` · ${t('gen.pack')} ${b.pack.docNo}` : ''}{b.boqVersion ? ` · ${t('gen.boq')} ${b.boqVersion.docNo}` : ''}</p>
        <dl className="kv" data-testid="bd-totals">
          {[['direct', b.directTotal], ['overhead', b.overheadTotal], ['contingency', b.contingencyTotal], ['reserve', b.reserveTotal], ['total', b.totalAmount], ['contract', b.contractValue]].map(([k, v]) => <div key={k}><dt>{t(`gen.t.${k === 'contract' ? 'contractValue' : k}`)}</dt><dd data-testid={`bd-t-${k}`}>₹ {inr(v)}</dd></div>)}
        </dl>
        {m.warning && <p className="mdm-banner" role="alert" data-testid="bd-warning">{t('margin.warning', { over: inr(m.over), pct: m.targetMarginPct })}</p>}
        {!b.readiness.ok && c.submit && <details data-testid="bd-readiness"><summary>{t('page.notReady', { n: b.readiness.problems.length })}</summary><ul>{b.readiness.problems.map((p) => <li key={p.code}>{p.text}</li>)}</ul></details>}
        {error?.form && <p className="field-error" role="alert" data-testid="bd-act-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="bd-note">{note}</p>}
        <div className="actions-row no-print">
          {c.edit && <button type="button" className="btn" onClick={() => setAdd({ lineKind: 'DIRECT', wbsId: '', costCodeId: '', resourceType: 'MATERIAL', resourceName: '', uom: '', qty: '', amount: '', reason: '' })} data-testid="bd-add">{t('lines.add')}</button>}
          {c.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => bd.act(b.id, 'submit'), t('page.sent'))} data-testid="bd-submit">{t('page.submit')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((x) => bd.act(b.id, 'withdraw', { reason: x }), t('page.withdrawn'))} data-testid="bd-withdraw">{t('act.withdraw')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((x) => bd.act(b.id, 'cancel', { reason: x }), t('page.cancelled'))} data-testid="bd-cancel">{t('act.cancel')}</button>}
          {c.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => bd.act(b.id, 'amend', { reason: x })); if (n && n.id !== b.id) navigateTo(`/bud/budget?id=${n.id}`); } }} data-testid="bd-amend">{t('page.revise')}</button>}
          {c.delete && <button type="button" className="btn" onClick={async () => { if (await run(() => bd.remove(b.id))) navigateTo('/bud/budgets'); }} data-testid="bd-delete">{t('act.delete')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => openPrint(`/budgets/${b.id}/print`, `${b.docNo}.html`)} data-testid="bd-print">{t('act.print')}</button>}
          {b.workflowInstanceId && <Link to={`/workflow/instance?id=${b.workflowInstanceId}`}>{t('page.approval')}</Link>}
        </div>
      </header>
      {add && (
        <form className="mdm-panel" aria-label={t('lines.add')} data-testid="bd-add-form" onSubmit={saveAdd}>
          <h2>{t('lines.add')}</h2>
          <div className="form-grid">
            <Field label={t('f.kind')} name="lineKind" error={error}><select value={add.lineKind} onChange={(e) => setAdd({ ...add, lineKind: e.target.value })} data-testid="add-kind">{KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}</select></Field>
            {add.lineKind === 'DIRECT' && <Field label={t('f.wbs')} name="wbsId" error={error}><select value={add.wbsId} onChange={(e) => setAdd({ ...add, wbsId: e.target.value })} data-testid="add-wbs"><option value="">—</option>{(sq.data?.wbs ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>}
            {(add.lineKind === 'DIRECT' || add.lineKind === 'OVERHEAD') && <Field label={t('f.costCode')} name="costCodeId" error={error}><select value={add.costCodeId} onChange={(e) => setAdd({ ...add, costCodeId: e.target.value })} data-testid="add-code"><option value="">—</option>{(sq.data?.costCodes ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>}
            <Field label={t('f.type')} name="resourceType" error={error}><select value={add.resourceType} onChange={(e) => setAdd({ ...add, resourceType: e.target.value })} data-testid="add-type">{TYPES.map((k) => <option key={k} value={k}>{t(`type.${k}`)}</option>)}</select></Field>
            <Field label={t('f.resource')} name="resourceName" error={error}><input value={add.resourceName} onChange={(e) => setAdd({ ...add, resourceName: e.target.value })} required maxLength={200} data-testid="add-name" /></Field>
            <Field label={t('f.uom')} name="uom" error={error}><input value={add.uom} onChange={(e) => setAdd({ ...add, uom: e.target.value })} maxLength={20} data-testid="add-uom" /></Field>
            <Field label={t('f.qty')} name="qty" error={error}><input type="number" min="0" step="0.001" value={add.qty} onChange={(e) => setAdd({ ...add, qty: e.target.value })} data-testid="add-qty" /></Field>
            <Field label={t('f.amount')} name="amount" error={error}><input type="number" min="0" step="0.01" value={add.amount} onChange={(e) => setAdd({ ...add, amount: e.target.value })} data-testid="add-amount" /></Field>
            <Field label={t('f.reason')} name="reason" error={error}><input value={add.reason} onChange={(e) => setAdd({ ...add, reason: e.target.value })} required minLength={5} maxLength={1000} data-testid="add-reason" /></Field>
          </div>
          <div className="actions"><button type="button" className="btn" onClick={() => setAdd(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="add-save">{t('act.save')}</button></div>
        </form>
      )}
      {adj && (
        <form className="mdm-panel" aria-label={t('lines.adjust')} data-testid="bd-adj-form" onSubmit={saveAdj}>
          <h2>{t('lines.adjust')}: {adj.name}</h2>
          <div className="form-grid">
            <Field label={t('f.qty')} name="qty" error={error}><input type="number" min="0" step="0.001" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} data-testid="adj-qty" /></Field>
            <Field label={t('f.rate')} name="rate" error={error}><input type="number" min="0" step="0.0001" value={adj.rate} onChange={(e) => setAdj({ ...adj, rate: e.target.value })} data-testid="adj-rate" /></Field>
            <Field label={t('f.reason')} name="reason" error={error}><input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} required minLength={5} maxLength={1000} data-testid="adj-reason" /></Field>
          </div>
          <div className="actions"><button type="button" className="btn" onClick={() => setAdj(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="adj-save">{t('act.save')}</button></div>
        </form>
      )}
      <Tabs tabs={TABS} active={tab} onChange={setTab} label={t('page.tabs')} labelOf={(k) => t(`tab.${k}`)} />
      {tab === 'lines' && (
        <div className="table-scroll" data-testid="bd-lines"><table className="data-table"><caption className="sr-only">{t('tab.lines')}</caption>
          <thead><tr><th>{t('f.kind')}</th><th>{t('f.wbs')}</th><th>{t('f.costCode')}</th><th>{t('f.resource')}</th><th>{t('f.uom')}</th><th className="num">{t('f.qty')}</th><th className="num">{t('f.rate')}</th><th className="num">{t('f.amount')}</th><th className="num">{t('lines.generated')}</th><th /></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id} data-testid="bd-line" data-adjusted={l.adjusted ? '1' : '0'} data-unrated={l.unrated ? '1' : '0'}>
              <td>{t(`kind.${l.lineKind}`)}</td><td>{l.wbsCode ?? '—'}</td><td>{l.costCode ?? '—'}</td><td>{l.resourceName}{l.unrated ? ` (${t('lines.unrated')})` : ''}{l.origin === 'MANUAL' ? ` · ${t('lines.manual')}` : ''}</td><td>{l.uom ?? ''}</td>
              <td className="num">{l.qty}</td><td className="num">{inr(l.rate)}</td><td className="num">{inr(l.amount)}</td>
              <td className="num muted" title={l.adjustReason ?? ''}>{l.genAmount != null ? inr(l.genAmount) : '—'}</td>
              <td>{c.edit && <button type="button" className="btn" onClick={() => setAdj({ id: l.id, name: l.resourceName, qty: String(l.qty), rate: String(l.rate), reason: '' })} data-testid="bd-line-adjust">{t('lines.adjust')}</button>}
                {c.edit && <button type="button" className="btn" onClick={() => why((x) => bd.removeLine(l.id, x), t('lines.removed'))} data-testid="bd-line-remove">{t('act.delete')}</button>}</td>
            </tr>))}</tbody></table></div>
      )}
      {tab === 'views' && (
        <div data-testid="bd-views">
          <Field label={t('views.by')} name="by"><select value={by} onChange={(e) => setBy(e.target.value)} data-testid="bd-by">{DIMENSIONS.map((k) => <option key={k} value={k}>{t(`dim.${k}`)}</option>)}</select></Field>
          {vq.isPending ? <Skeleton label={t('tab.views')} rows={3} /> : vq.isError ? <ErrorState error={vq.error} onRetry={vq.refetch} /> : (
            <table className="data-table" data-reconciled={vq.data.reconciled ? '1' : '0'}><caption className="sr-only">{t(`dim.${by}`)}</caption>
              <thead><tr><th>{t(`dim.${by}`)}</th><th className="num">{t('f.amount')}</th><th className="num">{t('views.share')}</th><th>{t('views.bar')}</th></tr></thead>
              <tbody>{vq.data.rows.map((r) => <tr key={r.key} data-testid="bd-view-row"><td>{r.label}</td><td className="num">{inr(r.amount)}</td><td className="num">{r.share} %</td><td style={{ minWidth: '6rem' }}><ShareBar pct={r.share} label={`${r.share} %`} /></td></tr>)}
                <tr><th scope="row">{t('gen.t.total')}</th><td className="num" data-testid="bd-view-total">{inr(vq.data.total)}</td><td /><td /></tr></tbody></table>
          )}
        </div>
      )}
      {tab === 'phasing' && (
        <div data-testid="bd-phasing">
          {c.edit && (
            <form className="mdm-panel" onSubmit={phase} data-testid="bd-phase-form">
              <div className="form-grid">
                <Field label={t('phasing.profile')} name="profile"><select value={ph.profile} onChange={(e) => setPh({ ...ph, profile: e.target.value })} data-testid="ph-profile">{PROFILES.map((k) => <option key={k} value={k}>{t(`profile.${k}`)}</option>)}</select></Field>
                <Field label={t('phasing.from')} name="from"><input type="month" value={ph.from} onChange={(e) => setPh({ ...ph, from: e.target.value })} data-testid="ph-from" /></Field>
                <Field label={t('phasing.to')} name="to"><input type="month" value={ph.to} onChange={(e) => setPh({ ...ph, to: e.target.value })} data-testid="ph-to" /></Field>
              </div>
              <p className="muted">{t('phasing.schedule')}</p>
              <div className="actions"><button type="submit" className="btn btn-primary" data-testid="ph-go">{t('phasing.generate')}</button></div>
            </form>
          )}
          {pq.isPending ? <Skeleton label={t('tab.phasing')} rows={3} /> : pq.isError ? <ErrorState error={pq.error} onRetry={pq.refetch} /> : (
            <>
              <p data-testid="ph-status" data-reconciled={pq.data.reconciled ? '1' : '0'}>{pq.data.methodLabel ?? t('phasing.none')} · ₹ {inr(pq.data.phasedTotal)} / ₹ {inr(pq.data.total)}{pq.data.reconciled ? ` · ${t('phasing.reconciled')}` : ` · ${t('phasing.unphased', { n: pq.data.unphasedLines })}`}</p>
              <Chart periods={pq.data.periods} label={t('phasing.chart')} />
              <div className="table-scroll"><table className="data-table" data-testid="ph-table"><thead><tr><th>{t('phasing.month')}</th><th className="num">{t('f.amount')}</th><th className="num">{t('phasing.cumulative')}</th></tr></thead>
                <tbody>{pq.data.periods.map((p) => <tr key={p.period}><td>{p.period}</td><td className="num">{inr(p.amount)}</td><td className="num">{p.cumulativePct} %</td></tr>)}</tbody></table></div>
            </>
          )}
        </div>
      )}
      {tab === 'margin' && (
        <div data-testid="bd-margin" data-warning={m.warning ? '1' : '0'}>
          <table className="data-table"><caption className="sr-only">{t('tab.margin')}</caption><tbody>
            {[['contractValue', m.contractValue], ['directCost', m.directCost], ['overheads', m.overheads], ['contingency', m.contingency], ['costBasis', m.costBasis], ['limit', m.limit], ['margin', m.margin], ['reserve', m.reserve], ['marginAfterReserve', m.marginAfterReserve]].map(([k, v]) => <tr key={k}><th scope="row">{t(`margin.${k}`)}</th><td className="num" data-testid={`mg-${k}`}>₹ {inr(v)}</td></tr>)}
            <tr><th scope="row">{t('margin.marginPct')}</th><td className="num" data-testid="mg-pct">{m.marginPct ?? '—'} % ({t('margin.target')} {m.targetMarginPct} %)</td></tr>
          </tbody></table>
          <p className={m.warning ? 'field-error' : 'muted'} data-testid="mg-message">{m.message ?? t('margin.ok')}</p>
        </div>
      )}
      {tab === 'versions' && (
        <div data-testid="bd-versions">
          <table className="data-table"><thead><tr><th>{t('f.docNo')}</th><th>{t('f.version')}</th><th>{t('f.status')}</th><th className="num">{t('f.total')}</th></tr></thead>
            <tbody>{b.versions.map((v) => <tr key={v.id} data-testid="bd-version"><td><button type="button" className="btn" onClick={() => navigateTo(`/bud/budget?id=${v.id}`)}>{v.docNo}</button></td><td>{v.versionNo} · {t(`vtype.${v.vtype}`)}</td><td>{t(`st.${v.status}`)}</td><td className="num">{inr(v.totalAmount)}</td></tr>)}</tbody></table>
          {b.reason && <p className="muted" data-testid="bd-reason">{t('page.reason')}: {b.reason}</p>}
          <h2>{t('page.history')}</h2>
          {hq.isPending ? <Skeleton label={t('page.history')} rows={2} /> : <ul data-testid="bd-history">{[...(hq.data?.approvals ?? []).map((a) => `${a.at?.slice(0, 16)} · ${a.step_code ?? ''} ${a.event} · ${a.actor}${a.comment ? `: ${a.comment}` : ''}`), ...(hq.data?.audit ?? []).map((a) => `${a.at?.slice(0, 16)} · ${a.action} · ${a.actor}${a.reason ? `: ${a.reason}` : ''}`)].map((s, i) => <li key={i}>{s}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
