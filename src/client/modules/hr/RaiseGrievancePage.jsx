import { useState } from 'react';
import { useT } from '../../platform/i18n/index.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { errorInfo, Field, Link, navigateTo, useOneAtATime, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { ext } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Raise Grievance (HR, part 07.13, FR-06, mobile): the category, a subject and what happened; it can be anonymous: then no identity is kept and the person gets a tracking code, shown once, to follow it. A supervisor who sees the labour register
// can raise one for a worker. HR is told; harassment and safety have a shorter time to resolve.
const CATS = ['WAGES', 'WORKING_CONDITIONS', 'SAFETY', 'HARASSMENT', 'DISCRIMINATION', 'LEAVE', 'ACCOMMODATION', 'SUPERVISOR', 'OTHER'];
export default function RaiseGrievancePage() {
  const t = useT('sep');
  usePageTitle(t('grv.raise'));
  const session = useSession();
  const canWorker = (session.data?.permissions ?? []).includes('hr.worker.view');
  const [v, setV] = useState({ category: 'WAGES', subject: '', description: '', anonymous: false, forWorker: false, workerId: '' });
  const [error, setError] = useState(null); const [done, setDone] = useState(null);
  const once = useOneAtATime(); // one send at a time: a double click does not raise two grievances
  const send = once(async (submit) => {
    setError(null);
    try {
      const r = await ext.createGrievance({ category: v.category, subject: v.subject.trim(), description: v.description.trim(), anonymous: v.anonymous, complainantType: v.forWorker ? 'WORKER' : 'EMPLOYEE', ...(v.forWorker ? { workerId: Number(v.workerId) } : {}), submit: v.anonymous ? true : submit });
      if (v.anonymous) setDone(r); else navigateTo(`/grievances/grievance?id=${r.id}`, { force: true });
    } catch (x) { setError(errorInfo(x)); }
  });
  if (done) return (
    <section aria-labelledby="rg-title" data-testid="raise-grievance">
      <PageHeader id="rg-title" title={t('grv.raise')} />
      <div className="mdm-panel" role="status" data-testid="rg-done"><p>{t('grv.sentAnon', { no: done.docNo })}</p><p className="exp-code" data-testid="rg-code">{done.trackingCode}</p><p className="muted">{t('grv.keepCode')}</p></div>
      <p className="small"><Link to="/grievances">{t('grv.title')}</Link></p>
    </section>
  );
  return (
    <section aria-labelledby="rg-title" data-testid="raise-grievance">
      <PageHeader id="rg-title" title={t('grv.raise')} />
      {error?.form && <p className="field-error" role="alert" data-testid="rg-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); send(true); }} data-testid="rg-form" aria-label={t('grv.raise')}>
        <Field label={t('grv.category')} name="category" error={error}><select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} data-testid="rg-category">{CATS.map((c) => <option key={c} value={c}>{t(`gcat.${c}`)}</option>)}</select></Field>
        <Field label={t('grv.subject')} name="subject" error={error}><input value={v.subject} maxLength={150} onChange={(e) => setV({ ...v, subject: e.target.value })} required data-testid="rg-subject" /></Field>
        <Field label={t('grv.description')} name="description" error={error}><textarea rows="5" value={v.description} maxLength={4000} onChange={(e) => setV({ ...v, description: e.target.value })} required data-testid="rg-description" /></Field>
        {canWorker && <label className="check"><input type="checkbox" checked={v.forWorker} onChange={(e) => setV({ ...v, forWorker: e.target.checked, anonymous: false })} data-testid="rg-worker" /> {t('grv.forWorker')}</label>}
        {v.forWorker && <LookupField id="rg-worker-id" label={t('grv.worker')} lookup="hr/workers" value={v.workerId} onChange={(x) => setV({ ...v, workerId: x })} required />}
        {!v.forWorker && <label className="check"><input type="checkbox" checked={v.anonymous} onChange={(e) => setV({ ...v, anonymous: e.target.checked })} data-testid="rg-anonymous" /> {t('grv.anonymous')}</label>}
        {v.anonymous && <p className="muted small">{t('grv.anonHint')}</p>}
        <div className="actions">{!v.anonymous && <button type="button" className="btn" onClick={() => send(false)} data-testid="rg-save">{t('act.saveDraft')}</button>}<button type="submit" className="btn btn-primary" data-testid="rg-send">{t('act.send')}</button></div>
      </form>
      <p className="small"><Link to="/grievances">{t('grv.title')}</Link></p>
    </section>
  );
}
