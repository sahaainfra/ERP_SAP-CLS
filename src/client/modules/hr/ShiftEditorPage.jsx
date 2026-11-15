import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { att, hoursText } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Shift editor (HR, part 07.04, FR-01): code, name, start and end (an end at or before the start crosses midnight: a night shift), break, grace, the hours for a half and a full day, when overtime starts and how times are rounded.
// A shift in use (assigned or in a roster) keeps its times: only its name and status change, and the server says so. The summary under the form is read from the same rule the server applies.
const blank = () => ({ code: '', name: '', startTime: '09:00', endTime: '18:00', breakMinutes: 60, graceMinutes: 10, halfDayHours: 4, fullDayHours: 8, otAfterHours: 8, roundingMinutes: 0, roundingMode: 'NEAREST', nightShift: false, status: 'ACTIVE' });
const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export default function ShiftEditorPage() {
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  usePageTitle(id ? 'Shift' : 'New Shift');
  const q = useQuery({ queryKey: ['hr', 'shift', id], queryFn: () => att.shifts.get(id), enabled: Boolean(id), retry: false });
  const [v, setV] = useState(blank);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  useEffect(() => { const s = q.data; if (s) setV({ code: s.code, name: s.name, startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, graceMinutes: s.graceMinutes, halfDayHours: s.halfDayHours, fullDayHours: s.fullDayHours, otAfterHours: s.otAfterHours ?? '', roundingMinutes: s.roundingMinutes, roundingMode: s.roundingMode, nightShift: s.nightShift, status: s.status }); }, [q.data]);
  if (id && q.error?.status === 403) return <NoPermission what="shifts" permission="att.shift.view" />;
  if (id && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (id && q.isPending) return <Skeleton label="Loading the shift" rows={5} />;
  const s = q.data;
  const canEdit = id ? s.can.edit : true;
  const crosses = minutes(v.endTime) <= minutes(v.startTime);
  const length = minutes(v.endTime) - minutes(v.startTime) + (crosses ? 1440 : 0);
  const body = () => ({ code: v.code.trim(), name: v.name.trim(), startTime: v.startTime, endTime: v.endTime, breakMinutes: Number(v.breakMinutes), graceMinutes: Number(v.graceMinutes), halfDayHours: Number(v.halfDayHours), fullDayHours: Number(v.fullDayHours), otAfterHours: v.otAfterHours === '' ? null : Number(v.otAfterHours), roundingMinutes: Number(v.roundingMinutes), roundingMode: v.roundingMode, nightShift: v.nightShift });
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null); setNote(null);
    try {
      if (id) { await att.shifts.update(id, { ...body(), status: v.status, version: s.rowVersion }); setNote('Saved.'); q.refetch(); } else { const out = await att.shifts.create(body()); navigateTo(`/hr/attendance/shifts/shift?id=${out.id}`, { force: true }); }
    } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  const locked = id && s.inUse;
  return (
    <section aria-labelledby="se-title" data-testid="shift-editor">
      <p><Link to="/hr/attendance/shifts">← Shifts</Link></p>
      <PageHeader id="se-title" title={id ? `${s.code} · ${s.name}` : 'New Shift'} />
      {locked && <p className="mdm-banner" role="status" data-testid="se-locked">This shift is in use: its times and rules stay as they are for the dates already worked. Change its name or status, or make a new shift.</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="se-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).map(([k, x]) => `${k}: ${x}`).join('; ')}` : ''}</p>}
      <form className="mdm-fields" onSubmit={save}>
        <Field label="Code (required)" name="code" error={error}><input value={v.code} maxLength={20} onChange={(e) => set({ code: e.target.value })} disabled={Boolean(id) || !canEdit} data-testid="se-code" /></Field>
        <Field label="Name (required)" name="name" error={error}><input value={v.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} disabled={!canEdit} data-testid="se-name" /></Field>
        <Field label="Starts" name="startTime" error={error}><input type="time" value={v.startTime} onChange={(e) => set({ startTime: e.target.value })} disabled={!canEdit || locked} data-testid="se-start" /></Field>
        <Field label="Ends" name="endTime" error={error} hint="An end at or before the start is the next day (a night shift)."><input type="time" value={v.endTime} onChange={(e) => set({ endTime: e.target.value })} disabled={!canEdit || locked} data-testid="se-end" /></Field>
        <Field label="Break (minutes)" name="breakMinutes" error={error}><input type="number" min="0" max="480" value={v.breakMinutes} onChange={(e) => set({ breakMinutes: e.target.value })} disabled={!canEdit || locked} /></Field>
        <Field label="Grace for coming late (minutes)" name="graceMinutes" error={error}><input type="number" min="0" max="120" value={v.graceMinutes} onChange={(e) => set({ graceMinutes: e.target.value })} disabled={!canEdit || locked} data-testid="se-grace" /></Field>
        <Field label="Hours for a half day" name="halfDayHours" error={error}><input type="number" step="0.25" min="0.5" max="24" value={v.halfDayHours} onChange={(e) => set({ halfDayHours: e.target.value })} disabled={!canEdit || locked} /></Field>
        <Field label="Hours for a full day" name="fullDayHours" error={error}><input type="number" step="0.25" min="0.5" max="24" value={v.fullDayHours} onChange={(e) => set({ fullDayHours: e.target.value })} disabled={!canEdit || locked} data-testid="se-full" /></Field>
        <Field label="Overtime starts after (hours worked)" name="otAfterHours" error={error} hint="Empty: no overtime on this shift."><input type="number" step="0.25" min="0.5" max="24" value={v.otAfterHours} onChange={(e) => set({ otAfterHours: e.target.value })} disabled={!canEdit || locked} data-testid="se-ot" /></Field>
        <Field label="Round worked time to" name="roundingMinutes" error={error}><select value={v.roundingMinutes} onChange={(e) => set({ roundingMinutes: e.target.value })} disabled={!canEdit || locked}>{[0, 5, 10, 15, 30].map((n) => <option key={n} value={n}>{n === 0 ? 'No rounding' : `${n} minutes`}</option>)}</select></Field>
        <Field label="Rounding" name="roundingMode" error={error}><select value={v.roundingMode} onChange={(e) => set({ roundingMode: e.target.value })} disabled={!canEdit || locked}><option value="NEAREST">To the nearest</option><option value="UP">Up</option><option value="DOWN">Down</option></select></Field>
        <label className="check"><input type="checkbox" checked={crosses || v.nightShift} disabled={crosses || !canEdit || locked} onChange={(e) => set({ nightShift: e.target.checked })} /> Night shift</label>
        {id && <Field label="Status" name="status" error={error}><select value={v.status} onChange={(e) => set({ status: e.target.value })} disabled={!canEdit}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive (cannot be newly assigned)</option></select></Field>}
        <p className="muted" data-testid="se-summary">{v.startTime} to {v.endTime}{crosses ? ' the next day' : ''}: {hoursText(length)} on site, {hoursText(Math.max(0, length - Number(v.breakMinutes || 0)))} paid.</p>
        <div className="actions"><button type="button" className="btn" onClick={() => navigateTo('/hr/attendance/shifts')}>Close</button>{canEdit && <button type="submit" className="btn btn-primary" disabled={busy} data-testid="se-save">{busy ? 'Saving...' : 'Save'}</button>}</div>
      </form>
      {note && <p role="status" className="mdm-banner" data-testid="se-note">{note}</p>}
    </section>
  );
}
