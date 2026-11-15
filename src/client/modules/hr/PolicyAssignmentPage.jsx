import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { formatDate } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { DAY_TYPES, WEEKDAYS, att, dayIST } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Policy Assignment (HR, part 07.04, FR-05 and FR-06): the configuration of what governs attendance. The hierarchy is the company default, then a site, a crew and an employee override, each with effective dates; the most specific one
// that says something about the policy, the shift, the weekly off or the holiday calendar wins, attribute by attribute. A new assignment of the same place ends the one before it the day before. "Who gets what" resolves any person on any day
// and names the level each part came from. The attendance period (calendar month, or from a start day such as the 26th) and its closing are below; a closed period is never recalculated.
const LEVELS = [['COMPANY', 'Company default'], ['SITE', 'Sites'], ['CREW', 'Crews'], ['EMPLOYEE', 'Employee overrides']];
const offText = (o) => (!o ? '—' : o.type === 'ROTATIONAL' ? `rotating (${o.cycle.length}-day cycle from ${o.anchor})` : `${o.days.map((d) => WEEKDAYS[d][1].slice(0, 3)).join(', ') || 'none'}${o.nthSaturdayOff?.length ? `, Saturdays ${o.nthSaturdayOff.join(' and ')}` : ''}`);
export default function PolicyAssignmentPage() {
  usePageTitle('Policy Assignment');
  const qc = useQueryClient();
  const [ended, setEnded] = useState(false);
  const q = useQuery({ queryKey: ['hr', 'att-assign', ended], queryFn: () => att.assignments.list({ includeEnded: ended }), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['hr'] });
  if (q.error?.status === 403) return <NoPermission what="attendance assignments" permission="att.assignment.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <section aria-labelledby="pa-title" data-testid="policy-assignment">
      <PageHeader id="pa-title" title={"Policy Assignment"} />
      <label className="check"><input type="checkbox" checked={ended} onChange={(e) => setEnded(e.target.checked)} data-testid="pa-ended" /> Show assignments that have ended</label>
      {q.isPending ? <Skeleton label="Loading the assignments" rows={4} /> : q.data.length === 0 ? <EmptyState title="Nothing is assigned yet" message="Start with the company default: a policy, a shift and the weekly off." /> : (
        LEVELS.map(([level, label]) => { const rows = q.data.filter((a) => a.scopeType === level); return rows.length ? <Level key={level} label={label} rows={rows} refresh={refresh} /> : null; })
      )}
      <Add refresh={refresh} />
      <Resolve />
      <Period />
      <p className="small"><Link to="/hr/attendance/shifts">Shifts</Link> · <Link to="/hr/attendance/policies">Attendance Policies</Link> · <Link to="/hr/attendance/roster">Roster Planner</Link></p>
    </section>
  );
}

function Level({ label, rows, refresh }) {
  const [error, setError] = useState(null);
  const end = async (a) => { setError(null); try { await att.assignments.end(a.id, dayIST(0), 'Ended from the assignment page'); refresh(); } catch (e) { setError(errorInfo(e)); } };
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="grid" data-testid={`pa-level-${rows[0].scopeType}`}><caption>{label}</caption><thead><tr><th>For</th><th>Policy</th><th>Shift</th><th>Weekly off</th><th>Holidays</th><th>From</th><th>To</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{rows.map((a) => <tr key={a.id} data-testid="pa-row"><td data-label="For">{a.scope}</td><td data-label="Policy">{a.policyCode ?? '—'}</td><td data-label="Shift">{a.shift ?? '—'}</td><td data-label="Weekly off">{offText(a.weeklyOff)}</td><td data-label="Holidays">{a.holidayCalendar ?? '—'}</td>
          <td data-label="From">{formatDate(a.effectiveFrom)}{a.when === 'FUTURE' ? ' (later)' : ''}</td><td data-label="To">{a.effectiveTo ? formatDate(a.effectiveTo) : 'open'}</td>
          <td data-label="Actions">{a.when !== 'ENDED' && <button type="button" className="btn btn-small" onClick={() => end(a)} data-testid="pa-end">End today</button>}</td></tr>)}</tbody></table>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Add({ refresh }) {
  const codes = useQuery({ queryKey: ['hr', 'att-codes'], queryFn: att.policies.codes, retry: false });
  const shifts = useQuery({ queryKey: ['hr', 'shifts', 'active'], queryFn: att.shifts.active, retry: false });
  const cals = useQuery({ queryKey: ['hr', 'att-cals'], queryFn: att.calendars, retry: false });
  const [v, setV] = useState({ scopeType: 'COMPANY', scopeId: '', policyCode: '', shiftId: '', offOn: true, days: [0], sat: [], calendarId: '', effectiveFrom: dayIST(1), effectiveTo: '', reason: '' });
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const lookup = { SITE: 'iam/sites', CREW: 'hr/crews', EMPLOYEE: 'hr/employees' }[v.scopeType];
  const go = async (e) => {
    e.preventDefault(); setError(null); setNote(null);
    try {
      await att.assignments.create({ scopeType: v.scopeType, scopeId: v.scopeType === 'COMPANY' ? 0 : Number(v.scopeId), policyCode: v.policyCode || null, shiftId: v.shiftId ? Number(v.shiftId) : null, weeklyOff: v.offOn ? { type: 'FIXED', days: v.days, ...(v.sat.length ? { nthSaturdayOff: v.sat } : {}) } : null, holidayCalendarId: v.calendarId ? Number(v.calendarId) : null, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo || null, reason: v.reason || null });
      setNote('Assigned.'); refresh();
    } catch (x) { setError(errorInfo(x)); }
  };
  const toggle = (list, n) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort());
  return (
    <section className="mdm-panel" aria-labelledby="pa-add" data-testid="pa-add">
      <h2 id="pa-add">Assign</h2>
      <form className="mdm-fields" onSubmit={go} aria-label="Assign">
        <Field label="To" name="scopeType" error={error}><select value={v.scopeType} onChange={(e) => set({ scopeType: e.target.value, scopeId: '' })} data-testid="pa-scope">{LEVELS.map(([k]) => <option key={k} value={k}>{k === 'COMPANY' ? 'The company' : k === 'SITE' ? 'A site' : k === 'CREW' ? 'A crew' : 'An employee'}</option>)}</select></Field>
        {lookup && <LookupField id="pa-scope-id" label={v.scopeType === 'SITE' ? 'Site' : v.scopeType === 'CREW' ? 'Crew' : 'Employee'} lookup={lookup} value={v.scopeId} onChange={(x) => set({ scopeId: x })} error={error?.fields?.scopeId} required />}
        <Field label="Policy" name="policyCode" error={error} hint="Only approved policies are listed."><select value={v.policyCode} onChange={(e) => set({ policyCode: e.target.value })} data-testid="pa-policy"><option value="">No change</option>{(codes.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label="Shift" name="shiftId" error={error}><select value={v.shiftId} onChange={(e) => set({ shiftId: e.target.value })} data-testid="pa-shift"><option value="">No change</option>{(shifts.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.startTime} to {s.endTime}</option>)}</select></Field>
        <fieldset><legend>Weekly off</legend>
          <label className="check"><input type="checkbox" checked={v.offOn} onChange={(e) => set({ offOn: e.target.checked })} data-testid="pa-off-on" /> Set the weekly off</label>
          {v.offOn && <div role="group" aria-label="Days off">{WEEKDAYS.map(([n, l]) => <label key={n} className="check"><input type="checkbox" checked={v.days.includes(n)} onChange={() => set({ days: toggle(v.days, n) })} data-testid={`pa-day-${n}`} /> {l}</label>)}</div>}
          {v.offOn && <div role="group" aria-label="Saturdays off">{[1, 2, 3, 4, 5].map((n) => <label key={n} className="check"><input type="checkbox" checked={v.sat.includes(n)} onChange={() => set({ sat: toggle(v.sat, n) })} /> Saturday {n}</label>)}</div>}</fieldset>
        <Field label="Holiday calendar (empty: those of the place)" name="holidayCalendarId" error={error}><select value={v.calendarId} onChange={(e) => set({ calendarId: e.target.value })}><option value="">No change</option>{(cals.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="From" name="effectiveFrom" error={error}><input type="date" value={v.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} data-testid="pa-from" /></Field>
        <Field label="To (empty for open)" name="effectiveTo" error={error}><input type="date" value={v.effectiveTo} onChange={(e) => set({ effectiveTo: e.target.value })} /></Field>
        <Field label="Why" name="reason" error={error}><input value={v.reason} onChange={(e) => set({ reason: e.target.value })} /></Field>
        {error?.form && <p className="field-error" role="alert" data-testid="pa-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary" data-testid="pa-go">Assign</button></div>
      </form>
      {note && <p role="status" className="mdm-banner" data-testid="pa-note">{note}</p>}
    </section>
  );
}

function Resolve() {
  const [emp, setEmp] = useState('');
  const [date, setDate] = useState(dayIST(0));
  const [out, setOut] = useState(null);
  const [error, setError] = useState(null);
  const go = async (e) => { e.preventDefault(); setError(null); try { setOut(await att.resolve(Number(emp), date)); } catch (x) { setError(errorInfo(x)); setOut(null); } };
  const src = (s) => (s ? `${LEVELS.find(([k]) => k === s.level)?.[1] ?? s.level.replace('_', ' ').toLowerCase()}` : 'nothing assigned');
  return (
    <section className="mdm-panel" aria-labelledby="pa-res" data-testid="pa-resolve">
      <h2 id="pa-res">Who gets what</h2>
      <form className="mdm-fields" onSubmit={go} aria-label="Resolve">
        <LookupField id="pa-res-emp" label="Employee" lookup="hr/employees" value={emp} onChange={setEmp} required />
        <Field label="On" name="date" error={null}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="pa-res-date" /></Field>
        <div className="actions"><button type="submit" className="btn" data-testid="pa-res-go">Show</button></div>
      </form>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {out && (
        <dl className="kv-list" data-testid="pa-res-out">
          <div><dt>Day</dt><dd data-testid="pa-res-day">{DAY_TYPES[out.dayType]}{out.holiday ? ` (${out.holiday.name})` : ''}</dd></div>
          <div><dt>Policy</dt><dd data-testid="pa-res-policy">{out.policy ? `${out.policy.code}, version ${out.policy.version} from ${formatDate(out.policy.effectiveFrom)}` : 'none'} · from: {src(out.sources.policy)}</dd></div>
          <div><dt>Shift</dt><dd data-testid="pa-res-shift">{out.shift ? `${out.shift.code} ${out.shift.startTime} to ${out.shift.endTime}${out.shift.nightShift ? ' (night)' : ''}` : 'none'} · from: {out.sources.shift?.level === 'ROSTER' ? 'the roster' : out.sources.shift?.level === 'ROSTER_CHANGE' ? 'an approved roster change' : src(out.sources.shift)}</dd></div>
          <div><dt>Weekly off</dt><dd>{out.weeklyOff ? 'Yes' : 'No'} · from: {src(out.sources.weeklyOff)}</dd></div>
          <div><dt>Holiday calendar</dt><dd>{src(out.sources.holidayCalendar)}</dd></div>
        </dl>
      )}
    </section>
  );
}

function Period() {
  const qc = useQueryClient();
  const def = useQuery({ queryKey: ['hr', 'att-period'], queryFn: att.period.get, retry: false });
  const list = useQuery({ queryKey: ['hr', 'att-periods'], queryFn: () => att.period.list({}), retry: false });
  const [startDay, setStartDay] = useState('1');
  const [from, setFrom] = useState(dayIST(1));
  const [error, setError] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['hr'] });
  const save = async (e) => { e.preventDefault(); setError(null); try { await att.period.set({ startDay: Number(startDay), effectiveFrom: from }); refresh(); } catch (x) { setError(errorInfo(x)); } };
  const close = async (p) => { setError(null); try { await att.period.close(p.id); refresh(); } catch (x) { setError(errorInfo(x)); } };
  return (
    <section className="mdm-panel" aria-labelledby="pa-per" data-testid="pa-period">
      <h2 id="pa-per">Attendance period</h2>
      {def.isSuccess && <p data-testid="pa-period-now">Periods start on day {def.data.current} of the month{def.data.current === 1 ? ' (the calendar month)' : ''}.{def.data.lastClosedEnd ? ` Closed up to ${formatDate(def.data.lastClosedEnd)}.` : ''}</p>}
      <form className="mdm-fields" onSubmit={save} aria-label="Attendance period">
        <Field label="Start day of the period (1 to 28)" name="startDay" error={error}><input type="number" min="1" max="28" value={startDay} onChange={(e) => setStartDay(e.target.value)} data-testid="pa-period-day" /></Field>
        <Field label="From" name="effectiveFrom" error={error}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="pa-period-from" /></Field>
        <div className="actions"><button type="submit" className="btn" data-testid="pa-period-save">Set</button></div>
      </form>
      {error?.form && <p className="field-error" role="alert" data-testid="pa-period-error">{error.form}</p>}
      {list.isSuccess && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Periods"><table className="grid" data-testid="pa-periods"><thead><tr><th>Period</th><th>From</th><th>To</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{list.data.map((p) => <tr key={p.id}><td data-label="Period">{p.label}</td><td data-label="From">{formatDate(p.start)}</td><td data-label="To">{formatDate(p.end)}</td><td data-label="Status">{p.status === 'CLOSED' ? 'Closed' : 'Open'}</td>
            <td data-label="Actions">{p.status === 'OPEN' && p.end < dayIST(0) && <button type="button" className="btn btn-small" onClick={() => close(p)} data-testid="pa-close">Close</button>}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}
