import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { CHECK_TONE, WA_TONE, fmtDate, fmtQty, st, today } from './api.js';
import { CloseForm } from './WasPage.jsx';

// Approve WA / Close WA (part 14.01, FR-04) on a phone: large buttons, few words to type. What waits for my approval (with its checks), and the approved WAs of the day I can close
// with the quantity done (the DPR quantity filled in) and what was used. Approval goes through the workflow engine's own task, so the chain cannot be bypassed.
const big = { minHeight: 48, minWidth: 120, fontSize: '1rem' };

function Approve({ t, w, onDone }) {
  const [comment, setComment] = useState(''); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const act = async (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('mb.sayWhy') }); return; } setError(null); setBusy(true); try { await st.decide(w.taskId, action, comment.trim() || null); onDone(t(`mb.done.${action}`, { w: w.waNo })); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } };
  return (
    <li className="mdm-panel" data-testid="mb-approve" data-wa={w.waNo}>
      <h3><Link to={`/site/work-authorisations?id=${w.id}`}>{w.waNo}</Link> <StatusBadge status={WA_TONE[w.status]} label={t(`wst.${w.status}`)} /></h3>
      <p><strong>{w.activity}</strong> · {fmtQty(w.plannedQty)} {w.uom ?? ''}</p>
      <p className="muted">{w.siteCode} · {w.workFront ?? '—'} · {fmtDate(w.planDate)} {w.startTime}–{w.endTime} · {w.supervisor}{w.emergency ? ` · ${t('wa.emergency')}: ${w.emergencyReason}` : ''}</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>{w.checks.filter((c) => c.result !== 'NA').map((c) => <li key={c.code}><StatusBadge status={CHECK_TONE[c.result]} label={t(`ck.${c.code}`)} /> <span className="muted">{c.message}</span></li>)}</ul>
      <p className="muted">{w.resources.map((r) => `${r.label} ${fmtQty(r.plannedQty)} ${r.uom}`).join(' · ')}</p>
      <Field label={t('mb.comment')} name={`c-${w.id}`}><input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="mb-error">{error.form}</p>}
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => act('approve')} data-testid="mb-approve-btn">{t('mb.approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => act('return')} data-testid="mb-return-btn">{t('mb.return')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => act('reject')} data-testid="mb-reject-btn">{t('mb.reject')}</button></div>
    </li>
  );
}

export default function MobilePage() {
  const t = useT('site'); usePageTitle(t('mb.title'));
  const qc = useQueryClient(); const [date, setDate] = useState(today()); const [open, setOpen] = useState(null); const [note, setNote] = useState(null);
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const q = useQuery({ queryKey: ['site', 'mobile', date], queryFn: () => st.mobile(date), retry: false, refetchInterval: 60_000 });
  const done = (msg) => { setNote(msg); setOpen(null); qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['workflow'] }); };
  if (q.error?.status === 403) return <NoPermission what={t('mb.title')} permission="site.work_authorisation.view" />;
  return (
    <section aria-labelledby="mb-h" data-testid="site-mobile" style={{ maxWidth: 640 }}>
      <h1 id="mb-h">{t('mb.title')}</h1>
      {!online && <p className="mdm-banner" role="status" data-testid="mb-offline">{t('mb.offline')}</p>}
      <Field label={t('f.date')} name="date"><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ minHeight: 44 }} data-testid="mb-date" /></Field>
      {note && <p className="mdm-banner" role="status" data-testid="mb-note">{note}</p>}
      {q.isPending && <Skeleton label={t('mb.title')} rows={4} />}
      {q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && (
        <>
          <h2>{t('mb.toApprove', { n: q.data.toApprove.length })}</h2>
          {q.data.toApprove.length === 0 ? <p className="muted" data-testid="mb-none-approve">{t('mb.noneApprove')}</p> : <ul style={{ listStyle: 'none', padding: 0 }}>{q.data.toApprove.map((w) => <Approve key={w.taskId} t={t} w={w} onDone={done} />)}</ul>}
          <h2>{t('mb.toClose', { n: q.data.toClose.length })}</h2>
          {q.data.toClose.length === 0 ? <p className="muted" data-testid="mb-none-close">{t('mb.noneClose')}</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>{q.data.toClose.map((w) => (
              <li key={w.id} className="mdm-panel" data-testid="mb-close" data-wa={w.waNo}>
                <h3><Link to={`/site/work-authorisations?id=${w.id}`}>{w.waNo}</Link> · {fmtDate(w.planDate)}</h3>
                <p><strong>{w.activity}</strong> · {t('wa.authorised')} {fmtQty(w.plannedQty)} {w.uom ?? ''}{w.dprQty ? ` · ${t('wa.fromDpr', { q: fmtQty(w.dprQty) })}` : ''}</p>
                {open === w.id ? <CloseForm compact t={t} w={w} onDone={() => done(t('mb.done.close', { w: w.waNo }))} /> : <button type="button" className="btn btn-primary" style={big} onClick={() => setOpen(w.id)} data-testid="mb-close-btn">{t('wa.close')}</button>}
              </li>
            ))}</ul>
          )}
        </>
      )}
    </section>
  );
}
