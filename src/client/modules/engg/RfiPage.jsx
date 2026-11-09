import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { Tabs } from '../proj/parts.jsx';
import { PRIORITY_TONE, RESPONSE_TYPES, RFI_PRIORITIES, RFI_TONE, eg, openPrint, rf } from './api.js';
import { useSearch } from './parts.jsx';

// RFI (part 11.02): the question with its links, the routing timeline, the response and the impact; the ball in court says who has to act next.
const TABS = ['question', 'routing', 'response', 'files'];
export default function RfiPage() {
  const t = useT('engg');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['engg', 'rfi', id], queryFn: () => rf.rfi(id), enabled: Boolean(id), retry: false });
  const [tab, setTab] = useState('question'); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [edit, setEdit] = useState(null); const [uploaded, setUploaded] = useState(0);
  const [ans, setAns] = useState({ responseType: 'CLARIFICATION', text: '', costImpact: '0', timeImpactDays: 0, drawingRevisionId: '', instructionRef: '', variationRef: '' });
  usePageTitle(q.data ? `${q.data.rfiNo} ${q.data.subject}` : t('rfi.title'));
  const dq = useQuery({ queryKey: ['engg', 'rfi-drawing', q.data?.drawingId], queryFn: () => eg.drawing(q.data.drawingId), enabled: Boolean(q.data?.drawingId), retry: false });
  if (!id) return <section aria-labelledby="rfi-h" data-testid="rfi-none"><h1 id="rfi-h">{t('rfi.title')}</h1><p className="muted"><Link to="/engg/rfis">{t('nav.rfis')}</Link></p></section>;
  if (q.error?.status === 403) return <NoPermission what={t('nav.rfis')} permission="engg.rfi.view" />;
  if (q.isPending) return <Skeleton label={t('rfi.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const c = r.can;
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['engg'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  const revisions = dq.data?.revisions ?? [];
  const respond = (e) => { e.preventDefault(); run(() => rf.act(r.id, 'respond', { responseType: ans.responseType, text: ans.text.trim(), costImpact: String(ans.costImpact || '0'), timeImpactDays: Number(ans.timeImpactDays) || 0, drawingRevisionId: ans.drawingRevisionId ? Number(ans.drawingRevisionId) : null, instructionRef: ans.instructionRef.trim() || null, variationRef: ans.variationRef.trim() || null }), t('rfi.answered')); };
  const save = (e) => { e.preventDefault(); run(async () => { await rf.update(r.id, { subject: edit.subject.trim(), question: edit.question.trim(), priority: edit.priority, requiredBy: edit.requiredBy, rowVersion: r.rowVersion }); setEdit(null); }, t('dwg.saved')); };
  return (
    <section aria-labelledby="rfi-h" data-testid="rfi" data-status={r.status} data-ball={r.ballInCourt}>
      <header>
        <h1 id="rfi-h">{r.rfiNo} · {r.subject} <StatusBadge status={RFI_TONE[r.status]} label={t(`rfis.${r.status}`)} /></h1>
        <p className="muted">{r.projectCode} · {t(`disc.${r.discipline}`)} · <StatusBadge status={PRIORITY_TONE[r.priority]} label={t(`prio.${r.priority}`)} /> · {t('rfi.requiredBy')} {r.requiredBy}{r.overdue ? ` · ${t('dwg.overdue')}` : ''}</p>
        <p data-testid="rfi-ball">{t('rfi.ball')}: <strong>{t(`ball.${r.ballInCourt}`)}</strong> · {t('rfi.age', { days: r.ageDays })}{r.slaDue ? ` · ${t('rfi.sla', { due: r.slaDue })}` : ''}{r.slaBreached ? ` · ${t('rfi.slaBreached')}` : ''}{r.criticalOpen ? ` · ${t('rfi.onCritical')}` : ''}{r.hold ? ` · ${t('rfi.holds')}` : ''}</p>
        {error?.form && <p className="field-error" role="alert" data-testid="rfi-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="rfi-note">{note}</p>}
        <div className="actions-row no-print">
          {c.edit && <button type="button" className="btn" onClick={() => setEdit({ subject: r.subject, question: r.question, priority: r.priority, requiredBy: r.requiredBy })} data-testid="rfi-edit">{t('act.edit')}</button>}
          {c.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => rf.act(r.id, 'submit'), t('rfi.sent'))} data-testid="rfi-submit">{t('rfi.send')}</button>}
          {c.requestClose && <button type="button" className="btn btn-primary" onClick={() => run(() => rf.act(r.id, 'close', {}), t('rfi.closeSent'))} data-testid="rfi-close">{t('rfi.requestClose')}</button>}
          {c.rework && <button type="button" className="btn" onClick={() => why((x) => rf.act(r.id, 'rework', { reason: x }), t('rfi.reworked'))} data-testid="rfi-rework">{t('rfi.rework')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((x) => rf.act(r.id, 'withdraw', { reason: x }), t('rev.withdrawn'))} data-testid="rfi-withdraw">{t('act.withdraw')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((x) => rf.act(r.id, 'cancel', { reason: x }), t('rfi.cancelled'))} data-testid="rfi-cancel">{t('act.cancel')}</button>}
          {c.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => rf.act(r.id, 'amend', { reason: x })); if (n) navigateTo(`/engg/rfi?id=${n.id}`); } }} data-testid="rfi-amend">{t('act.amend')}</button>}
          {c.delete && <button type="button" className="btn" onClick={async () => { if (await run(() => rf.remove(r.id))) navigateTo('/engg/rfis'); }} data-testid="rfi-delete">{t('act.delete')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => openPrint(`/rfis/${r.id}/print`, `${r.rfiNo}.html`)} data-testid="rfi-print">{t('act.print')}</button>}
          {(r.issueWorkflowId || r.closeWorkflowId) && <Link to={`/workflow/instance?id=${r.closeWorkflowId ?? r.issueWorkflowId}`}>{t('rev.approval')}</Link>}
        </div>
      </header>
      {edit && (
        <form className="mdm-panel" aria-label={t('act.edit')} data-testid="rfi-edit-form" onSubmit={save}>
          <div className="form-grid">
            <Field label={t('rfi.subject')} name="subject" error={error}><input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} required maxLength={200} data-testid="rfi-f-subject" /></Field>
            <Field label={t('rfi.question')} name="question" error={error}><textarea value={edit.question} onChange={(e) => setEdit({ ...edit, question: e.target.value })} rows={4} maxLength={4000} data-testid="rfi-f-question" /></Field>
            <Field label={t('rfi.priority')} name="priority" error={error}><select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>{RFI_PRIORITIES.map((k) => <option key={k} value={k}>{t(`prio.${k}`)}</option>)}</select></Field>
            <Field label={t('rfi.requiredBy')} name="requiredBy" error={error}><input type="date" value={edit.requiredBy} onChange={(e) => setEdit({ ...edit, requiredBy: e.target.value })} /></Field>
          </div>
          <div className="actions"><button type="button" className="btn" onClick={() => setEdit(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="rfi-save">{t('act.save')}</button></div>
        </form>
      )}
      <Tabs tabs={TABS} active={tab} onChange={setTab} label={t('rfi.title')} labelOf={(k) => t(`rfit.${k}`)} />
      {tab === 'question' && (
        <div className="mdm-panel" data-testid="rfi-question"><h2>{t('rfi.question')}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{r.question}</p>
          <dl>
            <dt>{t('rfi.proposed')}</dt><dd>{r.proposedSolution || '—'}</dd>
            <dt>{t('rfi.drawing')}</dt><dd>{r.drawingId ? <Link to={`/engg/drawing?id=${r.drawingId}`}>{r.drawingNo}{r.drawingRevision ? ` rev ${r.drawingRevision}` : ''}</Link> : '—'}</dd>
            <dt>{t('f.activity')}</dt><dd>{r.activityRef || '—'}</dd><dt>{t('rfi.spec')}</dt><dd>{r.specRef || '—'}</dd><dt>{t('rfi.consultant')}</dt><dd>{r.consultant || '—'}</dd>
          </dl></div>
      )}
      {tab === 'routing' && (
        <div className="mdm-panel" data-testid="rfi-routing"><h2>{t('rfit.routing')}</h2>
          <ol>{r.routing.map((x) => <li key={x.seq}>{String(x.at).slice(0, 16).replace('T', ' ')} · {x.by ?? '—'} · {t(`rte.${x.event}`)} → {t(`ball.${x.to}`)}{x.note ? ` — ${x.note}` : ''}</li>)}</ol></div>
      )}
      {tab === 'response' && (
        <div data-testid="rfi-response">
          <div className="mdm-panel"><h2>{t('rfit.response')}</h2>
            {r.responseType ? (
              <dl data-testid="rfi-answer"><dt>{t('rfi.responseType')}</dt><dd>{t(`rtype.${r.responseType}`)}</dd><dt>{t('rfi.answer')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.responseText}</dd>
                <dt>{t('rfi.respondedBy')}</dt><dd>{r.respondedBy} · {r.respondedOn}</dd>
                <dt>{t('rfi.instruction')}</dt><dd>{r.instructionRef || '—'}</dd><dt>{t('rfi.responseRevision')}</dt><dd>{r.responseRevision || '—'}</dd>
                <dt>{t('rfi.costImpact')}</dt><dd data-testid="rfi-cost">₹ {r.costImpact}</dd><dt>{t('rfi.timeImpact')}</dt><dd data-testid="rfi-time">{r.timeImpactDays}</dd>
                <dt>{t('rfi.variation')}</dt><dd>{r.variationRef || '—'}</dd>
                {r.verifiedBy && <><dt>{t('rfi.verifiedBy')}</dt><dd data-testid="rfi-verified">{r.verifiedBy} · {r.verifiedOn}</dd></>}
                {r.delayDraft && <><dt>{t('rfi.delayDraft')}</dt><dd data-testid="rfi-delay">{t('rfi.delayLine', { days: r.delayDraft.days })}</dd></>}</dl>
            ) : <p className="muted">{t('rfi.noAnswer')}</p>}</div>
          {c.respond && (
            <form className="mdm-panel" aria-label={t('rfi.recordAnswer')} data-testid="rfi-answer-form" onSubmit={respond}>
              <h2>{t('rfi.recordAnswer')}</h2>
              <div className="form-grid">
                <Field label={t('rfi.responseType')} name="responseType" error={error}><select value={ans.responseType} onChange={(e) => setAns({ ...ans, responseType: e.target.value })} data-testid="ans-type">{RESPONSE_TYPES.map((k) => <option key={k} value={k}>{t(`rtype.${k}`)}</option>)}</select></Field>
                <Field label={t('rfi.answer')} name="text" error={error}><textarea value={ans.text} onChange={(e) => setAns({ ...ans, text: e.target.value })} rows={4} maxLength={4000} data-testid="ans-text" /></Field>
                <Field label={t('rfi.costImpactRs')} name="costImpact" error={error}><input value={ans.costImpact} onChange={(e) => setAns({ ...ans, costImpact: e.target.value })} inputMode="decimal" data-testid="ans-cost" /></Field>
                <Field label={t('rfi.timeImpact')} name="timeImpactDays" error={error}><input type="number" min="0" value={ans.timeImpactDays} onChange={(e) => setAns({ ...ans, timeImpactDays: e.target.value })} data-testid="ans-days" /></Field>
                <Field label={t('rfi.responseRevision')} name="drawingRevisionId" error={error}><select value={ans.drawingRevisionId} onChange={(e) => setAns({ ...ans, drawingRevisionId: e.target.value })} data-testid="ans-revision"><option value="">—</option>{revisions.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.statusCode}</option>)}</select></Field>
                <Field label={t('rfi.instruction')} name="instructionRef" error={error}><input value={ans.instructionRef} onChange={(e) => setAns({ ...ans, instructionRef: e.target.value })} maxLength={120} data-testid="ans-instruction" /></Field>
                <Field label={t('rfi.variation')} name="variationRef" error={error}><input value={ans.variationRef} onChange={(e) => setAns({ ...ans, variationRef: e.target.value })} maxLength={120} /></Field>
              </div>
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={ans.text.trim().length < 5} data-testid="ans-save">{t('rfi.saveAnswer')}</button></div>
            </form>
          )}
        </div>
      )}
      {tab === 'files' && (
        <div className="mdm-panel" data-testid="rfi-files"><h2>{t('rfit.files')}</h2>
          {(c.edit || c.respond) && <FileUploader entity="engg_rfi" entityId={r.id} onDone={() => setUploaded((n) => n + 1)} />}
          <AttachmentList key={uploaded} entity="engg_rfi" entityId={r.id} canEdit={c.edit || c.respond} onReplace={() => {}} /></div>
      )}
    </section>
  );
}
