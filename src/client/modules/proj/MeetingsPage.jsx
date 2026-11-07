import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { MTYPES, dayIST, st, tm } from './api.js';

// Meetings (part 10.05, FR-04): the meetings of every project with their type, date, chair and the status of their minutes; a new meeting starts with its details, the agenda is added on the meeting page.
export default function MeetingsPage() {
  const t = useT('proj');
  usePageTitle(t('mtg.listTitle'));
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const [open, setOpen] = useState(false); const [error, setError] = useState(null);
  const [f, setF] = useState({ projectId: '', mtype: 'WEEKLY_PROGRESS', title: '', meetingDate: dayIST(), location: '', chairUser: '', minuteTaker: '' });
  const pq = useQuery({ queryKey: ['proj', 'picker'], queryFn: st.projects, retry: false, enabled: open });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const create = async (e) => {
    e.preventDefault(); setError(null);
    try { const r = await tm.createMeeting({ projectId: Number(f.projectId), mtype: f.mtype, title: f.title.trim(), meetingDate: f.meetingDate, location: f.location || null, chairUser: f.chairUser, minuteTaker: f.minuteTaker, attendees: [], agenda: [], decisions: [], actions: [] }); qc.invalidateQueries({ queryKey: ['proj'] }); navigateTo(`/proj/meeting?id=${r.id}`, { force: true }); } catch (x) { setError(errorInfo(x)); }
  };
  return (
    <section aria-labelledby="mtg-list-h" data-testid="meetings">
      <h1 id="mtg-list-h" className="sr-only">{t('mtg.listTitle')}</h1>
      <div className="actions-row no-print">
        {perms.includes('proj.meeting.create') && <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="mtg-new">{t('mtg.new')}</button>}
        <Link to="/proj/action-tracker">{t('trk.title')}</Link>
      </div>
      {open && (
        <form className="mdm-panel" aria-label={t('mtg.new')} data-testid="mtg-new-form" onSubmit={create}>
          <h2>{t('mtg.new')}</h2>
          <div className="form-grid">
            <Field label={t('st.project')} name="projectId" error={error}><select value={f.projectId} onChange={(e) => set('projectId', e.target.value)} required data-testid="mtg-f-project"><option value="">{t('st.chooseProject')}</option>{(pq.data ?? []).map((p) => <option key={p.projectId} value={p.projectId}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label={t('f.type')} name="mtype" error={error}><select value={f.mtype} onChange={(e) => set('mtype', e.target.value)} data-testid="mtg-f-type">{MTYPES.map((k) => <option key={k} value={k}>{t(`mtg.type.${k}`)}</option>)}</select></Field>
            <Field label={t('mtg.titleField')} name="title" error={error}><input value={f.title} onChange={(e) => set('title', e.target.value)} required maxLength={200} data-testid="mtg-f-title" /></Field>
            <Field label={t('mtg.date')} name="meetingDate" error={error}><input type="date" value={f.meetingDate} onChange={(e) => set('meetingDate', e.target.value)} required data-testid="mtg-f-date" /></Field>
            <Field label={t('mtg.location')} name="location" error={error}><input value={f.location} onChange={(e) => set('location', e.target.value)} maxLength={200} /></Field>
            <LookupField id="mtg-f-chair" label={t('mtg.chair')} lookup="proj/people" valueKey="code" value={f.chairUser} onChange={(v) => set('chairUser', v)} required />
            <LookupField id="mtg-f-taker" label={t('mtg.minuteTaker')} lookup="proj/people" valueKey="code" value={f.minuteTaker} onChange={(v) => set('minuteTaker', v)} required />
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="mtg-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || !f.title.trim() || !f.chairUser || !f.minuteTaker} data-testid="mtg-f-create">{t('mtg.create')}</button></div>
        </form>
      )}
      <ListReport listCode="proj.meetings" endpoint="/proj/meetings" title={t('mtg.listTitle')} session={session.data} rowHref={(r) => `/proj/meeting?id=${r.id}`} onOpen={(r) => navigateTo(`/proj/meeting?id=${r.id}`)} cardFields={['ref', 'title', 'meetingDate', 'statusLabel']} empty={{ title: t('mtg.emptyTitle'), text: t('mtg.emptyText') }} />
    </section>
  );
}
