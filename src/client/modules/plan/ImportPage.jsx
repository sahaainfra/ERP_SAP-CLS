import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { RES_TYPES, fmtDate, pl, uploadSchedule } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Import Schedule (part 13.03, FR-04, BR-02): a file of MS Project (XML) or Primavera P6 (XML or XER) in three steps. 1 the file is read and checked for a working schedule: nothing changes yet;
// 2 the mapping (calendars, WBS nodes, resources, the field of the activity code, replace or merge) with the validation report worked out again by the server for every change;
// 3 the file is applied in one go and the schedule calculated. A file is only ever read into a draft or returned schedule, never into a baseline.
const IMP_TONE = { ANALYSED: 'DRAFT', IMPORTED: 'APPROVED', DISCARDED: 'CANCELLED' };
const WBS_SHOWN = 200;

function Notes({ t, kind, rows, total }) {
  if (!total) return null;
  return (
    <div data-testid={`imp-${kind}`} role={kind === 'errors' ? 'alert' : undefined}>
      <h3>{t(`imp.${kind}`, { n: total })}</h3>
      <ul className={kind === 'errors' ? 'field-error' : 'muted'}>{rows.map((n, i) => <li key={i}>{n.message}</li>)}</ul>
      {total > rows.length && <p className="muted">{t('imp.more', { n: total - rows.length })}</p>}
    </div>
  );
}

function Mapping({ t, imp, onChange, busy }) {
  const o = imp.options; const m = imp.mapping; const set = (patch) => onChange(patch);
  return (
    <form className="mdm-panel" onSubmit={(e) => e.preventDefault()} aria-label={t('imp.step2')} data-testid="imp-mapping">
      <h2>{t('imp.step2')}</h2>
      <div className="form-grid">
        <Field label={t('imp.mode')} name="mode"><select value={m.mode} disabled={busy} onChange={(e) => set({ mode: e.target.value })} data-testid="imp-mode"><option value="MERGE">{t('imp.mode.MERGE')}</option><option value="REPLACE">{t('imp.mode.REPLACE')}</option></select></Field>
        {o.codeFrom.length > 0 && <Field label={t('imp.codeFrom')} name="codeFrom"><select value={m.codeFrom} disabled={busy} onChange={(e) => set({ codeFrom: e.target.value })} data-testid="imp-codefrom">{o.codeFrom.map((c) => <option key={c.code} value={c.code}>{t(`imp.codeFrom.${c.code}`)}</option>)}</select></Field>}
        <label className="check"><input type="checkbox" checked={m.useFileStart} disabled={busy || !o.file.start} onChange={(e) => set({ useFileStart: e.target.checked })} data-testid="imp-usestart" /> {t('imp.useFileStart', { d: fmtDate(o.file.start) })}</label>
        <label className="check"><input type="checkbox" checked={m.progress} disabled={busy} onChange={(e) => set({ progress: e.target.checked })} data-testid="imp-progress" /> {t('imp.progress')}</label>
        <label className="check"><input type="checkbox" checked={m.resourcesOn !== false} disabled={busy} onChange={(e) => set({ resourcesOn: e.target.checked })} data-testid="imp-resources-on" /> {t('imp.resourcesOn')}</label>
      </div>
      <div className="table-scroll"><table className="data-table" data-testid="imp-calendars"><caption>{t('imp.calendars')}</caption>
        <thead><tr><th>{t('imp.inFile')}</th><th>{t('imp.week')}</th><th className="num">{t('imp.holidays')}</th><th className="num">{t('f.activities')}</th><th>{t('imp.mapsTo')}</th></tr></thead>
        <tbody>{o.fileCalendars.map((c) => (
          <tr key={c.key}><td>{c.name}{c.isDefault ? ` · ${t('imp.default')}` : ''}</td><td>{c.workWeek}</td><td className="num">{c.holidays}</td><td className="num">{c.activities}</td>
            <td><select aria-label={t('imp.mapCalendar', { n: c.name })} value={m.calendars[c.key] ?? ''} disabled={busy} onChange={(e) => set({ calendars: { [c.key]: e.target.value ? Number(e.target.value) : null } })} data-testid="imp-cal-map"><option value="">{t('imp.scheduleCalendar')}</option>{o.calendars.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></td></tr>
        ))}</tbody></table></div>
      {o.fileWbs.length > 0 && (
        <div className="table-scroll"><table className="data-table" data-testid="imp-wbs"><caption>{t('imp.wbs')}</caption>
          <thead><tr><th>{t('imp.inFile')}</th><th className="num">{t('f.activities')}</th><th>{t('imp.mapsTo')}</th></tr></thead>
          <tbody>{o.fileWbs.slice(0, WBS_SHOWN).map((w) => (
            <tr key={w.key}><td>{w.code} {w.name}</td><td className="num">{w.activities}</td>
              <td><select aria-label={t('imp.mapWbs', { n: w.code })} value={m.wbs[w.key] ?? ''} disabled={busy} onChange={(e) => set({ wbs: { [w.key]: e.target.value ? Number(e.target.value) : null } })} data-testid="imp-wbs-map"><option value="">{t('act.noWbs')}</option>{o.wbs.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></td></tr>
          ))}</tbody></table>{o.fileWbs.length > WBS_SHOWN && <p className="muted">{t('imp.more', { n: o.fileWbs.length - WBS_SHOWN })}</p>}</div>
      )}
      {o.fileResources.length > 0 && m.resourcesOn !== false && (
        <div className="table-scroll"><table className="data-table" data-testid="imp-res"><caption>{t('imp.resources')}</caption>
          <thead><tr><th>{t('imp.inFile')}</th><th className="num">{t('imp.assignments')}</th><th>{t('f.type')}</th><th>{t('imp.trade')}</th><th>{t('f.uom')}</th><th>{t('imp.skip')}</th></tr></thead>
          <tbody>{o.fileResources.map((r) => { const x = m.resources[r.key] ?? {}; const put = (p) => set({ resources: { [r.key]: { type: x.type, itemId: x.itemId ?? null, trade: x.trade ?? null, uom: x.uom ?? null, skip: Boolean(x.skip), ...p } } }); return (
            <tr key={r.key}><td>{r.code ? `${r.code} · ` : ''}{r.name}</td><td className="num">{r.assignments}</td>
              <td><select aria-label={t('f.type')} value={x.type} disabled={busy || Boolean(x.itemId)} onChange={(e) => put({ type: e.target.value })} data-testid="imp-res-type">{RES_TYPES.map((k) => <option key={k} value={k}>{t(`r.type.${k}`)}</option>)}</select></td>
              <td>{x.itemId ? t('imp.itemMatched') : <input aria-label={t('imp.trade')} defaultValue={x.trade ?? ''} disabled={busy} maxLength={80} onBlur={(e) => e.target.value.trim() !== (x.trade ?? '') && put({ trade: e.target.value.trim() || null })} />}</td>
              <td><input aria-label={t('f.uom')} defaultValue={x.uom ?? ''} disabled={busy} maxLength={20} size={8} onBlur={(e) => e.target.value.trim() !== (x.uom ?? '') && put({ uom: e.target.value.trim() || null })} /></td>
              <td><input type="checkbox" aria-label={t('imp.skip')} checked={Boolean(x.skip)} disabled={busy} onChange={(e) => put({ skip: e.target.checked })} /></td></tr>
          ); })}</tbody></table></div>
      )}
    </form>
  );
}

export default function ImportPage() {
  const t = useT('plan');
  usePageTitle(t('imp.title'));
  const sp = useSearch(); const qc = useQueryClient();
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(Number(sp.get('scheduleId')) || null); const [importId, setImportId] = useState(Number(sp.get('importId')) || null);
  const [file, setFile] = useState(null); const [format, setFormat] = useState(''); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const sq = useQuery({ queryKey: ['plan', 'schedule', scheduleId], queryFn: () => pl.schedule(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const lq = useQuery({ queryKey: ['plan', 'imports', scheduleId], queryFn: () => pl.imports(scheduleId), enabled: Boolean(scheduleId) && sq.isSuccess, retry: false });
  const iq = useQuery({ queryKey: ['plan', 'import', importId], queryFn: () => pl.importOf(importId), enabled: Boolean(importId), retry: false });
  useEffect(() => { if (iq.data && !scheduleId) setScheduleId(iq.data.scheduleId); }, [iq.data, scheduleId]);
  if (lq.error?.status === 403 || iq.error?.status === 403) return <NoPermission what={t('imp.title')} permission="plan.schedule.import" />;
  const s = sq.data; const imp = iq.data; const pid = projectId ?? s?.projectId ?? null; const working = s && ['DRAFT', 'RETURNED'].includes(s.status);
  const fresh = (x) => { qc.setQueryData(['plan', 'import', x.id], x); qc.invalidateQueries({ queryKey: ['plan', 'imports'] }); };
  const read = async (e) => {
    e.preventDefault(); if (!file) return; setError(null); setBusy(true);
    try { const x = await uploadSchedule(scheduleId, file, format); fresh(x); setImportId(x.id); setFile(null); } catch (x) { setError({ form: [x.message, ...(x.details ?? []).map((d) => d.message)].join(' ') }); } finally { setBusy(false); }
  };
  const run = async (fn) => { setError(null); setBusy(true); try { const x = await fn(); fresh(x); if (x.status === 'IMPORTED') qc.invalidateQueries({ queryKey: ['plan'] }); return x; } catch (x) { setError(errorInfo(x)); return null; } finally { setBusy(false); } };
  const rep = imp?.result?.report; const ap = imp?.result?.applied;
  return (
    <section aria-labelledby="imp-h" data-testid="plan-import">
      <PageHeader id="imp-h" title={t('imp.title')} subtitle={t('imp.intro')} />
      <form className="mdm-panel no-print" onSubmit={read} aria-label={t('imp.step1')} data-testid="imp-step1">
        <h2>{t('imp.step1')}</h2>
        <SchedulePicker projectId={pid} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); setImportId(null); }} onSchedule={(v) => { setScheduleId(v); setImportId(null); }} editableOnly testId="imp" />
        {s && !working && <p className="field-error" role="alert" data-testid="imp-locked">{t('imp.locked', { d: s.docNo, s: t(`st.${s.status}`) })}</p>}
        <div className="form-grid">
          <Field label={t('imp.file')} name="file"><input type="file" accept=".xml,.xer,application/xml,text/xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required data-testid="imp-file" /></Field>
          <Field label={t('imp.format')} name="format"><select value={format} onChange={(e) => setFormat(e.target.value)} data-testid="imp-format"><option value="">{t('imp.format.auto')}</option><option value="MSP_XML">MS Project XML</option><option value="P6_XML">Primavera P6 XML</option><option value="P6_XER">Primavera P6 XER</option></select></Field>
        </div>
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !file || !working} data-testid="imp-read">{t('imp.read')}</button></div>
      </form>
      {error?.form && <p className="field-error" role="alert" data-testid="imp-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {importId && iq.isPending && <Skeleton label={t('imp.title')} rows={4} />}
      {iq.isError && iq.error?.status !== 403 && <ErrorState error={iq.error} onRetry={iq.refetch} />}
      {imp && (
        <div data-testid="imp-current" data-status={imp.status}>
          <h2>{imp.fileName} <StatusBadge status={IMP_TONE[imp.status]} label={t(`imp.st.${imp.status}`)} /></h2>
          {rep && (
            <dl className="kv" data-testid="imp-summary">
              <div><dt>{t('imp.format')}</dt><dd>{imp.formatLabel}</dd></div><div><dt>{t('f.schedule')}</dt><dd>{imp.scheduleDocNo}</dd></div><div><dt>{t('f.activities')}</dt><dd data-testid="imp-n-acts">{rep.summary.activities}</dd></div>
              <div><dt>{t('bl.links')}</dt><dd>{rep.summary.links}</dd></div><div><dt>{t('imp.calendars')}</dt><dd>{rep.summary.calendars}</dd></div><div><dt>{t('imp.wbsMatched')}</dt><dd>{rep.summary.wbsMatched} / {rep.summary.wbsNodes}</dd></div>
              <div><dt>{t('imp.assignments')}</dt><dd>{rep.summary.assignments}</dd></div><div><dt>{t('f.start')}</dt><dd>{fmtDate(rep.summary.start)}</dd></div><div><dt>{t('f.finish')}</dt><dd>{fmtDate(rep.summary.finish)}</dd></div>
              <div><dt>{t('imp.willAdd')}</dt><dd>{rep.summary.toAdd}</dd></div><div><dt>{t('imp.willUpdate')}</dt><dd>{rep.summary.toUpdate}</dd></div><div><dt>{t('imp.willRemove')}</dt><dd>{rep.summary.toRemove}</dd></div>
            </dl>
          )}
          {imp.status === 'ANALYSED' && imp.options && <Mapping t={t} imp={imp} busy={busy} onChange={(patch) => run(() => pl.updateImport(imp.id, { mapping: patch, rowVersion: imp.rowVersion }))} />}
          {rep && (
            <div className="mdm-panel" data-testid="imp-report">
              <h2>{t('imp.report')}</h2>
              {rep.errorCount === 0 && <p className="mdm-banner" role="status" data-testid="imp-ok">{t('imp.noErrors', { n: rep.warningCount })}</p>}
              <Notes t={t} kind="errors" rows={rep.errors} total={rep.errorCount} /><Notes t={t} kind="warnings" rows={rep.warnings} total={rep.warningCount} /><Notes t={t} kind="info" rows={rep.info} total={rep.info.length} />
            </div>
          )}
          {imp.status === 'ANALYSED' && (
            <div className="mdm-panel no-print" data-testid="imp-step3">
              <h2>{t('imp.step3')}</h2><p className="muted">{t('imp.applyHint', { d: imp.scheduleDocNo })}</p>
              <div className="actions">
                <button type="button" className="btn btn-primary" disabled={busy || !imp.can.apply} onClick={() => run(() => pl.importAct(imp.id, 'apply', { rowVersion: imp.rowVersion }))} data-testid="imp-apply">{t('imp.apply')}</button>
                <button type="button" className="btn" disabled={busy} onClick={() => run(() => pl.importAct(imp.id, 'discard'))} data-testid="imp-discard">{t('imp.discard')}</button>
              </div>
            </div>
          )}
          {ap && (
            <div className="mdm-panel" data-testid="imp-result">
              <h2>{t('imp.applied')}</h2>
              <dl className="kv">
                <div><dt>{t('imp.created')}</dt><dd data-testid="imp-created">{ap.created}</dd></div><div><dt>{t('imp.updated')}</dt><dd>{ap.updated}</dd></div><div><dt>{t('imp.removed')}</dt><dd>{ap.removed}</dd></div><div><dt>{t('bl.links')}</dt><dd>{ap.links}</dd></div><div><dt>{t('imp.assignments')}</dt><dd>{ap.resources}</dd></div>
                <div><dt>{t('f.finish')}</dt><dd data-testid="imp-finish">{fmtDate(ap.finish)}</dd></div><div><dt>{t('imp.fileFinish')}</dt><dd>{fmtDate(ap.fileFinish)}</dd></div><div><dt>{t('imp.datesDiffer')}</dt><dd data-testid="imp-differ">{ap.datesDiffer} / {ap.datesCompared}</dd></div>
              </dl>
              {ap.sample.length > 0 && (
                <div className="table-scroll"><table className="data-table"><caption>{t('imp.differCaption')}</caption><thead><tr><th>{t('f.code')}</th><th>{t('imp.fileDates')}</th><th>{t('imp.hereDates')}</th></tr></thead>
                  <tbody>{ap.sample.map((x) => <tr key={x.code}><td>{x.code}</td><td>{fmtDate(x.fileStart)} – {fmtDate(x.fileFinish)}</td><td>{fmtDate(x.start)} – {fmtDate(x.finish)}</td></tr>)}</tbody></table></div>
              )}
              <p><Link to={`/plan/gantt?scheduleId=${imp.scheduleId}`}>{t('g.title')}</Link> · <Link to={`/plan/activities?scheduleId=${imp.scheduleId}`}>{t('act.title')}</Link> · <Link to={`/plan/variance?scheduleId=${imp.scheduleId}&tab=quality`}>{t('q.title')}</Link></p>
            </div>
          )}
        </div>
      )}
      {!scheduleId && <p className="muted" data-testid="imp-choose">{t('imp.choose')}</p>}
      {lq.data && lq.data.rows.length > 0 && (
        <div className="table-scroll"><table className="data-table" data-testid="imp-list"><caption>{t('imp.earlier')}</caption>
          <thead><tr><th>{t('imp.file')}</th><th>{t('imp.format')}</th><th>{t('f.status')}</th><th className="num">{t('f.activities')}</th><th>{t('bl.who')}</th><th>{t('bl.when')}</th></tr></thead>
          <tbody>{lq.data.rows.map((x) => <tr key={x.id} aria-current={x.id === importId ? 'true' : undefined}><td><button type="button" className="link" onClick={() => setImportId(x.id)} data-testid="imp-open">{x.fileName}</button></td><td>{x.formatLabel}</td><td>{t(`imp.st.${x.status}`)}</td><td className="num">{x.activities}</td><td>{x.importedBy ?? x.createdBy}</td><td>{String(x.importedAt ?? x.createdAt).slice(0, 16).replace('T', ' ')}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}
