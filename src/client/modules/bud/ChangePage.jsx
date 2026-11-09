import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CHANGE_TONE, CHANGE_TYPES, KINDS, REASONS, TYPES, bc, inr, openPrint } from './api.js';
import { ProjectSelect, useSearch } from './parts.jsx';

// Budget Change Request (part 12.02): a revision, transfer or contingency drawdown with its lines and the impact preview (total, share of the budget, margin, approval band), worked out by the server as it is typed; then its approval and the version it made.
const blank = () => ({ lineId: '', isNew: false, lineKind: 'DIRECT', wbsId: '', costCodeId: '', resourceType: 'MATERIAL', resourceName: '', uom: '', qtyDelta: '', amountDelta: '' });
const toLine = (l) => (l.isNew
  ? { lineKind: l.lineKind, wbsId: l.wbsId ? Number(l.wbsId) : null, costCodeId: l.costCodeId ? Number(l.costCodeId) : null, resourceType: l.resourceType, resourceName: l.resourceName.trim() || null, uom: l.uom.trim() || null, qtyDelta: Number(l.qtyDelta || 0), amountDelta: Number(l.amountDelta || 0) }
  : { lineId: Number(l.lineId) || null, qtyDelta: Number(l.qtyDelta || 0), amountDelta: Number(l.amountDelta || 0) });
function Impact({ impact, issues, t }) {
  if (!impact) return null;
  return (
    <div className="mdm-panel" data-testid="bc-impact" data-director={impact.directorRequired ? '1' : '0'}>
      <h2>{t('chg.impact')}</h2>
      <table className="data-table"><tbody>
        {[['totalBefore', impact.totalBefore], ['totalAfter', impact.totalAfter], ['totalDelta', impact.totalDelta], ['moved', impact.moved], ['marginBefore', impact.marginBefore], ['marginAfter', impact.marginAfter], ['contingencyAfter', impact.contingencyAfter]].map(([k, v]) => <tr key={k}><th scope="row">{t(`chg.${k}`)}</th><td className="num" data-testid={`bc-i-${k}`}>₹ {inr(v)}</td></tr>)}
        <tr><th scope="row">{t('chg.pct')}</th><td className="num" data-testid="bc-i-pct">{impact.pctOfBudget} %</td></tr>
        <tr><th scope="row">{t('chg.chain')}</th><td data-testid="bc-i-chain">{impact.chain.join(' → ')}</td></tr>
      </tbody></table>
      {issues?.length > 0 && <ul className="field-error" role="alert" data-testid="bc-issues">{issues.map((i, n) => <li key={n}>{i.text ?? i.message}</li>)}</ul>}
    </div>
  );
}
function Editor({ initial, onSaved, t }) {
  const [f, setF] = useState(initial); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v })); const setLine = (i, k, v) => setF((x) => ({ ...x, lines: x.lines.map((l, n) => (n === i ? { ...l, [k]: v } : l)) }));
  const oq = useQuery({ queryKey: ['bud', 'change-options', f.projectId], queryFn: () => bc.options(f.projectId), enabled: Boolean(f.projectId), retry: false });
  const o = oq.data;
  const body = { projectId: Number(f.projectId), changeType: f.changeType, reasonCode: f.reasonCode, title: f.title.trim() || 'Preview', justification: f.justification, riskId: f.changeType === 'DRAWDOWN' && f.riskId ? Number(f.riskId) : null, lines: f.lines.filter((l) => l.isNew || l.lineId).map(toLine), ...(f.id ? { changeId: f.id } : {}) };
  const pq = useQuery({ queryKey: ['bud', 'change-preview', JSON.stringify(body)], queryFn: () => bc.preview(body), enabled: Boolean(f.projectId && o?.budget && body.lines.length), retry: false });
  useEffect(() => { if (!REASONS[f.changeType].includes(f.reasonCode)) set('reasonCode', REASONS[f.changeType][0]); }, [f.changeType]);
  const save = async (e) => {
    e.preventDefault(); setError(null); setBusy(true);
    try { const r = f.id ? await bc.update(f.id, { reasonCode: f.reasonCode, title: f.title.trim(), justification: f.justification.trim(), riskId: body.riskId, lines: body.lines }) : await bc.create({ ...body, title: f.title.trim(), justification: f.justification.trim() }); onSaved(r); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  return (
    <form className="mdm-panel" onSubmit={save} data-testid="bc-form">
      <div className="form-grid">
        {f.id ? null : <ProjectSelect value={f.projectId} onChange={(v) => setF({ ...f, projectId: v ? Number(v) : '', lines: [blank()], riskId: '' })} required testId="bc-project" error={error} />}
        {f.id ? null : <Field label={t('chg.type')} name="changeType" error={error}><select value={f.changeType} onChange={(e) => set('changeType', e.target.value)} data-testid="bc-type">{CHANGE_TYPES.map((k) => <option key={k} value={k}>{t(`ctype.${k}`)}</option>)}</select></Field>}
        <Field label={t('chg.reason')} name="reasonCode" error={error}><select value={f.reasonCode} onChange={(e) => set('reasonCode', e.target.value)} data-testid="bc-reason">{REASONS[f.changeType].map((k) => <option key={k} value={k}>{t(`reason.${k}`)}</option>)}</select></Field>
        <Field label={t('chg.title')} name="title" error={error}><input value={f.title} onChange={(e) => set('title', e.target.value)} required minLength={3} maxLength={200} data-testid="bc-title" /></Field>
        {f.changeType === 'DRAWDOWN' && <Field label={t('chg.risk')} name="riskId" error={error}><select value={f.riskId} onChange={(e) => set('riskId', e.target.value)} required data-testid="bc-risk"><option value="">—</option>{(o?.risks ?? []).map((r) => <option key={r.id} value={r.id}>{r.docNo} {r.title}</option>)}</select></Field>}
        <Field label={t('chg.justification')} name="justification" error={error}><textarea value={f.justification} onChange={(e) => set('justification', e.target.value)} required minLength={10} maxLength={4000} rows={3} data-testid="bc-justification" /></Field>
      </div>
      {o && !o.budget && <p className="field-error" role="alert" data-testid="bc-nobudget">{t('chg.noBudget')}</p>}
      {o?.budget && <p className="muted" data-testid="bc-budget">{t('chg.against', { doc: o.budget.docNo, v: o.budget.versionNo, total: inr(o.budget.total) })}{f.changeType === 'DRAWDOWN' ? ` · ${t('chg.contAvail', { a: inr(o.budget.contingencyAvailable) })}` : ''}</p>}
      {f.changeType === 'DRAWDOWN' && <p className="muted">{t('chg.drawdownHelp')}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="bc-lines-edit"><caption>{t('chg.lines')}</caption>
        <thead><tr><th>{t('chg.line')}</th><th className="num">{t('chg.qtyDelta')}</th><th className="num">{t('chg.amountDelta')}</th><th /></tr></thead>
        <tbody>{f.lines.map((l, i) => (
          <tr key={i} data-testid="bc-line-edit">
            <td>
              <select value={l.isNew ? 'NEW' : l.lineId} onChange={(e) => (e.target.value === 'NEW' ? setLine(i, 'isNew', true) : setF((x) => ({ ...x, lines: x.lines.map((y, n) => (n === i ? { ...y, isNew: false, lineId: e.target.value } : y)) })))} aria-label={t('chg.line')} data-testid="bc-line-pick">
                <option value="">—</option>
                {(o?.lines ?? []).filter((x) => !(f.changeType === 'DRAWDOWN' && x.lineKind === 'CONTINGENCY') && !(f.changeType === 'TRANSFER' && ['CONTINGENCY', 'RESERVE'].includes(x.lineKind))).map((x) => <option key={x.id} value={x.id}>{t(`kind.${x.lineKind}`)} · {x.wbsCode ?? '—'} · {x.resourceName} (₹ {inr(x.amount)})</option>)}
                <option value="NEW">{t('chg.newLine')}</option>
              </select>
              {l.isNew && (
                <div className="form-grid">
                  <Field label={t('f.kind')} name={`k${i}`}><select value={l.lineKind} onChange={(e) => setLine(i, 'lineKind', e.target.value)} data-testid="bc-new-kind">{KINDS.filter((k) => f.changeType !== 'DRAWDOWN' || k !== 'CONTINGENCY').map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}</select></Field>
                  {l.lineKind === 'DIRECT' && <Field label={t('f.wbs')} name={`w${i}`}><select value={l.wbsId} onChange={(e) => setLine(i, 'wbsId', e.target.value)} data-testid="bc-new-wbs"><option value="">—</option>{(o?.wbs ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>}
                  {['DIRECT', 'OVERHEAD'].includes(l.lineKind) && <Field label={t('f.costCode')} name={`c${i}`}><select value={l.costCodeId} onChange={(e) => setLine(i, 'costCodeId', e.target.value)} data-testid="bc-new-code"><option value="">—</option>{(o?.costCodes ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>}
                  <Field label={t('f.type')} name={`t${i}`}><select value={l.resourceType} onChange={(e) => setLine(i, 'resourceType', e.target.value)} data-testid="bc-new-type">{TYPES.map((k) => <option key={k} value={k}>{t(`type.${k}`)}</option>)}</select></Field>
                  <Field label={t('f.resource')} name={`n${i}`}><input value={l.resourceName} onChange={(e) => setLine(i, 'resourceName', e.target.value)} maxLength={200} data-testid="bc-new-name" /></Field>
                  <Field label={t('f.uom')} name={`u${i}`}><input value={l.uom} onChange={(e) => setLine(i, 'uom', e.target.value)} maxLength={20} data-testid="bc-new-uom" /></Field>
                </div>
              )}
            </td>
            <td className="num"><input type="number" step="0.001" value={l.qtyDelta} onChange={(e) => setLine(i, 'qtyDelta', e.target.value)} aria-label={t('chg.qtyDelta')} data-testid="bc-line-qty" style={{ maxWidth: '7rem' }} /></td>
            <td className="num"><input type="number" step="0.01" value={l.amountDelta} onChange={(e) => setLine(i, 'amountDelta', e.target.value)} aria-label={t('chg.amountDelta')} data-testid="bc-line-amount" style={{ maxWidth: '9rem' }} /></td>
            <td><button type="button" className="btn" onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((_, n) => n !== i) }))} data-testid="bc-line-remove">{t('act.delete')}</button></td>
          </tr>))}</tbody></table></div>
      <div className="actions-row"><button type="button" className="btn" onClick={() => set('lines', [...f.lines, blank()])} data-testid="bc-line-add">{t('chg.addLine')}</button></div>
      {pq.data && <Impact impact={pq.data.impact} issues={[...pq.data.issues, ...pq.data.problems]} t={t} />}
      {error?.form && <p className="field-error" role="alert" data-testid="bc-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !f.projectId || !o?.budget || f.title.trim().length < 3 || f.justification.trim().length < 10} data-testid="bc-save">{t('chg.save')}</button></div>
    </form>
  );
}
export default function ChangePage() {
  const t = useT('bud');
  const qc = useQueryClient();
  const params = useSearch(); const id = Number(params.get('id')) || null;
  const q = useQuery({ queryKey: ['bud', 'change', id], queryFn: () => bc.get(id), enabled: Boolean(id), retry: false });
  const hq = useQuery({ queryKey: ['bud', 'change-history', id], queryFn: () => bc.history(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [editing, setEditing] = useState(false); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  usePageTitle(q.data ? `${q.data.docNo} ${q.data.title}` : t('chg.newTitle'));
  if (!id) return (
    <section aria-labelledby="bc-h" data-testid="bc-new-page">
      <h1 id="bc-h">{t('chg.newTitle')}</h1>
      <Editor t={t} initial={{ projectId: Number(params.get('projectId')) || '', changeType: 'REVISION', reasonCode: 'RATE_ESCALATION', title: '', justification: '', riskId: '', lines: [blank()] }} onSaved={(r) => { qc.invalidateQueries({ queryKey: ['bud'] }); navigateTo(`/bud/change?id=${r.id}`); }} />
    </section>
  );
  if (q.error?.status === 403) return <NoPermission what={t('chg.listTitle')} permission="bud.change.view" />;
  if (q.isPending) return <Skeleton label={t('chg.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const c = q.data; const can = c.can;
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bud'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  return (
    <section aria-labelledby="bc-h" data-testid="bc-change" data-status={c.status} data-type={c.changeType}>
      <header>
        <h1 id="bc-h">{c.docNo} · {c.title} <StatusBadge status={CHANGE_TONE[c.status]} label={t(`cst.${c.status}`)} /></h1>
        <p className="muted">{c.projectCode} {c.projectName} · {t(`ctype.${c.changeType}`)} · {t(`reason.${c.reasonCode}`)}{c.risk ? ` · ${t('chg.risk')} ${c.risk.docNo} ${c.risk.title}` : ''}{c.variationRef ? ` · ${t('chg.variation')} ${c.variationRef}` : ''}</p>
        <p>{c.justification}</p>
        <dl className="kv" data-testid="bc-figures">
          {[['budgetTotalBefore', c.budgetTotalBefore], ['totalDelta', c.totalDelta], ['moved', c.moved], ['marginBefore', c.marginBefore], ['marginAfter', c.marginAfter]].map(([k, v]) => <div key={k}><dt>{t(`chg.${k === 'budgetTotalBefore' ? 'totalBefore' : k}`)}</dt><dd>₹ {inr(v)}</dd></div>)}
          <div><dt>{t('chg.pct')}</dt><dd data-testid="bc-pct">{c.pctOfBudget} %</dd></div>
        </dl>
        {c.resultBudget && <p data-testid="bc-result">{t('chg.applied')} <button type="button" className="btn" onClick={() => navigateTo(`/bud/budget?id=${c.resultBudget.id}`)}>{c.resultBudget.docNo} v{c.resultBudget.versionNo}</button></p>}
        {c.stale && <p className="field-error" role="alert" data-testid="bc-stale">{t('chg.stale')}</p>}
        {error?.form && <p className="field-error" role="alert" data-testid="bc-act-error">{error.form}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="bc-note">{note}</p>}
        <div className="actions-row no-print">
          {can.edit && <button type="button" className="btn" onClick={() => setEditing(!editing)} data-testid="bc-edit">{t('act.edit')}</button>}
          {can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => bc.act(c.id, 'submit'), t('page.sent'))} data-testid="bc-submit">{t('page.submit')}</button>}
          {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => bc.act(c.id, 'withdraw', { reason: x }), t('page.withdrawn'))} data-testid="bc-withdraw">{t('act.withdraw')}</button>}
          {can.cancel && <button type="button" className="btn" onClick={() => why((x) => bc.act(c.id, 'cancel', { reason: x }), t('page.cancelled'))} data-testid="bc-cancel">{t('act.cancel')}</button>}
          {can.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => bc.act(c.id, 'amend', { reason: x })); if (n) navigateTo(`/bud/change?id=${n.id}`); } }} data-testid="bc-amend">{t('chg.raiseAgain')}</button>}
          {can.delete && <button type="button" className="btn" onClick={async () => { if (await run(() => bc.remove(c.id))) navigateTo('/bud/changes'); }} data-testid="bc-delete">{t('act.delete')}</button>}
          {can.print && <button type="button" className="btn" onClick={() => openPrint(`/changes/${c.id}/print`, `${c.docNo}.html`)} data-testid="bc-print">{t('act.print')}</button>}
          {c.workflowInstanceId && <Link to={`/workflow/instance?id=${c.workflowInstanceId}`}>{t('page.approval')}</Link>}
        </div>
      </header>
      {editing && can.edit && <Editor t={t} initial={{ id: c.id, projectId: c.projectId, changeType: c.changeType === 'VARIATION' ? 'REVISION' : c.changeType, reasonCode: c.reasonCode, title: c.title, justification: c.justification ?? '', riskId: c.riskId ?? '', lines: c.lines.filter((l) => !(c.changeType === 'DRAWDOWN' && l.lineKind === 'CONTINGENCY')).map((l) => (l.isNew ? { ...blank(), isNew: true, lineKind: l.lineKind, wbsId: l.wbsId ?? '', costCodeId: l.costCodeId ?? '', resourceType: l.resourceType, resourceName: l.resourceName, uom: l.uom ?? '', qtyDelta: String(l.qtyDelta), amountDelta: String(Number(l.amountDelta)) } : { ...blank(), lineId: String(l.lineId), qtyDelta: String(l.qtyDelta), amountDelta: String(Number(l.amountDelta)) })) }} onSaved={() => { setEditing(false); setNote(t('chg.saved')); qc.invalidateQueries({ queryKey: ['bud'] }); }} />}
      {!editing && c.impact && <Impact impact={c.impact} issues={c.issues} t={t} />}
      <div className="table-scroll"><table className="data-table" data-testid="bc-lines"><caption>{t('chg.lines')}</caption>
        <thead><tr><th>{t('f.kind')}</th><th>{t('f.wbs')}</th><th>{t('f.costCode')}</th><th>{t('f.resource')}</th><th className="num">{t('chg.before')}</th><th className="num">{t('chg.amountDelta')}</th><th className="num">{t('chg.after')}</th></tr></thead>
        <tbody>{c.lines.map((l) => <tr key={l.id} data-testid="bc-line"><td>{t(`kind.${l.lineKind}`)}{l.isNew ? ` · ${t('chg.newLine')}` : ''}</td><td>{l.wbsCode ?? '—'}</td><td>{l.costCode ?? '—'}</td><td>{l.resourceName}</td><td className="num">{inr(l.amountBefore)}</td><td className="num">{inr(l.amountDelta)}</td><td className="num">{inr(l.amountAfter)}</td></tr>)}</tbody></table></div>
      <h2>{t('page.history')}</h2>
      {hq.isPending ? <Skeleton label={t('page.history')} rows={2} /> : <ul data-testid="bc-history">{[...(hq.data?.approvals ?? []).map((a) => `${a.at?.slice(0, 16)} · ${a.step_code ?? ''} ${a.event} · ${a.actor}${a.comment ? `: ${a.comment}` : ''}`), ...(hq.data?.audit ?? []).map((a) => `${a.at?.slice(0, 16)} · ${a.action} · ${a.actor}${a.reason ? `: ${a.reason}` : ''}`)].map((s, i) => <li key={i}>{s}</li>)}</ul>}
    </section>
  );
}
