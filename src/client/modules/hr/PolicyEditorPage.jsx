import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { DiscussionTab, TimelineTab } from '../../platform/collab/CollabTabs.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { MISSING_MODES, REQ_STATUS, att, dayIST, hoursText } from './api.js';

// Policy rules editor (HR, part 07.04, FR-04): the rules of one attendance policy version: late marks (3 lates = half a day), early going, missing punch, comp-off and overtime (who is eligible, the multiplier, the limits).
// The examples under the rules are computed by the server with the rules as they stand in the form, for the shift chosen, so a change is seen before it is sent. A new policy or a new version takes effect from its date only; it goes to
// the HR manager and, when it touches pay, the director. An approved version is read-only; "New version" makes the next one.
const BLANK = () => ({ late: { enabled: true, countPerHalfDay: 3 }, earlyGoing: { enabled: true, graceMinutes: 10, countPerHalfDay: 3 }, missingPunch: { mode: 'REGULARISE' }, compOff: { enabled: false, minMinutes: 240, expiryDays: 60 },
  ot: { enabled: false, multiplier: 2, holidayMultiplier: '', maxPerDayMinutes: 120, maxPerWeekMinutes: 600, eligibleGrades: '', eligibleCategories: [] } });
const CATS = [['PERMANENT', 'Permanent'], ['CONTRACT', 'Contract'], ['TRAINEE', 'Trainee'], ['CONSULTANT', 'Consultant']];
const num = (v) => (v === '' || v == null ? 0 : Number(v));
const toRules = (r) => ({ late: { enabled: r.late.enabled, countPerHalfDay: num(r.late.countPerHalfDay) }, earlyGoing: { enabled: r.earlyGoing.enabled, graceMinutes: num(r.earlyGoing.graceMinutes), countPerHalfDay: num(r.earlyGoing.countPerHalfDay) }, missingPunch: { mode: r.missingPunch.mode },
  compOff: { enabled: r.compOff.enabled, minMinutes: num(r.compOff.minMinutes), expiryDays: num(r.compOff.expiryDays) },
  ot: { enabled: r.ot.enabled, multiplier: num(r.ot.multiplier), holidayMultiplier: r.ot.holidayMultiplier === '' ? null : Number(r.ot.holidayMultiplier), maxPerDayMinutes: num(r.ot.maxPerDayMinutes), maxPerWeekMinutes: num(r.ot.maxPerWeekMinutes), eligibleGrades: String(r.ot.eligibleGrades).split(',').map((x) => x.trim()).filter(Boolean), eligibleCategories: r.ot.eligibleCategories } });
const fromRules = (r) => ({ ...r, ot: { ...r.ot, holidayMultiplier: r.ot.holidayMultiplier ?? '', eligibleGrades: (r.ot.eligibleGrades ?? []).join(', ') } });
const TABS = [['rules', 'Rules and examples'], ['versions', 'Versions'], ['approvals', 'Approvals'], ['timeline', 'Timeline'], ['discussion', 'Discussion']];
const minOf = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const at = (date, startTime, plusMin) => { const t = Date.parse(`${date}T${startTime}:00Z`) + plusMin * 60_000; return new Date(t).toISOString().slice(0, 16); };

export default function PolicyEditorPage() {
  const sp = new URLSearchParams(window.location.search);
  const id = Number(sp.get('id')) || null;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hr', 'policy', id], queryFn: () => att.policies.get(id), enabled: Boolean(id), retry: false });
  usePageTitle(q.data ? `${q.data.code} v${q.data.version}` : 'New Policy');
  const [tab, setTab] = useState('rules');
  const [v, setV] = useState({ code: '', name: '', effectiveFrom: dayIST(1), changeNote: '', rules: BLANK() });
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const [amendFrom, setAmendFrom] = useState(dayIST(30));
  const [busy, setBusy] = useState(false);
  useEffect(() => { const p = q.data; if (p) setV({ code: p.code, name: p.name, effectiveFrom: p.effectiveFrom, changeNote: p.changeNote ?? '', rules: fromRules(p.rules) }); }, [q.data]);
  if (id && q.error?.status === 403) return <NoPermission what="attendance policies" permission="att.policy.view" />;
  if (id && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (id && q.isPending) return <Skeleton label="Loading the policy" rows={6} />;
  const p = q.data;
  const editable = id ? p.can.edit : true;
  const setRule = (part, patch) => setV((x) => ({ ...x, rules: { ...x.rules, [part]: { ...x.rules[part], ...patch } } }));
  const refresh = () => { qc.invalidateQueries({ queryKey: ['hr'] }); };
  const run = async (fn, done) => { setError(null); try { const out = await fn(); setNote(done); setMode(null); setReason(''); refresh(); return out; } catch (e) { setError(errorInfo(e)); return null; } };
  const save = async (submit) => {
    setBusy(true); setError(null); setNote(null);
    try {
      const body = { name: v.name.trim(), effectiveFrom: v.effectiveFrom, rules: toRules(v.rules), changeNote: v.changeNote.trim() || null };
      if (id) { await att.policies.update(id, { ...body, version: p.rowVersion }); if (submit) await att.policies.submit(id); setNote(submit ? 'Sent for approval.' : 'Saved.'); refresh(); } else { const out = await att.policies.create({ ...body, code: v.code.trim(), submit }); navigateTo(`/hr/attendance/policies/policy?id=${out.id}${submit ? '&sent=1' : ''}`, { force: true }); }
    } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const status = p ? (REQ_STATUS[p.status] ?? ['DRAFT', p.statusLabel]) : null;
  return (
    <section aria-labelledby="pe-title" data-testid="policy-editor">
      <p><Link to="/hr/attendance/policies">← Attendance Policies</Link></p>
      <header className="op-header">
        <div className="page-head"><h1 id="pe-title">{id ? `${p.code} · ${p.name}` : 'New Policy'}</h1>{status && <StatusBadge status={status[0]} label={status[1]} />}{id && <span className="muted">version {p.version}</span>}</div>
        {id && <dl className="op-figures"><div><dt>Effective from</dt><dd data-testid="pe-effective">{formatDate(p.effectiveFrom)}</dd></div><div><dt>Touches pay</dt><dd data-testid="pe-band">{p.band === 'PAY_IMPACTING' ? 'Yes: the director also approves' : 'No'}</dd></div></dl>}
        {sp.get('sent') === '1' && <p className="mdm-banner" role="status" data-testid="pe-sent">Sent for approval.</p>}
        {id && <Actions />}
      </header>
      {error?.form && <p className="field-error" role="alert" data-testid="pe-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).map(([k, x]) => `${k}: ${x}`).join('; ')}` : ''}</p>}
      {note && <p role="status" className="mdm-banner" data-testid="pe-note">{note}</p>}
      {id && <div role="tablist" aria-label="Policy sections" className="op-tabs">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`pe-tab-${k}`} aria-selected={tab === k} aria-controls={`pe-panel-${k}`} tabIndex={tab === k ? 0 : -1} className={`op-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>}
      <div role="tabpanel" id={`pe-panel-${tab}`} className="op-panel" tabIndex={0}>
        {tab === 'rules' && (
          <>
            <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }} aria-label="Rules">
              {!id && <Field label="Code (required)" name="code" error={error}><input value={v.code} maxLength={20} onChange={(e) => setV({ ...v, code: e.target.value })} data-testid="pe-code" /></Field>}
              <Field label="Name (required)" name="name" error={error}><input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} disabled={!editable} data-testid="pe-name" /></Field>
              <Field label="Effective from" name="effectiveFrom" error={error} hint="It governs this date and later; days before it keep the version in force then."><input type="date" value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} disabled={!editable} data-testid="pe-from" /></Field>
              <fieldset><legend>Late coming</legend>
                <label className="check"><input type="checkbox" checked={v.rules.late.enabled} disabled={!editable} onChange={(e) => setRule('late', { enabled: e.target.checked })} data-testid="pe-late-on" /> Count a late mark after the grace of the shift</label>
                <Field label="Late marks that make half a day (0 for none)" name="rules.late.countPerHalfDay" error={error}><input type="number" min="0" max="31" value={v.rules.late.countPerHalfDay} disabled={!editable} onChange={(e) => setRule('late', { countPerHalfDay: e.target.value })} data-testid="pe-late-count" /></Field></fieldset>
              <fieldset><legend>Early going</legend>
                <label className="check"><input type="checkbox" checked={v.rules.earlyGoing.enabled} disabled={!editable} onChange={(e) => setRule('earlyGoing', { enabled: e.target.checked })} /> Count an early-going mark</label>
                <Field label="Grace before the end of the shift (minutes)" name="rules.earlyGoing.graceMinutes" error={error}><input type="number" min="0" max="240" value={v.rules.earlyGoing.graceMinutes} disabled={!editable} onChange={(e) => setRule('earlyGoing', { graceMinutes: e.target.value })} /></Field>
                <Field label="Early-going marks that make half a day (0 for none)" name="rules.earlyGoing.countPerHalfDay" error={error}><input type="number" min="0" max="31" value={v.rules.earlyGoing.countPerHalfDay} disabled={!editable} onChange={(e) => setRule('earlyGoing', { countPerHalfDay: e.target.value })} /></Field></fieldset>
              <Field label="A missing punch" name="rules.missingPunch.mode" error={error}><select value={v.rules.missingPunch.mode} disabled={!editable} onChange={(e) => setRule('missingPunch', { mode: e.target.value })} data-testid="pe-missing">{MISSING_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <fieldset><legend>Comp-off</legend>
                <label className="check"><input type="checkbox" checked={v.rules.compOff.enabled} disabled={!editable} onChange={(e) => setRule('compOff', { enabled: e.target.checked })} /> A day off is earned for work on a weekly off or a holiday</label>
                <Field label="Minutes worked for a comp-off" name="rules.compOff.minMinutes" error={error}><input type="number" min="30" max="1440" value={v.rules.compOff.minMinutes} disabled={!editable} onChange={(e) => setRule('compOff', { minMinutes: e.target.value })} /></Field>
                <Field label="Valid for (days)" name="rules.compOff.expiryDays" error={error}><input type="number" min="1" max="365" value={v.rules.compOff.expiryDays} disabled={!editable} onChange={(e) => setRule('compOff', { expiryDays: e.target.value })} /></Field></fieldset>
              <fieldset><legend>Overtime</legend>
                <label className="check"><input type="checkbox" checked={v.rules.ot.enabled} disabled={!editable} onChange={(e) => setRule('ot', { enabled: e.target.checked })} data-testid="pe-ot-on" /> Pay overtime after the hours the shift names</label>
                <Field label="Multiplier (for example 2 for double)" name="rules.ot.multiplier" error={error}><input type="number" step="0.25" min="1" max="5" value={v.rules.ot.multiplier} disabled={!editable} onChange={(e) => setRule('ot', { multiplier: e.target.value })} data-testid="pe-ot-mult" /></Field>
                <Field label="Multiplier on a holiday (empty: the same)" name="rules.ot.holidayMultiplier" error={error}><input type="number" step="0.25" min="1" max="5" value={v.rules.ot.holidayMultiplier} disabled={!editable} onChange={(e) => setRule('ot', { holidayMultiplier: e.target.value })} /></Field>
                <Field label="At most a day (minutes)" name="rules.ot.maxPerDayMinutes" error={error}><input type="number" min="0" max="720" value={v.rules.ot.maxPerDayMinutes} disabled={!editable} onChange={(e) => setRule('ot', { maxPerDayMinutes: e.target.value })} data-testid="pe-ot-day" /></Field>
                <Field label="At most a week (minutes)" name="rules.ot.maxPerWeekMinutes" error={error}><input type="number" min="0" max="5000" value={v.rules.ot.maxPerWeekMinutes} disabled={!editable} onChange={(e) => setRule('ot', { maxPerWeekMinutes: e.target.value })} /></Field>
                <Field label="Grades eligible (comma separated; empty: all)" name="rules.ot.eligibleGrades" error={error}><input value={v.rules.ot.eligibleGrades} disabled={!editable} onChange={(e) => setRule('ot', { eligibleGrades: e.target.value })} /></Field>
                <div role="group" aria-label="Categories eligible">{CATS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={v.rules.ot.eligibleCategories.includes(k)} disabled={!editable} onChange={(e) => setRule('ot', { eligibleCategories: e.target.checked ? [...v.rules.ot.eligibleCategories, k] : v.rules.ot.eligibleCategories.filter((x) => x !== k) })} /> {l}</label>)}</div></fieldset>
              <Field label="What changed and why" name="changeNote" error={error}><textarea rows="2" value={v.changeNote} disabled={!editable} onChange={(e) => setV({ ...v, changeNote: e.target.value })} data-testid="pe-note-field" /></Field>
              {editable && <div className="actions"><button type="button" className="btn" disabled={busy} onClick={() => save(false)} data-testid="pe-save">Save draft</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)} data-testid="pe-send">{busy ? 'Saving...' : 'Send for approval'}</button></div>}
            </form>
            <Examples rules={v.rules} />
          </>
        )}
        {tab === 'versions' && <Versions p={p} />}
        {tab === 'approvals' && <Approvals p={p} />}
        {tab === 'timeline' && <TimelineTab entity="att_policy" id={p.id} />}
        {tab === 'discussion' && <DiscussionTab entity="att_policy" id={p.id} />}
      </div>
    </section>
  );

  function Actions() {
    const c = p.can;
    return (
      <div data-testid="pe-actions">
        <div className="actions-row">
          {c.withdraw && <button type="button" className="btn" onClick={() => setMode('withdraw')} data-testid="pe-withdraw">Withdraw</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => setMode('cancel')} data-testid="pe-cancel">Cancel</button>}
          {c.delete && <button type="button" className="btn" onClick={() => { if (window.confirm('Delete this draft?')) run(() => att.policies.remove(p.id), 'Deleted.').then(() => navigateTo('/hr/attendance/policies')); }} data-testid="pe-delete">Delete draft</button>}
          {c.amend && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="pe-amend">New version</button>}
          {c.print && <a className="btn" href={`/api/v1/hr/att/policies/${p.id}/print`} target="_blank" rel="noreferrer" data-testid="pe-print">Print</a>}
        </div>
        {mode && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); if (mode === 'amend') run(() => att.policies.amend(p.id, amendFrom, reason), 'A new version was made: change its rules and send it for approval.').then((o) => o && navigateTo(`/hr/attendance/policies/policy?id=${o.id}`, { force: true })); else run(() => (mode === 'withdraw' ? att.policies.withdraw(p.id, reason) : att.policies.cancel(p.id, reason)), 'Done.'); }}>
          {mode === 'amend' && <Field label="The new version takes effect on" name="effectiveFrom" error={error}><input type="date" value={amendFrom} onChange={(e) => setAmendFrom(e.target.value)} data-testid="pe-amend-from" /></Field>}
          <Field label="Reason (required)" name="reason" error={error}><textarea rows="2" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="pe-reason" /></Field>
          <div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="pe-reason-go">Confirm</button></div></form>}
      </div>
    );
  }
}

/** Examples: scenarios worked out by the server with the rules as they are in the form, on the shift chosen. */
function Examples({ rules }) {
  const shifts = useQuery({ queryKey: ['hr', 'shifts', 'active'], queryFn: att.shifts.active, retry: false });
  const [shiftId, setShiftId] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const shift = shifts.data?.find((s) => String(s.id) === String(shiftId)) ?? shifts.data?.[0];
  const key = JSON.stringify(rules);
  const date = useMemo(() => dayIST(0), []);
  useEffect(() => {
    if (!shift) return undefined;
    const t = setTimeout(async () => {
      const len = shift.lengthMinutes; const st = shift.startTime; const r = toRules(rules);
      const sc = [
        ['Works the whole shift', 0, len],
        ['Arrives 25 minutes late', 25, len],
        ['Leaves 45 minutes early', 0, len - 45],
        ['Works 3 hours more than the shift', 0, len + 180],
        ['Third late mark of the period', 25, len, { lateMarksBefore: 2 }],
        ['Forgets to punch out', 0, null],
        ['Works on the weekly off', 0, len, { day: 'WEEKLY_OFF' }],
      ];
      try {
        const out = await Promise.all(sc.map(async ([label, inMin, outMin, extra]) => {
          const punchIn = at(date, st, inMin); const punchOut = outMin == null ? null : at(date, st, outMin);
          const res = await att.evaluate({ shiftId: shift.id, rules: r, date, punchIn, punchOut, ...(extra ?? {}) });
          return { label, punchIn, punchOut, res };
        }));
        setRows(out); setError(null);
      } catch (e) { setError(errorInfo(e)); setRows(null); }
    }, 350);
    return () => clearTimeout(t);
  }, [shift?.id, key, date]);
  return (
    <section className="mdm-panel" aria-labelledby="ex-title" data-testid="pe-examples">
      <h2 id="ex-title">Examples</h2>
      <Field label="Shift for the examples" name="shift" error={null}><select value={shift?.id ?? ''} onChange={(e) => setShiftId(e.target.value)} data-testid="pe-ex-shift">{(shifts.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.startTime} to {s.endTime}</option>)}</select></Field>
      {shifts.isSuccess && !shifts.data.length && <p className="muted">Make a shift first: the examples are worked out on a shift.</p>}
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {rows && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Examples"><table className="grid" data-testid="pe-ex-table"><thead><tr><th>What happens</th><th>Punches</th><th>Result</th><th>Worked</th><th>Marks</th><th>Overtime</th><th>Notes</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.label} data-testid="pe-ex-row"><td data-label="What happens">{x.label}</td><td data-label="Punches">{x.punchIn.slice(11)} to {x.punchOut ? x.punchOut.slice(11) : 'none'}</td><td data-label="Result">{x.res.status.replace(/_/g, ' ').toLowerCase()}</td><td data-label="Worked">{hoursText(x.res.workedMinutes)}</td>
            <td data-label="Marks">{[x.res.lateMark && `late ${x.res.lateMinutes} min`, x.res.earlyMark && `early ${x.res.earlyMinutes} min`, x.res.lateDeduction && 'half day off', x.res.compOff > 0 && `comp-off ${x.res.compOff}`].filter(Boolean).join(', ') || '—'}</td>
            <td data-label="Overtime">{x.res.otPaidMinutes ? `${hoursText(x.res.otPaidMinutes)} × ${x.res.otMultiplier}` : '—'}</td><td data-label="Notes">{x.res.notes.join('; ') || '—'}</td></tr>)}</tbody></table></div>
      )}
      <p className="muted small">{minOf('00:00') === 0 ? 'Worked out by the server for today, with the shift\'s own grace, hours and rounding.' : ''}</p>
    </section>
  );
}

function Versions({ p }) {
  const cmp = useQuery({ queryKey: ['hr', 'policy', p.id, 'compare'], queryFn: () => att.policies.compare(p.id), enabled: p.version > 1, retry: false });
  return (
    <div data-testid="pe-versions">
      <ol className="mdm-list">{p.versions.map((x) => <li key={x.id}>{x.id === p.id ? <strong>Version {x.version}</strong> : <Link to={`/hr/attendance/policies/policy?id=${x.id}`}>Version {x.version}</Link>} · from {formatDate(x.effectiveFrom)} · {REQ_STATUS[x.status]?.[1] ?? x.status}</li>)}</ol>
      {p.version > 1 && (cmp.isPending ? <Skeleton label="Comparing" rows={2} /> : cmp.isError ? <ErrorState error={cmp.error} onRetry={cmp.refetch} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Comparison with the version before"><table className="grid" data-testid="pe-compare"><thead><tr><th>Rule</th><th>Before</th><th>This version</th></tr></thead><tbody>{cmp.data.rows.filter((x) => x.changed).map((x) => <tr key={x.field}><td>{x.field}</td><td>{String(x.before ?? '—')}</td><td>{String(x.after ?? '—')}</td></tr>)}</tbody></table></div>
      ))}
    </div>
  );
}

function Approvals({ p }) {
  const items = (p.history?.approvals ?? []);
  if (!items.length) return <p className="muted">Nothing sent for approval yet.</p>;
  return <ol className="mdm-list" data-testid="pe-approvals">{items.map((a, i) => <li key={i}>{formatDateTime(a.at)} · {a.event} · {a.actor}{a.comment ? `: ${a.comment}` : ''}</li>)}</ol>;
}
void api;
