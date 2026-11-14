import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, hse, qs } from './api.js';
import { ErrorLine, big, useRecord, useRunner } from './HseParts.jsx';

// Site Induction (part 19.01, FR-02, on a phone): choose the site and the content, scan the badge of the worker (or search a person), answer the quiz; the server scores it, records the induction and clears the worker for deployment; a gate check says whether a badge is valid.
const TONE = { APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
function Induct() {
  const t = useT('hse'); const { error, run, busy } = useRunner(); const [siteId, setSiteId] = useState(''); const [contentId, setContentId] = useState(''); const [mode, setMode] = useState('scan'); const [badge, setBadge] = useState(''); const [text, setText] = useState(''); const [person, setPerson] = useState(null); const [answers, setAnswers] = useState([]); const [result, setResult] = useState(null);
  const oq = useQuery({ queryKey: ['hse', 'induction-options', siteId], queryFn: () => hse.get(`/inductions/options${qs({ siteId })}`), retry: false });
  const pq = useQuery({ queryKey: ['hse', 'people', text], queryFn: () => hse.get(`/inductions/people${qs({ q: text })}`), enabled: mode === 'search' && text.trim().length >= 2, retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('ind.title')} permission="hse.induction.create" />; if (oq.isPending) return <Skeleton label={t('ind.title')} rows={4} />;
  const o = oq.data; const content = (o.contents ?? []).find((c) => String(c.id) === String(contentId)); const complete = content && answers.length === content.questions.length && answers.every((a) => a >= 0) && (mode === 'scan' ? badge.length >= 3 : person);
  const submit = async () => { const r = await run(() => (mode === 'scan' ? hse.post('/inductions/scan', { badge, contentId: Number(contentId), siteId: Number(siteId), answers }) : hse.post('/inductions', { contentId: Number(contentId), siteId: Number(siteId), personType: person.type, personId: person.id, answers }))); if (r) { setResult(r); setAnswers([]); setBadge(''); setPerson(null); setText(''); } };
  return (
    <div className="mdm-panel" data-testid="hse-induct"><ErrorLine error={error} id="hse-ind-error" />
      <div className="form-grid">
        <Field label={t('site')} name="siteId" error={error}><select value={siteId} onChange={(e) => { setSiteId(e.target.value); setContentId(''); setAnswers([]); }} style={big} data-testid="hse-ind-site"><option value="">—</option>{o.sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field>
        <Field label={t('ind.content')} name="contentId" error={error}><select value={contentId} onChange={(e) => { setContentId(e.target.value); setAnswers([]); }} style={big} data-testid="hse-ind-content"><option value="">—</option>{(o.contents ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field></div>
      {content && (
        <>
          <div className="mdm-panel" data-testid="hse-ind-body"><h2>{content.title}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{content.body}</p><p className="muted">{t('ind.passMark', { n: content.passPct })} · {t('ind.validity', { n: content.validityDays })}</p></div>
          {content.questions.map((qn, i) => (
            <fieldset key={i} className="mdm-panel" data-testid="hse-ind-question"><legend>{i + 1}. {qn.q}</legend>
              {qn.options.map((opt, j) => <label key={j} style={{ display: 'block', minHeight: 44 }}><input type="radio" name={`q${i}`} checked={answers[i] === j} onChange={() => setAnswers((a) => { const n = [...a]; n[i] = j; for (let k = 0; k < content.questions.length; k += 1) if (n[k] === undefined) n[k] = -1; return n; })} data-testid={`hse-ind-q${i}-o${j}`} /> {opt}</label>)}</fieldset>
          ))}
          <div className="actions-row"><button type="button" className={`btn ${mode === 'scan' ? 'btn-primary' : ''}`} onClick={() => setMode('scan')} data-testid="hse-ind-mode-scan">{t('ind.scan')}</button><button type="button" className={`btn ${mode === 'search' ? 'btn-primary' : ''}`} onClick={() => setMode('search')} data-testid="hse-ind-mode-search">{t('ind.search')}</button></div>
          {mode === 'scan' ? <Field label={t('ind.badge')} name="badge" error={error}><input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="LAB:…" autoComplete="off" style={big} data-testid="hse-ind-badge" /></Field> : (
            <>
              <Field label={t('ind.person')} name="personId" error={error}><input value={text} onChange={(e) => setText(e.target.value)} style={big} data-testid="hse-ind-search" /></Field>
              <ul data-testid="hse-ind-people">{(pq.data ?? []).map((p) => <li key={`${p.type}${p.id}`}><button type="button" className={`btn ${person?.id === p.id && person?.type === p.type ? 'btn-primary' : ''}`} style={{ minHeight: 44 }} onClick={() => setPerson(p)}>{p.name} · {p.code} · {t(`ind.${p.type}`)}</button></li>)}</ul>
            </>)}
          <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !complete} onClick={submit} data-testid="hse-ind-submit">{t('ind.record')}</button></div>
        </>)}
      {result && <p className={result.passed ? 'mdm-banner' : 'field-error'} role="status" data-testid="hse-ind-result">{result.personName}: {result.passed ? t('ind.passed', { score: result.scorePct ?? 100, until: fmtDate(result.validUntil) }) : t('ind.failed', { score: result.scorePct })}</p>}
    </div>
  );
}
function Check() {
  const t = useT('hse'); const [badge, setBadge] = useState(''); const [out, setOut] = useState(null); const [err, setErr] = useState(null);
  const go = async () => { setErr(null); setOut(null); try { setOut(await hse.get(`/inductions/check${qs({ badge })}`)); } catch (e) { setErr(e.message); } };
  return (
    <div className="mdm-panel no-print" data-testid="hse-ind-check"><h2>{t('ind.check')}</h2><div className="form-grid"><Field label={t('ind.badge')} name="checkBadge" error={null}><input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="LAB:…" style={big} data-testid="hse-ind-check-badge" /></Field><button type="button" className="btn" style={big} disabled={badge.length < 3} onClick={go} data-testid="hse-ind-check-go">{t('ind.checkGo')}</button></div>
      {err && <p className="field-error" role="alert">{err}</p>}{out && <p role="status" data-testid="hse-ind-check-result" data-valid={String(out.valid)}><StatusBadge status={out.valid ? 'APPROVED' : 'REJECTED'} label={out.valid ? t('ind.valid') : t('ind.notValid')} /> {out.worker.name} ({out.worker.code}) · {out.message}</p>}</div>
  );
}
function Induction({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/inductions', id, t('ind.title'), 'hse.induction.view'); const { error, run, busy, note } = useRunner(); usePageTitle(t('ind.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="hse-induction-object" data-status={x.status}><h1 id="in-h">{x.docNo} <StatusBadge status={TONE[x.status]} label={t(`ind.st.${x.status}`)} /></h1>
      <p><Link to="/hse/induction">{t('ind.title')}</Link> · {x.project} · {x.site} · {x.personName} ({x.personCode}, {t(`ind.${x.personType}`)}) · {x.content}</p>
      <ErrorLine error={error} id="hse-ind-error" />{note && <p className="mdm-banner" role="status">{note}</p>}
      <p>{t('ind.date')}: {fmtDate(x.inductionDate)} · {t('ind.score')}: {x.scorePct ?? '—'}% ({t('ind.passMark', { n: x.passMark })}) · {t('ind.via')}: {x.via} · {t('ind.validUntil')}: {x.validUntil ? fmtDate(x.validUntil) : '—'}{x.cancelReason ? ` · ${x.cancelReason}` : ''}</p>
      {x.can.cancel && <div className="actions-row no-print"><button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => hse.act('/inductions', x.id, 'cancel', { reason: r }), t('cancelled')); }} data-testid="hse-ind-cancel">{t('cancel')}</button></div>}
    </div>
  );
}
export default function InductionPage() {
  const t = useT('hse'); usePageTitle(t('ind.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="in-h"><Induction id={id} /></section>;
  return (
    <section aria-labelledby="inl-h" data-testid="hse-induction"><h1 id="inl-h">{t('ind.title')}</h1><p className="muted">{t('ind.intro')}</p>
      <Induct /><Check />
      <ListReport listCode="hse.inductions" endpoint="/hse/inductions" title={t('ind.recent')} session={session.data} rowHref={(r) => `/hse/induction?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/induction?id=${r.id}`)} cardFields={['docNo', 'person', 'validUntil', 'status']} statusKey="status" dateKey="date" empty={{ title: t('ind.emptyTitle'), text: t('ind.emptyBody') }} />
    </section>
  );
}
