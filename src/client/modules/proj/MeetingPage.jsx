import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { ACTION_TONE, MEET_TONE, MTYPES, downloadFile, tm } from './api.js';
import { Tabs, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Meeting (part 10.05, FR-04, FR-05, BR-02): one meeting with its details, attendees (people of the company and external attendees), agenda, minutes, decisions and actions. The minute-taker sends the minutes and the chair approves them: they are then
// issued and locked, every action becomes a task of its owner, and the minutes can be printed as a PDF. A correction is a revision. Owners update their own actions here, and the task follows.
const norm = (m) => ({ mtype: m.type, title: m.title, meetingDate: m.meetingDate, startTime: m.startTime ?? '', location: m.location ?? '', chairUser: m.chairUser, minuteTaker: m.minuteTaker, attendees: m.attendees, agenda: m.agenda, minutes: m.minutes ?? '', decisions: m.decisions, actions: m.actions.map((a) => ({ description: a.description, ownerUser: a.ownerUser, dueDate: a.dueDate, priority: a.priority ?? 'MEDIUM' })) });
export default function MeetingPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['proj', 'meeting', id], queryFn: () => tm.meeting(id), enabled: Boolean(id), retry: false });
  const [tab, setTab] = useState('minutes'); const [f, setF] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  usePageTitle(q.data ? `${q.data.ref} ${q.data.title}` : t('mtg.title'));
  if (!id) return <section aria-labelledby="mtg-h" data-testid="mtg-none"><PageHeader id="mtg-h" title={t('mtg.title')} subtitle={<>{t('bq.noId')} <Link to="/proj/meetings">{t('mtg.listTitle')}</Link></>} /></section>;
  if (q.error?.status === 403) return <NoPermission what={t('mtg.listTitle')} permission="proj.meeting.view" />;
  if (q.isPending) return <Skeleton label={t('mtg.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const m = q.data; const c = m.can; const form = f ?? norm(m); const editing = c.edit; const dirty = f !== null;
  const set = (k, v) => setF({ ...form, [k]: v });
  const upd = (list, i, k, v) => set(list, form[list].map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const save = async () => { const body = { ...form, startTime: form.startTime || null, location: form.location || null, minutes: form.minutes || null, attendees: form.attendees.map((a) => ({ kind: a.kind, user: a.user || null, stakeholderId: a.stakeholderId || null, name: a.name, organisation: a.organisation || null, present: a.present !== false })), agenda: form.agenda.map((a) => ({ title: a.title, notes: a.notes || null })), version: m.rowVersion }; const r = await run(() => tm.updateMeeting(id, body), t('wbs.saved')); if (r) setF(null); return r; };
  return (
    <section aria-labelledby="mtg-h" data-testid="meeting" data-status={m.status} data-rev={m.revNo}>
      <header>
        <PageHeader id="mtg-h" title={<>{m.ref} · {m.title} <StatusBadge status={MEET_TONE[m.status]} label={m.statusLabel} /></>} subtitle={<>{m.projectCode} {m.projectName} · {t(`mtg.type.${m.type}`)} · {m.meetingDate}{m.startTime ? ` ${m.startTime}` : ''}{m.location ? ` · ${m.location}` : ''} · {t('mtg.chair')}: {m.chairUser} · {t('mtg.minuteTaker')}: {m.minuteTaker}</>} />
        {m.revisionReason && <p className="mdm-banner" role="status">{t('mtg.revisionOf')}: {m.revisionReason}</p>}
        {m.status === 'APPROVED' && <p className="mdm-banner" role="status" data-testid="mtg-issued">{t('mtg.issued', { by: m.issuedBy, at: String(m.issuedAt).slice(0, 10) })}</p>}
        {m.openRevisionId && <p className="mdm-banner" role="status"><Link to={`/proj/meeting?id=${m.openRevisionId}`}>{t('mtg.openRevision')}</Link></p>}
        {error?.form && <p className="field-error" role="alert" data-testid="mtg-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="mtg-note">{note}</p>}
        <div className="actions-row no-print" data-testid="mtg-actions">
          {editing && <button type="button" className="btn btn-primary" disabled={!dirty} onClick={save} data-testid="mtg-save">{t('bl.save')}</button>}
          {c.submit && <button type="button" className="btn btn-primary" disabled={dirty} onClick={() => run(() => tm.meetingAct(id, 'submit'), t('mtg.sent'))} data-testid="mtg-submit">{t('mtg.submit')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((r) => tm.meetingAct(id, 'withdraw', { reason: r }), t('bq.withdrawn'))}>{t('act.withdraw')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((r) => tm.meetingAct(id, 'cancel', { reason: r }), t('bq.cancelled'))}>{t('bl.cancel')}</button>}
          {c.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('mtg.confirmDelete'))) { const r = await run(() => tm.removeMeeting(id)); if (r) navigateTo('/proj/meetings', { force: true }); } }} data-testid="mtg-delete">{t('act.delete')}</button>}
          {c.amend && <button type="button" className="btn" onClick={() => why((r) => tm.meetingAct(id, 'amend', { reason: r }).then((n) => navigateTo(`/proj/meeting?id=${n.id}`, { force: true })), t('mtg.revising'))} data-testid="mtg-revise">{t('mtg.revise')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => downloadFile(`/meetings/${id}/print`, 'minutes.html')} data-testid="mtg-print">{t('act.print')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => downloadFile(`/meetings/${id}/document?format=pdf`, `minutes-${m.docNo}.pdf`)} data-testid="mtg-pdf">{t('bl.pdf')}</button>}
        </div>
      </header>
      <Tabs tabs={['minutes', 'attendees', 'actions', 'approvals']} active={tab} onChange={setTab} label={t('mtg.title')} />
      {tab === 'minutes' && (
        <div data-testid="mtg-minutes">
          <div className="form-grid">
            <Field label={t('mtg.titleField')} name="title" error={error}><input value={form.title} onChange={(e) => set('title', e.target.value)} disabled={!editing} maxLength={200} data-testid="mtg-e-title" /></Field>
            <Field label={t('f.type')} name="mtype" error={error}><select value={form.mtype} onChange={(e) => set('mtype', e.target.value)} disabled={!editing}>{MTYPES.map((k) => <option key={k} value={k}>{t(`mtg.type.${k}`)}</option>)}</select></Field>
            <Field label={t('mtg.date')} name="meetingDate" error={error}><input type="date" value={form.meetingDate} onChange={(e) => set('meetingDate', e.target.value)} disabled={!editing} /></Field>
            <Field label={t('mtg.location')} name="location" error={error}><input value={form.location} onChange={(e) => set('location', e.target.value)} disabled={!editing} maxLength={200} /></Field>
            {editing && <LookupField id="mtg-e-chair" label={t('mtg.chair')} lookup="proj/people" valueKey="code" value={form.chairUser} onChange={(v) => set('chairUser', v)} />}
            {editing && <LookupField id="mtg-e-taker" label={t('mtg.minuteTaker')} lookup="proj/people" valueKey="code" value={form.minuteTaker} onChange={(v) => set('minuteTaker', v)} />}
          </div>
          <h2>{t('mtg.agenda')}</h2>
          {form.agenda.length === 0 && !editing && <p className="muted">—</p>}
          {form.agenda.map((a, i) => (<div key={i} className="form-grid"><Field label={`${i + 1}.`} name={`agenda.${i}.title`} error={error}><input value={a.title} onChange={(e) => upd('agenda', i, 'title', e.target.value)} disabled={!editing} maxLength={300} data-testid={`agenda-${i}`} /></Field>{editing && <button type="button" className="btn" onClick={() => set('agenda', form.agenda.filter((_, j) => j !== i))}>{t('bl.removeRow')}</button>}</div>))}
          {editing && <button type="button" className="btn" onClick={() => set('agenda', [...form.agenda, { title: '', notes: '' }])} data-testid="agenda-add">{t('mtg.addAgenda')}</button>}
          <Field label={t('mtg.minutesText')} name="minutes" error={error}><textarea rows={8} value={form.minutes} onChange={(e) => set('minutes', e.target.value)} disabled={!editing} maxLength={20000} data-testid="mtg-e-minutes" /></Field>
          <h2>{t('mtg.decisions')}</h2>
          {form.decisions.length === 0 && !editing && <p className="muted">—</p>}
          {form.decisions.map((d, i) => (<div key={i} className="form-grid"><Field label={`D${i + 1}`} name={`decisions.${i}.text`} error={error}><input value={d.text} onChange={(e) => upd('decisions', i, 'text', e.target.value)} disabled={!editing} maxLength={1000} data-testid={`decision-${i}`} /></Field>{editing && <button type="button" className="btn" onClick={() => set('decisions', form.decisions.filter((_, j) => j !== i))}>{t('bl.removeRow')}</button>}</div>))}
          {editing && <button type="button" className="btn" onClick={() => set('decisions', [...form.decisions, { text: '' }])} data-testid="decision-add">{t('mtg.addDecision')}</button>}
        </div>
      )}
      {tab === 'attendees' && (
        <div data-testid="mtg-attendees">
          <h2>{t('bl.attendees')}</h2>
          {form.attendees.length === 0 && <p className="muted" data-testid="att-empty">{t('mtg.noAttendees')}</p>}
          {form.attendees.map((a, i) => (
            <div key={i} className="form-grid" data-testid="att-row">
              <Field label={t('f.type')} name={`attendees.${i}.kind`} error={error}><select value={a.kind} onChange={(e) => upd('attendees', i, 'kind', e.target.value)} disabled={!editing}><option value="INTERNAL">{t('mtg.internal')}</option><option value="EXTERNAL">{t('mtg.external')}</option></select></Field>
              {a.kind === 'INTERNAL' ? <LookupField id={`att-user-${i}`} label={t('team.person')} lookup="proj/people" valueKey="code" value={a.user ?? ''} onChange={(v) => setF({ ...form, attendees: form.attendees.map((r, j) => (j === i ? { ...r, user: v, name: v } : r)) })} /> : <><Field label={t('f.name')} name={`attendees.${i}.name`} error={error}><input value={a.name} onChange={(e) => upd('attendees', i, 'name', e.target.value)} disabled={!editing} maxLength={160} data-testid={`att-name-${i}`} /></Field><Field label={t('stk.organisation')} name={`attendees.${i}.organisation`} error={error}><input value={a.organisation ?? ''} onChange={(e) => upd('attendees', i, 'organisation', e.target.value)} disabled={!editing} maxLength={200} /></Field></>}
              <label><input type="checkbox" checked={a.present !== false} onChange={(e) => upd('attendees', i, 'present', e.target.checked)} disabled={!editing} /> {t('mtg.present')}</label>
              {editing && <button type="button" className="btn" onClick={() => set('attendees', form.attendees.filter((_, j) => j !== i))}>{t('bl.removeRow')}</button>}
            </div>
          ))}
          {editing && <div className="actions-row"><button type="button" className="btn" onClick={() => set('attendees', [...form.attendees, { kind: 'INTERNAL', user: '', name: '', present: true }])} data-testid="att-add-internal">{t('mtg.addInternal')}</button><button type="button" className="btn" onClick={() => set('attendees', [...form.attendees, { kind: 'EXTERNAL', name: '', organisation: '', present: true }])} data-testid="att-add-external">{t('mtg.addExternal')}</button></div>}
          {m.distribution && <><h2>{t('mtg.distribution')}</h2><p className="small" data-testid="mtg-distribution">{t('mtg.sentTo', { n: m.distribution.internal.length })}: {m.distribution.internal.join(', ')}{m.distribution.external.length ? ` · ${t('mtg.externalSend', { n: m.distribution.external.length })}: ${m.distribution.external.map((e) => `${e.name}${e.email ? ` <${e.email}>` : ''}`).join(', ')}` : ''}</p></>}
        </div>
      )}
      {tab === 'actions' && (
        <div data-testid="mtg-actions-tab">
          <h2>{t('mtg.actions')}</h2>
          {editing ? (
            <>
              {form.actions.map((a, i) => (
                <div key={i} className="form-grid" data-testid="act-row">
                  <Field label={t('mtg.action')} name={`actions.${i}.description`} error={error}><input value={a.description} onChange={(e) => upd('actions', i, 'description', e.target.value)} maxLength={1000} data-testid={`act-desc-${i}`} /></Field>
                  <LookupField id={`act-owner-${i}`} label={t('bl.owner')} lookup="proj/people" valueKey="code" value={a.ownerUser} onChange={(v) => upd('actions', i, 'ownerUser', v)} />
                  <Field label={t('bl.due')} name={`actions.${i}.dueDate`} error={error}><input type="date" value={a.dueDate} onChange={(e) => upd('actions', i, 'dueDate', e.target.value)} data-testid={`act-due-${i}`} /></Field>
                  <Field label={t('bl.priority')} name={`actions.${i}.priority`} error={error}><select value={a.priority} onChange={(e) => upd('actions', i, 'priority', e.target.value)}>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
                  <button type="button" className="btn" onClick={() => set('actions', form.actions.filter((_, j) => j !== i))}>{t('bl.removeRow')}</button>
                </div>))}
              <button type="button" className="btn" onClick={() => set('actions', [...form.actions, { description: '', ownerUser: '', dueDate: form.meetingDate, priority: 'MEDIUM' }])} data-testid="act-add">{t('bl.addAction')}</button>
              <p className="small muted">{t('mtg.actionsHelp')}</p>
            </>
          ) : m.actions.length === 0 ? <p className="muted">{t('mtg.noActions')}</p> : (
            <div className="table-wrap"><table className="data-table"><caption className="sr-only">{t('mtg.actions')}</caption>
              <thead><tr><th scope="col">#</th><th scope="col">{t('mtg.action')}</th><th scope="col">{t('bl.owner')}</th><th scope="col">{t('bl.due')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('mtg.task')}</th><th scope="col" className="no-print" /></tr></thead>
              <tbody>{m.actions.map((a) => (
                <tr key={a.id} data-testid="act-view" data-status={a.status} className={a.overdue ? 'muted' : ''}>
                  <td>{a.no}</td><td>{a.description}</td><td>{a.ownerUser}</td><td>{a.dueDate}{a.overdue ? ` · ${t('trk.overdue')}` : ''}</td><td><StatusBadge status={ACTION_TONE[a.status]} label={a.statusLabel} /></td><td>{a.taskNo ?? '—'}</td>
                  <td className="no-print">{a.mine && m.status === 'APPROVED' && ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(a.status) && <>{a.status !== 'IN_PROGRESS' && <button type="button" className="btn" onClick={() => run(() => tm.updateAction(a.id, { status: 'IN_PROGRESS' }), t('mtg.actionUpdated'))} data-testid={`act-start-${a.no}`}>{t('mtg.start')}</button>}<button type="button" className="btn btn-primary" onClick={() => run(() => tm.updateAction(a.id, { status: 'DONE' }), t('mtg.actionUpdated'))} data-testid={`act-done-${a.no}`}>{t('mtg.markDone')}</button></>}</td>
                </tr>))}</tbody></table></div>
          )}
        </div>
      )}
      {tab === 'approvals' && <Approvals id={id} rv={m.rowVersion} />}
      <p className="small"><Link to="/proj/meetings">{t('mtg.listTitle')}</Link> · <Link to="/proj/action-tracker">{t('trk.title')}</Link></p>
    </section>
  );
}
function Approvals({ id, rv }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'mtg-history', id, rv], queryFn: () => tm.meetingHistory(id), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.approvals')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div data-testid="mtg-approvals"><h2>{t('tab.approvals')}</h2>
      {q.data.approvals.length === 0 ? <p className="muted">{t('obj.noApprovals')}</p> : <ul className="mdm-list">{q.data.approvals.map((a, i) => <li key={i}><strong>{a.event}</strong> · {a.actor}{a.step_code ? ` · ${a.step_code}` : ''} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.comment ? ` · ${a.comment}` : ''}</li>)}</ul>}
      <h2>{t('mtg.revisions')}</h2><ul className="mdm-list" data-testid="mtg-revisions">{q.data.revisions.map((r) => <li key={r.id}><Link to={`/proj/meeting?id=${r.id}`}>{t('mtg.rev', { n: r.revNo })}</Link> · {r.statusLabel}{r.reason ? ` · ${r.reason}` : ''}</li>)}</ul>
      <h2>{t('obj.changes')}</h2><ul className="mdm-list">{q.data.audit.map((a, i) => <li key={i}>{a.action} · {a.actor} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.reason ? ` · ${a.reason}` : ''}</li>)}</ul>
    </div>
  );
}
