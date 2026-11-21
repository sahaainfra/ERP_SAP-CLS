import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { useT } from '../../platform/i18n/index.js';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';

// Part 28.02 (FR-01): the assistant panel — in the shell on every page (a dock that knows the page and its project) and as a full page.
// Every answer comes from the 28.01 gateway with its label, the query it ran and the records it cites; drafts become DRAFT records of their
// module only when the person saves them; thumbs keep the person's feedback.

const post = async (path, body, idem = false) => (await api.post(path, body, idem ? { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } } : undefined)).data;
const pageProject = () => { const v = Number(new URLSearchParams(window.location.search).get('projectId')); return Number.isSafeInteger(v) && v > 0 ? v : null; };

export function Answer({ a }) {
  const t = useT('aa');
  const [rated, setRated] = useState(null);
  const rate = useMutation({ mutationFn: (rating) => post('/ai/feedback', { logId: a.logId, rating }), onSuccess: (_d, rating) => setRated(rating) });
  return <div className="aa-answer" data-testid="aa-answer" aria-live="polite">
    <StatusBadge status="AT_RISK" label={a.label} size="sm" />{a.unsure && <> <StatusBadge status="DRAFT" label={t('unsure')} size="sm" /></>}
    <p className="aa-text">{a.text}</p>
    {a.meta?.query && <p className="muted small" data-testid="aa-query">{t('query')}: <code>{a.meta.query}</code></p>}
    {a.sources?.length > 0 && <ul className="aa-sources" data-testid="aa-sources">{a.sources.map((s) => <li key={`${s.type}:${s.id}`}>{s.route ? <Link to={s.route}>{s.label}</Link> : s.label}</li>)}</ul>}
    <div className="actions-row aa-rate" role="group" aria-label={t('rate')}>
      <button type="button" className={`btn btn-small${rated === 1 ? ' btn-primary' : ''}`} aria-pressed={rated === 1} onClick={() => rate.mutate(1)} data-testid="aa-up">👍 {t('useful')}</button>
      <button type="button" className={`btn btn-small${rated === -1 ? ' btn-primary' : ''}`} aria-pressed={rated === -1} onClick={() => rate.mutate(-1)}>👎 {t('notUseful')}</button>
    </div>
  </div>;
}

function Ask({ me }) {
  const t = useT('aa');
  const [q, setQ] = useState('');
  const [history, setHistory] = useState([]);
  const ask = useMutation({ mutationFn: (question) => post('/ai/assistant/ask', { question, ...(pageProject() ? { projectId: pageProject() } : {}), route: window.location.pathname }), onSuccess: (a, question) => { setHistory((h) => [{ question, a }, ...h].slice(0, 10)); setQ(''); } });
  if (!me.ask) return <EmptyState compact title={t('notEnabled')} message={t('notEnabledBody')} />;
  return <>
    <form className="aa-ask" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) ask.mutate(q.trim()); }}>
      <Field name="aa-q" label={t('question')} hint={t('questionHint')}><input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} enterKeyHint="send" autoComplete="off" /></Field>
      <button type="submit" className="btn btn-primary" disabled={ask.isPending || q.trim().length < 3} data-testid="aa-ask">{ask.isPending ? t('asking') : t('ask')}</button>
    </form>
    {ask.error && <ErrorState error={ask.error} />}
    {history.map((h, i) => <div key={i} className="aa-turn"><p className="aa-q"><strong>{h.question}</strong></p><Answer a={h.a} /></div>)}
  </>;
}

function Copilots({ me }) {
  const t = useT('aa');
  const [kind, setKind] = useState(me.copilots[0] ?? '');
  const [vendor, setVendor] = useState('');
  const run = useMutation({ mutationFn: () => post(`/ai/copilots/${kind}`, kind === 'procurement' ? { vendor } : { ...(pageProject() ? { projectId: pageProject() } : {}) }) });
  if (!me.copilots.length) return <EmptyState compact title={t('noCopilot')} />;
  const needsProject = kind !== 'procurement' && !pageProject();
  return <form onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
    <Field name="aa-copilot" label={t('copilot')}><select value={kind} onChange={(e) => setKind(e.target.value)}>{me.copilots.map((k) => <option key={k} value={k}>{t(`c.${k}`)}</option>)}</select></Field>
    {kind === 'procurement' && <Field name="aa-vendor" label={t('vendor')}><input required minLength={2} value={vendor} onChange={(e) => setVendor(e.target.value)} /></Field>}
    {needsProject && <p className="muted small">{t('openProject')}</p>}
    <button type="submit" className="btn btn-primary" disabled={run.isPending || needsProject} data-testid="aa-copilot-run">{t('run')}</button>
    {run.error && <ErrorState error={run.error} />}
    {run.data && <Answer a={run.data} />}
  </form>;
}

function Drafts({ me }) {
  const t = useT('aa');
  const cache = useQueryClient();
  const [form, setForm] = useState({ kind: 'RFI', brief: '' });
  const [save, setSave] = useState({ subject: '', discipline: 'STRUCTURAL', requiredBy: '', party: '', letterDate: new Date().toISOString().slice(0, 10) });
  const list = useQuery({ queryKey: ['ai', 'drafts'], queryFn: async () => (await api.get('/ai/drafts')).data, retry: false, enabled: me.draft });
  const make = useMutation({ mutationFn: () => post('/ai/drafts', { ...form, ...(pageProject() ? { projectId: pageProject() } : {}) }), onSuccess: () => cache.invalidateQueries({ queryKey: ['ai', 'drafts'] }) });
  const keep = useMutation({ mutationFn: ({ id, kind }) => post(`/ai/drafts/${id}/save`, kind === 'RFI' ? { subject: save.subject, discipline: save.discipline, requiredBy: save.requiredBy } : { subject: save.subject, party: save.party, letterDate: save.letterDate }, true),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['ai', 'drafts'] }) });
  const drop = useMutation({ mutationFn: (id) => post(`/ai/drafts/${id}/discard`, {}), onSuccess: () => cache.invalidateQueries({ queryKey: ['ai', 'drafts'] }) });
  if (!me.draft) return <EmptyState compact title={t('notEnabled')} message={t('notEnabledBody')} />;
  const latest = list.data?.find((d) => d.status === 'PROPOSED');
  return <>
    <form onSubmit={(e) => { e.preventDefault(); make.mutate(); }} data-testid="aa-draft-form">
      <Field name="aa-kind" label={t('draftKind')}><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{me.kinds.map((k) => <option key={k} value={k}>{t(`k.${k}`)}</option>)}</select></Field>
      <Field name="aa-brief" label={t('brief')} hint={t('briefHint')}><textarea required minLength={10} maxLength={1500} value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} /></Field>
      <button type="submit" className="btn btn-primary" disabled={make.isPending || form.brief.trim().length < 10} data-testid="aa-draft">{t('makeDraft')}</button>
    </form>
    {make.error && <ErrorState error={make.error} />}
    {latest && <div className="aa-answer" data-testid="aa-draft-result">
      <StatusBadge status="AT_RISK" label="AI-generated — verify" size="sm" /> <strong>{latest.title}</strong>
      <pre className="ai-pre">{latest.body}</pre>
      {latest.canSave ? <form onSubmit={(e) => { e.preventDefault(); keep.mutate({ id: latest.id, kind: latest.kind }); }}>
        <p className="muted small">{t('confirmNote')}</p>
        <Field name="aa-subject" label={`${t('subject')} *`}><input required minLength={3} value={save.subject} onChange={(e) => setSave({ ...save, subject: e.target.value })} /></Field>
        {latest.kind === 'RFI' ? <>
          <Field name="aa-discipline" label={t('discipline')}><select value={save.discipline} onChange={(e) => setSave({ ...save, discipline: e.target.value })}>{['STRUCTURAL', 'ARCHITECTURAL', 'MEP', 'CIVIL', 'LANDSCAPE'].map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
          <Field name="aa-required" label={`${t('requiredBy')} *`}><input type="date" required value={save.requiredBy} onChange={(e) => setSave({ ...save, requiredBy: e.target.value })} /></Field>
        </> : <>
          <Field name="aa-party" label={`${t('party')} *`}><input required minLength={2} value={save.party} onChange={(e) => setSave({ ...save, party: e.target.value })} /></Field>
          <Field name="aa-date" label={t('letterDate')}><input type="date" value={save.letterDate} onChange={(e) => setSave({ ...save, letterDate: e.target.value })} /></Field>
        </>}
        <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={keep.isPending} data-testid="aa-save-draft">{t('saveDraft')}</button><button type="button" className="btn" onClick={() => drop.mutate(latest.id)}>{t('discard')}</button></div>
      </form> : <div className="actions-row"><p className="muted small">{t('copyOnly')}</p><button type="button" className="btn" onClick={() => drop.mutate(latest.id)}>{t('discard')}</button></div>}
      {keep.error && <ErrorState error={keep.error} />}
    </div>}
    {keep.data && <p role="status" data-testid="aa-saved">{t('saved', { ref: keep.data.ref })} <Link to={keep.data.route}>{t('open')}</Link></p>}
    {(list.data ?? []).filter((d) => d.status !== 'PROPOSED').length > 0 && <details><summary>{t('earlier')}</summary><ul className="wd-todo">{list.data.filter((d) => d.status !== 'PROPOSED').map((d) => <li key={d.id}>{d.title} · {t(`st.${d.status}`)}{d.target ? <> · <Link to={d.target.route}>{d.target.ref}</Link></> : null}</li>)}</ul></details>}
  </>;
}

export function AssistantPanel() {
  const t = useT('aa');
  const me = useQuery({ queryKey: ['ai', 'assistant-me'], queryFn: async () => (await api.get('/ai/assistant/me')).data, retry: false });
  const [tab, setTab] = useState('ask');
  if (me.isPending) return <Skeleton label={t('title')} rows={3} />;
  if (me.error) return <ErrorState error={me.error} onRetry={me.refetch} />;
  if (me.data.killSwitch) return <EmptyState compact title={t('stopped')} message={t('stoppedBody')} />;
  return <div className="aa-panel" data-testid="aa-panel">
    <div role="tablist" aria-label={t('title')} className="tabs">{['ask', 'copilots', 'drafts'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)}>{t(`tab.${k}`)}</button>)}</div>
    {tab === 'ask' && <Ask me={me.data} />}
    {tab === 'copilots' && <Copilots me={me.data} />}
    {tab === 'drafts' && <Drafts me={me.data} />}
    <p className="muted small">{t('footer')}</p>
  </div>;
}

/** The dock in the shell: a button on every page that opens the panel beside the page (a sheet on a phone). */
export default function AiDock() {
  const t = useT('aa');
  const [open, setOpen] = useState(false);
  const me = useQuery({ queryKey: ['ai', 'assistant-me'], queryFn: async () => (await api.get('/ai/assistant/me')).data, retry: false, staleTime: 60_000 });
  const ref = useRef(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const m = me.data;
  if (!m || (!m.ask && !m.draft && !m.copilots?.length)) return null;
  if (window.location.pathname === '/ai/assistant') return null;
  return <>
    <button type="button" className="btn aa-fab" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="aa-dock" data-testid="aa-fab">✦ {t('fab')}</button>
    {open && <aside id="aa-dock" className="aa-dock" role="dialog" aria-label={t('title')} tabIndex={-1} ref={ref}>
      <div className="aa-dock-head"><strong>{t('title')}</strong><button type="button" className="btn btn-small" onClick={() => setOpen(false)} aria-label={t('close')}>✕</button></div>
      <AssistantPanel />
    </aside>}
  </>;
}

export function AssistantPage() {
  const t = useT('aa');
  usePageTitle(t('title'));
  return <section aria-labelledby="aa-h" data-testid="ai-assistant-page"><PageHeader id="aa-h" title={t('title')} subtitle={t('subtitle')} /><AssistantPanel /></section>;
}
