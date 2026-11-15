import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { formatDate } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { DAY_TYPES, REQ_STATUS, att, dayIST } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Roster Planner (HR, part 07.04, FR-02): a calendar grid for a site (or one crew): a row for each person deployed there, a column for each day, and in each cell the shift that resolves for the day (the rotating pattern, an approved change,
// the assignment). A change of one day is asked for with the cell's list (keyboard and phone) or by dragging a shift from the palette onto a cell; dragging one person's cell onto another person's cell on the same day asks for a swap.
// Every change goes to the supervisor and the project manager and shows as "waiting" until approved; Undo withdraws it. Rotating patterns are made below for the days after today. Legend, zoom, days shown and Print are on the page.
const SHIFT_CLASS = (i) => `att-s${i % 6}`;
export default function RosterPlannerPage() {
  usePageTitle('Roster Planner');
  const qc = useQueryClient();
  const sp = new URLSearchParams(window.location.search);
  const [siteId, setSiteId] = useState(sp.get('siteId') ?? '');
  const [crewId, setCrewId] = useState('');
  const [from, setFrom] = useState(sp.get('from') || dayIST(0));
  const [days, setDays] = useState(7);
  const [zoom, setZoom] = useState(100);
  const [reason, setReason] = useState('Roster change');
  const [error, setError] = useState(null);
  const [undo, setUndo] = useState(null);
  const [drag, setDrag] = useState(null);
  const q = useQuery({ queryKey: ['hr', 'roster-board', siteId, crewId, from, days], queryFn: () => att.rosters.board({ siteId, crewId: crewId || undefined, from, days }), enabled: Boolean(siteId), retry: false });
  const changes = useQuery({ queryKey: ['hr', 'roster-changes', siteId], queryFn: () => att.rosters.changes({ siteId }), enabled: Boolean(siteId), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['hr'] });
  const b = q.data;
  const idx = (id) => Math.max(0, (b?.shifts ?? []).findIndex((s) => s.id === id));
  const send = async (body, label) => {
    setError(null);
    try { const out = await att.rosters.change({ siteId: Number(siteId), reason: reason.trim(), submit: true, ...body }); setUndo({ id: out.id, label, docNo: out.docNo }); refresh(); } catch (e) { setError(errorInfo(e)); }
  };
  const change = (row, date, value) => send({ kind: 'CHANGE', employeeId: row.employeeId, workDate: date, ...(value === 'OFF' ? { isOff: true } : { shiftId: Number(value) }) }, `${row.name} on ${formatDate(date)}`);
  const swap = (a, c, date) => send({ kind: 'SWAP', employeeId: a.employeeId, swapEmployeeId: c.employeeId, workDate: date }, `${a.name} and ${c.name} on ${formatDate(date)}`);
  const undoIt = async () => { try { await att.rosters.cancelChange(undo.id, 'Undone from the roster planner'); setUndo(null); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const editable = (date) => b?.canChange && date >= dayIST(0) && !(b.closedUpTo && date <= b.closedUpTo);
  if (q.error?.status === 403) return <NoPermission what="the roster planner" permission="att.roster.view" />;
  return (
    <section aria-labelledby="rp-title" data-testid="roster-planner">
      <PageHeader id="rp-title" title={"Roster Planner"} />
      <form className="srch-form" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <LookupField id="rp-site" label="Site" lookup="iam/sites" value={siteId} onChange={(x) => { setSiteId(x); setCrewId(''); }} required />
        <Field label="Crew" name="crew" error={null}><select value={crewId} onChange={(e) => setCrewId(e.target.value)} data-testid="rp-crew"><option value="">All people of the site</option>{(b?.crews ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="From" name="from" error={null}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="rp-from" /></Field>
        <Field label="Days" name="days" error={null}><select value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="rp-days">{[7, 14, 28].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
        <label className="field"><span>Zoom {zoom}%</span><input type="range" min="80" max="140" step="10" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" /></label>
        <button type="button" className="btn" onClick={() => window.print()} data-testid="rp-print">Print</button>
      </form>
      {!siteId ? <EmptyState title="Choose a site" message="The planner shows the people deployed at a site and the shift of each day." /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the roster" rows={5} /> : (
        <>
          <p className="muted small" data-testid="rp-legend"><span className="att-chip att-s0">A shift</span> the shift of the day, each shift in its own shade · <span className="att-chip att-off">Off</span> off in the roster · <span className="att-chip att-wo">WO</span> weekly off · <span className="att-chip att-ho">Holiday</span> · <span className="att-chip att-pending">Waiting</span> a change waits for approval · * an approved change. Drag a shift from the palette onto a day, or one person's day onto another person's to swap.</p>
          {b.canChange && (
            <div className="mdm-panel" aria-label="Shifts to drag">
              <Field label="Reason for the changes you make" name="reason" error={null}><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} data-testid="rp-reason" /></Field>
              <p className="att-palette" data-testid="rp-palette">{b.shifts.map((s, i) => <span key={s.id} className={`att-chip ${SHIFT_CLASS(i)}`} draggable onDragStart={() => setDrag({ kind: 'shift', value: String(s.id) })} title={`${s.name} ${s.startTime}-${s.endTime}`}>{s.code} {s.startTime}-{s.endTime}</span>)}<span className="att-chip att-off" draggable onDragStart={() => setDrag({ kind: 'shift', value: 'OFF' })}>Off</span></p>
            </div>
          )}
          {error?.form && <p className="field-error" role="alert" data-testid="rp-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
          {undo && <p className="mdm-banner" role="status" data-testid="rp-undo">{undo.label} sent for approval ({undo.docNo}). <button type="button" className="btn btn-small" onClick={undoIt} data-testid="rp-undo-go">Undo</button></p>}
          {b.rows.length === 0 ? <EmptyState title="Nobody is deployed here" message="Deploy people to this site first (Deployments), then plan their shifts." /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Roster" style={{ fontSize: `${zoom}%` }}>
              <table className="grid att-grid" data-testid="rp-grid"><thead><tr><th scope="col">Person</th>{b.dates.map((d) => <th scope="col" key={d}>{formatDate(d)}</th>)}</tr></thead>
                <tbody>{b.rows.map((row) => (
                  <tr key={row.employeeId} data-testid="rp-row"><th scope="row">{row.name}<span className="muted small"> {row.code}{row.designation ? ` · ${row.designation}` : ''}</span></th>
                    {row.days.map((d) => {
                      const pending = b.pending.includes(`${row.employeeId}|${d.date}`);
                      const cls = pending ? 'att-pending' : d.holiday ? 'att-ho' : d.dayType === 'WEEKLY_OFF' ? 'att-wo' : d.shiftId ? SHIFT_CLASS(idx(d.shiftId)) : 'att-off';
                      return (
                        <td key={d.date} data-label={formatDate(d.date)} data-testid="rp-cell" onDragOver={(e) => e.preventDefault()}
                          onDrop={() => { if (!drag || !editable(d.date)) return; if (drag.kind === 'shift') change(row, d.date, drag.value); else if (drag.kind === 'cell' && drag.date === d.date && drag.row.employeeId !== row.employeeId) swap(drag.row, row, d.date); setDrag(null); }}>
                          <span className={`att-chip ${cls}`} draggable={editable(d.date) && !pending} onDragStart={() => setDrag({ kind: 'cell', row, date: d.date })} title={DAY_TYPES[d.dayType]}>{d.holiday ? d.holiday : d.dayType === 'WEEKLY_OFF' ? 'WO' : d.shift ?? 'Off'}{d.source === 'ROSTER_CHANGE' ? '*' : ''}</span>
                          {editable(d.date) && !pending && (
                            <select aria-label={`Change ${row.name} on ${formatDate(d.date)}`} value="" onChange={(e) => { if (e.target.value) change(row, d.date, e.target.value); }} data-testid="rp-change">
                              <option value="">…</option>{b.shifts.filter((s) => s.id !== d.shiftId).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}<option value="OFF">Off</option></select>
                          )}
                        </td>
                      );
                    })}</tr>))}</tbody></table>
            </div>
          )}
          {b.canEdit && <Patterns b={b} refresh={refresh} />}
          {changes.data?.length > 0 && (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Recent changes"><table className="grid" data-testid="rp-changes"><caption>Changes asked for at this site</caption><thead><tr><th>No.</th><th>Day</th><th>Person</th><th>To</th><th>Status</th></tr></thead>
              <tbody>{changes.data.slice(0, 15).map((c) => <tr key={c.id}><td data-label="No.">{c.docNo}</td><td data-label="Day">{formatDate(c.workDate)}</td><td data-label="Person">{c.employee}{c.swapEmployee ? ` ⇄ ${c.swapEmployee}` : ''}</td><td data-label="To">{c.shift}{c.swapShift ? ` / ${c.swapShift}` : ''}</td><td data-label="Status">{REQ_STATUS[c.status]?.[1] ?? c.status}</td></tr>)}</tbody></table></div>
          )}
        </>
      )}
      <p className="small"><Link to="/hr/attendance/shifts">Shifts</Link> · <Link to="/hr/attendance/assignment">Policy Assignment</Link> · <Link to="/hr/deployments">Deployments</Link></p>
    </section>
  );
}

/** Rotating patterns: a cycle of days, each a shift or a day off, starting on a date after today and repeating. */
function Patterns({ b, refresh }) {
  const q = useQuery({ queryKey: ['hr', 'rosters', b.siteId], queryFn: () => att.rosters.list({ siteId: b.siteId }), retry: false });
  const [name, setName] = useState('');
  const [crew, setCrew] = useState('');
  const [cycle, setCycle] = useState(['', '', '', 'OFF']);
  const [fromDate, setFromDate] = useState(dayIST(7));
  const [error, setError] = useState(null);
  const create = async (e) => {
    e.preventDefault(); setError(null);
    try { await att.rosters.create({ siteId: b.siteId, crewId: crew ? Number(crew) : null, name: name.trim(), cycle: cycle.map((x) => (x === 'OFF' || x === '' ? null : Number(x))), fromDate }); setName(''); refresh(); q.refetch(); } catch (x) { setError(errorInfo(x)); }
  };
  return (
    <section className="mdm-panel" aria-labelledby="pt-title" data-testid="rp-patterns">
      <h2 id="pt-title">Rotating patterns</h2>
      {q.data?.length > 0 && <ul className="mdm-list">{q.data.map((r) => <li key={r.id}>{r.name}{r.crew ? ` (${r.crew})` : ' (the whole site)'}: {r.cycle.map((x) => b.shifts.find((s) => s.id === x)?.code ?? 'Off').join(' → ')} · from {formatDate(r.fromDate)}{r.toDate ? ` to ${formatDate(r.toDate)}` : ''}</li>)}</ul>}
      <form className="mdm-fields" onSubmit={create} aria-label="New pattern">
        <Field label="Name" name="name" error={error}><input value={name} onChange={(e) => setName(e.target.value)} required data-testid="pt-name" /></Field>
        <Field label="Crew (empty: the whole site)" name="crewId" error={error}><select value={crew} onChange={(e) => setCrew(e.target.value)} data-testid="pt-crew"><option value="">The whole site</option>{b.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Starts on (tomorrow or later)" name="fromDate" error={error}><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} data-testid="pt-from" /></Field>
        <div role="group" aria-label="The days of the cycle" className="att-cycle">{cycle.map((x, i) => <label key={i} className="field"><span>Day {i + 1}</span><select value={x} onChange={(e) => setCycle(cycle.map((y, j) => (j === i ? e.target.value : y)))} data-testid={`pt-day-${i}`}><option value="">Choose</option><option value="OFF">Off</option>{b.shifts.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label>)}
          <button type="button" className="btn btn-small" onClick={() => setCycle([...cycle, ''])} data-testid="pt-add-day">Add a day</button>{cycle.length > 1 && <button type="button" className="btn btn-small" onClick={() => setCycle(cycle.slice(0, -1))}>Remove the last day</button>}</div>
        {error?.form && <p className="field-error" role="alert" data-testid="pt-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary" data-testid="pt-create">Make the pattern</button></div>
      </form>
    </section>
  );
}
