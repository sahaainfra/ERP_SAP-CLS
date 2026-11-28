import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { DiscussionTab } from '../../platform/collab/CollabTabs.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { useSession } from '../core/api/index.js';
import { HIN_TONE, HIN_TYPES, PARTIES, download, fmtDate, openPrint, st, today } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Hindrance Register and the hindrance with its evidence (part 14.03, FR-02, BR-01, FR-05): the register with the age of each open hindrance; one hindrance with the activities and locations it touches, the letter that
// notified it, the evidence files, the delay draft it raised and the reports that mention it; approval by the construction manager and the project manager; closing with an end date and evidence.
const blank = (siteId) => ({ siteId, title: '', description: '', type: 'SITE_NOT_HANDED_OVER', startDate: today(), endDate: '', responsibleParty: 'CLIENT', responsibleName: '', letterId: '', activityIds: [], locationIds: [], text: '' });
const fromRecord = (h) => ({ siteId: h.siteId, title: h.title, description: h.description ?? '', type: h.type, startDate: h.startDate, endDate: h.endDate ?? '', responsibleParty: h.responsibleParty, responsibleName: h.responsibleName ?? '', letterId: h.letterId ?? '', activityIds: (h.affected.activities ?? []).map((a) => a.id), locationIds: (h.affected.locations ?? []).map((a) => a.id), text: h.affected.text ?? '' });
const payload = (f, withSite) => ({ ...(withSite ? { siteId: f.siteId } : {}), title: f.title.trim(), description: f.description.trim() || null, type: f.type, startDate: f.startDate, endDate: f.endDate || null, responsibleParty: f.responsibleParty, responsibleName: f.responsibleName.trim() || null, letterId: f.letterId ? Number(f.letterId) : null, affected: { activityIds: f.activityIds, locationIds: f.locationIds, text: f.text.trim() || undefined } });
const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

function Form({ t, editing, onSaved, onCancel }) {
  const sitesQ = useQuery({ queryKey: ['site', 'hin-sites'], queryFn: st.hinSites, retry: false });
  const [f, setF] = useState(editing ? fromRecord(editing) : null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const sites = (sitesQ.data ?? []).filter((s) => s.canCreate || editing); const siteId = f?.siteId ?? (sites.length === 1 ? sites[0].id : null);
  const oq = useQuery({ queryKey: ['site', 'hin-options', siteId], queryFn: () => st.hinOptions(siteId), enabled: Boolean(siteId), retry: false });
  if (sitesQ.isPending) return <Skeleton label={t('cnd.hin.new')} rows={4} />;
  if (sitesQ.isError) return <ErrorState error={sitesQ.error} onRetry={sitesQ.refetch} />;
  const form = f ?? blank(siteId); const set = (k, v) => setF({ ...form, siteId, [k]: v }); const o = oq.data;
  const save = async (e) => {
    e.preventDefault(); setError(null);
    if (!siteId) { setError({ form: t('f.chooseSite'), fields: { siteId: t('f.chooseSite') } }); return; }
    setBusy(true); try { const h = editing ? await st.updateHindrance(editing.id, { ...payload(form, false), rowVersion: editing.rowVersion }) : await st.createHindrance(payload({ ...form, siteId }, true)); onSaved(h); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  return (
    <form className="mdm-panel" onSubmit={save} aria-label={editing ? t('cnd.hin.edit') : t('cnd.hin.new')} data-testid="hin-form">
      <h2>{editing ? t('cnd.hin.edit') : t('cnd.hin.new')}</h2>
      <div className="form-grid">
        <Field label={t('f.site')} name="siteId" error={error}><select value={siteId ?? ''} disabled={Boolean(editing)} onChange={(e) => setF({ ...blank(e.target.value ? Number(e.target.value) : null), ...(f ?? {}), siteId: e.target.value ? Number(e.target.value) : null, activityIds: [], locationIds: [], letterId: '' })} data-testid="hin-site"><option value="">{t('f.chooseSite')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.projectCode} · {s.code} {s.name}</option>)}</select></Field>
        <Field label={t('cnd.hin.titleField')} name="title" error={error}><input value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)} data-testid="hin-title" /></Field>
        <Field label={t('cnd.hin.type')} name="type" error={error}><select value={form.type} onChange={(e) => set('type', e.target.value)} data-testid="hin-type">{HIN_TYPES.map((x) => <option key={x} value={x}>{t(`cnd.hin.t.${x}`)}</option>)}</select></Field>
        <Field label={t('cnd.hin.party')} name="responsibleParty" error={error}><select value={form.responsibleParty} onChange={(e) => set('responsibleParty', e.target.value)} data-testid="hin-party">{PARTIES.map((x) => <option key={x} value={x}>{t(`cnd.hin.p.${x}`)}</option>)}</select></Field>
        <Field label={t('cnd.hin.partyName')} name="responsibleName" error={error}><input value={form.responsibleName} maxLength={120} onChange={(e) => set('responsibleName', e.target.value)} /></Field>
        <Field label={t('cnd.hin.start')} name="startDate" error={error}><input type="date" value={form.startDate} max={today()} onChange={(e) => e.target.value && set('startDate', e.target.value)} data-testid="hin-start" /></Field>
        <Field label={t('cnd.hin.letter')} name="letterId" error={error} hint={t('cnd.hin.letterHint')}><select value={form.letterId} onChange={(e) => set('letterId', e.target.value)} data-testid="hin-letter"><option value="">{t('cnd.hin.noLetter')}</option>{(o?.letters ?? []).map((l) => <option key={l.id} value={l.id}>{l.letterNo} · {l.subject}</option>)}</select></Field>
      </div>
      <Field label={t('cnd.hin.description')} name="description" error={error}><textarea rows={3} value={form.description} maxLength={4000} onChange={(e) => set('description', e.target.value)} data-testid="hin-desc" /></Field>
      <fieldset><legend>{t('cnd.hin.activities')}</legend>
        {oq.isPending && siteId && <Skeleton label={t('cnd.hin.activities')} rows={2} />}
        {o && (o.activities.length === 0 ? <p className="muted">{t('cnd.hin.noActivities')}</p> : <div className="check-list" style={{ maxHeight: 160, overflow: 'auto' }}>{o.activities.map((a) => <label key={a.id} style={{ display: 'block' }}><input type="checkbox" checked={form.activityIds.includes(a.id)} onChange={() => set('activityIds', toggle(form.activityIds, a.id))} /> {a.code} {a.name}</label>)}</div>)}
      </fieldset>
      <fieldset><legend>{t('cnd.hin.locations')}</legend>
        {o && (o.locations.length === 0 ? <p className="muted">{t('cnd.hin.noLocations')}</p> : <div className="check-list" style={{ maxHeight: 120, overflow: 'auto' }}>{o.locations.map((a) => <label key={a.id} style={{ display: 'block' }}><input type="checkbox" checked={form.locationIds.includes(a.id)} onChange={() => set('locationIds', toggle(form.locationIds, a.id))} /> {a.code} {a.name}</label>)}</div>)}
      </fieldset>
      <Field label={t('cnd.hin.otherAffected')} name="text" error={error}><input value={form.text} maxLength={500} onChange={(e) => set('text', e.target.value)} /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="hin-error">{error.form}{error.correlationId ? ` (${error.correlationId})` : ''}</p>}
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={busy} data-testid="hin-save">{t('act.save')}</button><button type="button" className="btn" onClick={onCancel}>{t('cnd.close')}</button></div>
    </form>
  );
}

function Hindrance({ t, id, onGone }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['site', 'hindrance', id], queryFn: () => st.hindrance(id), retry: false });
  const hq = useQuery({ queryKey: ['site', 'hin-history', id], queryFn: () => st.hinHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [talk, setTalk] = useState(false); const [up, setUp] = useState(0); const [comment, setComment] = useState(''); const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false); const [cl, setCl] = useState({ endDate: today(), closureNotes: '' });
  usePageTitle(q.data ? `${q.data.docNo} · ${t('cnd.hin.title')}` : t('cnd.hin.title'));
  if (q.error?.status === 403) return <NoPermission what={t('cnd.hin.title')} permission="site.hindrance.view" />;
  if (q.isPending) return <Skeleton label={t('cnd.hin.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const h = q.data; const can = h.can; const refresh = () => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); };
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('dpr.sayWhy') }); return; } run(() => st.decide(h.taskId, action, comment.trim() || null), t(`dpr.done.${action}`)); };
  const aff = h.affected ?? {};
  if (editing) return <Form t={t} editing={h} onSaved={() => { setEditing(false); refresh(); }} onCancel={() => setEditing(false)} />;
  return (
    <div data-testid="hin-object" data-status={h.status}>
      <PageHeader id="hin-h" title={<>{h.docNo} · {h.title} <StatusBadge status={HIN_TONE[h.status]} label={t(`cnd.hin.s.${h.status}`)} />{h.overdue && <> <StatusBadge status="OVERDUE" label={t('cnd.hin.overdue', { n: h.escalationLevel })} /></>}</>} meta={<><Link to="/site/hindrances">{t('cnd.hin.back')}</Link>{h.revisionNo > 1 && <> · {t('dpr.amendmentOf', { n: h.previous?.docNo ?? '' })}</>}</>} />
      <dl className="kv" data-testid="hin-figures">
        <div><dt>{t('f.site')}</dt><dd>{h.projectCode} · {h.siteCode} {h.siteName}</dd></div><div><dt>{t('cnd.hin.type')}</dt><dd>{t(`cnd.hin.t.${h.type}`)}</dd></div>
        <div><dt>{t('cnd.hin.party')}</dt><dd>{t(`cnd.hin.p.${h.responsibleParty}`)}{h.responsibleName ? ` · ${h.responsibleName}` : ''}</dd></div>
        <div><dt>{t('cnd.hin.start')}</dt><dd>{fmtDate(h.startDate)}</dd></div><div><dt>{t('cnd.hin.end')}</dt><dd>{h.endDate ? fmtDate(h.endDate) : t('cnd.hin.stillOpen')}</dd></div><div><dt>{t('cnd.hin.days')}</dt><dd data-testid="hin-days">{h.ageDays}</dd></div>
        <div><dt>{t('wa.raisedBy')}</dt><dd>{h.requestedBy ?? '—'}</dd></div>{h.approvedAt && <div><dt>{t('wa.approvedBy')}</dt><dd>{h.approvedBy} · {fmtDate(h.approvedAt.slice(0, 10))}</dd></div>}
        {h.closedAt && <div><dt>{t('cnd.hin.closedBy')}</dt><dd>{h.closedBy} · {fmtDate(h.closedAt.slice(0, 10))}</dd></div>}
      </dl>
      {h.description && <p>{h.description}</p>}
      {h.closureNotes && <p data-testid="hin-closure"><strong>{t('cnd.hin.closure')}:</strong> {h.closureNotes}</p>}
      {h.status === 'APPROVED' && <p className="muted" data-testid="hin-locked">{t('cnd.hin.locked')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="hin-obj-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="hin-obj-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <button type="button" className="btn" onClick={() => setEditing(true)} data-testid="hin-edit">{t('act.edit')}</button>}
        {can.submit && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => st.hinAct(h.id, 'submit'), t('act.sent'))} data-testid="hin-submit">{t('act.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => st.hinAct(h.id, 'withdraw', { reason: x }))}>{t('act.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why((x) => st.hinAct(h.id, 'cancel', { reason: x }))} data-testid="hin-cancel">{t('act.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('cnd.hin.deleteAsk')) && await run(() => st.removeHindrance(h.id))) onGone(); }}>{t('act.delete')}</button>}
        {can.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => st.hinAct(h.id, 'amend', { reason: x })); if (n) navigateTo(`/site/hindrances?id=${n.id}`); } }} data-testid="hin-amend">{t('cnd.hin.amend')}</button>}
        {can.close && <button type="button" className="btn btn-primary" onClick={() => setClosing(!closing)} aria-expanded={closing} data-testid="hin-close-open">{t('cnd.hin.close')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => openPrint(`/hindrances/${h.id}/print`).catch(() => null)} data-testid="hin-print">{t('act.print')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/hindrances/${h.id}/pdf`, `${h.docNo.replace(/\W+/g, '-')}.pdf`).catch(() => setError({ form: t('bl.fileFailed') }))} data-testid="hin-pdf">PDF</button>}
        <button type="button" className="btn" onClick={() => setTalk(!talk)} aria-expanded={talk}>{t('act.discussion')}</button>
        {h.workflowInstanceId && <Link to={`/workflow/instance?id=${h.workflowInstanceId}`}>{t('act.approval')}</Link>}
      </div>
      {closing && can.close && (
        <form className="mdm-panel no-print" data-testid="hin-close-form" onSubmit={async (e) => { e.preventDefault(); const x = await run(() => st.hinAct(h.id, 'close', { endDate: cl.endDate, closureNotes: cl.closureNotes.trim() }), t('cnd.hin.closedNote')); if (x) setClosing(false); }}>
          <h2>{t('cnd.hin.close')}</h2><p className="muted">{t('cnd.hin.closeHelp')}</p>
          <div className="form-grid"><Field label={t('cnd.hin.end')} name="endDate"><input type="date" value={cl.endDate} min={h.startDate} max={today()} onChange={(e) => e.target.value && setCl({ ...cl, endDate: e.target.value })} data-testid="hin-close-end" /></Field>
            <Field label={t('cnd.hin.closure')} name="closureNotes"><input value={cl.closureNotes} maxLength={2000} onChange={(e) => setCl({ ...cl, closureNotes: e.target.value })} data-testid="hin-close-notes" /></Field></div>
          <p>{t('cnd.hin.evidenceNow', { n: h.evidence.files })}{h.evidence.letter ? ` · ${h.evidence.letter.letterNo}` : ''}</p>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="hin-close-go">{t('cnd.hin.close')}</button>
        </form>
      )}
      {h.taskId && (
        <div className="mdm-panel no-print" data-testid="hin-decide"><h2>{t('dpr.decide')}</h2>
          <label>{t('mb.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="hin-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('approve')} data-testid="hin-approve">{t('mb.approve')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('return')} data-testid="hin-return">{t('mb.return')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('reject')} data-testid="hin-reject">{t('mb.reject')}</button></div>
        </div>
      )}
      {talk && <div className="mdm-panel"><DiscussionTab entity="site_hindrance" id={h.id} /></div>}
      <div className="mdm-panel" data-testid="hin-affected"><h2>{t('cnd.hin.affected')}</h2>
        {(aff.activities ?? []).length === 0 && (aff.locations ?? []).length === 0 && !aff.text ? <p className="muted">{t('cnd.hin.noneAffected')}</p> : <ul>{(aff.activities ?? []).map((a) => <li key={`a${a.id}`}>{t('cnd.hin.activity')}: {a.code} {a.name}</li>)}{(aff.locations ?? []).map((a) => <li key={`l${a.id}`}>{t('cnd.hin.location')}: {a.code} {a.name}</li>)}{aff.text && <li>{aff.text}</li>}</ul>}
      </div>
      <div className="mdm-panel" data-testid="hin-evidence"><h2>{t('cnd.hin.evidence')}</h2>
        <p data-testid="hin-letter-line">{t('cnd.hin.notifiedBy')}: {h.evidence.letter ? <Link to={`/engg/letters?id=${h.evidence.letter.id}`}>{h.evidence.letter.letterNo} {h.evidence.letter.subject}</Link> : <span className="muted">{t('cnd.hin.noLetter')}</span>}</p>
        <p>{t('cnd.hin.evidenceNow', { n: h.evidence.files })}</p>
        {['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(h.status) && (can.edit || can.close) && <FileUploader entity="site_hindrance" entityId={h.id} onDone={() => { setUp((n) => n + 1); refresh(); }} />}
        <AttachmentList key={up} entity="site_hindrance" entityId={h.id} canEdit={can.edit || can.close} />
      </div>
      <div className="mdm-panel" data-testid="hin-links"><h2>{t('cnd.hin.linked')}</h2>
        <ul>
          <li>{t('cnd.hin.delay')}: {h.delay ? <Link to={`/plan/delays?id=${h.delay.id}`}>{h.delay.docNo} · {h.delay.status} · {h.delay.days} {t('cnd.hin.daysShort')}</Link> : <span className="muted">{t('cnd.hin.noDelay')}</span>}</li>
          <li>{t('cnd.hin.reports')}: {h.dprs.length === 0 ? <span className="muted">{t('cnd.hin.noReports')}</span> : h.dprs.map((d) => <span key={d.id}><Link to={`/site/dprs?id=${d.id}`}>{d.docNo}</Link> ({fmtDate(d.date)}) </span>)}</li>
          {h.revisions.length > 0 && <li>{t('cnd.hin.revisions')}: {h.revisions.map((r) => <span key={r.id}><Link to={`/site/hindrances?id=${r.id}`}>{r.docNo}</Link> ({r.status}) </span>)}</li>}
        </ul>
      </div>
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="hin-history"><caption>{t('wa.history')}</caption><thead><tr><th>{t('wa.when')}</th><th>{t('wa.who')}</th><th>{t('wa.what')}</th><th>{t('wa.note')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((r, i) => <tr key={i}><td>{String(r.at ?? '').slice(0, 16).replace('T', ' ')}</td><td>{r.who}</td><td>{r.what}</td><td>{r.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function HindrancesPage() {
  const t = useT('site'); usePageTitle(t('cnd.hin.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const isNew = sp.get('new') === '1'; const session = useSession(); const perms = session.data?.permissions ?? []; const qc = useQueryClient();
  if (id) return <section aria-labelledby="hin-h" data-testid="site-hindrances"><Hindrance key={id} t={t} id={id} onGone={() => navigateTo('/site/hindrances')} /></section>;
  if (isNew) return <section data-testid="site-hindrances"><PageHeader srOnly title={t('cnd.hin.new')} /><Form t={t} editing={null} onSaved={(h) => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); navigateTo(`/site/hindrances?id=${h.id}`); }} onCancel={() => navigateTo('/site/hindrances')} /></section>;
  return (
    <section aria-labelledby="hin-h" data-testid="site-hindrances">
      <PageHeader id="hin-h" srOnly title={t('cnd.hin.title')} />
      <div className="actions-row no-print">{perms.includes('site.hindrance.create') && <Link to="/site/hindrances?new=1">{t('cnd.hin.new')}</Link>} <Link to="/site/weather">{t('cnd.wx.title')}</Link> <Link to="/site/diary">{t('cnd.diary.title')}</Link></div>
      <ListReport listCode="site.hindrances" endpoint="/site/hindrances" title={t('cnd.hin.title')} session={session.data} rowHref={(r) => `/site/hindrances?id=${r.id}`} onOpen={(r) => navigateTo(`/site/hindrances?id=${r.id}`)}
        cardFields={['docNo', 'title', 'site', 'startDate', 'ageDays']} statusKey="status"
        empty={{ title: t('cnd.hin.emptyTitle'), text: t('cnd.hin.emptyBody') }} />
    </section>
  );
}
