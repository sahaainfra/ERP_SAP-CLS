import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders, lastApiFailure } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { useFormat, useT } from '../../platform/i18n/index.js';
import Markdown from '../../platform/Markdown.jsx';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';

// Part 29.08: Help & Support (form / wizard, UI v3 §3.3, phone first). Raise a ticket in three steps — what happened (with the page and the
// last failed call captured), details with a screenshot, how to be told — then follow it, answer, rate it; the knowledge base; release notes.

const read = async (path) => (await api.get(path)).data;
const send = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const transport = browserTransport(authHeaders);
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/help${p.toString() ? `?${p}` : ''}`);
};
export const TS = { NEW: 'SUBMITTED', ASSIGNED: 'IN_REVIEW', IN_PROGRESS: 'IN_REVIEW', WAITING_USER: 'RETURNED', RESOLVED: 'APPROVED', CLOSED: 'COMPLETED', CANCELLED: 'CANCELLED' };

function Raise() {
  const t = useT('hd');
  const cache = useQueryClient();
  const search = useSearch();
  const from = search.get('from') ?? '';
  const failure = lastApiFailure();
  const opts = useQuery({ queryKey: ['hd', 'options'], queryFn: () => read('/admin/help/options'), retry: false });
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ category: 'BUG', priority: 'MEDIUM', subject: '', description: '', attachFailure: Boolean(failure), email: false, whatsapp: false });
  const [shot, setShot] = useState(null);
  const [done, setDone] = useState(null);
  const raise = useMutation({ mutationFn: async () => {
    const pathOnly = from.split('?')[0]; const m = /\/(\d+)(?:\/|$)/.exec(pathOnly);
    const r = await send('/admin/help/tickets', { subject: f.subject.trim(), description: f.description.trim(), category: f.category, priority: f.priority, ...(from ? { pageRef: from.slice(0, 300), pageTitle: (search.get('title') ?? '').slice(0, 160) || undefined, ...(m ? { entityId: m[1] } : {}) } : {}),
      ...(f.attachFailure && failure ? { correlationId: failure.correlationId ?? undefined, failedCall: failure } : {}), userAgent: navigator.userAgent.slice(0, 300), channels: [...(f.email ? ['EMAIL'] : []), ...(f.whatsapp ? ['WHATSAPP'] : [])] });
    if (shot) { const stored = await uploadFile(shot, { transport, entity: 'hd_tickets', entityId: r.data.id, stripExif: true }); await send(`/admin/help/tickets/${r.data.id}/screenshot`, { fileId: stored.id }); }
    return r.data;
  }, onSuccess: (d) => { setDone(d); cache.invalidateQueries({ queryKey: ['hd'] }); } });
  if (done) return <Card title={t('raised', { no: done.ticketNo })} testid="hd-raised"><p>{t('raisedBody', { due: new Date(done.slaDue).toLocaleString() })}</p><button type="button" className="btn btn-primary hd-wide" onClick={() => go({ tab: 'mine', ticket: done.id, from: '', title: '' })}>{t('follow')}</button></Card>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const ok1 = f.subject.trim().length >= 5; const ok2 = f.description.trim().length >= 10;
  return <Card title={t('raiseTitle')} subtitle={t('raiseSub')} testid="hd-raise-form">
    <ol className="hd-steps" aria-label={t('steps')}>{[1, 2, 3].map((n) => <li key={n} aria-current={step === n ? 'step' : undefined} className={step === n ? 'hd-step-on' : step > n ? 'hd-step-done' : ''}>{n}. {t(`step${n}`)}</li>)}</ol>
    {step === 1 && <div className="hd-form">
      <Field name="hd-cat" label={t('category')}><select value={f.category} onChange={set('category')}>{(opts.data?.categories ?? ['BUG']).map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}</select></Field>
      <Field name="hd-subject" label={t('subject')}><input value={f.subject} onChange={set('subject')} maxLength={160} required /></Field>
      <div className="hd-context small" data-testid="hd-context">
        <p>{from ? t('fromPage', { page: search.get('title') || from }) : t('noPage')}</p>
        {failure && <label className="hd-check"><input type="checkbox" checked={f.attachFailure} onChange={set('attachFailure')} /> {t('attachFailure', { status: failure.status ?? '—', id: (failure.correlationId ?? '').slice(0, 8) })}</label>}
      </div>
    </div>}
    {step === 2 && <div className="hd-form">
      <Field name="hd-desc" label={t('description')}><textarea rows={6} value={f.description} onChange={set('description')} maxLength={4000} required /></Field>
      <Field name="hd-prio" label={t('priority')}><select value={f.priority} onChange={set('priority')}>{(opts.data?.priorities ?? ['LOW', 'MEDIUM', 'HIGH', 'URGENT']).map((p) => <option key={p} value={p}>{t(`pr.${p}`)}</option>)}</select></Field>
      <Field name="hd-shot" label={t('screenshot')}><input type="file" accept="image/*" capture="environment" onChange={(e) => setShot(e.target.files?.[0] ?? null)} /></Field>
      <p className="muted small">{t('shotHelp')}</p>
    </div>}
    {step === 3 && <div className="hd-form">
      <p className="small">{t('updatesInApp')}</p>
      <label className="hd-check"><input type="checkbox" checked={f.email} onChange={set('email')} /> {t('byEmail')}</label>
      <label className="hd-check"><input type="checkbox" checked={f.whatsapp} onChange={set('whatsapp')} /> {t('byWhatsapp')}</label>
    </div>}
    {(raise.error || opts.error) && <ErrorState error={raise.error ?? opts.error} />}
    <div className="hd-footer">
      {step > 1 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>{t('back')}</button>}
      {step < 3 ? <button type="button" className="btn btn-primary" disabled={(step === 1 && !ok1) || (step === 2 && !ok2)} onClick={() => setStep(step + 1)} data-testid="hd-next">{t('next')}</button>
        : <button type="button" className="btn btn-primary" disabled={raise.isPending || !ok1 || !ok2} onClick={() => raise.mutate()} data-testid="hd-submit">{t('submit')}</button>}
    </div>
  </Card>;
}

export function TicketView({ id, work = false }) {
  const t = useT('hd');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['hd', 'ticket', id], queryFn: () => read(`/admin/help/tickets/${id}`), retry: false });
  const [text, setText] = useState('');
  const [rating, setRating] = useState(0);
  const act = useMutation({ mutationFn: (b) => send(`/admin/help/tickets/${id}/act`, b), onSuccess: () => { setText(''); cache.invalidateQueries({ queryKey: ['hd'] }); } });
  const rate = useMutation({ mutationFn: () => send(`/admin/help/tickets/${id}/rating`, { rating, comment: text || undefined }), onSuccess: () => cache.invalidateQueries({ queryKey: ['hd'] }) });
  if (q.isPending) return <Skeleton label={t('ticket')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const k = q.data;
  return <Card title={`${k.ticketNo} · ${k.subject}`} subtitle={`${t(`cat.${k.category}`)} · ${t(`pr.${k.priority}`)} · ${k.teamLabel}`} testid="hd-ticket">
    <p className="small"><StatusBadge status={TS[k.status]} label={t(`s.${k.status}`)} size="sm" /> · {t('due', { at: dateTime(k.slaDue) })}{k.breached ? ` · ${t('breached')}` : ''}{k.escalationLevel ? ` · ${t('escalated', { n: k.escalationLevel })}` : ''}</p>
    <p className="small">{k.description}</p>
    {k.pageRef && <p className="muted small">{t('page')}: <code className="hd-code">{k.pageRef}</code></p>}
    {k.correlationId && <p className="muted small">{t('correlation')}: <code className="hd-code" data-testid="hd-correlation">{k.correlationId}</code></p>}
    {k.failedCall && <p className="muted small">{t('failedCall', { status: k.failedCall.status ?? '—', path: k.failedCall.path ?? '' })}</p>}
    {k.resolution && <p className="small hd-resolution"><strong>{t('resolution')}:</strong> {k.resolution}</p>}
    <ol className="hd-timeline">{k.notes.map((n) => <li key={n.id} className={n.internal ? 'hd-internal' : ''}><span className="muted small">{dateTime(n.at)} · {n.by}{n.internal ? ` · ${t('internal')}` : ''}</span><br />{n.body}</li>)}</ol>
    {(act.error || rate.error) && <ErrorState error={act.error ?? rate.error} />}
    {!['CLOSED', 'CANCELLED'].includes(k.status) && <Field name={`hd-note-${id}`} label={work ? t('noteOrResolution') : t('reply')}><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} /></Field>}
    <div className="hd-footer">
      {!['CLOSED', 'CANCELLED'].includes(k.status) && <button type="button" className="btn" disabled={act.isPending || text.trim().length < 2} onClick={() => act.mutate({ action: 'comment', note: text })} data-testid="hd-comment">{t('sendNote')}</button>}
      {work && k.canWork && ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_USER'].includes(k.status) && <>
        {k.status === 'NEW' && <button type="button" className="btn" onClick={() => act.mutate({ action: 'assign' })} data-testid="hd-assign">{t('takeIt')}</button>}
        <button type="button" className="btn" disabled={text.trim().length < 2} onClick={() => act.mutate({ action: 'wait', note: text })}>{t('askUser')}</button>
        <button type="button" className="btn btn-primary" disabled={text.trim().length < 5} onClick={() => act.mutate({ action: 'resolve', resolution: text })} data-testid="hd-resolve">{t('resolve')}</button>
      </>}
      {k.mine && ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_USER'].includes(k.status) && !work && <button type="button" className="btn" onClick={() => act.mutate({ action: 'cancel' })}>{t('cancelTicket')}</button>}
      {k.mine && k.status === 'RESOLVED' && !work && <button type="button" className="btn" onClick={() => act.mutate({ action: 'reopen', note: text || undefined })}>{t('reopen')}</button>}
    </div>
    {k.canRate && !work && <div className="hd-rate" data-testid="hd-rate"><p className="small">{t('rateAsk')}</p>
      <div className="hd-stars" role="radiogroup" aria-label={t('rating')}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} className={`btn${rating >= n ? ' btn-primary' : ''}`} onClick={() => setRating(n)} aria-label={t('stars', { n })}>★</button>)}</div>
      <button type="button" className="btn btn-primary hd-wide" disabled={!rating || rate.isPending} onClick={() => rate.mutate()} data-testid="hd-send-rating">{t('sendRating')}</button></div>}
    {k.rating && <p className="small">{t('rated', { n: k.rating })}</p>}
  </Card>;
}

function Mine() {
  const t = useT('hd');
  const { dateTime } = useFormat();
  const search = useSearch();
  const sel = search.get('ticket');
  const q = useQuery({ queryKey: ['hd', 'mine'], queryFn: () => read('/admin/help/tickets?scope=mine'), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.mine')} rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <>
    {sel && <TicketView key={sel} id={sel} />}
    {!q.data.rows.length ? <EmptyState title={t('noTickets')} message={t('noTicketsBody')} action={<button type="button" className="btn" onClick={() => go({ tab: 'raise' })}>{t('raise')}</button>} /> :
      <ul className="hd-cards" data-testid="hd-mine">{q.data.rows.map((k) => <li key={k.id} className="hd-card" data-testid="hd-ticketrow">
        <button type="button" className="hd-cardbtn" onClick={() => go({ ticket: k.id })}><span className="actions-row"><strong>{k.ticketNo} · {k.subject}</strong><StatusBadge status={TS[k.status]} label={t(`s.${k.status}`)} size="sm" /></span>
          <span className="muted small">{t(`cat.${k.category}`)} · {dateTime(k.createdAt)}</span></button>
      </li>)}</ul>}
  </>;
}

function Knowledge() {
  const t = useT('hd');
  const search = useSearch();
  const sel = search.get('article');
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const q = useQuery({ queryKey: ['hd', 'kb', term], queryFn: () => read(`/admin/help/articles?kind=ARTICLE${term.length >= 2 ? `&q=${encodeURIComponent(term)}` : ''}`), retry: false });
  const a = useQuery({ queryKey: ['hd', 'article', sel], queryFn: () => read(`/admin/help/articles/${sel}`), enabled: Boolean(sel), retry: false });
  return <>
    <form className="hd-form" onSubmit={(e) => { e.preventDefault(); setTerm(text.trim()); }}><Field name="hd-kbq" label={t('searchKb')}><input type="search" inputMode="search" value={text} onChange={(e) => setText(e.target.value)} /></Field></form>
    {sel && (a.isPending ? <Skeleton label={t('article')} rows={4} /> : a.error ? <ErrorState error={a.error} /> : <Card title={a.data.title} subtitle={t('version', { v: a.data.version })} testid="hd-article"><Markdown source={a.data.body} /></Card>)}
    {q.isPending ? <Skeleton label={t('tab.kb')} rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data.rows.length ? <EmptyState title={t('noKb')} message={t('noKbBody')} action={<button type="button" className="btn" onClick={() => go({ tab: 'raise' })}>{t('raise')}</button>} /> :
      <ul className="hd-cards">{q.data.rows.map((x) => <li key={x.id} className="hd-card"><button type="button" className="hd-cardbtn" onClick={() => go({ article: x.id })}><strong>{x.title}</strong><span className="muted small">{x.module ?? ''}</span></button></li>)}</ul>}
  </>;
}

function Releases() {
  const t = useT('hd');
  const q = useQuery({ queryKey: ['hd', 'releases'], queryFn: () => read('/admin/help/releases'), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.releases')} rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return !q.data.rows.length ? <EmptyState title={t('noReleases')} message={t('noReleasesBody')} /> : <>{q.data.rows.map((r) => <Card key={r.version} title={`v${r.version}`} testid="hd-release"><Markdown source={r.body} /></Card>)}</>;
}

export function HelpCenter() {
  const t = useT('hd');
  const search = useSearch();
  usePageTitle(t('title'));
  const ctx = useQuery({ queryKey: ['hd', 'options'], queryFn: () => read('/admin/help/options'), retry: false });
  const tabs = ['raise', 'mine', 'kb', 'releases'];
  const tab = tabs.includes(search.get('tab')) ? search.get('tab') : 'raise';
  return <section aria-labelledby="hd-h" data-testid="hd-page">
    <PageHeader id="hd-h" title={t('title')} subtitle={t('subtitle')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="hd-tabs">{tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'raise' ? '' : k, ticket: '', article: '' })}>{t(`tab.${k}`)}</button>)}</div>
    {ctx.error?.status === 403 ? <NoPermission message={ctx.error.message} /> : ctx.error ? <ErrorState error={ctx.error} onRetry={ctx.refetch} /> : <>
      {tab === 'raise' && <Raise />}
      {tab === 'mine' && <Mine />}
      {tab === 'kb' && <Knowledge />}
      {tab === 'releases' && <Releases />}
    </>}
  </section>;
}
