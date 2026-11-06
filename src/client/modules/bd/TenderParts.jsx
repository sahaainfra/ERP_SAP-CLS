import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link } from '../core/pages/ui.jsx';
import { CRITERIA, DOC_KINDS, IMPACTS, TEAM_KINDS, dayIST, inr, tdr } from './api.js';

const RESULT_TONE = { PASS: 'COMPLETED', FAIL: 'REJECTED', WAIVED: 'AT_RISK', PENDING: 'DRAFT' };

/** BR-01: what stands between the tender and the submission, one line each. */
export function ReadinessPanel({ readiness }) {
  const t = useT('bd');
  return (
    <div className="mdm-panel" data-testid="readiness" data-ready={readiness.ready ? 'yes' : 'no'}>
      <h2>{t('tdr.readiness')} <StatusBadge status={readiness.ready ? 'COMPLETED' : 'AT_RISK'} label={readiness.ready ? t('tdr.readyYes') : t('tdr.readyNo')} /></h2>
      <ul className="mdm-list">{readiness.items.map((i) => <li key={i.code} data-testid="rd-item" data-code={i.code} data-ok={i.ok ? 'yes' : 'no'}><StatusBadge status={i.ok ? 'COMPLETED' : i.blocking ? 'REJECTED' : 'AT_RISK'} label={i.ok ? t('tdr.ok') : i.blocking ? t('tdr.blocks') : t('tdr.note')} /> {i.text}</li>)}</ul>
    </div>
  );
}

/** FR-02: the eligibility checklist: figures against figures are worked out, the others marked by hand, a failed criterion can be waived with a reason; evidence files per criterion. */
export function EligibilityTab({ tender, run, error }) {
  const t = useT('bd');
  const e = tender.eligibility; const can = tender.can.manage;
  const [edit, setEdit] = useState(null); const [add, setAdd] = useState(null);
  const save = async (row) => { const ok = await run(() => tdr.updateEligibility(row.id, { requirement: row.requirement === '' ? null : Number(row.requirement), our: row.our === '' ? null : Number(row.our), ourText: row.ourText || null, requirementText: row.requirementText || null, notes: row.notes || null, ...(row.result ? { result: row.result } : {}), ...(row.result === 'WAIVED' ? { waiveReason: row.waiveReason } : {}), version: row.rowVersion }), t('el.saved')); if (ok) setEdit(null); };
  return (
    <div data-testid="eligibility">
      <p className="muted" data-testid="el-summary">{t('el.summary', { passed: e.passed, waived: e.waived, failed: e.failed, pending: e.pending })}</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={t('tab.eligibility')}>
        <table className="grid"><thead><tr><th>{t('el.criterion')}</th><th>{t('el.requirement')}</th><th>{t('el.ours')}</th><th>{t('el.result')}</th><th>{t('el.evidence')}</th>{can && <th>{t('tdr.actions')}</th>}</tr></thead>
          <tbody>{e.rows.map((r) => (
            <tr key={r.id} data-testid="el-row" data-criterion={r.criterion} data-result={r.result}>
              <th scope="row" data-label={t('el.criterion')}>{r.title}<div className="muted small">{t(`crit.${r.criterion}`)}{r.auto ? ` · ${t('el.worked')}` : ''}</div></th>
              <td data-label={t('el.requirement')}>{r.requirement != null ? inr(r.requirement) : r.requirementText ?? '—'}</td>
              <td data-label={t('el.ours')}>{r.our != null ? inr(r.our) : r.ourText ?? '—'}</td>
              <td data-label={t('el.result')}><StatusBadge status={RESULT_TONE[r.result]} label={t(`result.${r.result}`)} />{r.waiveReason ? <div className="muted small">{r.waiveReason}</div> : null}</td>
              <td data-label={t('el.evidence')}><AttachmentList entity="tdr_eligibility" entityId={r.id} canEdit={can} /></td>
              {can && <td data-label={t('tdr.actions')}><button type="button" className="btn btn-small" onClick={() => setEdit({ ...r, requirement: r.requirement ?? '', our: r.our ?? '', ourText: r.ourText ?? '', requirementText: r.requirementText ?? '', notes: r.notes ?? '', waiveReason: r.waiveReason ?? '', result: '' })} data-testid="el-edit">{t('act.edit')}</button> <button type="button" className="btn btn-small" onClick={() => run(() => tdr.deleteEligibility(r.id), t('el.removed'))} data-testid="el-remove">{t('act.remove')}</button></td>}
            </tr>))}</tbody></table>
      </div>
      {edit && (
        <form className="mdm-panel mdm-fields" onSubmit={(ev) => { ev.preventDefault(); save(edit); }} data-testid="el-form" aria-label={edit.title}>
          <h2>{edit.title}</h2>
          {['TURNOVER', 'NET_WORTH', 'BID_CAPACITY'].includes(edit.criterion) ? <>
            <Field label={t('el.requirementValue')} name="requirement" error={error}><input type="number" min="0" step="0.01" value={edit.requirement} readOnly={edit.criterion === 'BID_CAPACITY'} onChange={(ev) => setEdit({ ...edit, requirement: ev.target.value })} data-testid="el-requirement" /></Field>
            <Field label={t('el.ourValue')} name="our" error={error}><input type="number" min="0" step="0.01" value={edit.our} readOnly={edit.criterion === 'BID_CAPACITY'} onChange={(ev) => setEdit({ ...edit, our: ev.target.value })} data-testid="el-our" /></Field>
          </> : <>
            <Field label={t('el.requirementText')} name="requirementText" error={error}><input value={edit.requirementText} onChange={(ev) => setEdit({ ...edit, requirementText: ev.target.value })} data-testid="el-requirement-text" /></Field>
            <Field label={t('el.ourText')} name="ourText" error={error}><input value={edit.ourText} onChange={(ev) => setEdit({ ...edit, ourText: ev.target.value })} data-testid="el-our-text" /></Field>
            <Field label={t('el.result')} name="result" error={error}><select value={edit.result} onChange={(ev) => setEdit({ ...edit, result: ev.target.value })} data-testid="el-result"><option value="">{t('el.keep')}</option>{['PASS', 'FAIL', 'PENDING', 'WAIVED'].map((k) => <option key={k} value={k}>{t(`result.${k}`)}</option>)}</select></Field>
          </>}
          {['TURNOVER', 'NET_WORTH', 'BID_CAPACITY'].includes(edit.criterion) && <Field label={t('el.waive')} name="result" error={error}><select value={edit.result} onChange={(ev) => setEdit({ ...edit, result: ev.target.value })} data-testid="el-result"><option value="">{t('el.worked')}</option><option value="WAIVED">{t('result.WAIVED')}</option><option value="PENDING">{t('el.backToWorked')}</option></select></Field>}
          {edit.result === 'WAIVED' && <Field label={t('el.waiveReason')} name="waiveReason" error={error}><input value={edit.waiveReason} onChange={(ev) => setEdit({ ...edit, waiveReason: ev.target.value })} data-testid="el-waive-reason" /></Field>}
          <Field label={t('comp.note')} name="notes" error={error}><input value={edit.notes} onChange={(ev) => setEdit({ ...edit, notes: ev.target.value })} /></Field>
          {can && <><h3>{t('el.evidence')}</h3><FileUploader entity="tdr_eligibility" entityId={edit.id} /></>}
          <div className="actions"><button type="button" className="btn" onClick={() => setEdit(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="el-save">{t('act.save')}</button></div>
        </form>)}
      {can && !add && <div className="actions"><button type="button" className="btn" onClick={() => setAdd({ criterion: 'OTHER', title: '' })} data-testid="el-add">{t('el.add')}</button></div>}
      {add && (
        <form className="mdm-panel mdm-fields" onSubmit={async (ev) => { ev.preventDefault(); if (await run(() => tdr.addEligibility(tender.id, { criterion: add.criterion, title: add.title.trim() }), t('el.added'))) setAdd(null); }} data-testid="el-add-form" aria-label={t('el.add')}>
          <Field label={t('el.criterion')} name="criterion" error={error}><select value={add.criterion} onChange={(ev) => setAdd({ ...add, criterion: ev.target.value })}>{CRITERIA.map((k) => <option key={k} value={k}>{t(`crit.${k}`)}</option>)}</select></Field>
          <Field label={t('el.title')} name="title" error={error}><input value={add.title} onChange={(ev) => setAdd({ ...add, title: ev.target.value })} required data-testid="el-add-title" /></Field>
          <div className="actions"><button type="button" className="btn" onClick={() => setAdd(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="el-add-save">{t('act.save')}</button></div>
        </form>)}
    </div>
  );
}

/** FR-04: addenda and corrigenda with their impact; an addendum may move the dates; each is read and acknowledged by the team; the changes of the dates are logged. */
export function AddendaTab({ tender, run, error }) {
  const t = useT('bd');
  const can = tender.can.manage || (tender.status === 'APPROVED' && tender.can.ready);
  const blank = { kind: 'ADDENDUM', date: dayIST(0), summary: '', impact: 'NONE', impactNote: '', newPrebidDate: '', newSubmissionAt: '', newOpeningAt: '' };
  const [v, setV] = useState(blank);
  const send = async (ev) => { ev.preventDefault(); if (await run(() => tdr.addAddendum(tender.id, { kind: v.kind, date: v.date, summary: v.summary.trim(), impact: v.impact, impactNote: v.impactNote.trim() || null, ...(v.newPrebidDate ? { newPrebidDate: v.newPrebidDate } : {}), ...(v.newSubmissionAt ? { newSubmissionAt: v.newSubmissionAt } : {}), ...(v.newOpeningAt ? { newOpeningAt: v.newOpeningAt } : {}) }), t('ad.added'))) setV(blank); };
  return (
    <div data-testid="addenda">
      {tender.addenda.length === 0 ? <EmptyState title={t('ad.none')} message={t('ad.noneHint')} /> : (
        <ul className="mdm-list" data-testid="ad-list">{tender.addenda.map((a) => (
          <li key={a.id} data-testid="ad-row" data-ack={a.acknowledged ? 'yes' : 'no'}>
            <strong>{t(a.kind === 'CORRIGENDUM' ? 'ad.corrigendum' : 'ad.addendum')} {a.number}</strong> · {a.date} · {t(`impact.${a.impact}`)} {a.acknowledged ? <StatusBadge status="COMPLETED" label={t('ad.read', { by: a.ackBy })} /> : <StatusBadge status="AT_RISK" label={t('ad.unread')} />}
            <p>{a.summary}</p>{a.impactNote && <p className="muted">{a.impactNote}</p>}
            {(a.newPrebidDate || a.newSubmissionAt || a.newOpeningAt) && <p className="muted small">{[a.newPrebidDate && `${t('td.prebid')}: ${a.newPrebidDate}`, a.newSubmissionAt && `${t('td.submission')}: ${a.newSubmissionAt.replace('T', ' ')}`, a.newOpeningAt && `${t('td.opening')}: ${a.newOpeningAt.replace('T', ' ')}`].filter(Boolean).join(' · ')}</p>}
            <AttachmentList entity="tdr_addendum" entityId={a.id} canEdit={can} />
            {can && <div className="actions no-print">{!a.acknowledged && <button type="button" className="btn btn-small" onClick={() => run(() => tdr.ackAddendum(a.id), t('ad.acked'))} data-testid="ad-ack">{t('ad.acknowledge')}</button>}</div>}
          </li>))}</ul>)}
      {tender.dateLog.length > 0 && <><h2>{t('ad.dateLog')}</h2><ul className="mdm-list" data-testid="date-log">{tender.dateLog.map((d, i) => <li key={i}>{d.field}: {d.oldValue ?? '—'} → <strong>{d.newValue ?? '—'}</strong> · {d.reason} · <span className="muted small">{d.by}</span></li>)}</ul></>}
      {can && (
        <form className="mdm-panel mdm-fields no-print" onSubmit={send} data-testid="ad-form" aria-label={t('ad.record')}>
          <h2>{t('ad.record')}</h2>
          <Field label={t('ad.kind')} name="kind" error={error}><select value={v.kind} onChange={(ev) => setV({ ...v, kind: ev.target.value })} data-testid="ad-kind"><option value="ADDENDUM">{t('ad.addendum')}</option><option value="CORRIGENDUM">{t('ad.corrigendum')}</option></select></Field>
          <Field label={t('ad.date')} name="date" error={error}><input type="date" value={v.date} onChange={(ev) => setV({ ...v, date: ev.target.value })} data-testid="ad-date" /></Field>
          <Field label={t('ad.summary')} name="summary" error={error}><textarea rows="3" value={v.summary} onChange={(ev) => setV({ ...v, summary: ev.target.value })} required data-testid="ad-summary" /></Field>
          <Field label={t('ad.impact')} name="impact" error={error}><select value={v.impact} onChange={(ev) => setV({ ...v, impact: ev.target.value })} data-testid="ad-impact">{IMPACTS.map((k) => <option key={k} value={k}>{t(`impact.${k}`)}</option>)}</select></Field>
          {v.impact !== 'NONE' && <Field label={t('ad.impactNote')} name="impactNote" error={error}><input value={v.impactNote} onChange={(ev) => setV({ ...v, impactNote: ev.target.value })} data-testid="ad-impact-note" /></Field>}
          {v.impact === 'DATES' && <>
            <Field label={t('ad.newPrebid')} name="newPrebidDate" error={error}><input type="date" value={v.newPrebidDate} onChange={(ev) => setV({ ...v, newPrebidDate: ev.target.value })} /></Field>
            <Field label={t('ad.newSubmission')} name="newSubmissionAt" error={error}><input type="datetime-local" value={v.newSubmissionAt} onChange={(ev) => setV({ ...v, newSubmissionAt: ev.target.value })} data-testid="ad-new-submission" /></Field>
            <Field label={t('ad.newOpening')} name="newOpeningAt" error={error}><input type="datetime-local" value={v.newOpeningAt} onChange={(ev) => setV({ ...v, newOpeningAt: ev.target.value })} data-testid="ad-new-opening" /></Field></>}
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="ad-save">{t('act.save')}</button></div>
        </form>)}
    </div>
  );
}

/** FR-05: the queries sent to the authority, linked to clauses, and the clarifications received. */
export function QueriesTab({ tender, run, error }) {
  const t = useT('bd');
  const can = tender.can.manage; const [v, setV] = useState({ clauseRef: '', query: '', addendumNumber: '' }); const [resp, setResp] = useState(null);
  return (
    <div data-testid="queries">
      {tender.queries.length === 0 ? <EmptyState title={t('qu.none')} message={t('qu.noneHint')} /> : (
        <ul className="mdm-list" data-testid="qu-list">{tender.queries.map((q) => (
          <li key={q.id} data-testid="qu-row" data-status={q.status}>
            <strong>#{q.seq}</strong> {q.clauseRef && <span>[{q.clauseRef}] </span>}<StatusBadge status={q.status === 'ANSWERED' ? 'COMPLETED' : q.status === 'SUBMITTED' ? 'IN_REVIEW' : q.status === 'NO_RESPONSE' ? 'AT_RISK' : 'DRAFT'} label={t(`qstatus.${q.status}`)} />
            <p>{q.query}</p>{q.submittedOn && <p className="muted small">{t('qu.sentOn', { date: q.submittedOn })}</p>}
            {q.response && <p data-testid="qu-response"><strong>{t('qu.response')}:</strong> {q.response} <span className="muted small">({q.responseDate})</span></p>}
            {can && <div className="actions no-print">
              {q.status === 'DRAFT' && <button type="button" className="btn btn-small" onClick={() => run(() => tdr.queryAct(q.id, 'send'), t('qu.sent'))} data-testid="qu-send">{t('qu.send')}</button>}
              {['SUBMITTED', 'ANSWERED'].includes(q.status) && <button type="button" className="btn btn-small" onClick={() => setResp({ id: q.id, response: q.response ?? '', date: dayIST(0) })} data-testid="qu-respond">{t('qu.record')}</button>}
              {q.status === 'SUBMITTED' && <button type="button" className="btn btn-small" onClick={() => run(() => tdr.queryAct(q.id, 'no-response'), t('qu.closed'))}>{t('qu.noResponse')}</button>}
            </div>}
          </li>))}</ul>)}
      {resp && (
        <form className="mdm-panel mdm-fields" onSubmit={async (ev) => { ev.preventDefault(); if (await run(() => tdr.queryAct(resp.id, 'respond', { response: resp.response.trim(), date: resp.date }), t('qu.recorded'))) setResp(null); }} data-testid="qu-response-form" aria-label={t('qu.record')}>
          <Field label={t('qu.response')} name="response" error={error}><textarea rows="3" value={resp.response} onChange={(ev) => setResp({ ...resp, response: ev.target.value })} required data-testid="qu-response-text" /></Field>
          <Field label={t('qu.responseDate')} name="date" error={error}><input type="date" value={resp.date} onChange={(ev) => setResp({ ...resp, date: ev.target.value })} /></Field>
          <div className="actions"><button type="button" className="btn" onClick={() => setResp(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="qu-response-save">{t('act.save')}</button></div>
        </form>)}
      {can && (
        <form className="mdm-panel mdm-fields no-print" onSubmit={async (ev) => { ev.preventDefault(); if (await run(() => tdr.addQuery(tender.id, { clauseRef: v.clauseRef.trim() || null, query: v.query.trim(), ...(v.addendumNumber ? { addendumNumber: Number(v.addendumNumber) } : {}) }), t('qu.added'))) setV({ clauseRef: '', query: '', addendumNumber: '' }); }} data-testid="qu-form" aria-label={t('qu.raise')}>
          <h2>{t('qu.raise')}</h2>
          <Field label={t('qu.clause')} name="clauseRef" error={error}><input value={v.clauseRef} onChange={(ev) => setV({ ...v, clauseRef: ev.target.value })} data-testid="qu-clause" /></Field>
          <Field label={t('qu.query')} name="query" error={error}><textarea rows="3" value={v.query} onChange={(ev) => setV({ ...v, query: ev.target.value })} required data-testid="qu-query" /></Field>
          {tender.addenda.length > 0 && <Field label={t('qu.addendum')} name="addendumNumber" error={error}><select value={v.addendumNumber} onChange={(ev) => setV({ ...v, addendumNumber: ev.target.value })}><option value="">–</option>{tender.addenda.map((a) => <option key={a.id} value={a.number}>{a.number}</option>)}</select></Field>}
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="qu-save">{t('act.save')}</button></div>
        </form>)}
    </div>
  );
}

/** FR-06: the tasks of the tender team, with due dates; each is a task of the person in the task list as well. */
export function TasksTab({ tender, run, error }) {
  const t = useT('bd');
  const can = tender.can.manage; const [v, setV] = useState({ kind: 'ESTIMATION', title: '', assignee: '', dueDate: '' });
  return (
    <div data-testid="team">
      {tender.teamTasks.length === 0 ? <EmptyState title={t('tk.none')} message={t('tk.noneHint')} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t('tab.tasks')}>
          <table className="grid" data-testid="tk-table"><thead><tr><th>{t('tk.task')}</th><th>{t('tk.assignee')}</th><th>{t('tk.due')}</th><th>{t('el.result')}</th><th>{t('tdr.actions')}</th></tr></thead>
            <tbody>{tender.teamTasks.map((x) => (
              <tr key={x.id} data-testid="tk-row" data-status={x.status}>
                <th scope="row" data-label={t('tk.task')}>{x.title}<div className="muted small">{t(`kind.${x.kind}`)}</div></th><td data-label={t('tk.assignee')}>{x.assignee}</td>
                <td data-label={t('tk.due')} className={x.overdue ? 'field-error' : ''}>{x.dueDate}</td><td data-label={t('el.result')}><StatusBadge status={x.status === 'DONE' ? 'COMPLETED' : x.status === 'CANCELLED' ? 'CANCELLED' : x.overdue ? 'OVERDUE' : 'IN_REVIEW'} label={t(`tstatus.${x.status}`)} /></td>
                <td data-label={t('tdr.actions')}>{x.status === 'OPEN' && <><button type="button" className="btn btn-small" onClick={() => run(() => tdr.taskAct(x.id, 'done'), t('tk.done'))} data-testid="tk-done">{t('tk.markDone')}</button> {can && <button type="button" className="btn btn-small" onClick={() => run(() => tdr.taskAct(x.id, 'cancel'), t('tk.cancelled'))}>{t('act.cancel')}</button>}</>}</td>
              </tr>))}</tbody></table>
        </div>)}
      {can && (
        <form className="mdm-panel mdm-fields no-print" onSubmit={async (ev) => { ev.preventDefault(); if (await run(() => tdr.addTask(tender.id, { kind: v.kind, title: v.title.trim(), assignee: v.assignee.trim(), dueDate: v.dueDate }), t('tk.added'))) setV({ kind: 'ESTIMATION', title: '', assignee: '', dueDate: '' }); }} data-testid="tk-form" aria-label={t('tk.add')}>
          <h2>{t('tk.add')}</h2>
          <Field label={t('tk.kind')} name="kind" error={error}><select value={v.kind} onChange={(ev) => setV({ ...v, kind: ev.target.value })} data-testid="tk-kind">{TEAM_KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}</select></Field>
          <Field label={t('tk.task')} name="title" error={error}><input value={v.title} onChange={(ev) => setV({ ...v, title: ev.target.value })} required data-testid="tk-title" /></Field>
          <Field label={t('tk.assignee')} name="assignee" error={error} hint={t('tk.assigneeHint')}><input value={v.assignee} onChange={(ev) => setV({ ...v, assignee: ev.target.value })} required data-testid="tk-assignee" /></Field>
          <Field label={t('tk.due')} name="dueDate" error={error}><input type="date" value={v.dueDate} min={dayIST(0)} onChange={(ev) => setV({ ...v, dueDate: ev.target.value })} required data-testid="tk-due" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="tk-save">{t('act.save')}</button></div>
        </form>)}
    </div>
  );
}

/** FR-04: the tender documents are registered in the document service (04.10) and linked to the tender; ad-hoc files are attached to the tender. */
export function DocumentsTab({ tender, run, error }) {
  const t = useT('bd');
  const q = useQuery({ queryKey: ['bd', 'tender-docs', tender.id, tender.rowVersion], queryFn: () => tdr.documents(tender.id), retry: false });
  const can = tender.can.manage; const [v, setV] = useState({ title: '', kind: 'NIT' });
  return (
    <div data-testid="documents">
      {q.isPending ? <Skeleton label={t('tab.documents')} rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data.rows.length === 0 ? <EmptyState title={t('dc.none')} message={t('dc.noneHint')} /> : (
        <ul className="mdm-list" data-testid="dc-list">{q.data.rows.map((d) => <li key={d.id} data-testid="dc-row"><Link to={d.route}>{d.docNo}</Link> · {d.title} · <span className="muted small">{d.tags.join(', ')}</span></li>)}</ul>)}
      {can && (
        <form className="mdm-panel mdm-fields no-print" onSubmit={async (ev) => { ev.preventDefault(); if (await run(() => tdr.registerDocument(tender.id, { title: v.title.trim(), kind: v.kind }), t('dc.registered'))) setV({ title: '', kind: 'NIT' }); }} data-testid="dc-form" aria-label={t('dc.register')}>
          <h2>{t('dc.register')}</h2>
          <Field label={t('dc.title')} name="title" error={error}><input value={v.title} onChange={(ev) => setV({ ...v, title: ev.target.value })} required data-testid="dc-title" /></Field>
          <Field label={t('dc.kind')} name="kind" error={error}><select value={v.kind} onChange={(ev) => setV({ ...v, kind: ev.target.value })} data-testid="dc-kind">{DOC_KINDS.map((k) => <option key={k} value={k}>{t(`dkind.${k}`)}</option>)}</select></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="dc-save">{t('dc.registerButton')}</button></div>
        </form>)}
      <h2>{t('dc.attachments')}</h2>
      <AttachmentList entity="tdr_tender" entityId={tender.id} canEdit={can} />
      {can && <FileUploader entity="tdr_tender" entityId={tender.id} />}
    </div>
  );
}
