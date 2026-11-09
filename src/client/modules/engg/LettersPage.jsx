import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { LETTER_CATS, dayIST, lt } from './api.js';
import { ProjectSelect } from './parts.jsx';

// Correspondence Register (part 11.05): inward and outward tabs with the overdue-reply filter; an inward letter is registered on this page, an outward one is drafted on its own page.
export default function LettersPage() {
  const t = useT('engg');
  usePageTitle(t('letter.registerTitle'));
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const fp = Number(/filter\[projectId\]=(\d+)/.exec(window.location.search)?.[1]) || null;
  const [tab, setTab] = useState('ALL'); const [overdue, setOverdue] = useState(false); const [open, setOpen] = useState(false); const [error, setError] = useState(null);
  const [f, setF] = useState({ projectId: fp ?? '', theirRef: '', letterDate: dayIST(), party: '', subject: '', category: 'INSTRUCTION', clauseRef: '', responseDue: dayIST(7), assignedTo: '', tags: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const register = async (e) => {
    e.preventDefault(); setError(null);
    try { const r = await lt.create({ projectId: Number(f.projectId), direction: 'IN', theirRef: f.theirRef.trim() || null, letterDate: f.letterDate, party: f.party.trim(), subject: f.subject.trim(), category: f.category, clauseRef: f.clauseRef.trim() || null, responseDue: f.responseDue || null, assignedTo: f.assignedTo.trim() || null, tags: f.tags.trim() || null }); qc.invalidateQueries({ queryKey: ['engg'] }); navigateTo(`/engg/letter?id=${r.id}`); } catch (x) { setError(errorInfo(x)); }
  };
  const ctx = [...(fp ? [{ key: 'projectId', op: 'eq', value: String(fp) }] : []), ...(tab !== 'ALL' ? [{ key: 'direction', op: 'eq', value: tab }] : []), ...(overdue ? [{ key: 'overdue', op: 'eq', value: '1' }] : [])];
  const txt = (k, label, props = {}) => <Field label={label} name={k} error={error}><input value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`lt-f-${k}`} {...props} /></Field>;
  return (
    <section aria-labelledby="lt-list-h" data-testid="eg-letters">
      <h1 id="lt-list-h" className="sr-only">{t('letter.registerTitle')}</h1>
      <div className="actions-row no-print">
        {perms.includes('engg.letter.create') && <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="lt-new-in">{t('letter.registerInward')}</button>}
        {perms.includes('engg.letter.create') && <button type="button" className="btn" onClick={() => navigateTo('/engg/letter-draft')} data-testid="lt-new-out">{t('letter.draftOutward')}</button>}
        <Link to="/engg/time-bars">{t('tb.title')}</Link>
      </div>
      <div role="group" aria-label={t('letter.direction')} className="actions-row" data-testid="lt-tabs">
        {[['ALL', 'letter.all'], ['IN', 'letter.inward'], ['OUT', 'letter.outward']].map(([k, label]) => <button key={k} type="button" className={`btn${tab === k ? ' btn-primary' : ''}`} aria-pressed={tab === k} onClick={() => setTab(k)} data-testid={`lt-tab-${k}`}>{t(label)}</button>)}
        <label><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} data-testid="lt-overdue" /> {t('letter.overdueOnly')}</label>
      </div>
      {open && (
        <form className="mdm-panel" aria-label={t('letter.registerInward')} data-testid="lt-new-form" onSubmit={register}>
          <h2>{t('letter.registerInward')}</h2>
          <div className="form-grid">
            <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} required testId="lt-f-project" error={error} />
            {txt('theirRef', t('letter.theirRef'), { maxLength: 120 })}
            <Field label={t('letter.date')} name="letterDate" error={error}><input type="date" value={f.letterDate} onChange={(e) => set('letterDate', e.target.value)} data-testid="lt-f-letterDate" /></Field>
            {txt('party', t('letter.party'), { required: true, maxLength: 160 })}{txt('subject', t('letter.subject'), { required: true, maxLength: 300 })}
            <Field label={t('letter.category')} name="category" error={error}><select value={f.category} onChange={(e) => set('category', e.target.value)} data-testid="lt-f-category">{LETTER_CATS.map((k) => <option key={k} value={k}>{t(`lcat.${k}`)}</option>)}</select></Field>
            {txt('clauseRef', t('letter.clause'), { maxLength: 120 })}
            <Field label={t('letter.responseDue')} name="responseDue" error={error}><input type="date" value={f.responseDue} onChange={(e) => set('responseDue', e.target.value)} data-testid="lt-f-responseDue" /></Field>
            {txt('assignedTo', t('letter.assignedTo'), { maxLength: 60 })}{txt('tags', t('letter.tags'), { maxLength: 300 })}
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="lt-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || f.party.trim().length < 2 || f.subject.trim().length < 3} data-testid="lt-register">{t('letter.register')}</button></div>
        </form>
      )}
      <ListReport key={`${tab}-${overdue}`} listCode="engg.letters" endpoint="/engg/letters" title={t('letter.registerTitle')} session={session.data} rowHref={(r) => `/engg/letter?id=${r.id}`} onOpen={(r) => navigateTo(`/engg/letter?id=${r.id}`)} cardFields={['letterNo', 'subject', 'party', 'statusLabel']} statusKey="statusLabel"
        empty={{ title: t('letter.emptyTitle'), text: t('letter.emptyBody') }} contextFilters={ctx} />
    </section>
  );
}
