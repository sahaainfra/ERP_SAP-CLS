import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { CONSTRAINT_TYPES, fmtDate, pl } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';

// Constraint Log (part 13.04, FR-02, BR-02): what stops an activity, with its owner and due date. Those found by the system (an open RFI, a drawing with no IFC revision, a late predecessor, labour no crew
// covers) clear by themselves when their source is resolved, or are waived with a reason; the others are logged here and cleared by their owner.
const TONE = { OPEN: 'IN_REVIEW', CLEARED: 'APPROVED', WAIVED: 'CANCELLED' };

function NewConstraint({ t, scheduleId: initial, onDone }) {
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(initial); const [f, setF] = useState({ activityId: '', type: 'PERMIT', description: '', owner: '', dueDate: '' }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const aq = useQuery({ queryKey: ['plan', 'activities-all', scheduleId], queryFn: () => pl.activities(scheduleId, 'filter=open&pageSize=1000'), enabled: Boolean(scheduleId), retry: false });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => { e.preventDefault(); setError(null); setBusy(true); try { onDone(await pl.createConstraint({ activityId: Number(f.activityId), type: f.type, description: f.description.trim(), owner: f.owner.trim() || null, dueDate: f.dueDate || null })); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <form className="mdm-panel" onSubmit={save} data-testid="con-form" aria-label={t('con.new')}>
      <h2>{t('con.new')}</h2>
      <SchedulePicker projectId={projectId} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); }} onSchedule={setScheduleId} testId="con" />
      <div className="form-grid">
        <Field label={t('f.activity')} name="activityId" error={error}><select value={f.activityId} onChange={(e) => set('activityId', e.target.value)} required data-testid="con-activity"><option value="">—</option>{(aq.data?.rows ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
        <Field label={t('f.type')} name="type" error={error}><select value={f.type} onChange={(e) => set('type', e.target.value)} data-testid="con-type">{CONSTRAINT_TYPES.map((k) => <option key={k} value={k}>{t(`ct.${k}`)}</option>)}</select></Field>
        <Field label={t('con.owner')} name="owner" error={error}><input value={f.owner} onChange={(e) => set('owner', e.target.value)} maxLength={60} data-testid="con-owner" /></Field>
        <Field label={t('con.due')} name="dueDate" error={error}><input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} data-testid="con-due" /></Field>
      </div>
      <Field label={t('f.name')} name="description" error={error}><input value={f.description} onChange={(e) => set('description', e.target.value)} required minLength={3} maxLength={500} data-testid="con-desc" /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="con-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !f.activityId} data-testid="con-save">{t('act.save')}</button></div>
    </form>
  );
}

function Detail({ t, id, onClose }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['plan', 'constraint', id], queryFn: () => pl.constraint(id), retry: false }); const [error, setError] = useState(null); const [edit, setEdit] = useState(null);
  if (q.isPending || q.isError) return null; const c = q.data;
  const run = async (fn) => { setError(null); try { await fn(); qc.invalidateQueries({ queryKey: ['plan'] }); return true; } catch (e) { setError(errorInfo(e)); return false; } };
  const ask = (fn) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x)); };
  return (
    <div className="mdm-panel" role="region" aria-label={t('con.detail')} data-testid="con-detail" data-status={c.status}>
      <h2>{t(`ct.${c.type}`)} · {c.activity} {c.activityName} <StatusBadge status={TONE[c.status]} label={t(`con.st.${c.status}`)} /></h2>
      <p>{c.description}</p>
      <dl className="kv"><div><dt>{t('con.owner')}</dt><dd>{c.owner ?? '—'}</dd></div><div><dt>{t('con.due')}</dt><dd>{fmtDate(c.dueDate)}{c.overdue ? ` · ${t('la.overdue')}` : ''}</dd></div><div><dt>{t('con.found')}</dt><dd>{c.origin === 'AUTO' ? t('con.byWho.AUTO') : t('con.byWho.MANUAL')}</dd></div>
        {c.clearedOn && <div><dt>{t('con.clearedOn')}</dt><dd>{fmtDate(c.clearedOn)} · {c.clearedBy}{c.clearNote ? ` · ${c.clearNote}` : ''}</dd></div>}</dl>
      {error?.form && <p className="field-error" role="alert" data-testid="con-detail-error">{error.form}</p>}
      <div className="actions no-print">
        {c.can.edit && <button type="button" className="btn" onClick={() => setEdit(edit ? null : { owner: c.owner ?? '', dueDate: c.dueDate ?? '' })} data-testid="con-edit">{t('bl.edit')}</button>}
        {c.can.clear && <button type="button" className="btn btn-primary" onClick={() => { const n = window.prompt(t('con.clearNote')); if (n !== null) run(() => pl.constraintAct(c.id, 'clear', { note: n || null })); }} data-testid="con-clear">{t('con.clear')}</button>}
        {c.can.waive && <button type="button" className="btn" onClick={() => ask((x) => pl.constraintAct(c.id, 'waive', { reason: x }))} data-testid="con-waive">{t('con.waive')}</button>}
        <button type="button" className="btn" onClick={onClose}>{t('con.close')}</button>
      </div>
      {edit && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => pl.updateConstraint(c.id, { owner: edit.owner.trim() || null, dueDate: edit.dueDate || null, rowVersion: c.rowVersion }))) setEdit(null); }} data-testid="con-edit-form" aria-label={t('bl.edit')}>
          <div className="form-grid"><Field label={t('con.owner')} name="owner" error={error}><input value={edit.owner} onChange={(e) => setEdit({ ...edit, owner: e.target.value })} maxLength={60} data-testid="con-edit-owner" /></Field><Field label={t('con.due')} name="dueDate" error={error}><input type="date" value={edit.dueDate} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} data-testid="con-edit-due" /></Field></div>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="con-edit-save">{t('act.save')}</button></div>
        </form>
      )}
    </div>
  );
}

export default function ConstraintsPage() {
  const t = useT('plan');
  usePageTitle(t('con.title'));
  const sp = useSearch(); const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? [];
  const [adding, setAdding] = useState(false); const [openId, setOpenId] = useState(null);
  return (
    <section aria-labelledby="con-h" data-testid="plan-constraints">
      <h1 id="con-h" className="sr-only">{t('con.title')}</h1>
      <div className="actions-row no-print">
        {perms.includes('plan.constraint.manage') && <button type="button" className="btn btn-primary" onClick={() => setAdding(!adding)} data-testid="con-new">{t('con.new')}</button>}
        <Link to="/plan/lookahead">{t('la.title')}</Link>
      </div>
      {adding && <NewConstraint t={t} scheduleId={Number(sp.get('scheduleId')) || null} onDone={(c) => { qc.invalidateQueries({ queryKey: ['plan'] }); setAdding(false); setOpenId(c.id); }} />}
      {openId && <Detail key={openId} t={t} id={openId} onClose={() => setOpenId(null)} />}
      <ListReport listCode="plan.constraints" endpoint="/plan/constraints" title={t('con.title')} session={session.data} onOpen={(r) => setOpenId(r.id)}
        cardFields={[{ key: 'activity', label: t('f.activity') }, { key: 'ctype', label: t('f.type') }, { key: 'owner', label: t('con.owner') }, { key: 'dueDate', label: t('con.due') }]} statusKey="status"
        empty={{ title: t('con.emptyTitle'), text: t('con.emptyBody') }} />
    </section>
  );
}
