import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { TS, TicketView } from './HelpCenter.jsx';

// Part 29.08: the Support Desk (worklist): the queue by priority and SLA with the ticket's page and correlation ID, data corrections routed
// to the module owner (implemented only through the module's transaction), knowledge management (articles, tours, announcements) and the
// support dashboard.

const read = async (path) => (await api.get(path)).data;
const send = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/admin/support${p.toString() ? `?${p}` : ''}`);
};
const CS = { SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', REJECTED: 'REJECTED', IMPLEMENTED: 'COMPLETED' };

function CorrectionForm({ ticketId }) {
  const t = useT('hd');
  const cache = useQueryClient();
  const [f, setF] = useState({ module: 'fin', entity: '', entityId: '', recordRef: '', field: '', current: '', proposed: '', reason: '' });
  const save = useMutation({ mutationFn: () => send(`/admin/help/tickets/${ticketId}/corrections`, { module: f.module, entity: f.entity.trim(), entityId: f.entityId.trim(), recordRef: f.recordRef.trim(), changes: [{ field: f.field.trim(), ...(f.current ? { current: f.current } : {}), proposed: f.proposed }], reason: f.reason }), onSuccess: () => cache.invalidateQueries({ queryKey: ['hd'] }) });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return <details className="hd-section"><summary>{t('requestCorrection')}</summary>
    <p className="muted small">{t('correctionRule')}</p>
    <div className="hd-form hd-grid">
      <Field name="hd-c-mod" label={t('module')}><select value={f.module} onChange={set('module')}>{['fin', 'bill', 'pay', 'proc', 'inv', 'hr', 'att', 'site', 'plant', 'proj', 'mdm', 'qa', 'hse', 'ctr', 'bud', 'est', 'bd'].map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
      <Field name="hd-c-ent" label={t('table')}><input value={f.entity} onChange={set('entity')} placeholder="fin_journals" /></Field>
      <Field name="hd-c-id" label={t('recordId')}><input value={f.entityId} onChange={set('entityId')} /></Field>
      <Field name="hd-c-ref" label={t('recordRef')}><input value={f.recordRef} onChange={set('recordRef')} /></Field>
      <Field name="hd-c-field" label={t('field')}><input value={f.field} onChange={set('field')} /></Field>
      <Field name="hd-c-cur" label={t('current')}><input value={f.current} onChange={set('current')} /></Field>
      <Field name="hd-c-new" label={t('proposed')}><input value={f.proposed} onChange={set('proposed')} /></Field>
      <Field name="hd-c-why" label={t('reason')}><input value={f.reason} onChange={set('reason')} /></Field>
    </div>
    {save.error && <ErrorState error={save.error} />}
    <button type="button" className="btn btn-primary" disabled={save.isPending || !f.entity || !f.entityId || !f.recordRef || !f.field || !f.proposed || f.reason.trim().length < 5} onClick={() => save.mutate()} data-testid="hd-send-correction">{t('sendCorrection')}</button>
  </details>;
}

function Queue() {
  const t = useT('hd');
  const { dateTime } = useFormat();
  const search = useSearch();
  const sel = search.get('ticket');
  const scope = search.get('scope') ?? 'queue';
  const breached = search.get('breached') === '1';
  const q = useQuery({ queryKey: ['hd', 'queue', scope, breached], queryFn: () => read(`/admin/help/tickets?scope=${scope}${breached ? '&breached=1' : ''}`), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.queue')} rows={4} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <>
    <div className="toolbar">
      <Field name="hd-scope" label={t('show')}><select value={scope} onChange={(e) => go({ scope: e.target.value === 'queue' ? '' : e.target.value, ticket: '' })}><option value="queue">{t('sc.queue')}</option><option value="assigned">{t('sc.assigned')}</option></select></Field>
      <label className="hd-check"><input type="checkbox" checked={breached} onChange={(e) => go({ breached: e.target.checked ? '1' : '', ticket: '' })} /> {t('onlyBreached')}</label>
    </div>
    {sel && <><TicketView key={sel} id={sel} work /><CorrectionForm ticketId={sel} /></>}
    {!q.data.rows.length ? <EmptyState title={t('queueEmpty')} message={t('queueEmptyBody')} /> : <Card title={t('tab.queue')} count={{ shown: q.data.rows.length, total: q.data.total }} testid="hd-queue">
      <ul className="hd-cards">{q.data.rows.map((k) => <li key={k.id} className={`hd-card${k.breached ? ' hd-late' : ''}`} data-testid="hd-queuerow">
        <button type="button" className="hd-cardbtn" onClick={() => go({ ticket: k.id })}><span className="actions-row"><strong>{k.ticketNo} · {k.subject}</strong><StatusBadge status={TS[k.status]} label={t(`s.${k.status}`)} size="sm" /></span>
          <span className="small">{t(`pr.${k.priority}`)} · {k.teamLabel} · {t('due', { at: dateTime(k.slaDue) })}{k.breached ? ` · ${t('breached')}` : ''}</span>
          <span className="muted small">{k.raisedBy}{k.assignedTo ? ` → ${k.assignedTo}` : ''}{k.pageRef ? ` · ${k.pageRef}` : ''}</span></button>
      </li>)}</ul>
    </Card>}
  </>;
}

function Corrections() {
  const t = useT('hd');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['hd', 'corrections'], queryFn: () => read('/admin/help/corrections'), retry: false });
  const [txt, setTxt] = useState({});
  const act = useMutation({ mutationFn: ({ c, action }) => send(`/admin/help/corrections/${c.id}/act`, { action, comment: txt[c.id] || undefined }), onSuccess: () => cache.invalidateQueries({ queryKey: ['hd'] }) });
  const impl = useMutation({ mutationFn: (c) => send(`/admin/help/corrections/${c.id}/implement`, { transactionRef: txt[c.id] }), onSuccess: () => cache.invalidateQueries({ queryKey: ['hd'] }) });
  if (q.isPending) return <Skeleton label={t('tab.corrections')} rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <>
    <p className="small muted">{t('correctionRule')}</p>
    {(act.error || impl.error) && <ErrorState error={act.error ?? impl.error} />}
    {!q.data.rows.length ? <EmptyState title={t('noCorrections')} message={t('noCorrectionsBody')} /> : <ul className="hd-cards" data-testid="hd-corrections">{q.data.rows.map((c) => <li key={c.id} className="hd-card" data-testid="hd-correction">
      <div className="actions-row"><strong>{c.recordRef}</strong><StatusBadge status={CS[c.status]} label={t(`cs.${c.status}`)} size="sm" /></div>
      <p className="small">{c.changes.map((x) => `${x.field}: ${x.current ?? '—'} → ${x.proposed}`).join('; ')}</p>
      <p className="muted small">{c.module} · {c.entity} #{c.entityId} · {t('owner', { r: c.owner })}{c.financial ? ` · ${t('thenAud')}` : ''} · {c.by}, {dateTime(c.createdAt)}</p>
      <p className="small">{c.reason}</p>
      {c.transactionRef && <p className="small">{t('implementedBy', { ref: c.transactionRef, who: c.implementedBy })}</p>}
      {(c.canApprove || c.canImplement) && <div className="hd-form"><Field name={`hd-ct-${c.id}`} label={c.canImplement ? t('transactionRef') : t('comment')}><input value={txt[c.id] ?? ''} onChange={(e) => setTxt({ ...txt, [c.id]: e.target.value })} /></Field>
        {c.canApprove && <><button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ c, action: 'approve' })} data-testid="hd-approve-correction">{t('approve')}</button>
          <button type="button" className="btn" disabled={act.isPending || (txt[c.id] ?? '').trim().length < 5} onClick={() => act.mutate({ c, action: 'reject' })}>{t('reject')}</button></>}
        {c.canImplement && <button type="button" className="btn btn-primary" disabled={impl.isPending || (txt[c.id] ?? '').trim().length < 3} onClick={() => impl.mutate(c)}>{t('implement')}</button>}</div>}
    </li>)}</ul>}
  </>;
}

function Articles() {
  const t = useT('hd');
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['hd', 'articles-all'], queryFn: () => read('/admin/help/articles?all=1'), retry: false });
  const blank = { kind: 'ARTICLE', title: '', body: '', module: '', routes: '', roles: '', steps: '', validFrom: '', validTo: '', status: 'PUBLISHED' };
  const [f, setF] = useState(blank);
  const save = useMutation({ mutationFn: () => send('/admin/help/articles', { ...(f.id ? { id: f.id } : {}), kind: f.kind, title: f.title, body: f.body, ...(f.module ? { module: f.module } : {}), routes: f.routes.split(/[\s,]+/).filter(Boolean), roles: f.roles.split(/[\s,]+/).filter(Boolean).map((r) => r.toUpperCase()),
    ...(f.kind === 'TOUR' ? { steps: f.steps.split('\n').filter(Boolean).map((l) => { const [title, ...rest] = l.split('|'); return { title: title.trim(), body: (rest.join('|') || title).trim() }; }) } : {}), ...(f.kind === 'ANNOUNCEMENT' ? { validFrom: new Date(f.validFrom).toISOString(), validTo: new Date(f.validTo).toISOString() } : {}), status: f.status }),
  onSuccess: () => { setF(blank); cache.invalidateQueries({ queryKey: ['hd'] }); } });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (q.isPending) return <Skeleton label={t('tab.articles')} rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <>
    {q.data.canManage && <Card title={f.id ? t('editArticle') : t('newArticle')} testid="hd-editor">
      <div className="hd-form hd-grid">
        <Field name="hd-a-kind" label={t('kind')}><select value={f.kind} onChange={set('kind')}>{['ARTICLE', 'TOUR', 'ANNOUNCEMENT'].map((k) => <option key={k} value={k}>{t(`k.${k}`)}</option>)}</select></Field>
        <Field name="hd-a-title" label={t('articleTitle')}><input value={f.title} onChange={set('title')} maxLength={160} /></Field>
        <Field name="hd-a-routes" label={t('routes')}><input value={f.routes} onChange={set('routes')} placeholder="/site/dprs" /></Field>
        <Field name="hd-a-roles" label={t('roles')}><input value={f.roles} onChange={set('roles')} placeholder="SE, CM" /></Field>
        {f.kind === 'ANNOUNCEMENT' && <><Field name="hd-a-from" label={t('from')}><input type="datetime-local" value={f.validFrom} onChange={set('validFrom')} /></Field><Field name="hd-a-to" label={t('to')}><input type="datetime-local" value={f.validTo} onChange={set('validTo')} /></Field></>}
        <Field name="hd-a-status" label={t('status')}><select value={f.status} onChange={set('status')}>{['DRAFT', 'PUBLISHED', 'RETIRED'].map((s) => <option key={s} value={s}>{t(`as.${s}`)}</option>)}</select></Field>
      </div>
      <Field name="hd-a-body" label={t('body')}><textarea rows={6} value={f.body} onChange={set('body')} /></Field>
      {f.kind === 'TOUR' && <Field name="hd-a-steps" label={t('tourSteps')}><textarea rows={4} value={f.steps} onChange={set('steps')} placeholder={t('tourStepsPh')} /></Field>}
      {save.error && <ErrorState error={save.error} />}
      <div className="hd-footer"><button type="button" className="btn btn-primary" disabled={save.isPending || f.title.trim().length < 3 || f.body.trim().length < 3} onClick={() => save.mutate()} data-testid="hd-save-article">{t('saveArticle')}</button>{f.id && <button type="button" className="btn" onClick={() => setF(blank)}>{t('cancel')}</button>}</div>
    </Card>}
    {!q.data.rows.length ? <EmptyState title={t('noKb')} message={t('noKbBody')} /> : <ul className="hd-cards">{q.data.rows.map((a) => <li key={a.id} className="hd-card">
      <div className="actions-row"><strong>{a.title}</strong><StatusBadge status={a.status === 'PUBLISHED' ? 'APPROVED' : a.status === 'DRAFT' ? 'DRAFT' : 'CANCELLED'} label={t(`as.${a.status}`)} size="sm" /></div>
      <p className="muted small">{t(`k.${a.kind}`)} · v{a.version}{a.routes.length ? ` · ${a.routes.join(', ')}` : ''}{a.roles.length ? ` · ${a.roles.join(', ')}` : ''}</p>
      {q.data.canManage && <button type="button" className="btn" onClick={() => setF({ id: a.id, kind: a.kind, title: a.title, body: a.body, module: a.module ?? '', routes: a.routes.join(', '), roles: a.roles.join(', '), steps: a.steps.map((s) => `${s.title} | ${s.body}`).join('\n'), validFrom: a.validFrom ? a.validFrom.slice(0, 16) : '', validTo: a.validTo ? a.validTo.slice(0, 16) : '', status: a.status })}>{t('edit')}</button>}
    </li>)}</ul>}
  </>;
}

function Dashboard() {
  const t = useT('hd');
  const { number } = useFormat();
  const q = useQuery({ queryKey: ['hd', 'dashboard'], queryFn: () => read('/admin/help/dashboard'), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.dashboard')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return <>
    <KpiRow testid="hd-kpis" label={t('tab.dashboard')}>
      <KpiTile testid="hd-k-open" kind="count" label={t('k.open')} value={number(d.open, { decimals: 0 })} tone={d.open ? 'warning' : 'success'} to="/admin/support">{t('k.openHelp')}</KpiTile>
      <KpiTile testid="hd-k-breached" kind="count" label={t('k.breached')} value={number(d.breached, { decimals: 0 })} tone={d.breached ? 'error' : 'success'} to="/admin/support?breached=1">{t('k.breachedHelp')}</KpiTile>
      <KpiTile testid="hd-k-time" kind="time" label={t('k.time')} value={d.avgResolutionHours == null ? '—' : `${d.avgResolutionHours} h`} tone="neutral">{t('k.timeHelp', { n: number(d.resolved30, { decimals: 0 }) })}</KpiTile>
      <KpiTile testid="hd-k-csat" kind="quality" label={t('k.csat')} value={d.avgRating == null ? '—' : `${d.avgRating} / 5`} tone="neutral">{t('k.csatHelp', { n: number(d.ratings30, { decimals: 0 }) })}</KpiTile>
    </KpiRow>
    <div className="hd-split">
      {[['byPriority', 'pr.'], ['byStatus', 's.'], ['byCategory', 'cat.']].map(([k, pre]) => <Card key={k} title={t(`by.${k}`)} testid={`hd-${k}`}>{!d[k].length ? <p className="muted small">{t('none')}</p> : <ul className="hd-list">{d[k].map((r) => <li key={r.key} className="small">{t(`${pre}${r.key}`)}: {number(r.n, { decimals: 0 })}</li>)}</ul>}</Card>)}
      <Card title={t('by.byTeam')} testid="hd-byTeam">{!d.byTeam.length ? <p className="muted small">{t('none')}</p> : <ul className="hd-list">{d.byTeam.map((r) => <li key={r.key} className="small">{r.label}: {number(r.n, { decimals: 0 })}</li>)}</ul>}</Card>
    </div>
  </>;
}

export function SupportDesk() {
  const t = useT('hd');
  const search = useSearch();
  usePageTitle(t('deskTitle'));
  const tabs = ['queue', 'corrections', 'articles', 'dashboard'];
  const tab = tabs.includes(search.get('tab')) ? search.get('tab') : 'queue';
  return <section aria-labelledby="sd-h" data-testid="sd-page">
    <PageHeader id="sd-h" title={t('deskTitle')} subtitle={t('deskSubtitle')} />
    <div role="tablist" aria-label={t('deskTitle')} className="tabs" data-testid="sd-tabs">{tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'queue' ? '' : k, ticket: '', scope: '', breached: '' })}>{t(`tab.${k}`)}</button>)}</div>
    {tab === 'queue' && <Queue />}
    {tab === 'corrections' && <Corrections />}
    {tab === 'articles' && <Articles />}
    {tab === 'dashboard' && <Dashboard />}
  </section>;
}
