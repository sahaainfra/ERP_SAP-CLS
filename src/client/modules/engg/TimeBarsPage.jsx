import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useSession } from '../core/api/index.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, lt } from './api.js';
import { ProjectSelect } from './parts.jsx';

// Notices and Time Bars (part 11.05, FR-04): notices the contract requires within a time limit, with the days left, the alerts, and the letter that served them.
export default function TimeBarsPage() {
  const t = useT('engg');
  usePageTitle(t('tb.title'));
  const qc = useQueryClient();
  const perms = useSession().data?.permissions ?? [];
  const [projectId, setProjectId] = useState(''); const [open, setOpen] = useState(false); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [f, setF] = useState({ projectId: '', description: '', clauseRef: '', eventDate: dayIST(-1), limitDays: 28, claimRef: '', ownerUser: '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const q = useQuery({ queryKey: ['engg', 'time-bars', projectId], queryFn: () => lt.bars(projectId), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('tb.title')} permission="engg.letter.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(typeof done === 'function' ? done(x) : done); qc.invalidateQueries({ queryKey: ['engg'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const create = (e) => { e.preventDefault(); run(async () => { await lt.createBar({ projectId: Number(f.projectId), description: f.description.trim(), clauseRef: f.clauseRef.trim() || null, eventDate: f.eventDate, limitDays: Number(f.limitDays), claimRef: f.claimRef.trim() || null, ownerUser: f.ownerUser.trim() || null }); setOpen(false); }, t('tb.created')); };
  const d = q.data;
  return (
    <section aria-labelledby="tb-h" data-testid="eg-timebars">
      <h1 id="tb-h">{t('tb.title')}</h1>
      <div className="actions-row no-print">
        {perms.includes('engg.letter.create') && <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="tb-new">{t('tb.new')}</button>}
        {perms.includes('engg.letter.approve') && <button type="button" className="btn" onClick={() => run(() => lt.alerts(), (r) => t('tb.alertsRun', { alerts: r.timeBarAlerts.length, lapsed: r.lapsed.length, overdue: r.replyOverdue.length }))} data-testid="tb-run">{t('tb.runAlerts')}</button>}
        <Link to="/engg/letters">{t('nav.letters')}</Link>
      </div>
      {error?.form && <p className="field-error" role="alert" data-testid="tb-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="tb-note">{note}</p>}
      {open && (
        <form className="mdm-panel" aria-label={t('tb.new')} data-testid="tb-form" onSubmit={create}>
          <h2>{t('tb.new')}</h2>
          <div className="form-grid">
            <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} required testId="tb-f-project" error={error} />
            <Field label={t('tb.description')} name="description" error={error}><input value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={500} data-testid="tb-f-description" /></Field>
            <Field label={t('letter.clause')} name="clauseRef" error={error}><input value={f.clauseRef} onChange={(e) => set('clauseRef', e.target.value)} maxLength={120} data-testid="tb-f-clause" /></Field>
            <Field label={t('tb.eventDate')} name="eventDate" error={error}><input type="date" value={f.eventDate} onChange={(e) => set('eventDate', e.target.value)} data-testid="tb-f-event" /></Field>
            <Field label={t('tb.limitDays')} name="limitDays" error={error}><input type="number" min="1" value={f.limitDays} onChange={(e) => set('limitDays', e.target.value)} data-testid="tb-f-days" /></Field>
            <Field label={t('tb.claim')} name="claimRef" error={error}><input value={f.claimRef} onChange={(e) => set('claimRef', e.target.value)} maxLength={120} /></Field>
            <Field label={t('tb.owner')} name="ownerUser" error={error}><input value={f.ownerUser} onChange={(e) => set('ownerUser', e.target.value)} maxLength={60} data-testid="tb-f-owner" /></Field>
          </div>
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || f.description.trim().length < 5} data-testid="tb-create">{t('tb.create')}</button></div>
        </form>
      )}
      <ProjectSelect value={projectId} onChange={setProjectId} allowAll testId="tb-filter" />
      {q.isPending ? <Skeleton label={t('tb.title')} rows={3} /> : (
        <>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))', gap: '0.75rem' }} data-testid="tb-counts">
            {['open', 'critical', 'warning', 'lapsed', 'served'].map((k) => <li key={k} className="mdm-panel" data-testid={`tb-count-${k}`} data-value={d.counts[k]}><strong style={{ fontSize: '1.5rem' }}>{d.counts[k]}</strong><br /><span className="muted">{t(`tb.count.${k}`)}</span></li>)}
          </ul>
          <div className="mdm-panel" data-testid="tb-list"><h2>{t('tb.list')}</h2>
            {d.rows.length === 0 ? <p className="muted">{t('tb.none')}</p> : (
              <div className="table-scroll"><table><thead><tr><th>{t('col.docNo')}</th><th>{t('tb.description')}</th><th>{t('letter.clause')}</th><th>{t('tb.deadline')}</th><th>{t('tb.daysLeft')}</th><th>{t('col.status')}</th><th>{t('tb.owner')}</th></tr></thead>
                <tbody>{d.rows.map((b) => <tr key={b.id} data-testid={`tb-row-${b.barNo}`} data-status={b.status} data-urgency={b.urgency}><td>{b.barNo}</td><td>{b.description}</td><td>{b.clauseRef ?? '—'}</td><td>{b.deadline}</td><td>{b.daysLeft ?? '—'}</td><td>{t(`tbs.${b.status}`)}{b.servedOn ? ` (${b.servedOn})` : ''}</td><td>{b.ownerUser ?? '—'}</td></tr>)}</tbody></table></div>
            )}</div>
        </>
      )}
    </section>
  );
}
