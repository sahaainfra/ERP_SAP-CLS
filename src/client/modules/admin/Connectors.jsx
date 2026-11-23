import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from '../bi/api.js';

// Part 29.02: business connectors (operations console, UI v3 §3.6). The connectors with their health and their syncs, the field mappings
// (used only once the data owner approves them), the sync runs with their errors, and the Tally export. Every sync goes through the owning
// module's own service, so the data obeys the same rules as a person's entry (BR-01).

const read = async (path) => (await api.get(path)).data;
const write = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/admin/connectors${p.toString() ? `?${p}` : ''}`);
};
const HEALTH = { HEALTHY: 'APPROVED', DEGRADED: 'IN_REVIEW', DOWN: 'REJECTED', UNKNOWN: 'DRAFT', NOT_ENABLED: 'CANCELLED' };
const RUN = { SUCCEEDED: 'APPROVED', PARTIAL: 'IN_REVIEW', FAILED: 'REJECTED', RUNNING: 'DRAFT' };
const MAP = { PENDING: 'IN_REVIEW', ACTIVE: 'APPROVED', REJECTED: 'REJECTED', RETIRED: 'CANCELLED' };
const ENTITIES = ['gl_account', 'gst_rate', 'tds_section', 'biometric_user', 'equipment'];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

function RunResult({ run }) {
  const t = useT('con');
  const { number } = useFormat();
  if (!run) return null;
  return <div className="con-result" role="status" data-testid="con-result">
    <StatusBadge status={RUN[run.status]} label={t(`r.${run.status}`)} size="sm" /> {t('records', { n: number(run.records ?? 0, { decimals: 0 }), e: number(run.errors ?? 0, { decimals: 0 }) })}
    {run.detail?.matched != null && <span> · {t('matched', { m: number(run.detail.matched, { decimals: 0 }), u: number(run.detail.unmatched, { decimals: 0 }), d: number(run.detail.duplicates ?? 0, { decimals: 0 }) })}</span>}
    {run.detail?.replayed != null && <span> · {t('replayed', { n: number(run.detail.replayed, { decimals: 0 }) })}</span>}
    {run.detail?.nameScore != null && <span> · {t('nameScore', { n: number(run.detail.nameScore, { decimals: 0 }) })}</span>}
    {run.problems?.slice(0, 3).map((p, i) => <p key={i} className="small con-problem">{p.message}</p>)}
  </div>;
}

function ConnectorCard({ c, data }) {
  const t = useT('con');
  const { dateTime, number } = useFormat();
  const cache = useQueryClient();
  const [form, setForm] = useState({ bankAccountId: data.bankAccounts[0]?.id ?? '', from: monthStart(), to: today(), since: `${today()}T00:00:00Z`, ifsc: '', accountNo: '', name: '' });
  const [result, setResult] = useState(null);
  const done = (r) => { setResult(r.data); cache.invalidateQueries({ queryKey: ['con'] }); };
  const test = useMutation({ mutationFn: () => write(`/admin/connectors/${c.code}/health`, {}), onSuccess: () => cache.invalidateQueries({ queryKey: ['con'] }) });
  const run = useMutation({ mutationFn: ({ path, body }) => write(`/admin/connectors/${c.code}/${path}`, body), onSuccess: done });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const off = c.status !== 'ENABLED';
  return <li className="con-card" data-testid="con-connector" data-code={c.code}>
    <div className="actions-row"><strong>{c.name}</strong><StatusBadge status={HEALTH[c.health]} label={t(`h.${c.health}`)} size="sm" /></div>
    <p className="muted small">{c.code} · {t(`type.${c.type}`)} · {c.provider} · {c.environment}</p>
    <p className="small">{c.lastCall ? t('lastCall', { s: c.lastCall.status, at: dateTime(c.lastCall.at) }) : t('noCall')}{c.failures24h ? ` · ${t('fails', { n: number(c.failures24h, { decimals: 0 }) })}` : ''}</p>
    {c.lastCall?.error && <p className="small con-problem">{c.lastCall.error}</p>}
    {c.lastRun && <p className="muted small">{t('lastRun', { s: t(`r.${c.lastRun.status}`), at: c.lastRun.at ? dateTime(c.lastRun.at) : '—' })}</p>}
    {data.canRun && !off && <div className="con-actions">
      <button type="button" className="btn" disabled={test.isPending} onClick={() => test.mutate()} data-testid="con-test">{t('test')}</button>
      {test.data && <span className="small" role="status" data-testid="con-test-result">{test.data.data.status === 'ok' ? t('testOk') : t('testFail', { m: test.data.data.message })}</span>}
      {c.kinds.includes('BANK_STATEMENT') && <form className="con-form" onSubmit={(e) => { e.preventDefault(); run.mutate({ path: 'bank-statement', body: { bankAccountId: Number(form.bankAccountId), from: form.from, to: form.to } }); }}>
        <Field name={`con-acct-${c.id}`} label={t('bankAccount')}><select value={form.bankAccountId} onChange={set('bankAccountId')} required>{data.bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>
        <Field name={`con-from-${c.id}`} label={t('from')}><input type="date" value={form.from} onChange={set('from')} required /></Field>
        <Field name={`con-to-${c.id}`} label={t('to')}><input type="date" value={form.to} onChange={set('to')} required /></Field>
        <button type="submit" className="btn btn-primary" disabled={run.isPending || !data.bankAccounts.length} data-testid="con-fetch">{t('fetchStatement')}</button>
      </form>}
      {c.kinds.includes('PENNY_DROP') && <form className="con-form" onSubmit={(e) => { e.preventDefault(); run.mutate({ path: 'validate-account', body: { ifsc: form.ifsc.trim().toUpperCase(), accountNo: form.accountNo.trim(), name: form.name.trim() } }); }}>
        <Field name={`con-ifsc-${c.id}`} label={t('ifsc')}><input value={form.ifsc} onChange={set('ifsc')} autoCapitalize="characters" required pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" /></Field>
        <Field name={`con-ac-${c.id}`} label={t('accountNo')}><input value={form.accountNo} onChange={set('accountNo')} inputMode="numeric" required pattern="\d{6,18}" /></Field>
        <Field name={`con-name-${c.id}`} label={t('payeeName')}><input value={form.name} onChange={set('name')} required minLength={2} /></Field>
        <button type="submit" className="btn" disabled={run.isPending}>{t('validate')}</button>
      </form>}
      {(c.kinds.includes('BIOMETRIC') || (c.kinds.includes('TELEMATICS') && c.provider === 'telematics_http')) && <form className="con-form" onSubmit={(e) => { e.preventDefault(); run.mutate({ path: c.type === 'biometric' ? 'biometric' : 'telematics', body: { since: form.since } }); }}>
        <Field name={`con-since-${c.id}`} label={t('since')}><input value={form.since} onChange={set('since')} required /></Field>
        <button type="submit" className="btn btn-primary" disabled={run.isPending} data-testid="con-pull">{c.type === 'biometric' ? t('pullPunches') : t('pullReadings')}</button>
      </form>}
    </div>}
    {off && <p className="muted small">{t('enableFirst')}</p>}
    {(test.error || run.error) && <ErrorState error={test.error ?? run.error} />}
    <RunResult run={result} />
  </li>;
}

function Overview() {
  const t = useT('con');
  const q = useQuery({ queryKey: ['con', 'list'], queryFn: () => read('/admin/connectors'), retry: false });
  const [ex, setEx] = useState({ from: monthStart(), to: today(), companyName: '' });
  const [exRun, setExRun] = useState(null);
  const cache = useQueryClient();
  const exp = useMutation({ mutationFn: () => write('/admin/connectors/accounting-export', { from: ex.from, to: ex.to, ...(ex.companyName.trim() ? { companyName: ex.companyName.trim() } : {}) }), onSuccess: (r) => { setExRun(r.data); cache.invalidateQueries({ queryKey: ['con'] }); } });
  const file = useMutation({ mutationFn: (r) => downloadReport(`/api/v1/admin/connectors/runs/${r.id}/output`, `tally-${ex.from}-${ex.to}.xml`) });
  if (q.isPending) return <Skeleton label={t('tab.connectors')} rows={4} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return <>
    {!d.rows.length ? <EmptyState title={t('none')} message={t('noneBody')} action={<Link to="/admin/integrations">{t('openHub')}</Link>} /> :
      <ul className="con-cards" data-testid="con-connectors">{d.rows.map((c) => <ConnectorCard key={c.id} c={c} data={d} />)}</ul>}
    {d.canExport && <Card title={t('tally')} subtitle={t('tallySub')} testid="con-tally">
      <form className="con-form" onSubmit={(e) => { e.preventDefault(); exp.mutate(); }}>
        <Field name="con-ex-from" label={t('from')}><input type="date" value={ex.from} onChange={(e) => setEx({ ...ex, from: e.target.value })} required /></Field>
        <Field name="con-ex-to" label={t('to')}><input type="date" value={ex.to} onChange={(e) => setEx({ ...ex, to: e.target.value })} required /></Field>
        <Field name="con-ex-co" label={t('tallyCompany')}><input value={ex.companyName} onChange={(e) => setEx({ ...ex, companyName: e.target.value })} maxLength={120} /></Field>
        <button type="submit" className="btn btn-primary" disabled={exp.isPending} data-testid="con-export">{t('export')}</button>
      </form>
      {exp.error && <ErrorState error={exp.error} />}
      {exRun && <><RunResult run={exRun} /><p className="small" data-testid="con-recon">{t('recon', { j: exRun.detail.journals, x: exRun.detail.exported, dr: exRun.detail.debit, cr: exRun.detail.credit })} {exRun.detail.balanced ? t('balanced') : t('unbalanced')}</p>
        {exRun.hasOutput && <button type="button" className="btn" onClick={() => file.mutate(exRun)} data-testid="con-xml">{t('downloadXml')}</button>}</>}
    </Card>}
  </>;
}

function Mappings() {
  const t = useT('con');
  const cache = useQueryClient();
  const l = useQuery({ queryKey: ['con', 'list'], queryFn: () => read('/admin/connectors'), retry: false });
  const q = useQuery({ queryKey: ['con', 'maps'], queryFn: () => read('/admin/connectors/mappings'), retry: false });
  const [f, setF] = useState({ connector: '', entity: 'gl_account', internal: '', external: '', reason: '' });
  const [comment, setComment] = useState({});
  const propose = useMutation({ mutationFn: () => write('/admin/connectors/mappings', { ...f, connector: f.connector || 'ACCOUNTING_EXPORT' }), onSuccess: () => { setF({ ...f, internal: '', external: '' }); cache.invalidateQueries({ queryKey: ['con'] }); } });
  const act = useMutation({ mutationFn: ({ m, action }) => write(`/admin/connectors/mappings/requests/${m.requestId}/act`, { action, comment: comment[m.id] || undefined }), onSuccess: () => cache.invalidateQueries({ queryKey: ['con'] }) });
  if (q.isPending || l.isPending) return <Skeleton label={t('tab.mappings')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return <>
    {l.data?.canConfigure && <Card title={t('propose')} subtitle={t('proposeSub')} testid="con-propose">
      <form className="con-form" onSubmit={(e) => { e.preventDefault(); propose.mutate(); }}>
        <Field name="con-m-conn" label={t('connector')}><select value={f.connector} onChange={set('connector')}><option value="">{t('accountingExport')}</option>{l.data.rows.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
        <Field name="con-m-entity" label={t('entity')}><select value={f.entity} onChange={set('entity')}>{ENTITIES.map((k) => <option key={k} value={k}>{t(`e.${k}`)}</option>)}</select></Field>
        <Field name="con-m-int" label={t('internal')}><input value={f.internal} onChange={set('internal')} required maxLength={120} /></Field>
        <Field name="con-m-ext" label={t('external')}><input value={f.external} onChange={set('external')} required maxLength={120} /></Field>
        <Field name="con-m-reason" label={t('reason')}><input value={f.reason} onChange={set('reason')} required minLength={5} maxLength={500} /></Field>
        <button type="submit" className="btn btn-primary" disabled={propose.isPending} data-testid="con-m-send">{t('send')}</button>
      </form>
      {propose.error && <ErrorState error={propose.error} />}
    </Card>}
    {act.error && <ErrorState error={act.error} />}
    {!q.data.rows.length ? <EmptyState title={t('noMaps')} message={t('noMapsBody')} /> :
      <ul className="con-cards" data-testid="con-maps">{q.data.rows.map((m) => <li key={m.id} className="con-card" data-testid="con-map">
        <div className="actions-row"><strong>{m.internal} → {m.external}</strong><StatusBadge status={MAP[m.status] ?? 'DRAFT'} label={t(`m.${m.status}`)} size="sm" /></div>
        <p className="muted small">{t(`e.${m.entity}`)} · {m.connector === 'ACCOUNTING_EXPORT' ? t('accountingExport') : m.connector} · {t('by', { who: m.by })}{m.approvedBy ? ` · ${t('approvedBy', { who: m.approvedBy })}` : ''}</p>
        {m.canApprove && m.status === 'PENDING' && <div className="con-decide">
          <Field name={`con-c-${m.id}`} label={t('comment')}><input value={comment[m.id] ?? ''} onChange={(e) => setComment({ ...comment, [m.id]: e.target.value })} /></Field>
          <div className="actions-row"><button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ m, action: 'approve' })} data-testid="con-m-approve">{t('approve')}</button>
            <button type="button" className="btn" disabled={act.isPending || (comment[m.id] ?? '').trim().length < 5} onClick={() => act.mutate({ m, action: 'reject' })}>{t('reject')}</button></div>
        </div>}
      </li>)}</ul>}
  </>;
}

function Runs() {
  const t = useT('con');
  const { dateTime, number } = useFormat();
  const search = useSearch();
  const status = search.get('status') ?? '';
  const q = useQuery({ queryKey: ['con', 'runs', status], queryFn: () => read(`/admin/connectors/runs${status ? `?status=${status}` : ''}`), retry: false });
  const exp = useMutation({ mutationFn: (format) => downloadReport(`/api/v1/admin/connectors/runs/export?format=${format}${status ? `&status=${status}` : ''}`, `sync-runs.${format}`) });
  return <>
    <div className="toolbar">
      <Field name="con-status" label={t('status')}><select value={status} onChange={(e) => go({ status: e.target.value })}><option value="">{t('all')}</option>{['SUCCEEDED', 'PARTIAL', 'FAILED', 'RUNNING'].map((s) => <option key={s} value={s}>{t(`r.${s}`)}</option>)}</select></Field>
      <button type="button" className="btn" disabled={exp.isPending} onClick={() => exp.mutate('xlsx')}>{t('exportXlsx')}</button>
      <button type="button" className="btn" disabled={exp.isPending} onClick={() => exp.mutate('csv')}>{t('exportCsv')}</button>
    </div>
    {exp.error && <ErrorState error={exp.error} />}
    {q.isPending ? <Skeleton label={t('tab.runs')} rows={5} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data.rows.length ? <EmptyState title={t('noRuns')} message={t('noRunsBody')} action={<button type="button" className="btn" onClick={() => go({ tab: '', status: '' })}>{t('tab.connectors')}</button>} /> :
      <Card title={t('tab.runs')} count={{ shown: q.data.rows.length, total: q.data.total }} testid="con-runs">
        <ul className="con-cards">{q.data.rows.map((r) => <li key={r.id} className="con-card" data-testid="con-run">
          <div className="actions-row"><strong>{t(`k.${r.kind}`)} · {r.connector === 'ACCOUNTING_EXPORT' ? t('accountingExport') : r.connector}</strong><StatusBadge status={RUN[r.status]} label={t(`r.${r.status}`)} size="sm" /></div>
          <p className="muted small">{dateTime(r.startedAt)} · {r.by ?? '—'} · {t('records', { n: number(r.records ?? 0, { decimals: 0 }), e: number(r.errors ?? 0, { decimals: 0 }) })}</p>
          {r.problems.slice(0, 2).map((p, i) => <p key={i} className="small con-problem">{p.message}</p>)}
        </li>)}</ul>
      </Card>}
  </>;
}

export function BusinessConnectors() {
  const t = useT('con');
  const search = useSearch();
  usePageTitle(t('title'));
  const tabs = ['connectors', 'mappings', 'runs'];
  const tab = tabs.includes(search.get('tab')) ? search.get('tab') : 'connectors';
  return <section aria-labelledby="con-h" data-testid="con-page">
    <PageHeader id="con-h" title={t('title')} subtitle={t('subtitle')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="con-tabs">{tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'connectors' ? '' : k, status: '' })}>{t(`tab.${k}`)}</button>)}</div>
    {tab === 'connectors' && <Overview />}
    {tab === 'mappings' && <Mappings />}
    {tab === 'runs' && <Runs />}
  </section>;
}
