import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { perf } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Goal Setting (HR, part 07.11, FR-02): the goals of the person for the cycle, each with a measure, a target and a weight (together at most 100%). The person writes them and sends them to the manager, who agrees or returns them with a note;
// a goal the manager sets is agreed at once. After agreement the person records the progress. A manager can look at the goals of a person who reports to them.
const TONE = { DRAFT: 'DRAFT', PROPOSED: 'IN_REVIEW', AGREED: 'COMPLETED', RETURNED: 'RETURNED' };
export default function GoalSettingPage() {
  const t = useT('prf');
  usePageTitle(t('goal.title'));
  const qc = useQueryClient();
  const [who, setWho] = useState('');
  const q = useQuery({ queryKey: ['perf', 'goals', who], queryFn: () => perf.goals({ employeeId: who || undefined }), retry: false });
  const [v, setV] = useState({ title: '', measure: '', target: '', weight: '20' });
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what={t('goal.title')} permission="hr.perf.own" />;
  const d = q.data;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['perf'] }); } catch (e) { setError(errorInfo(e)); } };
  const save = (e) => {
    e.preventDefault();
    const body = { title: v.title.trim(), measure: v.measure.trim() || null, target: v.target.trim() || null, weight: Number(v.weight) };
    run(async () => { if (edit) await perf.updateGoal(edit.id, { ...body, version: edit.rowVersion }); else await perf.createGoal({ ...body, cycleId: d.cycle.id, employeeId: who ? Number(who) : undefined }); setEdit(null); setV({ title: '', measure: '', target: '', weight: '20' }); }, t('goal.saved'));
  };
  return (
    <section aria-labelledby="gs-title" data-testid="goals">
      <PageHeader id="gs-title" title={t('goal.title')} />
      <div className="mdm-fields no-print"><LookupField id="gs-who" label={t('goal.for')} lookup="hr/employees" value={who} onChange={setWho} hint={t('goal.forHint')} /></div>
      {error?.form && <p className="field-error" role="alert" data-testid="gs-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="gs-note">{note}</p>}
      {q.isPending ? <Skeleton label={t('goal.title')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d.cycle ? <EmptyState title={t('my.noCycle')} message="" /> : (
        <>
          <p className="muted">{d.cycle.name} · {t('goal.left', { n: d.weightLeft })}</p>
          {d.goals.length === 0 ? <p className="muted" data-testid="gs-none">{t('goal.none')}</p> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t('goal.title')}>
              <table className="grid" data-testid="gs-table"><thead><tr><th>{t('goal.goal')}</th><th>{t('goal.target')}</th><th>{t('my.weight')}</th><th>{t('goal.progress')}</th><th>{t('s.status')}</th><th><span className="sr-only">{t('act.actions')}</span></th></tr></thead>
                <tbody>{d.goals.map((g) => (
                  <tr key={g.id} data-testid="gs-row" data-status={g.status}>
                    <th scope="row" data-label={t('goal.goal')}>{g.title}{g.managerNote ? <span className="muted small"> · {g.managerNote}</span> : null}</th><td data-label={t('goal.target')}>{g.target ?? g.measure ?? '—'}</td><td data-label={t('my.weight')}>{g.weight}%</td>
                    <td data-label={t('goal.progress')}>{g.can.progress ? <input type="number" min="0" max="100" defaultValue={g.progress} aria-label={`${t('goal.progress')} ${g.title}`} onBlur={(e) => Number(e.target.value) !== g.progress && run(() => perf.goalAct(g.id, 'progress', { progress: Number(e.target.value) }), t('goal.saved'))} data-testid="gs-progress" /> : `${g.progress}%`}</td>
                    <td data-label={t('s.status')}><StatusBadge status={TONE[g.status]} label={t(`goal.st.${g.status}`)} /></td>
                    <td data-label={t('act.actions')}>
                      {g.can.edit && <button type="button" className="btn btn-small" onClick={() => { setEdit(g); setV({ title: g.title, measure: g.measure ?? '', target: g.target ?? '', weight: String(g.weight) }); }} data-testid="gs-edit">{t('act.edit')}</button>}{' '}
                      {g.can.propose && <button type="button" className="btn btn-small btn-primary" onClick={() => run(() => perf.goalAct(g.id, 'propose'), t('goal.sent'))} data-testid="gs-propose">{t('goal.send')}</button>}{' '}
                      {g.can.delete && <button type="button" className="btn btn-small" onClick={() => run(() => perf.removeGoal(g.id))} data-testid="gs-delete">×</button>}
                      {g.can.agree && <button type="button" className="btn btn-small btn-primary" onClick={() => run(() => perf.goalAct(g.id, 'agree'), t('goal.agreedNote'))} data-testid="gs-agree">{t('goal.agree')}</button>}{' '}
                      {g.can.return && <button type="button" className="btn btn-small" onClick={() => { const why = window.prompt(t('goal.why')); if (why) run(() => perf.goalAct(g.id, 'return', { reason: why }), t('goal.returned')); }} data-testid="gs-return">{t('goal.giveBack')}</button>}
                    </td>
                  </tr>))}</tbody></table>
            </div>
          )}
          <form className="mdm-panel mdm-fields" onSubmit={save} data-testid="gs-form" aria-label={edit ? t('act.edit') : t('goal.add')}>
            <h2>{edit ? t('act.edit') : t('goal.add')}</h2>
            <Field label={t('goal.goal')} name="title" error={error}><input value={v.title} maxLength={150} onChange={(e) => setV({ ...v, title: e.target.value })} required data-testid="gs-title" /></Field>
            <Field label={t('goal.measure')} name="measure" error={error}><input value={v.measure} maxLength={200} onChange={(e) => setV({ ...v, measure: e.target.value })} data-testid="gs-measure" /></Field>
            <Field label={t('goal.target')} name="target" error={error}><input value={v.target} maxLength={200} onChange={(e) => setV({ ...v, target: e.target.value })} data-testid="gs-target" /></Field>
            <Field label={t('my.weight')} name="weight" error={error}><input type="number" min="1" max="100" value={v.weight} onChange={(e) => setV({ ...v, weight: e.target.value })} required data-testid="gs-weight" /></Field>
            <div className="actions">{edit && <button type="button" className="btn" onClick={() => { setEdit(null); setV({ title: '', measure: '', target: '', weight: '20' }); }}>{t('act.close')}</button>}<button type="submit" className="btn btn-primary" data-testid="gs-save">{t('act.save')}</button></div>
          </form>
        </>
      )}
      <p className="small"><Link to="/performance">{t('my.title')}</Link> · <Link to="/performance/team">{t('team.title')}</Link></p>
    </section>
  );
}
