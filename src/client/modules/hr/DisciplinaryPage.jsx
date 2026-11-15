import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { dayIST, ext } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Disciplinary Cases (HR, part 07.13, FR-07, restricted): HR and the director see the cases; HR opens one (incident, category, severity) and takes it through show-cause (with the day to answer by), inquiry, action and closing, each a dated line
// of the timeline; every look at a case is audited. An employee sees only the cases that concern them, without the file and the inquiry notes, and answers a show-cause here.
const TONE = { OPEN: 'IN_REVIEW', SHOW_CAUSE: 'AT_RISK', RESPONDED: 'IN_REVIEW', INQUIRY: 'IN_REVIEW', ACTION_TAKEN: 'APPROVED', CLOSED: 'COMPLETED', DROPPED: 'CANCELLED' };
export default function DisciplinaryPage() {
  const t = useT('sep');
  usePageTitle(t('dsc.title'));
  const qc = useQueryClient();
  const session = useSession();
  const canManage = (session.data?.permissions ?? []).includes('hr.disciplinary.manage');
  const q = useQuery({ queryKey: ['ext', 'cases'], queryFn: ext.cases, retry: false });
  const [open, setOpen] = useState(null); const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ employeeId: '', incidentDate: dayIST(0), category: 'CONDUCT', severity: 'MINOR', incident: '' });
  const [st, setSt] = useState({ stage: 'SHOW_CAUSE', text: '', dueDate: '', action: 'WARNING' });
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['ext', 'cases'] }); } catch (e) { setError(errorInfo(e)); } };
  const c = (q.data ?? []).find((x) => x.id === open);
  return (
    <section aria-labelledby="dc-title" data-testid="disciplinary">
      <PageHeader id="dc-title" title={t('dsc.title')} />
      <p className="muted small">{canManage ? t('dsc.restricted') : t('dsc.yours')}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="dc-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="dc-note">{note}</p>}
      {canManage && <div className="actions-row"><button type="button" className="btn btn-primary" onClick={() => setAdding(true)} data-testid="dc-new">{t('dsc.open')}</button></div>}
      {adding && (
        <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); run(async () => { await ext.createCase({ employeeId: Number(v.employeeId), incidentDate: v.incidentDate, category: v.category, severity: v.severity, incident: v.incident.trim() }); setAdding(false); }, t('dsc.opened')); }} data-testid="dc-form" aria-label={t('dsc.open')}>
          <LookupField id="dc-emp" label={t('list.employee')} lookup="hr/employees" value={v.employeeId} onChange={(x) => setV({ ...v, employeeId: x })} required />
          <Field label={t('dsc.date')} name="incidentDate" error={error}><input type="date" value={v.incidentDate} onChange={(e) => setV({ ...v, incidentDate: e.target.value })} data-testid="dc-date" /></Field>
          <Field label={t('dsc.category')} name="category" error={error}><select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} data-testid="dc-category">{['ATTENDANCE', 'CONDUCT', 'SAFETY_BREACH', 'FRAUD', 'HARASSMENT', 'NEGLIGENCE', 'OTHER'].map((k) => <option key={k} value={k}>{t(`dcat.${k}`)}</option>)}</select></Field>
          <Field label={t('dsc.severity')} name="severity" error={error}><select value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })} data-testid="dc-severity">{['MINOR', 'MAJOR', 'GROSS'].map((k) => <option key={k} value={k}>{t(`sev.${k}`)}</option>)}</select></Field>
          <Field label={t('dsc.incident')} name="incident" error={error}><textarea rows="4" value={v.incident} onChange={(e) => setV({ ...v, incident: e.target.value })} required data-testid="dc-incident" /></Field>
          <div className="actions"><button type="button" className="btn" onClick={() => setAdding(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!v.employeeId} data-testid="dc-create">{t('act.save')}</button></div>
        </form>
      )}
      {q.isPending ? <Skeleton label={t('dsc.title')} rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data.length === 0 ? <EmptyState title={t('dsc.none')} message={canManage ? t('dsc.noneHint') : ''} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t('dsc.title')}>
          <table className="grid" data-testid="dc-table"><thead><tr><th>{t('dsc.case')}</th><th>{t('list.employee')}</th><th>{t('dsc.category')}</th><th>{t('dsc.severity')}</th><th>{t('sep.status')}</th></tr></thead>
            <tbody>{q.data.map((x) => (
              <tr key={x.id} data-testid="dc-row" data-status={x.status}><th scope="row" data-label={t('dsc.case')}><button type="button" className="link-button" onClick={() => setOpen(x.id)} data-testid="dc-open">{x.docNo}</button></th><td data-label={t('list.employee')}>{x.employee} <span className="muted small">{x.employeeCode}</span></td><td data-label={t('dsc.category')}>{t(`dcat.${x.category}`)}</td><td data-label={t('dsc.severity')}>{t(`sev.${x.severity}`)}</td><td data-label={t('sep.status')}><StatusBadge status={TONE[x.status]} label={t(`cs.${x.status}`)} /></td></tr>))}</tbody></table>
        </div>
      )}
      {c && (
        <div className="mdm-panel" data-testid="dc-case">
          <h2>{c.docNo} · {c.employee}</h2>
          {c.incident && <p data-testid="dc-incident-text">{c.incident}</p>}
          {c.responseDue && <p className="muted">{t('dsc.answerBy', { date: c.responseDue })}</p>}
          <ol className="mdm-list" data-testid="dc-timeline">{c.actions.map((a, i) => <li key={i}><span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')} · {t(`stage.${a.stage}`)} · {a.by}</span>{a.text ? <><br />{a.text}</> : null}{a.outcome ? <strong> · {t(`act2.${a.outcome}`)}</strong> : null}</li>)}</ol>
          {c.can.respond && (
            <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => ext.caseRespond(c.id, st.text.trim()), t('dsc.answered')); }} data-testid="dc-respond" aria-label={t('dsc.answer')}>
              <Field label={t('dsc.answer')} name="text" error={error}><textarea rows="4" value={st.text} onChange={(e) => setSt({ ...st, text: e.target.value })} required data-testid="dc-answer" /></Field>
              <div className="actions"><button type="submit" className="btn btn-primary" data-testid="dc-answer-send">{t('act.send')}</button></div>
            </form>
          )}
          {c.can.manage && (
            <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => ext.caseStep(c.id, { stage: st.stage, text: st.text.trim(), ...(st.stage === 'SHOW_CAUSE' ? { dueDate: st.dueDate } : {}), ...(st.stage === 'ACTION' ? { action: st.action } : {}), version: c.rowVersion }), t('dsc.stepped')); }} data-testid="dc-step" aria-label={t('dsc.next')}>
              <Field label={t('dsc.next')} name="stage" error={error}><select value={st.stage} onChange={(e) => setSt({ ...st, stage: e.target.value })} data-testid="dc-stage">{['SHOW_CAUSE', 'INQUIRY', 'ACTION', 'CLOSE', 'DROP'].map((k) => <option key={k} value={k}>{t(`step.${k}`)}</option>)}</select></Field>
              {st.stage === 'SHOW_CAUSE' && <Field label={t('dsc.dueDate')} name="dueDate" error={error}><input type="date" value={st.dueDate} onChange={(e) => setSt({ ...st, dueDate: e.target.value })} required data-testid="dc-due" /></Field>}
              {st.stage === 'ACTION' && <Field label={t('dsc.action')} name="action" error={error}><select value={st.action} onChange={(e) => setSt({ ...st, action: e.target.value })} data-testid="dc-action">{['WARNING', 'FINAL_WARNING', 'SUSPENSION', 'TERMINATION_RECOMMENDED', 'NONE'].map((k) => <option key={k} value={k}>{t(`act2.${k}`)}</option>)}</select></Field>}
              <Field label={t('dsc.text')} name="text" error={error}><textarea rows="3" value={st.text} onChange={(e) => setSt({ ...st, text: e.target.value })} required data-testid="dc-text" /></Field>
              <div className="actions"><button type="submit" className="btn btn-primary" data-testid="dc-step-go">{t('act.save')}</button></div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
