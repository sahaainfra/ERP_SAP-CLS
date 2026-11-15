import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { LEVEL_TONE, RISK_CATEGORIES, RISK_STRATEGIES, RISK_TONE, dayIST, downloadFile, inr, rk } from './api.js';
import { Tabs, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Risk (part 10.06, FR-01, FR-04, FR-05, BR-01, BR-02): one risk or opportunity with its assessment (the score, level and EMV are the server's), exposure, response actions (tasks) and early-warning triggers, contingency, and its history. The owner asks to
// close it with a justification; a high or critical risk waits for the project manager.
const norm = (r) => ({ title: r.title, description: r.description ?? '', cause: r.cause ?? '', effect: r.effect ?? '', category: r.category, ownerUser: r.ownerUser, probability: r.probability, impactCost: r.impactCost, impactTime: r.impactTime, impactQuality: r.impactQuality, impactSafety: r.impactSafety, strategy: r.strategy,
  residualProbability: r.residualProbability ?? '', residualImpact: r.residualImpact ?? '', exposureCost: r.exposureCost, exposureDays: r.exposureDays, actions: r.actions.map((a) => ({ description: a.description, ownerUser: a.ownerUser, dueDate: a.dueDate })), triggers: r.triggers.map((x) => ({ name: x.name, indicator: x.indicator ?? '', comparator: x.comparator, threshold: x.threshold, unit: x.unit ?? '' })) });
export default function RiskPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['proj', 'risk', id], queryFn: () => rk.risk(id), enabled: Boolean(id), retry: false });
  const h = useQuery({ queryKey: ['proj', 'risk-history', id], queryFn: () => rk.riskHistory(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [tab, setTab] = useState('assessment'); const [f, setF] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [reading, setReading] = useState({}); const [cont, setCont] = useState({ kind: 'ALLOCATION', amount: '', reason: '' }); const [closing, setClosing] = useState(null);
  usePageTitle(q.data ? `${q.data.docNo} ${q.data.title}` : t('rk.title'));
  if (!id) return <section aria-labelledby="rk-h" data-testid="rk-none"><PageHeader id="rk-h" title={t('rk.title')} subtitle={<Link to="/proj/risks">{t('rk.registerTitle')}</Link>} /></section>;
  if (q.error?.status === 403) return <NoPermission what={t('rk.registerTitle')} permission="proj.risk.view" />;
  if (q.isPending) return <Skeleton label={t('rk.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const c = r.can; const form = f ?? norm(r); const dirty = f !== null; const editing = c.edit;
  const set = (k, v) => setF({ ...form, [k]: v });
  const setIn = (k, kk, v) => set(k, { ...form[k], [kk]: v });
  const upd = (list, i, k, v) => set(list, form[list].map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const run = async (fn, done) => { setError(null); setNote(null); try { const out = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return out ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const w = window.prompt(t('act.why')); if (w) run(() => fn(w), done); };
  const save = async () => {
    const body = { ...form, description: form.description || null, cause: form.cause || null, effect: form.effect || null, probability: Number(form.probability), impactCost: Number(form.impactCost), impactTime: Number(form.impactTime), impactQuality: Number(form.impactQuality), impactSafety: Number(form.impactSafety),
      residualProbability: form.residualProbability === '' ? null : Number(form.residualProbability), residualImpact: form.residualImpact === '' ? null : Number(form.residualImpact), exposureDays: Object.fromEntries(Object.entries(form.exposureDays).map(([k, v]) => [k, Number(v) || 0])),
      triggers: form.triggers.map((x) => ({ ...x, indicator: x.indicator || null, unit: x.unit || null, threshold: Number(x.threshold) || 0 })), rowVersion: r.rowVersion };
    if (await run(() => rk.updateRisk(r.id, body), t('rk.saved'))) setF(null);
  };
  const scale = [1, 2, 3, 4, 5];
  const sel = (k, label, optional = false) => <Field label={label} name={k} error={error}><select value={form[k]} disabled={!editing} onChange={(e) => set(k, e.target.value)} data-testid={`rk-${k}`}>{optional && <option value="">—</option>}{scale.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>;
  const tabs = ['assessment', 'response', 'contingency', 'history'];
  return (
    <section aria-labelledby="rk-h" data-testid="risk" data-status={r.status} data-level={r.level}>
      <header>
        <PageHeader id="rk-h" title={<>{r.docNo} · {r.title} <StatusBadge status={RISK_TONE[r.status]} label={r.statusLabel} /> <StatusBadge status={LEVEL_TONE[r.level]} label={`${r.score} · ${t(`rk.level.${r.level}`)}`} /></>} subtitle={<>{r.projectCode} {r.projectName} · {r.typeLabel} · {r.categoryLabel} · {t('rk.col.owner')}: {r.ownerUser} · EMV {inr(r.emv)} ({r.probabilityPct}%)</>} />
        {r.status === 'CLOSE_REQUESTED' && <p className="mdm-banner" role="status" data-testid="rk-closing">{t('rk.closeWaiting', { by: r.requestedBy })}</p>}
        {r.closedAt && <p className="mdm-banner" role="status" data-testid="rk-closed">{t('rk.closedBy', { by: r.closedBy, at: String(r.closedAt).slice(0, 10), why: r.closeReason ?? '' })}</p>}
        {r.occurredIssueId && <p className="mdm-banner" role="status"><Link to={`/proj/issue?id=${r.occurredIssueId}`}>{t('rk.occurredIssue')}</Link></p>}
        {error?.form && <p className="field-error" role="alert" data-testid="rk-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="rk-note">{note}</p>}
        <div className="actions-row no-print">
          {editing && <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty} data-testid="rk-save">{t('act.save')}</button>}
          {c.submit && <button type="button" className="btn" onClick={() => setClosing(closing ? null : { reason: '', occurred: false })} data-testid="rk-close">{t('rk.closeAsk')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((w) => rk.riskAct(r.id, 'withdraw', { reason: w }), t('rk.withdrawn'))} data-testid="rk-withdraw">{t('act.withdraw')}</button>}
          {c.amend && <button type="button" className="btn" onClick={() => why((w) => rk.riskAct(r.id, 'amend', { reason: w }), t('rk.reopened'))} data-testid="rk-reopen">{t('rk.reopen')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((w) => rk.riskAct(r.id, 'cancel', { reason: w }), t('rk.cancelled'))} data-testid="rk-cancel">{t('act.cancel')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => downloadFile(`/risks/${r.id}/print?format=html`, `${r.docNo}.html`)} data-testid="rk-print">{t('act.print')}</button>}
        </div>
      </header>
      {closing && (
        <form className="mdm-panel" aria-label={t('rk.closeAsk')} data-testid="rk-close-form" onSubmit={(e) => { e.preventDefault(); run(() => rk.riskAct(r.id, 'submit', { reason: closing.reason, occurred: closing.occurred }), r.needsApproval ? t('rk.closeSent') : t('rk.closedNow')).then((x) => x && setClosing(null)); }}>
          <h2>{t('rk.closeAsk')}</h2>
          {r.needsApproval && <p className="muted">{t('rk.closeNeedsPm')}</p>}
          <Field label={t('rk.justification')} name="reason" error={error}><textarea value={closing.reason} onChange={(e) => setClosing({ ...closing, reason: e.target.value })} rows={3} maxLength={1000} data-testid="rk-close-reason" /></Field>
          {r.rtype === 'RISK' && <label><input type="checkbox" checked={closing.occurred} onChange={() => setClosing({ ...closing, occurred: !closing.occurred })} data-testid="rk-close-occurred" /> {t('rk.occurred')}</label>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={closing.reason.trim().length < 10} data-testid="rk-close-send">{t('act.submit')}</button></div>
        </form>
      )}
      <Tabs tabs={tabs} active={tab} onChange={setTab} label={t('rk.title')} />
      {tab === 'assessment' && (
        <div className="mdm-panel" role="tabpanel" aria-labelledby="ptab-assessment" data-testid="rk-tab-assessment">
          <div className="form-grid">
            <Field label={t('rk.col.title')} name="title" error={error}><input value={form.title} disabled={!editing} onChange={(e) => set('title', e.target.value)} maxLength={200} data-testid="rk-title" /></Field>
            <Field label={t('rk.col.category')} name="category" error={error}><select value={form.category} disabled={!editing} onChange={(e) => set('category', e.target.value)}>{RISK_CATEGORIES.map((k) => <option key={k} value={k}>{t(`rk.cat.${k}`)}</option>)}</select></Field>
            <LookupField id="rk-owner" label={t('rk.col.owner')} lookup="proj/people" valueKey="code" value={form.ownerUser} onChange={(v) => set('ownerUser', v)} disabled={!editing} />
            <Field label={t('rk.cause')} name="cause" error={error}><textarea value={form.cause} disabled={!editing} onChange={(e) => set('cause', e.target.value)} rows={2} maxLength={2000} /></Field>
            <Field label={t('rk.effect')} name="effect" error={error}><textarea value={form.effect} disabled={!editing} onChange={(e) => set('effect', e.target.value)} rows={2} maxLength={2000} /></Field>
            {sel('probability', t('rk.probability'))}{sel('impactCost', t('rk.impactCost'))}{sel('impactTime', t('rk.impactTime'))}{sel('impactQuality', t('rk.impactQuality'))}{sel('impactSafety', t('rk.impactSafety'))}
            <Field label={t('rk.strategy')} name="strategy" error={error}><select value={form.strategy} disabled={!editing} onChange={(e) => set('strategy', e.target.value)} data-testid="rk-strategy">{RISK_STRATEGIES[r.rtype].map((k) => <option key={k} value={k}>{t(`rk.strat.${k}`)}</option>)}</select></Field>
            {sel('residualProbability', t('rk.residualProbability'), true)}{sel('residualImpact', t('rk.residualImpact'), true)}
          </div>
          <p data-testid="rk-residual">{r.residualScore != null ? t('rk.residual', { score: r.residualScore, level: t(`rk.level.${r.residualLevel}`) }) : t('rk.noResidual')}</p>
          <h2>{t('rk.exposure')}</h2>
          <div className="form-grid">
            {['min', 'mostLikely', 'max'].map((k) => <Field key={k} label={`${t('rk.costRs')} · ${t(k === 'mostLikely' ? 'rk.mostLikelyShort' : `rk.${k}`)}`} name={`exposureCost.${k}`} error={error}><input value={form.exposureCost[k]} disabled={!editing} onChange={(e) => setIn('exposureCost', k, e.target.value)} inputMode="decimal" data-testid={`rk-cost-${k}`} /></Field>)}
            {['min', 'mostLikely', 'max'].map((k) => <Field key={k} label={`${t('rk.delayDays')} · ${t(k === 'mostLikely' ? 'rk.mostLikelyShort' : `rk.${k}`)}`} name={`exposureDays.${k}`} error={error}><input type="number" min="0" value={form.exposureDays[k]} disabled={!editing} onChange={(e) => setIn('exposureDays', k, e.target.value)} /></Field>)}
          </div>
          <p data-testid="rk-emv"><strong>{t('rk.emv')}</strong>: {inr(r.emv)} = {r.probabilityPct}% × {inr(r.exposureCost.mostLikely)}</p>
        </div>
      )}
      {tab === 'response' && (
        <div className="mdm-panel" role="tabpanel" aria-labelledby="ptab-response" data-testid="rk-tab-response">
          <h2>{t('rk.actions')}</h2>
          {form.actions.length === 0 && <p className="muted">{t('rk.noActions')}</p>}
          <table className="data-table"><thead><tr><th scope="col">#</th><th scope="col">{t('rk.action')}</th><th scope="col">{t('rk.col.owner')}</th><th scope="col">{t('rk.due')}</th><th scope="col">{t('rk.col.status')}</th></tr></thead>
            <tbody>{form.actions.map((a, i) => (
              <tr key={i} data-testid={`rk-action-${i}`}><td>{i + 1}</td>
                <td>{editing ? <input aria-label={t('rk.action')} value={a.description} onChange={(e) => upd('actions', i, 'description', e.target.value)} maxLength={1000} /> : a.description}</td>
                <td>{editing ? <LookupField id={`rk-ao-${i}`} label={t('rk.col.owner')} lookup="proj/people" valueKey="code" value={a.ownerUser} onChange={(v) => upd('actions', i, 'ownerUser', v)} /> : a.ownerUser}</td>
                <td>{editing ? <input type="date" aria-label={t('rk.due')} value={a.dueDate} onChange={(e) => upd('actions', i, 'dueDate', e.target.value)} /> : a.dueDate}</td>
                <td>{r.actions[i] ? `${r.actions[i].statusLabel}${r.actions[i].overdue ? ` · ${t('rk.overdue')}` : ''}` : t('rk.unsaved')}{editing && <button type="button" className="btn" onClick={() => set('actions', form.actions.filter((_, j) => j !== i))}>{t('act.remove')}</button>}</td></tr>
            ))}</tbody></table>
          {editing && <button type="button" className="btn" onClick={() => set('actions', [...form.actions, { description: '', ownerUser: r.ownerUser, dueDate: dayIST(14) }])} data-testid="rk-add-action">{t('rk.addAction')}</button>}
          <h2>{t('rk.triggers')}</h2>
          {form.triggers.length === 0 && <p className="muted">{t('rk.noTriggers')}</p>}
          <table className="data-table"><thead><tr><th scope="col">{t('rk.indicator')}</th><th scope="col">{t('rk.condition')}</th><th scope="col">{t('rk.reading')}</th><th scope="col">{t('rk.col.status')}</th></tr></thead>
            <tbody>{form.triggers.map((x, i) => {
              const live = r.triggers[i];
              return (
                <tr key={i} data-testid={`rk-trigger-${i}`} data-status={live?.status ?? 'NEW'}>
                  <td>{editing ? <input aria-label={t('rk.indicator')} value={x.name} onChange={(e) => upd('triggers', i, 'name', e.target.value)} maxLength={160} data-testid={`rk-trg-name-${i}`} /> : x.name}</td>
                  <td>{editing ? <><select aria-label={t('rk.condition')} value={x.comparator} onChange={(e) => upd('triggers', i, 'comparator', e.target.value)}>{['GTE', 'GT', 'LTE', 'LT'].map((k) => <option key={k} value={k}>{t(`rk.cmp.${k}`)}</option>)}</select> <input type="number" aria-label={t('rk.threshold')} value={x.threshold} onChange={(e) => upd('triggers', i, 'threshold', e.target.value)} data-testid={`rk-trg-th-${i}`} /> <input aria-label={t('rk.unit')} value={x.unit} onChange={(e) => upd('triggers', i, 'unit', e.target.value)} maxLength={30} size={5} /></> : `${t(`rk.cmp.${x.comparator}`)} ${x.threshold}${x.unit ? ` ${x.unit}` : ''}`}</td>
                  <td>{live ? <>{live.currentValue ?? '—'} {c.reading && <><input type="number" aria-label={t('rk.newReading')} value={reading[live.id] ?? ''} onChange={(e) => setReading({ ...reading, [live.id]: e.target.value })} data-testid={`rk-reading-${i}`} style={{ width: 90 }} /> <button type="button" className="btn" disabled={reading[live.id] === undefined || reading[live.id] === ''} onClick={() => run(() => rk.reading(r.id, live.id, { value: Number(reading[live.id]) }), t('rk.readingSaved'))} data-testid={`rk-reading-save-${i}`}>{t('rk.record')}</button></>}</> : '—'}</td>
                  <td>{live ? (live.status === 'FIRED' ? <strong role="status" data-testid={`rk-fired-${i}`}>{t('rk.fired')}</strong> : t('rk.armed')) : t('rk.unsaved')}{live?.status === 'FIRED' && c.reading && <button type="button" className="btn" onClick={() => run(() => rk.rearm(r.id, live.id), t('rk.rearmed'))}>{t('rk.rearm')}</button>}{editing && <button type="button" className="btn" onClick={() => set('triggers', form.triggers.filter((_, j) => j !== i))}>{t('act.remove')}</button>}</td>
                </tr>
              );
            })}</tbody></table>
          {editing && <button type="button" className="btn" onClick={() => set('triggers', [...form.triggers, { name: '', indicator: '', comparator: 'GTE', threshold: 0, unit: '' }])} data-testid="rk-add-trigger">{t('rk.addTrigger')}</button>}
        </div>
      )}
      {tab === 'contingency' && (
        <div className="mdm-panel" role="tabpanel" aria-labelledby="ptab-contingency" data-testid="rk-tab-contingency">
          <p><strong>{t('rk.allocated')}</strong>: {inr(r.contingencyAllocated)} · <strong>{t('rk.drawn')}</strong>: {inr(r.contingencyDrawn)}</p>
          <table className="data-table"><thead><tr><th scope="col">{t('rk.kind')}</th><th scope="col">{t('rk.amount')}</th><th scope="col">{t('rk.col.status')}</th><th scope="col">{t('rk.reason')}</th><th scope="col">{t('rk.by')}</th></tr></thead>
            <tbody>{r.contingency.map((e) => <tr key={e.id}><td>{t(`rk.cont.${e.kind}`)}</td><td>{inr(e.amount)}</td><td>{t(`rk.contStatus.${e.status}`)}{c.contingency && e.kind === 'ALLOCATION' && e.status === 'ACTIVE' && <button type="button" className="btn" onClick={() => run(() => rk.release(r.id, e.id), t('rk.released'))}>{t('rk.release')}</button>}</td><td>{e.reason}</td><td>{e.by}</td></tr>)}</tbody></table>
          {c.contingency && r.rtype === 'RISK' && (
            <form className="actions-row" aria-label={t('rk.contNew')} data-testid="rk-cont-form" onSubmit={(e) => { e.preventDefault(); run(() => rk.contingency(r.id, cont), t('rk.contSaved')).then((x) => x && setCont({ kind: cont.kind, amount: '', reason: '' })); }}>
              <Field label={t('rk.kind')} name="kind" error={error}><select value={cont.kind} onChange={(e) => setCont({ ...cont, kind: e.target.value })} data-testid="rk-cont-kind"><option value="ALLOCATION">{t('rk.cont.ALLOCATION')}</option><option value="DRAWDOWN">{t('rk.cont.DRAWDOWN')}</option></select></Field>
              <Field label={t('rk.amount')} name="amount" error={error}><input value={cont.amount} onChange={(e) => setCont({ ...cont, amount: e.target.value })} inputMode="decimal" data-testid="rk-cont-amount" /></Field>
              <Field label={t('rk.reason')} name="reason" error={error}><input value={cont.reason} onChange={(e) => setCont({ ...cont, reason: e.target.value })} maxLength={1000} data-testid="rk-cont-reason" /></Field>
              <button type="submit" className="btn btn-primary" disabled={!cont.amount || cont.reason.trim().length < 5} data-testid="rk-cont-save">{t('act.save')}</button>
            </form>
          )}
        </div>
      )}
      {tab === 'history' && (
        <div className="mdm-panel" role="tabpanel" aria-labelledby="ptab-history" data-testid="rk-tab-history">
          <h2>{t('rk.history')}</h2>
          <ol>{(h.data?.audit ?? []).map((a, n) => <li key={n}>{String(a.at).slice(0, 16).replace('T', ' ')} · {a.actor} · {a.action}{a.from?.score != null && a.to?.score != null ? ` (${t('rk.scoreMoved', { from: a.from.score, to: a.to.score })})` : ''}{a.reason ? ` — ${a.reason}` : ''}</li>)}</ol>
          {(h.data?.approvals ?? []).length > 0 && <><h2>{t('rk.approvals')}</h2><ol>{h.data.approvals.map((a, n) => <li key={n}>{String(a.at).slice(0, 16).replace('T', ' ')} · {a.actor} · {a.event}{a.comment ? ` — ${a.comment}` : ''}</li>)}</ol></>}
          {r.issues.length > 0 && <><h2>{t('rk.linkedIssues')}</h2><ul>{r.issues.map((x) => <li key={x.id}><Link to={`/proj/issue?id=${x.id}`}>{x.docNo}</Link> {x.title} ({x.statusLabel})</li>)}</ul></>}
        </div>
      )}
    </section>
  );
}
