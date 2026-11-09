import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { BASES, RULE_TONE, RUN_TONE, al, bd, dp, download, inr } from './api.js';

// Overhead Allocation Rules (part 12.04, FR-04, BR-01): how a pool of head-office cost (the approved budget or the actual cost of chosen cost centres and accounts) is shared over the projects: by revenue, by direct cost or by fixed percentages. One person
// drafts a rule, another puts it in force; a run shows its shares before it is posted, the shares add up to the pool exactly, and part 23.10 reads the posted runs.
const emptyRule = (fyId = '') => ({ fyId, name: '', basis: 'REVENUE', costCentreIds: [], accountIds: [], projectIds: '', fixed: [{ projectId: '', pct: '' }], reason: '' });
export default function AllocPage() {
  const t = useT('bud');
  usePageTitle(t('al.title'));
  const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? [];
  const oq = useQuery({ queryKey: ['bud', 'dept-options'], queryFn: dp.options, retry: false });
  const rq = useQuery({ queryKey: ['bud', 'alloc-rules'], queryFn: () => al.rules(), retry: false });
  const nq = useQuery({ queryKey: ['bud', 'alloc-runs'], queryFn: () => al.runs(), enabled: rq.isSuccess, retry: false });
  const pq = useQuery({ queryKey: ['bud', 'project-options'], queryFn: bd.projects, enabled: rq.isSuccess, retry: false });
  const [f, setF] = useState(null); const [run, setRun] = useState({ ruleId: '', fromPeriodNo: 1, toPeriodNo: 12, poolSource: 'BUDGET' }); const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [hist, setHist] = useState(null);
  if (rq.error?.status === 403) return <NoPermission what={t('al.title')} permission="bud.alloc.view" />;
  if (rq.isPending || oq.isPending) return <Skeleton label={t('al.title')} rows={4} />;
  if (rq.isError) return <ErrorState error={rq.error} onRetry={rq.refetch} />;
  const rules = rq.data.rows; const form = f ?? emptyRule(oq.data?.fys[0]?.id ?? ''); const active = rules.filter((r) => r.status === 'ACTIVE');
  const set = (k, v) => setF({ ...form, [k]: v });
  const toggle = (k, id) => set(k, form[k].includes(id) ? form[k].filter((x) => x !== id) : [...form[k], id]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['bud'] });
  const act = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); refresh(); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const create = (e) => {
    e.preventDefault();
    act(async () => {
      await al.createRule({ fyId: Number(form.fyId), name: form.name.trim(), basis: form.basis, pool: { costCentreIds: form.costCentreIds, accountIds: form.accountIds }, reason: form.reason.trim(),
        projectIds: form.basis === 'FIXED_PCT' ? [] : form.projectIds.split(',').map((x) => Number(x.trim())).filter(Boolean), fixed: form.basis === 'FIXED_PCT' ? form.fixed.filter((x) => x.projectId).map((x) => ({ projectId: Number(x.projectId), pct: Number(x.pct) })) : [] });
      setF(null);
    }, t('al.drafted'));
  };
  const runBody = () => ({ ruleId: Number(run.ruleId), fromPeriodNo: Number(run.fromPeriodNo), toPeriodNo: Number(run.toPeriodNo), poolSource: run.poolSource });
  const doPreview = (e) => { e.preventDefault(); setPreview(null); act(async () => { setPreview(await al.preview(runBody())); }); };
  const post = () => act(async () => { await al.post({ ...runBody(), expectedPool: Number(preview.pool) }); setPreview(null); }, t('al.posted'));
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) act(() => fn(x), done); };
  const periods = oq.data?.fys.find((x) => x.id === rules.find((r) => r.id === Number(run.ruleId))?.fyId)?.periods ?? oq.data?.fys[0]?.periods ?? [];
  const show = async (r) => setHist({ r, h: await al.ruleHistory(r.id) });
  return (
    <section aria-labelledby="al-h" data-testid="bud-alloc">
      <h1 id="al-h">{t('al.title')}</h1>
      <p className="muted">{t('al.intro')} <span data-testid="al-inforce">{t('al.inForce', { n: rq.data.inForce })}</span></p>
      {note && <p className="mdm-banner" role="status" data-testid="al-note">{note}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="al-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}

      {perms.includes('bud.alloc.configure') && (
        <form className="mdm-panel" onSubmit={create} data-testid="al-form" aria-label={t('al.draft')}>
          <h2>{t('al.draft')}</h2>
          <div className="form-grid">
            <Field label={t('dp.fy')} name="fyId" error={error}><select value={form.fyId} onChange={(e) => set('fyId', e.target.value)} required data-testid="al-fy">{oq.data.fys.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></Field>
            <Field label={t('al.name')} name="name" error={error}><input value={form.name} onChange={(e) => set('name', e.target.value)} required minLength={3} maxLength={120} data-testid="al-name" /></Field>
            <Field label={t('al.basis')} name="basis" error={error}><select value={form.basis} onChange={(e) => set('basis', e.target.value)} data-testid="al-basis">{BASES.map((k) => <option key={k} value={k}>{t(`al.basis.${k}`)}</option>)}</select></Field>
            <Field label={t('f.reason')} name="reason" error={error}><input value={form.reason} onChange={(e) => set('reason', e.target.value)} required minLength={5} maxLength={1000} data-testid="al-reason" /></Field>
          </div>
          <fieldset><legend>{t('al.poolCc')}</legend>
            {oq.data.costCentres.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={form.costCentreIds.includes(c.id)} onChange={() => toggle('costCentreIds', c.id)} data-testid="al-cc" /> {c.code} · {c.name}</label>)}
          </fieldset>
          <fieldset><legend>{t('al.poolAccounts')}</legend>
            <p className="muted">{t('al.poolAccountsHelp')}</p>
            {oq.data.accounts.map((a) => <label key={a.id} className="check"><input type="checkbox" checked={form.accountIds.includes(a.id)} onChange={() => toggle('accountIds', a.id)} /> {a.code} {a.name}</label>)}
          </fieldset>
          {form.basis === 'FIXED_PCT' ? (
            <fieldset><legend>{t('al.fixed')}</legend>
              {form.fixed.map((x, i) => (
                <div className="form-grid" key={i} data-testid="al-fixed-row">
                  <Field label={t('f.project')} name={`fixed${i}`} error={error}><select value={x.projectId} onChange={(e) => set('fixed', form.fixed.map((y, n) => (n === i ? { ...y, projectId: e.target.value } : y)))} data-testid="al-fixed-project"><option value="">—</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
                  <Field label={t('al.pct')} name={`pct${i}`} error={error}><input type="number" min="0" max="100" step="0.0001" value={x.pct} onChange={(e) => set('fixed', form.fixed.map((y, n) => (n === i ? { ...y, pct: e.target.value } : y)))} data-testid="al-fixed-pct" /></Field>
                  <button type="button" className="btn" onClick={() => set('fixed', form.fixed.filter((_, n) => n !== i))}>{t('act.delete')}</button>
                </div>))}
              <p data-testid="al-fixed-sum">{t('al.sum', { n: form.fixed.reduce((a, x) => a + Number(x.pct || 0), 0).toFixed(4) })}</p>
              <button type="button" className="btn" onClick={() => set('fixed', [...form.fixed, { projectId: '', pct: '' }])} data-testid="al-fixed-add">{t('al.addShare')}</button>
            </fieldset>
          ) : (
            <Field label={t('al.projectsOnly')} name="projectIds" error={error}><input value={form.projectIds} onChange={(e) => set('projectIds', e.target.value)} placeholder={t('al.allActive')} data-testid="al-projects" /></Field>
          )}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={form.costCentreIds.length === 0 || form.name.trim().length < 3 || form.reason.trim().length < 5} data-testid="al-save">{t('al.saveDraft')}</button></div>
        </form>
      )}

      <div className="actions-row no-print"><button type="button" className="btn" onClick={() => download('/alloc-rules/export', 'overhead-allocation-rules.csv')} data-testid="al-export">{t('cmp.export')}</button></div>
      {rules.length === 0 ? <p className="muted" data-testid="al-empty">{t('al.empty')}</p> : (
        <div className="table-scroll"><table className="data-table" data-testid="al-table"><caption className="sr-only">{t('al.title')}</caption>
          <thead><tr><th>{t('f.docNo')}</th><th>{t('al.name')}</th><th>{t('dp.fy')}</th><th>{t('al.basis')}</th><th>{t('al.pool')}</th><th>{t('f.status')}</th><th>{t('cfg.by')}</th><th /></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id} data-testid="al-rule" data-status={r.status}>
              <td>{r.docNo}</td><td>{r.name}</td><td>{r.fy}</td><td>{t(`al.basis.${r.basis}`)}{r.basis === 'FIXED_PCT' ? ` (${r.fixed.map((x) => `${x.project?.code} ${x.pct} %`).join(', ')})` : ''}</td>
              <td>{r.pool.costCentres.map((c) => c.code).join(', ')}{r.pool.accounts.length ? ` · ${r.pool.accounts.map((a) => a.code).join(', ')}` : ` · ${t('al.allAccounts')}`}</td>
              <td><StatusBadge status={RULE_TONE[r.status]} label={t(`rst.${r.status}`)} /></td><td>{r.requestedBy}{r.approvedBy ? ` → ${r.approvedBy}` : ''}</td>
              <td>
                <button type="button" className="btn" onClick={() => show(r)} data-testid="al-history">{t('page.history')}</button>
                {r.can.activate && <button type="button" className="btn btn-primary" onClick={() => act(() => al.activate(r.id), t('al.activated'))} data-testid="al-activate">{t('al.activate')}</button>}
                {r.can.cancel && <button type="button" className="btn" onClick={() => why((x) => al.cancelRule(r.id, x), t('page.cancelled'))} data-testid="al-cancel">{t('act.cancel')}</button>}
              </td>
            </tr>))}</tbody></table></div>
      )}
      {hist && (
        <div className="mdm-panel" data-testid="al-hist"><h2>{hist.r.docNo} · {t('page.history')}</h2>
          <ul>{hist.h.audit.map((a, i) => <li key={i}>{`${a.at?.slice(0, 16)} · ${a.action} · ${a.actor}${a.reason ? `: ${a.reason}` : ''}`}</li>)}</ul>
          <div className="actions"><button type="button" className="btn" onClick={() => setHist(null)}>{t('act.close')}</button></div>
        </div>
      )}

      <h2>{t('al.runTitle')}</h2>
      {active.length === 0 ? <p className="muted" data-testid="al-noactive">{t('al.noActive')}</p> : (
        <form className="mdm-panel" onSubmit={doPreview} data-testid="al-run-form" aria-label={t('al.runTitle')}>
          <div className="form-grid">
            <Field label={t('al.rule')} name="ruleId" error={error}><select value={run.ruleId} onChange={(e) => { setRun({ ...run, ruleId: e.target.value }); setPreview(null); }} required data-testid="al-run-rule"><option value="">—</option>{active.map((r) => <option key={r.id} value={r.id}>{r.docNo} · {r.name}</option>)}</select></Field>
            <Field label={t('al.from')} name="fromPeriodNo" error={error}><select value={run.fromPeriodNo} onChange={(e) => { setRun({ ...run, fromPeriodNo: Number(e.target.value) }); setPreview(null); }} data-testid="al-run-from">{periods.map((p) => <option key={p.id} value={p.periodNo}>{p.name}</option>)}</select></Field>
            <Field label={t('al.to')} name="toPeriodNo" error={error}><select value={run.toPeriodNo} onChange={(e) => { setRun({ ...run, toPeriodNo: Number(e.target.value) }); setPreview(null); }} data-testid="al-run-to">{periods.map((p) => <option key={p.id} value={p.periodNo}>{p.name}</option>)}</select></Field>
            <Field label={t('al.source')} name="poolSource" error={error}><select value={run.poolSource} onChange={(e) => { setRun({ ...run, poolSource: e.target.value }); setPreview(null); }} data-testid="al-run-source">{['BUDGET', 'ACTUAL'].map((k) => <option key={k} value={k}>{t(`al.source.${k}`)}</option>)}</select></Field>
          </div>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={!run.ruleId} data-testid="al-preview">{t('al.preview')}</button></div>
        </form>
      )}
      {preview && (
        <div className="mdm-panel" data-testid="al-preview-panel">
          <h3>{t('al.previewTitle', { rule: preview.ruleDocNo, from: preview.from.name, to: preview.to.name })}</h3>
          <p data-testid="al-pool">{t('al.poolIs', { pool: inr(preview.pool), source: preview.poolSourceLabel })} · {t('al.basisSource', { s: preview.basisSource.toLowerCase().replaceAll('_', ' ') })}</p>
          <ul className="muted">{preview.breakdown.map((b) => <li key={b.costCentreId}>{b.costCentre}: ₹ {inr(b.amount)}</li>)}</ul>
          <div className="table-scroll"><table className="data-table" data-testid="al-lines"><caption className="sr-only">{t('al.previewTitle', { rule: preview.ruleDocNo, from: preview.from.name, to: preview.to.name })}</caption>
            <thead><tr><th>{t('f.project')}</th><th className="num">{t('al.basisValue')}</th><th className="num">{t('al.share')}</th><th className="num">{t('f.amount')}</th><th className="num">{t('al.residual')}</th></tr></thead>
            <tbody>{preview.lines.map((l) => <tr key={l.projectId} data-testid="al-line"><td>{l.project}</td><td className="num">{inr(l.basisValue)}</td><td className="num">{l.share} %</td><td className="num">{inr(l.amount)}</td><td className="num">{l.residual === '0.00' ? '—' : inr(l.residual)}</td></tr>)}
              <tr><th scope="row">{t('f.total')}</th><td /><td /><td className="num" data-testid="al-allocated">{inr(preview.allocated)}</td><td /></tr></tbody></table></div>
          <p className={preview.balanced ? '' : 'field-error'} data-testid="al-balanced">{preview.balanced ? t('al.balanced') : t('al.notBalanced')}</p>
          {perms.includes('bud.alloc.run') && <div className="actions"><button type="button" className="btn btn-primary" onClick={post} disabled={!preview.balanced} data-testid="al-post">{t('al.post')}</button></div>}
        </div>
      )}

      <h2>{t('al.runs')}</h2>
      {nq.isPending ? <Skeleton label={t('al.runs')} rows={2} /> : (nq.data?.rows ?? []).length === 0 ? <p className="muted" data-testid="al-noruns">{t('al.noRuns')}</p> : (
        <div className="table-scroll"><table className="data-table" data-testid="al-runs"><caption className="sr-only">{t('al.runs')}</caption>
          <thead><tr><th>{t('f.docNo')}</th><th>{t('al.rule')}</th><th>{t('al.period')}</th><th className="num">{t('al.pool')}</th><th>{t('f.status')}</th><th>{t('al.runBy')}</th><th /></tr></thead>
          <tbody>{nq.data.rows.map((r) => (
            <tr key={r.id} data-testid="al-run" data-status={r.status}>
              <td>{r.docNo}</td><td>{r.rule}</td><td>{r.from} – {r.to}</td><td className="num">{inr(r.pool)}</td><td><StatusBadge status={RUN_TONE[r.status]} label={t(`rnst.${r.status}`)} /></td><td>{r.runBy}</td>
              <td>{r.can.reverse && <button type="button" className="btn" onClick={() => why((x) => al.reverse(r.id, x), t('al.reversed'))} data-testid="al-reverse">{t('al.reverse')}</button>}</td>
            </tr>))}</tbody></table></div>
      )}
    </section>
  );
}
