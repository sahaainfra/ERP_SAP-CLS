import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { DiscussionTab, TimelineTab } from '../../platform/collab/CollabTabs.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Tabs } from '../proj/parts.jsx';
import { DEPT_TONE, SPREADS, dp, inr, openPrint } from './api.js';
import { useSearch } from './parts.jsx';

// Department Budget Workbench (part 12.04, FR-01, FR-02): the budget of a cost centre for a financial year by GL account and month. The twelve months are typed or spread from a yearly amount by the server; totals are worked out by the server when the
// budget is saved, and an approved budget is locked and changed by a new version that is compared with the one in force.
const num = (v) => (v === '' || v == null ? 0 : Number(v));
const blank = () => ({ accountId: '', note: '', months: Array(12).fill('') });
const toBody = (rows) => rows.filter((r) => r.accountId).map((r) => ({ accountId: Number(r.accountId), note: r.note.trim() || null, months: r.months.map(num) }));
const sum = (xs) => xs.reduce((a, b) => a + num(b), 0);

function Grid({ rows, setRows, periods, accounts, t }) {
  const [spread, setSpread] = useState(null); const [err, setErr] = useState(null);
  const set = (i, k, v) => setRows((x) => x.map((r, n) => (n === i ? { ...r, [k]: v } : r)));
  const setMonth = (i, m, v) => setRows((x) => x.map((r, n) => (n === i ? { ...r, months: r.months.map((a, k) => (k === m ? v : a)) } : r)));
  const doSpread = async () => {
    setErr(null);
    try { const out = await dp.spread({ total: num(spread.total), profile: spread.profile }); setRows((x) => x.map((r, n) => (n === spread.i ? { ...r, months: out.months } : r))); setSpread(null); } catch (x) { setErr(errorInfo(x)); }
  };
  return (
    <>
      <div className="table-scroll"><table className="data-table" data-testid="dp-grid"><caption>{t('dp.lines')}</caption>
        <thead><tr><th>{t('dp.account')}</th>{periods.map((p) => <th key={p.id} className="num">{p.name.split(' ')[0]}</th>)}<th className="num">{t('f.total')}</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} data-testid="dp-row">
            <td style={{ minWidth: '14rem' }}>
              <select value={r.accountId} onChange={(e) => set(i, 'accountId', e.target.value)} aria-label={t('dp.account')} data-testid="dp-account"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id} disabled={rows.some((x, n) => n !== i && String(x.accountId) === String(a.id))}>{a.code} {a.name}</option>)}</select>
              <input value={r.note} onChange={(e) => set(i, 'note', e.target.value)} maxLength={300} placeholder={t('dp.note')} aria-label={t('dp.note')} />
            </td>
            {r.months.map((m, k) => <td key={k} className="num"><input type="number" min="0" step="0.01" value={m} onChange={(e) => setMonth(i, k, e.target.value)} aria-label={`${periods[k]?.name ?? k + 1}`} data-testid="dp-cell" style={{ minWidth: '5.5rem' }} /></td>)}
            <td className="num" data-testid="dp-row-total">{inr(sum(r.months))}</td>
            <td><button type="button" className="btn" onClick={() => setSpread({ i, total: '', profile: 'LINEAR' })} data-testid="dp-spread-open">{t('dp.spread')}</button><button type="button" className="btn" onClick={() => setRows((x) => x.filter((_, n) => n !== i))} data-testid="dp-row-remove">{t('act.delete')}</button></td>
          </tr>))}
          <tr><th scope="row">{t('f.total')}</th>{periods.map((p, k) => <td key={p.id} className="num">{inr(rows.reduce((a, r) => a + num(r.months[k]), 0))}</td>)}<td className="num" data-testid="dp-grid-total">{inr(rows.reduce((a, r) => a + sum(r.months), 0))}</td><td /></tr></tbody></table></div>
      <div className="actions-row"><button type="button" className="btn" onClick={() => setRows((x) => [...x, blank()])} data-testid="dp-row-add">{t('dp.addAccount')}</button></div>
      {spread && (
        <div className="mdm-panel" role="group" data-testid="dp-spread-form" aria-label={t('dp.spread')}>
          <div className="form-grid">
            <Field label={t('dp.yearTotal')} name="total" error={err}><input type="number" min="0" step="0.01" value={spread.total} onChange={(e) => setSpread({ ...spread, total: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doSpread(); } }} data-testid="dp-spread-total" /></Field>
            <Field label={t('dp.profile')} name="profile" error={err}><select value={spread.profile} onChange={(e) => setSpread({ ...spread, profile: e.target.value })} data-testid="dp-spread-profile">{SPREADS.map((k) => <option key={k} value={k}>{t(`dp.profile.${k}`)}</option>)}</select></Field>
          </div>
          {err?.form && <p className="field-error" role="alert">{err.form}</p>}
          <div className="actions"><button type="button" className="btn btn-primary" onClick={doSpread} disabled={spread.total === ''} data-testid="dp-spread-apply">{t('dp.apply')}</button><button type="button" className="btn" onClick={() => setSpread(null)}>{t('act.close')}</button></div>
        </div>
      )}
    </>
  );
}
function Editor({ b, onSaved, t }) {
  const oq = useQuery({ queryKey: ['bud', 'dept-options'], queryFn: dp.options, retry: false }); const o = oq.data;
  const [f, setF] = useState({ fyId: b?.fyId ?? '', costCentreId: b?.costCentreId ?? '', name: b?.name ?? '', reason: b?.reason ?? '' });
  const [rows, setRows] = useState(b?.lines?.length ? b.lines.map((l) => ({ accountId: String(l.accountId), note: l.note ?? '', months: l.months })) : [blank()]);
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const fy = o?.fys.find((x) => x.id === Number(f.fyId)); const periods = b ? b.periods : (fy?.periods ?? []);
  const save = async (e) => {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const body = { name: f.name.trim() || undefined, reason: f.reason.trim() || null, lines: toBody(rows) };
      onSaved(b ? await dp.update(b.id, { ...body, rowVersion: b.rowVersion }) : await dp.create({ ...body, fyId: Number(f.fyId), costCentreId: Number(f.costCentreId) }));
    } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  if (oq.isPending) return <Skeleton label={t('dp.title')} rows={4} />;
  if (oq.isError) return <ErrorState error={oq.error} onRetry={oq.refetch} />;
  return (
    <form className="mdm-panel" onSubmit={save} data-testid="dp-form">
      <div className="form-grid">
        {!b && <Field label={t('dp.fy')} name="fyId" error={error}><select value={f.fyId} onChange={(e) => setF({ ...f, fyId: e.target.value })} required data-testid="dp-fy"><option value="">—</option>{o.fys.filter((x) => x.status === 'Open').map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></Field>}
        {!b && <Field label={t('dp.costCentre')} name="costCentreId" error={error}><select value={f.costCentreId} onChange={(e) => setF({ ...f, costCentreId: e.target.value })} required data-testid="dp-cc"><option value="">—</option>{o.costCentres.filter((c) => c.canPrepare).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>}
        <Field label={t('dp.name')} name="name" error={error}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={3} maxLength={200} data-testid="dp-name" /></Field>
        <Field label={t('f.reason')} name="reason" error={error}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={1000} data-testid="dp-reason" /></Field>
      </div>
      {periods.length === 0 ? <p className="muted" data-testid="dp-choose">{t('dp.chooseFy')}</p> : <Grid rows={rows} setRows={setRows} periods={periods} accounts={o.accounts} t={t} />}
      {error?.form && <p className="field-error" role="alert" data-testid="dp-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
      <p className="muted">{t('dp.serverTotals')}</p>
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || periods.length === 0 || (!b && (!f.fyId || !f.costCentreId))} data-testid="dp-save">{t('dp.save')}</button></div>
    </form>
  );
}
function Compare({ id, t }) {
  const q = useQuery({ queryKey: ['bud', 'dept-compare', id], queryFn: () => dp.compare(id), retry: false });
  if (q.isPending) return <Skeleton label={t('dp.compare')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const c = q.data;
  return (
    <div data-testid="dp-compare">
      <p className="muted">{c.from ? t('dp.comparing', { from: c.from.docNo, v1: c.from.versionNo, to: c.to.docNo, v2: c.to.versionNo }) : t('dp.noParent')}</p>
      <dl className="kv"><div><dt>{t('dp.before')}</dt><dd>₹ {inr(c.totalBefore)}</dd></div><div><dt>{t('dp.after')}</dt><dd>₹ {inr(c.totalAfter)}</dd></div><div><dt>{t('dp.delta')}</dt><dd data-testid="dp-cmp-delta">₹ {inr(c.totalDelta)}</dd></div></dl>
      <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('dp.compare')}</caption>
        <thead><tr><th>{t('dp.account')}</th><th className="num">{t('dp.before')}</th><th className="num">{t('dp.after')}</th><th className="num">{t('dp.delta')}</th></tr></thead>
        <tbody>{c.rows.map((r) => <tr key={r.accountId} data-testid="dp-cmp-row" data-changed={r.changed ? '1' : '0'}><td>{r.code} {r.name}</td><td className="num">{inr(r.before)}</td><td className="num">{inr(r.after)}</td><td className={`num${r.changed ? ' field-error' : ''}`}>{inr(r.delta)}</td></tr>)}</tbody></table></div>
    </div>
  );
}
const TABS = ['details', 'lines', 'attachments', 'approvals', 'timeline', 'discussion', 'related'];
export default function DeptBudgetPage() {
  const t = useT('bud');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['bud', 'dept', id], queryFn: () => dp.get(id), enabled: Boolean(id), retry: false });
  const hq = useQuery({ queryKey: ['bud', 'dept-history', id], queryFn: () => dp.history(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const rq = useQuery({ queryKey: ['bud', 'dept-related', id], queryFn: async () => (await api.get(`/ui/objects/bud_dept_budget/${id}/related`)).data ?? [], enabled: Boolean(id) && q.isSuccess, retry: false });
  const [tab, setTab] = useState('details'); const [editing, setEditing] = useState(false); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [uploaded, setUploaded] = useState(0);
  usePageTitle(q.data ? `${q.data.docNo} ${q.data.name}` : t('dp.newTitle'));
  if (!id) {
    return (
      <section aria-labelledby="dp-h" data-testid="dp-new-page">
        <h1 id="dp-h">{t('dp.newTitle')}</h1>
        <Editor t={t} onSaved={(r) => { qc.invalidateQueries({ queryKey: ['bud'] }); navigateTo(`/bud/dept-budget?id=${r.id}`); }} />
      </section>
    );
  }
  if (q.error?.status === 403) return <NoPermission what={t('dp.listTitle')} permission="bud.dept_budget.view" />;
  if (q.isPending) return <Skeleton label={t('dp.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const b = q.data; const can = b.can; const tabs = b.parent ? [...TABS, 'compare'] : TABS;
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bud'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  return (
    <section aria-labelledby="dp-h" data-testid="dept-budget" data-status={b.status} data-number={b.docNo} data-version={b.versionNo}>
      <header>
        <h1 id="dp-h">{b.docNo} · {b.name} <StatusBadge status={DEPT_TONE[b.status]} label={t(`dst.${b.status}`)} /></h1>
        <p className="muted">{b.costCentreCode} {b.costCentreName}{b.department ? ` · ${b.department}` : ''} · {t('dp.fy')} {b.fy} · {t('f.version')} {b.versionNo} ({t(`dvt.${b.vtype}`)}){b.lockedAt ? ` · ${t('page.locked')}` : ''}</p>
        <dl className="kv" data-testid="dp-figures">
          <div><dt>{t('f.total')}</dt><dd data-testid="dp-total">₹ {inr(b.total)}</dd></div>
          <div><dt>{t('dp.actualToDate')}</dt><dd data-testid="dp-actual">₹ {inr(b.actualToDate)}</dd></div>
          <div><dt>{t('dp.accounts')}</dt><dd>{b.linesCount}</dd></div>
          <div><dt>{t('dp.preparedBy')}</dt><dd>{b.requestedBy ?? '—'}</dd></div>
          {b.approvedBy && <div><dt>{t('dp.approvedBy')}</dt><dd>{b.approvedBy}</dd></div>}
        </dl>
        {b.openVersion && b.status === 'APPROVED' && <p className="mdm-banner" role="status" data-testid="dp-open-version">{t('dp.openVersion', { doc: b.openVersion })}</p>}
        {error?.form && <p className="field-error" role="alert" data-testid="dp-act-error">{error.form}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="dp-note">{note}</p>}
        <div className="actions-row no-print">
          {can.edit && <button type="button" className="btn" onClick={() => { setEditing(!editing); setTab('lines'); }} data-testid="dp-edit">{t('act.edit')}</button>}
          {can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => dp.act(b.id, 'submit'), t('page.sent'))} data-testid="dp-submit">{t('page.submit')}</button>}
          {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => dp.act(b.id, 'withdraw', { reason: x }), t('page.withdrawn'))} data-testid="dp-withdraw">{t('act.withdraw')}</button>}
          {can.cancel && <button type="button" className="btn" onClick={() => why((x) => dp.act(b.id, 'cancel', { reason: x }), t('page.cancelled'))} data-testid="dp-cancel">{t('act.cancel')}</button>}
          {can.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => dp.act(b.id, 'amend', { reason: x })); if (n) navigateTo(`/bud/dept-budget?id=${n.id}`); } }} data-testid="dp-amend">{b.status === 'APPROVED' ? t('dp.newVersion') : t('dp.raiseAgain')}</button>}
          {can.delete && <button type="button" className="btn" onClick={async () => { if (await run(() => dp.remove(b.id))) navigateTo('/bud/dept-budgets'); }} data-testid="dp-delete">{t('act.delete')}</button>}
          {can.print && <button type="button" className="btn" onClick={() => openPrint(`/dept-budgets/${b.id}/print`, `${b.docNo}.html`)} data-testid="dp-print">{t('act.print')}</button>}
          <button type="button" className="btn" onClick={() => navigateTo(`/bud/dept-report?fyId=${b.fyId}&costCentreId=${b.costCentreId}`)} data-testid="dp-vs-actual">{t('dp.vsActual')}</button>
          {b.workflowInstanceId && <Link to={`/workflow/instance?id=${b.workflowInstanceId}`}>{t('page.approval')}</Link>}
        </div>
      </header>
      <Tabs tabs={tabs} active={tab} onChange={setTab} label={t('page.tabs')} labelOf={(k) => t(`dtab.${k}`)} />
      <div role="tabpanel" aria-labelledby={`ptab-${tab}`}>
        {tab === 'details' && (
          <dl className="kv" data-testid="dp-details">
            <div><dt>{t('dp.costCentre')}</dt><dd>{b.costCentreCode} {b.costCentreName}</dd></div><div><dt>{t('dp.department')}</dt><dd>{b.department ?? t('dp.companyLevel')}</dd></div><div><dt>{t('dp.fy')}</dt><dd>{b.fy}</dd></div>
            <div><dt>{t('f.status')}</dt><dd>{t(`dst.${b.status}`)}</dd></div>{b.reason && <div><dt>{t('f.reason')}</dt><dd>{b.reason}</dd></div>}
            {b.parent && <div><dt>{t('dp.revises')}</dt><dd><button type="button" className="btn" onClick={() => navigateTo(`/bud/dept-budget?id=${b.parent.id}`)}>{b.parent.docNo} v{b.parent.versionNo}</button></dd></div>}
          </dl>
        )}
        {tab === 'lines' && (editing && can.edit ? <Editor t={t} b={b} onSaved={() => { setEditing(false); qc.invalidateQueries({ queryKey: ['bud'] }); }} /> : (
          b.lines.length === 0 ? <p className="muted" data-testid="dp-no-lines">{t('dp.noLines')}</p> : (
            <div className="table-scroll"><table className="data-table" data-testid="dp-lines"><caption className="sr-only">{t('dp.lines')}</caption>
              <thead><tr><th>{t('dp.account')}</th>{b.periods.map((p) => <th key={p.id} className="num">{p.name.split(' ')[0]}</th>)}<th className="num">{t('f.total')}</th></tr></thead>
              <tbody>{b.lines.map((l) => <tr key={l.accountId} data-testid="dp-line"><td>{l.accountCode} {l.accountName}{l.note ? <span className="muted"> · {l.note}</span> : null}</td>{l.months.map((m, k) => <td key={k} className="num">{inr(m)}</td>)}<td className="num">{inr(l.total)}</td></tr>)}
                <tr><th scope="row">{t('f.total')}</th>{b.monthTotals.map((m, k) => <td key={k} className="num">{inr(m)}</td>)}<td className="num" data-testid="dp-lines-total">{inr(b.total)}</td></tr></tbody></table></div>
          )))}
        {tab === 'attachments' && (
          <div data-testid="dp-attachments">
            {can.edit && <FileUploader entity="bud_dept_budget" entityId={b.id} onDone={() => setUploaded((n) => n + 1)} />}
            <AttachmentList key={uploaded} entity="bud_dept_budget" entityId={b.id} canEdit={can.edit} onReplace={() => {}} />
          </div>
        )}
        {tab === 'approvals' && (hq.isPending ? <Skeleton label={t('page.history')} rows={2} /> : (
          <ul data-testid="dp-history">{[...(hq.data?.approvals ?? []).map((a) => `${a.at?.slice(0, 16)} · ${a.step_code ?? ''} ${a.event} · ${a.actor}${a.comment ? `: ${a.comment}` : ''}`), ...(hq.data?.audit ?? []).map((a) => `${a.at?.slice(0, 16)} · ${a.action} · ${a.actor}${a.reason ? `: ${a.reason}` : ''}`)].map((s, i) => <li key={i}>{s}</li>)}</ul>))}
        {tab === 'timeline' && <TimelineTab entity="bud_dept_budget" id={b.id} />}
        {tab === 'discussion' && <DiscussionTab entity="bud_dept_budget" id={b.id} />}
        {tab === 'related' && (rq.isPending ? <Skeleton label={t('dtab.related')} rows={2} /> : (
          <ul data-testid="dp-related">{(rq.data ?? []).map((r, i) => <li key={i}><Link to={r.to}>{r.label}</Link></li>)}{(rq.data ?? []).length === 0 && <li className="muted">{t('dp.noRelated')}</li>}</ul>))}
        {tab === 'compare' && <Compare id={b.id} t={t} />}
      </div>
    </section>
  );
}
