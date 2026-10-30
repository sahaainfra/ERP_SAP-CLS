import { useRef, useState } from 'react';
import readXlsxFile from 'read-excel-file/browser';
import {
  useAddHoliday, useCreateCalendar, useDeleteHoliday, useHolidayCalendar, useHolidayCalendars, useImportHolidays,
} from '../api/index.js';
import { formatDate } from '../../../platform/format.js';
import { GST_STATES } from '../../../../shared/gst.js';
import { Field, FormDialog, QueryState, can, errorInfo, usePageTitle } from './ui.jsx';

const TYPES = ['national', 'state', 'company', 'site', 'optional'];
const isoDate = (v) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').trim();
};

/** Read an .xlsx with columns Date, Name, Type (first row is the heading) into the rows the import API takes. */
export async function rowsFromWorkbook(file) {
  const sheet = await readXlsxFile(file);
  return sheet.slice(1).filter((r) => r.some((c) => c != null && c !== '')).map((r) => ({ date: isoDate(r[0]), name: String(r[1] ?? '').trim(), type: String(r[2] ?? 'company').trim().toLowerCase() }));
}

export default function HolidaysPage({ session }) {
  usePageTitle('Holiday Calendars');
  const calendars = useHolidayCalendars();
  const [selected, setSelected] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const current = selected ?? calendars.data?.[0]?.id ?? null;
  const detail = useHolidayCalendar(current, year);
  const createCal = useCreateCalendar();
  const addHoliday = useAddHoliday();
  const deleteHoliday = useDeleteHoliday();
  const importRows = useImportHolidays();
  const canEdit = can(session, 'core.holiday.configure');
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState([]);
  const [notice, setNotice] = useState('');
  const calDialog = useRef(null);
  const holDialog = useRef(null);

  const run = async (fn, dialog, done) => {
    setError(null);
    try {
      await fn();
      dialog?.current?.close();
      setNotice(done);
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const open = (dialog) => {
    setError(null);
    dialog.current?.showModal();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProblems([]);
    setNotice('');
    try {
      const rows = await rowsFromWorkbook(file);
      const out = await importRows.mutateAsync({ calendarId: current, rows });
      setNotice(`Imported: ${out.added} added, ${out.updated} updated, ${out.unchanged} unchanged.`);
    } catch (err) {
      const info = errorInfo(err);
      setProblems(err.details?.length ? err.details.map((d) => d.message) : [info.form]);
      setNotice('Nothing was imported.');
    }
  };

  const cal = detail.data;
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Configuration &rsaquo; Holiday Calendars</nav>
      <div className="page-head">
        <h1 id="page-title">Holiday Calendars</h1>
        <button type="button" className="btn btn-primary" disabled={!canEdit} onClick={() => open(calDialog)}>Add calendar</button>
      </div>
      <p className="muted">A company-wide calendar applies everywhere; a state or site calendar adds holidays for that place. A day is a working day if it is neither a weekly off nor a holiday.</p>
      <p role="status" className="notice">{notice}</p>
      <QueryState query={calendars} what="holiday calendars" permission="authenticated access" />
      {calendars.data?.length === 0 && <div className="state"><h2>No calendar yet</h2><p>Add a calendar, then add holidays one by one or import an Excel file.</p></div>}

      {calendars.data?.length > 0 && (
        <>
          <div className="toolbar">
            <label className="field field-inline"><span>Calendar</span>
              <select value={current ?? ''} onChange={(e) => setSelected(Number(e.target.value))} data-testid="calendar-select">
                {calendars.data.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name} ({c.holidayCount})</option>)}
              </select>
            </label>
            <label className="field field-inline"><span>Year</span><input type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
            <button type="button" className="btn" disabled={!canEdit} onClick={() => open(holDialog)}>Add holiday</button>
            <label className={`btn ${canEdit ? '' : 'btn-disabled'}`}>
              Import Excel
              <input type="file" accept=".xlsx" className="sr-only" disabled={!canEdit} onChange={onFile} aria-label="Import holidays from an Excel file" />
            </label>
          </div>
          <p className="muted small">Excel columns: Date (YYYY-MM-DD), Name, Type ({TYPES.join(', ')}). The first row is the heading. If any row is wrong nothing is imported.</p>
          {problems.length > 0 && (
            <div className="state state-error" role="alert">
              <h2>The file was not imported</h2>
              <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {cal && cal.holidays.length === 0 && <p className="muted">No holidays in {year} for this calendar.</p>}
          {cal?.holidays.length > 0 && (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Holidays in {year}</caption>
                <thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th /></tr></thead>
                <tbody>
                  {cal.holidays.map((h) => (
                    <tr key={h.id} data-testid={`holiday-${h.date}`}>
                      <td data-label="Date">{formatDate(h.date)}</td><td data-label="Holiday">{h.name}</td><td data-label="Type">{h.type}</td>
                      <td>{canEdit && <button type="button" className="link" aria-label={`Delete ${h.name}`} onClick={() => run(() => deleteHoliday.mutateAsync(h.id), null, `${h.name} deleted.`)}>Delete</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <FormDialog dialogRef={calDialog} title="Add holiday calendar" reason error={error} busy={createCal.isPending}
        onSubmit={(f) => run(() => createCal.mutateAsync({ code: String(f.get('code')), name: String(f.get('name')), stateCode: String(f.get('stateCode')) || null, siteId: f.get('siteId') ? Number(f.get('siteId')) : null, reason: String(f.get('reason')) }), calDialog, 'Calendar added.')}>
        <Field label="Code" name="code" error={error}><input name="code" required /></Field>
        <Field label="Name" name="name" error={error}><input name="name" required /></Field>
        <Field label="State (leave empty for company-wide)" name="stateCode" error={error}>
          <select name="stateCode" defaultValue=""><option value="">All states</option>{GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select>
        </Field>
        <Field label="Site ID (optional)" name="siteId" error={error}><input name="siteId" type="number" min="1" /></Field>
      </FormDialog>

      <FormDialog dialogRef={holDialog} title="Add holiday" reason={false} error={error} busy={addHoliday.isPending}
        onSubmit={(f) => run(() => addHoliday.mutateAsync({ calendarId: current, date: String(f.get('date')), name: String(f.get('name')), type: String(f.get('type')) }), holDialog, 'Holiday added.')}>
        <Field label="Date" name="date" error={error}><input name="date" type="date" required /></Field>
        <Field label="Name" name="name" error={error}><input name="name" required /></Field>
        <Field label="Type" name="type" error={error}><select name="type" defaultValue="company">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
      </FormDialog>
    </section>
  );
}
