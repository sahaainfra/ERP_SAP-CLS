import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { TEAM_TONE, dayIST, tm } from './api.js';
import ProjectPicker from './ProjectPicker.jsx';
import { useSearch } from './parts.jsx';

// Project Team (part 10.05, FR-01, BR-01): the members of a project with their project role and dates. Adding a person is a request approved by the project manager and the project director; the approved membership asks the role engine for the
// scoped role (it has its own approval), and the person then holds the role on this project. Ending a membership ends the role for the project.
export default function TeamPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  usePageTitle(t('team.title'));
  const projectId = Number(useSearch().get('projectId')) || null;
  const q = useQuery({ queryKey: ['proj', 'team', projectId], queryFn: () => tm.team(projectId), enabled: Boolean(projectId), retry: false });
  const [open, setOpen] = useState(false); const [f, setF] = useState({ username: '', projectRole: '', fromDate: dayIST(), toDate: '', reason: '' }); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const head = <><h1 id="team-h">{t('team.title')}</h1><p className="muted">{t('team.intro')}</p><ProjectPicker route="/proj/team" projectId={projectId} testId="team-project" /></>;
  if (!projectId) return <section aria-labelledby="team-h" data-testid="team-none">{head}</section>;
  if (q.error?.status === 403) return <NoPermission what={t('team.title')} permission="proj.team.view" />;
  if (q.isPending) return <Skeleton label={t('team.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  return (
    <section aria-labelledby="team-h" data-testid="team">
      {head}
      {error?.form && <p className="field-error" role="alert" data-testid="team-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="team-note">{note}</p>}
      {d.can.manage && <div className="actions-row no-print"><button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="team-add">{t('team.add')}</button></div>}
      {open && (
        <form className="mdm-panel" aria-label={t('team.add')} data-testid="team-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => tm.addMember({ projectId, username: f.username, projectRole: f.projectRole, fromDate: f.fromDate, ...(f.toDate ? { toDate: f.toDate } : {}), reason: f.reason.trim() }), t('team.requested'))) { setOpen(false); setF({ username: '', projectRole: '', fromDate: dayIST(), toDate: '', reason: '' }); } }}>
          <h2>{t('team.add')}</h2><p className="small muted">{t('team.addHelp')}</p>
          <div className="form-grid">
            <LookupField id="team-user" label={t('team.person')} lookup="proj/people" valueKey="code" value={f.username} onChange={(v) => set('username', v)} required />
            <Field label={t('team.role')} name="projectRole" error={error}><select value={f.projectRole} onChange={(e) => set('projectRole', e.target.value)} required data-testid="team-role"><option value="">—</option>{d.roles.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}</select></Field>
            <Field label={t('team.from')} name="fromDate" error={error}><input type="date" value={f.fromDate} onChange={(e) => set('fromDate', e.target.value)} required data-testid="team-from" /></Field>
            <Field label={t('team.to')} name="toDate" error={error}><input type="date" value={f.toDate} onChange={(e) => set('toDate', e.target.value)} data-testid="team-to" /></Field>
          </div>
          <Field label={t('wbs.reason')} name="reason" error={error}><textarea rows={2} value={f.reason} onChange={(e) => set('reason', e.target.value)} required minLength={5} data-testid="team-reason" /></Field>
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.username || !f.projectRole} data-testid="team-send">{t('team.send')}</button></div>
        </form>
      )}
      {d.members.length === 0 ? <div className="mdm-banner" data-testid="team-empty"><strong>{t('team.emptyTitle')}</strong> {t('team.emptyText')}</div> : (
        <div className="table-wrap" data-testid="team-table"><table className="data-table"><caption className="sr-only">{t('team.title')}</caption>
          <thead><tr><th scope="col">{t('team.person')}</th><th scope="col">{t('team.role')}</th><th scope="col">{t('team.period')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('team.access')}</th><th scope="col" className="no-print">{t('wbs.actions')}</th></tr></thead>
          <tbody>{d.members.map((m) => (
            <tr key={m.id} data-testid="team-row" data-user={m.username} data-status={m.status}>
              <td>{m.displayName} <span className="muted small">({m.username})</span></td><td>{m.projectRole}</td><td>{m.fromDate} → {m.toDate ?? '…'}</td><td><StatusBadge status={TEAM_TONE[m.status]} label={m.statusLabel} /></td>
              <td data-testid="team-access">{m.access ? t(`team.access.${m.access}`) : '—'}{m.accessNote ? <span className="muted small"> · {m.accessNote}</span> : null}</td>
              <td className="no-print">
                {m.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => tm.teamAct(m.id, 'withdraw', { reason: r }), t('bq.withdrawn'))}>{t('act.withdraw')}</button>}
                {m.can.cancel && <button type="button" className="btn" onClick={() => why((r) => tm.teamAct(m.id, 'cancel', { reason: r }), t('bq.cancelled'))}>{t('bl.cancel')}</button>}
                {m.can.end && <button type="button" className="btn" onClick={() => why((r) => tm.teamAct(m.id, 'end', { reason: r }), t('team.ended'))} data-testid={`team-end-${m.username}`}>{t('team.end')}</button>}
              </td>
            </tr>))}</tbody></table></div>
      )}
      <p className="small"><Link to={`/proj/stakeholders?projectId=${projectId}`}>{t('stk.title')}</Link> · <Link to="/proj/meetings">{t('mtg.listTitle')}</Link></p>
    </section>
  );
}
