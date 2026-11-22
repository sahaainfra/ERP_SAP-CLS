import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { useSession } from '../core/api/index.js';
import { Field, Link, can, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from '../bi/api.js';

// Part 29.01: the Enterprise Control Center (overview page, UI v3 §3.4) with the admin change approvals (worklist), the configuration
// export/import with its diff (form) and the company onboarding checklist (wizard). Every configuration change is a request a checker
// approves (BR-01); the emergency controls act at once and are ratified within 24 hours.

const read = async (path) => (await api.get(path)).data;
const write = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/admin/control${p.toString() ? `?${p}` : ''}`);
};
const ST = { SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', REJECTED: 'REJECTED', RETURNED: 'RETURNED', WITHDRAWN: 'CANCELLED' };
const TONE = { error: 'error', warning: 'warning', success: 'success' };

function Dashboard() {
  const t = useT('adm');
  const { number, dateTime } = useFormat();
  const q = useQuery({ queryKey: ['adm', 'dash'], queryFn: () => read('/admin/dashboard'), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.dashboard')} rows={6} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const by = Object.fromEntries(d.metrics.map((m) => [m.key, m]));
  const tone = (m) => (m.value ? TONE[m.tone] ?? 'warning' : 'success');
  return <>
    {d.readOnly && <p role="alert" className="adm-banner" data-testid="adm-readonly">{t('readOnlyOn')}</p>}
    <KpiRow testid="adm-tiles" label={t('tab.dashboard')}>
      <KpiTile testid="adm-approvals" label={t('m.approvals')} value={number(by.approvals.value, { decimals: 0 })} tone={by.approvals.value ? 'warning' : 'success'} to={by.approvals.drill}>{t('mine', { n: d.myApprovals })}</KpiTile>
      {d.metrics.filter((m) => m.key !== 'approvals').map((m) => <KpiTile key={m.key} testid={`adm-m-${m.key}`} label={t(`m.${m.key}`)} value={m.key === 'backup' ? (m.lastStatus ? t(`b.${m.lastStatus}`) : t('b.none')) : number(m.value, { decimals: 0 })}
        tone={m.key === 'ai' ? 'neutral' : tone(m)} to={m.drill}>{m.key === 'backup' ? (m.lastAt ? dateTime(m.lastAt) : t('b.noneBody')) : m.key === 'ai' ? t('aiCost', { cost: m.costRupees }) : m.never ? t('never') : t(`h.${m.key}`)}</KpiTile>)}
    </KpiRow>
    <p className="muted small">{t('env', { env: d.environment })}</p>
  </>;
}

function Approvals() {
  const t = useT('adm');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const status = new URLSearchParams(window.location.search).get('status') ?? 'SUBMITTED';
  const q = useQuery({ queryKey: ['adm', 'changes', status], queryFn: () => read(`/admin/changes?status=${status}`), retry: false });
  const [comment, setComment] = useState({});
  const act = useMutation({ mutationFn: ({ id, action, version }) => write(`/admin/changes/${id}/act`, { action, comment: comment[id] || undefined, version }), onSuccess: () => cache.invalidateQueries({ queryKey: ['adm'] }) });
  if (q.isPending) return <Skeleton label={t('tab.approvals')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <>
    <div className="toolbar"><Field name="adm-status" label={t('status')}><select value={status} onChange={(e) => go({ status: e.target.value === 'SUBMITTED' ? '' : e.target.value })}>{['SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED'].map((s) => <option key={s} value={s}>{t(`s.${s}`)}</option>)}</select></Field></div>
    {act.error && <ErrorState error={act.error} />}
    {!q.data.rows.length ? <EmptyState title={t('noRequests')} message={t('noRequestsBody')} action={<button type="button" className="btn" onClick={() => go({ tab: 'change' })}>{t('raise')}</button>} /> :
      <ul className="adm-cards" data-testid="adm-requests">{q.data.rows.map((r) => <li key={r.id} className="adm-card" data-testid="adm-request">
        <div className="actions-row"><strong>{r.title}</strong><StatusBadge status={ST[r.status]} label={t(`s.${r.status}`)} size="sm" /></div>
        <p className="muted small">{t('by', { by: r.requestedBy, at: dateTime(r.requestedAt) })} · {t('chain', { chain: r.chain.join(' → '), step: r.currentStep })}</p>
        <p className="small">{r.reason}</p>
        {r.steps?.filter((s) => s.decision).map((s) => <p key={`${s.stepNo}-${s.decidedAt}`} className="muted small">{t('decided', { role: s.role, who: s.decidedBy, d: t(`d.${s.decision}`) })}{s.comment ? `: ${s.comment}` : ''}</p>)}
        {r.canDecide && <div className="adm-decide">
          <Field name={`adm-c-${r.id}`} label={t('comment')}><input value={comment[r.id] ?? ''} onChange={(e) => setComment({ ...comment, [r.id]: e.target.value })} /></Field>
          <div className="actions-row adm-actions"><button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'approve', version: r.version })} data-testid="adm-approve">{t('approve')}</button>
            <button type="button" className="btn" disabled={act.isPending || (comment[r.id] ?? '').trim().length < 5} onClick={() => act.mutate({ id: r.id, action: 'return', version: r.version })}>{t('return')}</button>
            <button type="button" className="btn" disabled={act.isPending || (comment[r.id] ?? '').trim().length < 5} onClick={() => act.mutate({ id: r.id, action: 'reject', version: r.version })}>{t('reject')}</button></div>
        </div>}
      </li>)}</ul>}
  </>;
}

function Change() {
  const t = useT('adm');
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['adm', 'areas'], queryFn: () => read('/admin/areas'), retry: false });
  const [f, setF] = useState({ area: 'FEATURE_FLAG', key: '', value: '', reason: '' });
  const submit = useMutation({ mutationFn: (b) => write('/admin/changes', b), onSuccess: () => { setF({ ...f, key: '', value: '', reason: '' }); cache.invalidateQueries({ queryKey: ['adm'] }); } });
  if (q.isPending) return <Skeleton label={t('tab.change')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const list = q.data[f.area]; const cur = list.find((x) => x.key === f.key);
  return <Card title={t('tab.change')} subtitle={t('changeSub')} testid="adm-change">
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); submit.mutate({ area: f.area, key: f.key, value: f.area === 'FEATURE_FLAG' ? f.value === 'true' : f.value, reason: f.reason }); }}>
      <Field name="adm-area" label={`${t('area')} *`}><select value={f.area} onChange={(e) => setF({ ...f, area: e.target.value, key: '', value: '' })}>{Object.keys(q.data).map((a) => <option key={a} value={a}>{t(`a.${a}`)}</option>)}</select></Field>
      <Field name="adm-key" label={`${t('key')} *`}><input list="adm-keys" required value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} /><datalist id="adm-keys">{list.map((x) => <option key={x.key} value={x.key} />)}</datalist></Field>
      {cur && <p className="muted small" data-testid="adm-current">{t('current', { v: String(cur.value) })}{cur.description ? ` · ${cur.description}` : ''}</p>}
      {f.area === 'FEATURE_FLAG' ? <Field name="adm-value" label={`${t('newValue')} *`}><select required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })}><option value="">{t('choose')}</option><option value="true">{t('on')}</option><option value="false">{t('off')}</option></select></Field>
        : <Field name="adm-value" label={`${t('newValue')} *`}><input required value={f.value} inputMode={['integer', 'decimal'].includes(cur?.type) ? 'decimal' : 'text'} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>}
      <Field name="adm-reason" label={`${t('reason')} *`}><input required minLength={5} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <div className="actions-row adm-actions"><button type="submit" className="btn btn-primary" disabled={submit.isPending} data-testid="adm-submit-change">{t('send')}</button></div>
      {submit.error && <ErrorState error={submit.error} />}
      {submit.data && <p role="status" data-testid="adm-sent">{t('sent', { chain: submit.data.data.chain.join(' → ') })}</p>}
    </form>
  </Card>;
}

function Emergency() {
  const t = useT('adm');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['adm', 'emergency'], queryFn: () => read('/admin/emergency'), retry: false });
  const [why, setWhy] = useState(''); const [flag, setFlag] = useState('');
  const act = useMutation({ mutationFn: ({ path, body }) => write(`/admin/emergency/${path}`, body), onSuccess: () => { setWhy(''); setFlag(''); cache.invalidateQueries({ queryKey: ['adm'] }); } });
  if (q.isPending) return <Skeleton label={t('tab.emergency')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const e = q.data; const okWhy = why.trim().length >= 5;
  return <>
    <Card title={t('tab.emergency')} subtitle={t('emergencySub')} testid="adm-emergency">
      <p><StatusBadge status={e.readOnly ? 'REJECTED' : 'APPROVED'} label={e.readOnly ? t('roOn', { by: e.readOnlyBy }) : t('roOff')} /></p>
      {e.canExecute && <div className="form-grid">
        <Field name="adm-why" label={`${t('reason')} *`}><input value={why} minLength={5} onChange={(x) => setWhy(x.target.value)} /></Field>
        <div className="actions-row adm-actions">
          <button type="button" className="btn btn-primary" disabled={!okWhy || act.isPending} onClick={() => act.mutate({ path: 'read-only', body: { on: !e.readOnly, reason: why } })} data-testid="adm-ro">{e.readOnly ? t('roEnd') : t('roStart')}</button>
          <button type="button" className="btn" disabled={!okWhy || act.isPending} onClick={() => act.mutate({ path: 'force-logout', body: { reason: why } })} data-testid="adm-logout">{t('logout')}</button>
        </div>
        <Field name="adm-flag" label={t('killFlag')}><input value={flag} placeholder="ff.module.pNNNN" onChange={(x) => setFlag(x.target.value)} /></Field>
        <div className="actions-row adm-actions"><button type="button" className="btn" disabled={!okWhy || !flag || act.isPending} onClick={() => act.mutate({ path: 'kill', body: { key: flag, reason: why } })}>{t('kill')}</button></div>
        {act.error && <ErrorState error={act.error} />}
      </div>}
    </Card>
    <Card title={t('actions')} testid="adm-actions">
      {!e.actions.length ? <p className="muted">{t('noActions')}</p> : <ul className="adm-cards">{e.actions.map((a) => <li key={a.id} className="adm-card">
        <div className="actions-row"><strong>{t(`e.${a.action}`)}</strong><StatusBadge status={a.status === 'RATIFIED' ? 'APPROVED' : a.overdue ? 'REJECTED' : 'AT_RISK'} label={a.status === 'RATIFIED' ? t('ratified', { by: a.ratifiedBy }) : a.overdue ? t('overdue') : t('ratifyBy', { at: dateTime(a.ratifyDue) })} size="sm" /></div>
        <p className="muted small">{a.by} · {dateTime(a.at)} · {a.reason}</p>
      </li>)}</ul>}
    </Card>
  </>;
}

function Snapshots() {
  const t = useT('adm');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['adm', 'snapshots'], queryFn: () => read('/admin/snapshots'), retry: false });
  const [note, setNote] = useState(''); const [file, setFile] = useState(null); const [pick, setPick] = useState([]); const [why, setWhy] = useState('');
  const take = useMutation({ mutationFn: () => write('/admin/snapshots', { note: note || undefined }), onSuccess: () => { setNote(''); cache.invalidateQueries({ queryKey: ['adm', 'snapshots'] }); } });
  const diff = useMutation({ mutationFn: (f) => api.post('/admin/snapshots/diff', { file: f }) });
  const imp = useMutation({ mutationFn: () => write('/admin/snapshots/import', { file, keys: pick, reason: why }), onSuccess: () => { setPick([]); cache.invalidateQueries({ queryKey: ['adm'] }); } });
  const download = useMutation({ mutationFn: (s) => downloadReport(`/api/v1/admin/snapshots/${s.id}/export`, `config-${s.environment}.json`) });
  const load = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const parsed = JSON.parse(await f.text()); setFile(parsed); setPick([]); diff.mutate(parsed); } catch { setFile(null); } };
  if (q.isPending) return <Skeleton label={t('tab.snapshots')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = diff.data?.data;
  return <>
    <Card title={t('takeTitle')} subtitle={t('takeSub')} testid="adm-take">
      <div className="form-grid"><Field name="adm-note" label={t('note')}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="actions-row adm-actions"><button type="button" className="btn btn-primary" onClick={() => take.mutate()} disabled={take.isPending} data-testid="adm-take-btn">{t('take')}</button></div></div>
      {take.error && <ErrorState error={take.error} />}
      {!q.data.length ? <p className="muted">{t('noSnapshots')}</p> : <ul className="adm-cards" data-testid="adm-snapshots">{q.data.map((s) => <li key={s.id} className="adm-card">
        <div className="actions-row"><strong>{s.environment} · {dateTime(s.takenAt)}</strong><button type="button" className="btn btn-small" onClick={() => download.mutate(s)}>{t('export')}</button></div>
        <p className="muted small">{s.note ?? ''} <code>{s.checksum.slice(0, 12)}</code></p></li>)}</ul>}
    </Card>
    <Card title={t('diffTitle')} subtitle={t('diffSub')} testid="adm-diff">
      <Field name="adm-file" label={t('file')}><input type="file" accept="application/json,.json" onChange={load} data-testid="adm-file" /></Field>
      {file === null && diff.isIdle === false && <p className="muted">{t('badFile')}</p>}
      {diff.error && <ErrorState error={diff.error} />}
      {d && <>
        <p className="muted small" data-testid="adm-diff-summary">{t('diffSummary', { from: d.from.environment, at: dateTime(d.from.takenAt), to: d.to.environment, n: d.differences.length })}</p>
        {!d.differences.length ? <p>{t('same')}</p> : <div className="table-scroll"><table className="data-table" data-testid="adm-diff-table">
          <thead><tr><th>{t('pick')}</th><th>{t('area')}</th><th>{t('key')}</th><th>{t('here')}</th><th>{t('there')}</th><th>{t('change')}</th></tr></thead>
          <tbody>{d.differences.map((x) => { const k = `${x.area}:${x.key}`; return <tr key={k} data-testid="adm-diff-row">
            <td data-label={t('pick')}>{x.canApply ? <input type="checkbox" aria-label={t('pickOne', { key: x.key })} checked={pick.includes(k)} onChange={(e) => setPick(e.target.checked ? [...pick, k] : pick.filter((p) => p !== k))} /> : '—'}</td>
            <td data-label={t('area')}>{t(`a.${x.area}`)}</td><td data-label={t('key')}><code>{x.key}</code></td><td data-label={t('here')}>{x.current ?? '—'}</td><td data-label={t('there')}>{x.incoming ?? '—'}</td><td data-label={t('change')}>{t(`c.${x.change}`)}</td></tr>; })}</tbody>
        </table></div>}
        {pick.length > 0 && <div className="form-grid"><Field name="adm-imp-why" label={`${t('reason')} *`}><input value={why} minLength={5} onChange={(e) => setWhy(e.target.value)} /></Field>
          <div className="actions-row adm-actions"><button type="button" className="btn btn-primary" disabled={why.trim().length < 5 || imp.isPending} onClick={() => imp.mutate()} data-testid="adm-import">{t('importN', { n: pick.length })}</button></div></div>}
        {imp.error && <ErrorState error={imp.error} />}
        {imp.data && <p role="status" data-testid="adm-imported">{t('imported', { n: imp.data.data.length })}</p>}
      </>}
    </Card>
  </>;
}

function Onboarding() {
  const t = useT('adm');
  const q = useQuery({ queryKey: ['adm', 'onboarding'], queryFn: () => read('/admin/onboarding'), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.onboarding')} rows={4} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const o = q.data;
  return <Card title={t('obTitle', { company: o.company.name })} subtitle={t('obSub', { done: o.done, total: o.total })} testid="adm-onboarding">
    <ol className="adm-steps">{o.steps.map((s, i) => <li key={s.key} data-testid="adm-step" data-done={s.done}>
      <span className="adm-step-no" aria-hidden="true">{i + 1}</span><div><strong>{t(`ob.${s.key}`)}</strong> <StatusBadge status={s.done ? 'APPROVED' : 'DRAFT'} label={s.done ? t('done') : t('todo')} size="sm" />
        <div className="muted small">{t(`obh.${s.key}`)}{s.detail != null && s.done ? ` · ${s.detail}` : ''}</div><Link to={s.route}>{s.done ? t('review') : t('start')}</Link></div></li>)}</ol>
  </Card>;
}

function Catalogue() {
  const t = useT('adm');
  const { dateTime } = useFormat();
  const [qText, setQ] = useState('');
  const q = useQuery({ queryKey: ['adm', 'cat', qText], queryFn: () => read(`/admin/catalogue${qText.trim().length >= 2 ? `?q=${encodeURIComponent(qText.trim())}` : ''}`), retry: false });
  return <>
    <Field name="adm-q" label={t('searchPages')}><input type="search" inputMode="search" value={qText} onChange={(e) => setQ(e.target.value)} /></Field>
    {q.isPending ? <Skeleton label={t('tab.pages')} rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : <>
      <Card title={t('tab.pages')} count={{ shown: q.data.pages.length, total: q.data.pages.length }} testid="adm-pages">
        {!q.data.pages.length ? <p className="muted">{t('noPages')}</p> : <ul className="adm-links">{q.data.pages.map((p) => <li key={p.code}><Link to={p.route}>{p.label}</Link></li>)}</ul>}
      </Card>
      <Card title={t('history')} testid="adm-history">
        {!q.data.recent.length ? <p className="muted">{t('noHistory')}</p> : <ul className="adm-cards">{q.data.recent.map((r) => <li key={r.id} className="adm-card"><div className="actions-row"><strong>{r.title}</strong><StatusBadge status={ST[r.status] ?? 'DRAFT'} label={t(`s.${r.status}`)} size="sm" /></div><p className="muted small">{r.by} · {dateTime(r.at)}</p></li>)}</ul>}
      </Card>
    </>}
  </>;
}

export function ControlCenter() {
  const t = useT('adm');
  const session = useSession();
  const search = useSearch();
  usePageTitle(t('title'));
  const tabs = ['dashboard', 'approvals', ...(can(session.data, 'adm.change.create') ? ['change'] : []), 'emergency', ...(can(session.data, 'adm.snapshot.manage') ? ['snapshots'] : []), ...(can(session.data, 'adm.onboarding.run') ? ['onboarding'] : []), 'pages'];
  const tab = tabs.includes(search.get('tab')) ? search.get('tab') : 'dashboard';
  return <section aria-labelledby="adm-h" data-testid="adm-page">
    <PageHeader id="adm-h" title={t('title')} subtitle={t('subtitle')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="adm-tabs">{tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'dashboard' ? '' : k, status: '' })}>{t(`tab.${k}`)}</button>)}</div>
    {tab === 'dashboard' && <Dashboard />}
    {tab === 'approvals' && <Approvals />}
    {tab === 'change' && <Change />}
    {tab === 'emergency' && <Emergency />}
    {tab === 'snapshots' && <Snapshots />}
    {tab === 'onboarding' && <Onboarding />}
    {tab === 'pages' && <Catalogue />}
  </section>;
}
