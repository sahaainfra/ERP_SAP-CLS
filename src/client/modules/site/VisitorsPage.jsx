import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { VISITOR_TYPES, st, today } from './api.js';
import { useSearch } from './parts.jsx';

// Visitor Log (part 14.03, FR-04): the visits of officials, the client and the consultant with the purpose, the instructions given and the letter that announced or followed the visit.
const blank = (siteId) => ({ siteId, date: today(), timeIn: '', timeOut: '', visitorName: '', organisation: '', visitorType: 'OFFICIAL', purpose: '', instructions: '', linkedLetterId: '' });
const fromRecord = (v) => ({ siteId: v.siteId, date: v.date, timeIn: v.timeIn ?? '', timeOut: v.timeOut ?? '', visitorName: v.visitorName, organisation: v.organisation ?? '', visitorType: v.visitorType, purpose: v.purpose, instructions: v.instructions ?? '', linkedLetterId: v.linkedLetterId ?? '' });
const body = (f, withKey) => ({ ...(withKey ? { siteId: f.siteId, date: f.date } : {}), timeIn: f.timeIn || null, timeOut: f.timeOut || null, visitorName: f.visitorName.trim(), organisation: f.organisation.trim() || null, visitorType: f.visitorType, purpose: f.purpose.trim(), instructions: f.instructions.trim() || null, linkedLetterId: f.linkedLetterId ? Number(f.linkedLetterId) : null });

function Form({ t, sites, editing, onDone }) {
  const [f, setF] = useState(editing ? fromRecord(editing) : blank(sites.length === 1 ? sites[0].id : null)); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const oq = useQuery({ queryKey: ['site', 'hin-options', f.siteId], queryFn: () => st.hinOptions(f.siteId), enabled: Boolean(f.siteId), retry: false });
  const save = async (e) => { e.preventDefault(); setError(null); if (!f.siteId) { setError({ form: t('f.chooseSite'), fields: { siteId: t('f.chooseSite') } }); return; } setBusy(true); try { const v = editing ? await st.updateVisitor(editing.id, { ...body(f, false), rowVersion: editing.rowVersion }) : await st.createVisitor(body(f, true)); if (!editing) setF(blank(f.siteId)); onDone(v); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <form className="mdm-panel" onSubmit={save} aria-label={editing ? t('cnd.vis.edit') : t('cnd.vis.new')} data-testid="vis-form">
      <h2>{editing ? t('cnd.vis.edit') : t('cnd.vis.new')}</h2>
      <div className="form-grid">
        <Field label={t('f.site')} name="siteId" error={error}><select value={f.siteId ?? ''} disabled={Boolean(editing)} onChange={(e) => set('siteId', e.target.value ? Number(e.target.value) : null)} data-testid="vis-site"><option value="">{t('f.chooseSite')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.projectCode} · {s.code} {s.name}</option>)}</select></Field>
        <Field label={t('f.date')} name="date" error={error}><input type="date" value={f.date} max={today()} disabled={Boolean(editing)} onChange={(e) => e.target.value && set('date', e.target.value)} data-testid="vis-date" /></Field>
        <Field label={t('cnd.vis.name')} name="visitorName" error={error}><input value={f.visitorName} maxLength={120} onChange={(e) => set('visitorName', e.target.value)} data-testid="vis-name" /></Field>
        <Field label={t('cnd.vis.organisation')} name="organisation" error={error}><input value={f.organisation} maxLength={160} onChange={(e) => set('organisation', e.target.value)} data-testid="vis-org" /></Field>
        <Field label={t('cnd.vis.type')} name="visitorType" error={error}><select value={f.visitorType} onChange={(e) => set('visitorType', e.target.value)} data-testid="vis-type">{VISITOR_TYPES.map((x) => <option key={x} value={x}>{t(`cnd.vis.t.${x}`)}</option>)}</select></Field>
        <Field label={t('cnd.vis.timeIn')} name="timeIn" error={error}><input type="time" value={f.timeIn} onChange={(e) => set('timeIn', e.target.value)} /></Field>
        <Field label={t('cnd.vis.timeOut')} name="timeOut" error={error}><input type="time" value={f.timeOut} onChange={(e) => set('timeOut', e.target.value)} /></Field>
        <Field label={t('cnd.vis.letter')} name="linkedLetterId" error={error}><select value={f.linkedLetterId} onChange={(e) => set('linkedLetterId', e.target.value)} data-testid="vis-letter"><option value="">{t('cnd.hin.noLetter')}</option>{(oq.data?.letters ?? []).map((l) => <option key={l.id} value={l.id}>{l.letterNo} · {l.subject}</option>)}</select></Field>
      </div>
      <Field label={t('cnd.vis.purpose')} name="purpose" error={error}><input value={f.purpose} maxLength={500} onChange={(e) => set('purpose', e.target.value)} data-testid="vis-purpose" /></Field>
      <Field label={t('cnd.vis.instructions')} name="instructions" error={error}><textarea rows={3} value={f.instructions} maxLength={2000} onChange={(e) => set('instructions', e.target.value)} data-testid="vis-instructions" /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="vis-error">{error.form}{error.correlationId ? ` (${error.correlationId})` : ''}</p>}
      <div className="actions-row">
        {(!editing || editing.can.edit) && <button type="submit" className="btn btn-primary" disabled={busy} data-testid="vis-save">{t('act.save')}</button>}
        {editing?.can.delete && <button type="button" className="btn" disabled={busy} onClick={async () => { if (window.confirm(t('cnd.vis.deleteAsk'))) { setBusy(true); try { await st.removeVisitor(editing.id); onDone(null); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } } }}>{t('act.delete')}</button>}
        {editing && <button type="button" className="btn" onClick={() => onDone(null)}>{t('cnd.close')}</button>}
      </div>
    </form>
  );
}

export default function VisitorsPage() {
  const t = useT('site'); usePageTitle(t('cnd.vis.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? []; const qc = useQueryClient();
  const sitesQ = useQuery({ queryKey: ['site', 'vis-sites'], queryFn: st.visSites, retry: false });
  const rq = useQuery({ queryKey: ['site', 'visitor', id], queryFn: () => st.visitor(id), enabled: Boolean(id), retry: false });
  if (sitesQ.error?.status === 403) return <NoPermission what={t('cnd.vis.title')} permission="site.visitor.view" />;
  if (sitesQ.isPending) return <Skeleton label={t('cnd.vis.title')} rows={5} />;
  if (sitesQ.isError) return <ErrorState error={sitesQ.error} onRetry={sitesQ.refetch} />;
  const sites = sitesQ.data; const done = () => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); if (id) navigateTo('/site/visitors'); };
  return (
    <section aria-labelledby="vis-h" data-testid="site-visitors">
      <h1 id="vis-h">{t('cnd.vis.title')}</h1><p className="muted">{t('cnd.vis.intro')}</p>
      {id && rq.isPending && <Skeleton label={t('cnd.vis.edit')} rows={3} />}
      {id && rq.isError && <ErrorState error={rq.error} onRetry={rq.refetch} />}
      {id && rq.data && <Form key={`${rq.data.id}-${rq.data.rowVersion}`} t={t} sites={sites} editing={rq.data} onDone={done} />}
      {!id && perms.includes('site.visitor.create') && <Form t={t} sites={sites.filter((s) => s.canCreate)} editing={null} onDone={done} />}
      <ListReport listCode="site.visitors" endpoint="/site/visitors" title={t('cnd.vis.title')} session={session.data} rowHref={(r) => `/site/visitors?id=${r.id}`} onOpen={(r) => navigateTo(`/site/visitors?id=${r.id}`)}
        cardFields={['date', 'visitor', 'organisation', 'purpose']}
        empty={{ title: t('cnd.vis.emptyTitle'), text: t('cnd.vis.emptyBody') }} />
      <p className="muted small">{t('cnd.links')} <Link to="/site/diary">{t('cnd.diary.title')}</Link> · <Link to="/site/hindrances">{t('cnd.hin.title')}</Link> · <Link to="/site/dprs">{t('dpr.register')}</Link></p>
    </section>
  );
}
