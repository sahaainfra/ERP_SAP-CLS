import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { AttachmentPanel } from '../../platform/object/panels.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { bill, fmtDate, qs } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './BillParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { useFlagOn } from '../../platform/shell/api.js';
import { useLongFormDraft } from '../../platform/forms/useLongFormDraft.js';
import { DraftBanner } from '../../platform/forms/layout.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';

// The measurement book (part 22.01): Record Measurement (a mobile form), the Measurement Book list with the entry and its checks, the MB Abstract and the book in print.
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }); const day = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const CHECK_TONE = { NOT_CHECKED: 'DRAFT', CHECKED: 'APPROVED', DIFFERENCE: 'RETURNED' };
const DIMS = { QTY: [], NOS: ['nos'], LENGTH: ['nos', 'length'], AREA: ['nos', 'length', 'breadth'], VOLUME: ['nos', 'length', 'breadth', 'depth'] };
const blank = { projectId: '', boqLineId: '', locationId: '', waId: '', activityId: '', irId: '', dprWorkId: '', drawingRef: '', description: '', template: 'VOLUME', nos: '1', length: '', breadth: '', depth: '', deduction: '0', qty: '', measuredOn: day() };
const num = (s) => (s === '' || s == null ? null : Number(s));
const payload = (v) => ({ projectId: Number(v.projectId), boqLineId: Number(v.boqLineId), locationId: v.locationId ? Number(v.locationId) : null, waId: v.waId ? Number(v.waId) : null, activityId: v.activityId ? Number(v.activityId) : null, irId: v.irId ? Number(v.irId) : null, dprWorkId: v.dprWorkId ? Number(v.dprWorkId) : null, drawingRef: v.drawingRef || null, description: v.description, template: v.template,
  nos: DIMS[v.template].includes('nos') ? num(v.nos) : null, length: DIMS[v.template].includes('length') ? num(v.length) : null, breadth: DIMS[v.template].includes('breadth') ? num(v.breadth) : null, depth: DIMS[v.template].includes('depth') ? num(v.depth) : null, deduction: Number(v.deduction || 0), qty: v.template === 'QTY' ? num(v.qty) : null, measuredOn: v.measuredOn });
const ready = (v) => v.projectId && v.boqLineId && v.description.trim().length >= 3 && (v.template === 'QTY' ? v.qty !== '' : DIMS[v.template].every((k) => v[k] !== ''));

function Issues({ issues }) {
  const t = useT('bill'); if (!issues?.length) return null;
  return <ul data-testid="bill-issues" className="mdm-panel" role="alert">{issues.map((i, n) => <li key={n} data-code={i.code} data-severity={i.severity}>{i.severity === 'BLOCK' ? '⛔' : i.severity === 'WARN' ? '⚠' : 'ℹ'} {i.message}</li>)}<li className="muted">{t('issuesNote')}</li></ul>;
}
function Cumulative({ c, uom }) {
  const t = useT('bill'); if (!c) return null;
  return <p data-testid="bill-cumulative" className="muted">{t('cumulative', { others: nf.format(c.others), total: nf.format(c.total), limit: nf.format(c.limit), uom: uom ?? '' })}</p>;
}

function MeasureForm({ onSaved }) {
  const t = useT('bill'); const { error, run, busy } = useRunner(); const [v, setV] = useState(blank); const fe = error?.fields ?? {};
  const o = useQuery({ queryKey: ['bill', 'mb-options'], queryFn: () => bill.get('/mb-entries/options'), retry: false });
  const body = ready(v) ? payload(v) : null;
  const pv = useQuery({ queryKey: ['bill', 'mb-preview', JSON.stringify(body)], queryFn: () => bill.post('/mb-entries/preview', body), enabled: Boolean(body), retry: false, placeholderData: (p) => p });
  // PACK-09: a draft of the measurement on the server and a question before leaving with unsaved changes
  const pack09 = useFlagOn('ff.forms.pack09');
  const ld = useLongFormDraft({ formCode: 'bill.mb_entry', values: v, enabled: pack09, title: v.description, projectId: v.projectId });
  const sg = useQuery({ queryKey: ['bill', 'mb-suggestions', v.projectId], queryFn: () => bill.get(`/mb-entries/suggestions${qs({ projectId: v.projectId })}`), enabled: Boolean(v.projectId), retry: false });
  if (o.error?.status === 403) return <NoPermission what={t('rec.title')} permission="bill.mb_entry.create" />; if (o.isPending) return <Skeleton label={t('rec.title')} rows={4} />; if (o.isError) return <ErrorState error={o.error} onRetry={o.refetch} />; const d = o.data;
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value }); const items = d.items.filter((i) => String(i.projectId) === String(v.projectId)); const locs = d.locations.filter((l) => String(l.projectId) === String(v.projectId));
  const item = items.find((i) => String(i.id) === String(v.boqLineId));
  const dims = DIMS[v.template]; const labels = { nos: t('rec.nos'), length: t('rec.length'), breadth: t('rec.breadth'), depth: t('rec.depth') };
  const use = (s) => setV({ ...v, description: v.description || s.activity, locationId: s.locationId ? String(s.locationId) : v.locationId, waId: s.waId ? String(s.waId) : v.waId, activityId: String(s.activityId), dprWorkId: String(s.id), ...(v.template === 'QTY' ? { qty: String(s.qty) } : {}) });
  return (
    <form className="mdm-panel" data-testid="bill-mb-form" onBlur={pack09 ? ld.onBlur : undefined} onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bill.post('/mb-entries', body)); if (r) { if (pack09) await ld.done().catch(() => null); onSaved(r); } }}>
      <ErrorLine error={error} id="bill-error" />
      {pack09 && <DraftBanner draft={ld.draft} onResume={() => { const p = ld.resume(); if (p) setV({ ...blank, ...p }); }} onDiscard={ld.discard} />}
      <div className="form-grid">
        <Field label={t('project')} name="projectId" error={fe.projectId}><select value={v.projectId} onChange={(e) => setV({ ...blank, projectId: e.target.value, measuredOn: v.measuredOn })} style={big} data-testid="bill-mb-project"><option value="">—</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('rec.item')} name="boqLineId" error={fe.boqLineId}><select value={v.boqLineId} onChange={(e) => { const i = items.find((x) => String(x.id) === e.target.value); setV({ ...v, boqLineId: e.target.value, description: v.description || (i ? i.description : '') }); }} style={big} data-testid="bill-mb-item"><option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.code} {i.description} ({i.uom})</option>)}</select></Field>
        <Field label={t('rec.location')} name="locationId" error={fe.locationId}><select value={v.locationId} onChange={set('locationId')} style={big} data-testid="bill-mb-location"><option value="">—</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
        <Field label={t('rec.wa')} name="waId" error={fe.waId}><select value={v.waId} onChange={set('waId')} style={big} data-testid="bill-mb-wa"><option value="">—</option>{d.workAuthorisations.map((w) => <option key={w.id} value={w.id}>{w.waNo}</option>)}</select></Field>
        <Field label={t('rec.ir')} name="irId" error={fe.irId}><select value={v.irId} onChange={set('irId')} style={big} data-testid="bill-mb-ir"><option value="">{t('rec.irAuto')}</option>{d.inspections.map((i) => <option key={i.id} value={i.id}>{i.docNo} · {i.pointType} · {i.result ?? '—'}</option>)}</select></Field>
        <Field label={t('rec.drawing')} name="drawingRef" error={fe.drawingRef}><input value={v.drawingRef} onChange={set('drawingRef')} style={big} maxLength={120} data-testid="bill-mb-drawing" /></Field>
        <Field label={t('rec.date')} name="measuredOn" error={fe.measuredOn}><input type="date" value={v.measuredOn} onChange={set('measuredOn')} style={big} data-testid="bill-mb-date" /></Field>
        <Field label={t('rec.description')} name="description" error={fe.description}><input value={v.description} onChange={set('description')} style={big} maxLength={1000} data-testid="bill-mb-description" /></Field>
        <Field label={t('rec.template')} name="template" error={fe.template}><select value={v.template} onChange={set('template')} style={big} data-testid="bill-mb-template">{d.templates.map((x) => <option key={x.id} value={x.id}>{t(`tpl.${x.id}`)}</option>)}</select></Field>
        {v.template === 'QTY' ? <Field label={t('rec.qty')} name="qty" error={fe.qty}><input type="number" inputMode="decimal" min="0" step="any" value={v.qty} onChange={set('qty')} style={big} data-testid="bill-mb-qty" /></Field>
          : dims.map((k) => <Field key={k} label={labels[k]} name={k} error={fe[k]}><input type="number" inputMode="decimal" min="0" step="any" value={v[k]} onChange={set(k)} style={big} data-testid={`bill-mb-${k}`} /></Field>)}
        <Field label={t('rec.deduction')} name="deduction" error={fe.deduction}><input type="number" inputMode="decimal" min="0" step="any" value={v.deduction} onChange={set('deduction')} style={big} data-testid="bill-mb-deduction" /></Field>
      </div>
      <div className="mdm-panel" data-testid="bill-mb-result"><div className="muted">{t('rec.computed')}</div><strong style={{ fontSize: '1.5rem' }} data-testid="bill-mb-computed">{pv.data ? `${nf.format(pv.data.qty)} ${pv.data.uom ?? ''}` : '—'}</strong>{pv.isError && <p className="field-error" role="alert">{pv.error?.message}</p>}
        {pv.data && <><Cumulative c={pv.data.cumulative} uom={pv.data.uom} /><Issues issues={pv.data.issues} /></>}{item && !pv.data && <p className="muted">{t('rec.boqQty', { qty: nf.format(item.qty), uom: item.uom })}</p>}</div>
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || !body} data-testid="bill-mb-save">{t('rec.save')}</button></div>
      {sg.data?.length > 0 && <div data-testid="bill-mb-suggestions"><h2>{t('rec.suggest')}</h2><p className="muted">{t('rec.suggestNote')}</p>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('rec.dpr')}</th><th>{t('rec.description')}</th><th>{t('rec.location')}</th><th className="num">{t('rec.reported')}</th><th /></tr></thead>
          <tbody>{sg.data.map((s) => <tr key={s.id} data-testid="bill-mb-suggestion"><td>{s.dprNo} · {fmtDate(s.date)}</td><td>{s.activity}</td><td>{s.location ?? '—'}</td><td className="num">{nf.format(s.qty)} {s.uom}</td><td><button type="button" className="btn" onClick={() => use(s)} data-testid="bill-mb-use">{t('rec.use')}</button></td></tr>)}</tbody></table></div></div>}
    </form>
  );
}

function CheckForm({ x, run, busy, error }) {
  const t = useT('bill'); const [c, setC] = useState({ checkedQty: String(x.qty), checkPct: '100', checkerName: '', checkerOrg: '', checkedOn: day(), signatureRef: '', note: '' }); const set = (k) => (e) => setC({ ...c, [k]: e.target.value }); const fe = error?.fields ?? {};
  return (
    <form className="mdm-panel no-print" data-testid="bill-check-form" onSubmit={async (e) => { e.preventDefault(); await run(() => bill.post(`/mb-entries/${x.id}/check`, { checkedQty: Number(c.checkedQty), checkPct: Number(c.checkPct), checkerName: c.checkerName, checkerOrg: c.checkerOrg || null, checkedOn: c.checkedOn, signatureRef: c.signatureRef || null, note: c.note || null }), t('chk.done')); }}>
      <h2>{t('chk.title')}</h2><p className="muted">{t('chk.intro')}</p>
      <div className="form-grid">
        <Field label={t('chk.qty')} name="checkedQty" error={fe.checkedQty}><input type="number" min="0" step="any" value={c.checkedQty} onChange={set('checkedQty')} style={big} data-testid="bill-check-qty" /></Field>
        <Field label={t('chk.pct')} name="checkPct" error={fe.checkPct}><input type="number" min="0" max="100" step="any" value={c.checkPct} onChange={set('checkPct')} style={big} data-testid="bill-check-pct" /></Field>
        <Field label={t('chk.name')} name="checkerName" error={fe.checkerName}><input value={c.checkerName} onChange={set('checkerName')} style={big} maxLength={120} data-testid="bill-check-name" /></Field>
        <Field label={t('chk.org')} name="checkerOrg" error={fe.checkerOrg}><input value={c.checkerOrg} onChange={set('checkerOrg')} style={big} maxLength={160} data-testid="bill-check-org" /></Field>
        <Field label={t('chk.date')} name="checkedOn" error={fe.checkedOn}><input type="date" value={c.checkedOn} onChange={set('checkedOn')} style={big} data-testid="bill-check-date" /></Field>
        <Field label={t('chk.signature')} name="signatureRef" error={fe.signatureRef}><input value={c.signatureRef} onChange={set('signatureRef')} style={big} maxLength={160} data-testid="bill-check-signature" /></Field>
        <Field label={t('chk.note')} name="note" error={fe.note}><input value={c.note} onChange={set('note')} style={big} maxLength={500} data-testid="bill-check-note" /></Field></div>
      <div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy || c.checkerName.trim().length < 2} data-testid="bill-check-save">{t('chk.save')}</button></div></form>
  );
}

function Entry({ id }) {
  const t = useT('bill'); const { q, guard } = useRecord('/mb-entries', id, t('mb.entry'), 'bill.mb_entry.view'); const { error, run, busy } = useRunner(); const [tab, setTab] = useState('values'); usePageTitle(t('mb.entry'));
  if (guard) return guard; const x = q.data; const row = (k, val) => <tr><th scope="row">{t(k)}</th><td>{val}</td></tr>;
  return (
    <div data-testid="bill-mb-object" data-status={x.status} data-check={x.checkStatus}><PageHeader id="mbe-h" title={<>{x.docNo} <Status x={x} /> <StatusBadge status={CHECK_TONE[x.checkStatus]} label={t(`chk.s.${x.checkStatus}`)} /></>} meta={<><Link to="/bill/mb-entries">{t('mb.title')}</Link> · {x.project} · {x.item} {x.itemDescription}{x.location ? ` · ${x.location}` : ''}{x.page ? ` · ${t('mb.pageLine', { book: x.book, page: x.page, line: x.line })}` : ''}</>} />
      <KpiRow><KpiTile label={t('mb.measured')} value={<>{nf.format(x.qty)} {x.uom}</>} kind="quantity" valueTestid="bill-mb-qty-value" />
        {x.checkStatus !== 'NOT_CHECKED' && <KpiTile label={t('mb.checked')} value={<>{nf.format(x.checkedQty)} {x.uom}</>} kind="quantity" valueTestid="bill-mb-checked">{x.checkDiff !== 0 && <div data-testid="bill-mb-diff">{t('mb.diff', { diff: nf.format(x.checkDiff) })}</div>}</KpiTile>}
        {x.status === 'APPROVED' && <KpiTile label={t('mb.certified')} value={<>{nf.format(x.certifiedQty)} {x.uom}</>} kind="quantity" valueTestid="bill-mb-certified"><div>{t('mb.locked')}</div></KpiTile>}</KpiRow>
      <ErrorLine error={error} id="bill-error" />
      <Issues issues={x.issues} /><Cumulative c={x.cumulative} uom={x.uom} />
      {x.can.check && <CheckForm x={x} run={run} busy={busy} error={error} />}
      <div className="actions-row no-print" role="tablist">{['values', 'check', 'documents'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`bill-mb-tab-${k}`}>{t(`mb.tab.${k}`)}</button>)}</div>
      {tab === 'values' && <div className="table-scroll" data-testid="bill-mb-tab-values-body"><table className="data-table"><tbody>{row('rec.description', x.description)}{row('rec.template', t(`tpl.${x.template}`))}{x.nos != null && row('rec.nos', nf.format(x.nos))}{x.length != null && row('rec.length', nf.format(x.length))}{x.breadth != null && row('rec.breadth', nf.format(x.breadth))}{x.depth != null && row('rec.depth', nf.format(x.depth))}{row('rec.deduction', nf.format(x.deduction))}{row('rec.drawing', x.drawingRef ?? '—')}{row('mb.measuredBy', `${x.measuredBy} · ${fmtDate(x.measuredOn)}`)}{row('mb.clientCheck', x.clientCheckRequired ? t('yes') : t('no'))}{x.period && row('mb.period', x.period)}</tbody></table></div>}
      {tab === 'check' && <div className="table-scroll" data-testid="bill-mb-tab-check-body">{x.checkStatus === 'NOT_CHECKED' ? <p className="muted">{t('chk.none')}</p> : <table className="data-table"><tbody>{row('chk.name', `${x.checkerName}${x.checkerOrg ? `, ${x.checkerOrg}` : ''}`)}{row('chk.date', fmtDate(x.checkedOn))}{row('chk.pct', `${x.checkPct}%`)}{row('chk.signature', x.signatureRef ?? '—')}{x.checkNote && row('chk.note', x.checkNote)}</tbody></table>}</div>}
      {tab === 'documents' && <AttachmentPanel type="bill_mb_entries" id={x.id} entity="bill_mb_entries" canEdit={x.can.edit} />}
      <DocBar kind="/mb-entries" x={x} printName={`${x.docNo.replaceAll('/', '-')}.pdf`} />
    </div>
  );
}

export function RecordMeasurementPage() {
  const t = useT('bill'); usePageTitle(t('rec.title'));
  return (<section aria-labelledby="rec-h" data-testid="bill-record"><PageHeader id="rec-h" title={t('rec.title')} subtitle={t('rec.intro')} meta={<Link to="/bill/mb-entries">{t('mb.title')}</Link>} /><MeasureForm onSaved={(r) => navigateTo(`/bill/mb-entries?id=${r.id}`)} /></section>);
}
export function MbEntriesPage() {
  const t = useT('bill'); usePageTitle(t('mb.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="mbe-h"><Entry id={id} /></section>;
  return (
    <section aria-labelledby="mbs-h" data-testid="bill-mb-list"><PageHeader id="mbs-h" title={t('mb.title')} subtitle={t('mb.intro')} />
      <div className="actions-row no-print"><Link to="/bill/mb-record" data-testid="bill-mb-new">{t('rec.title')}</Link> · <Link to="/bill/mb-abstract">{t('abs.title')}</Link></div>
      <ListReport listCode="bill.mb_entries" endpoint="/bill/mb-entries" title={t('mb.title')} session={session.data} rowHref={(r) => `/bill/mb-entries?id=${r.id}`} onOpen={(r) => navigateTo(`/bill/mb-entries?id=${r.id}`)} cardFields={['docNo', 'item', 'location', 'qty', 'check', 'status']} statusKey="status" empty={{ title: t('mb.emptyTitle'), text: t('mb.emptyBody') }} />
    </section>
  );
}
export function MbAbstractPage() {
  const t = useT('bill'); usePageTitle(t('abs.title')); const [f, setF] = useState({ projectId: '', period: day().slice(0, 7) }); const { error, run } = useRunner();
  const o = useQuery({ queryKey: ['bill', 'mb-options'], queryFn: () => bill.get('/mb-entries/options'), retry: false });
  const projects = o.data?.projects ?? []; const pid = f.projectId || (projects.length === 1 ? String(projects[0].id) : '');
  const q = useQuery({ queryKey: ['bill', 'mb-abstract', pid, f.period], queryFn: () => bill.get(`/mb-abstract${qs({ projectId: pid, period: f.period })}`), enabled: Boolean(pid), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('abs.title')} permission="bill.mb_entry.create" />; if (o.isPending) return <Skeleton label={t('abs.title')} rows={5} />; const d = q.data;
  return (
    <section aria-labelledby="abs-h" data-testid="bill-abstract"><PageHeader id="abs-h" title={t('abs.title')} subtitle={t('abs.intro')} />
      <div className="form-grid no-print"><Field label={t('project')} name="projectId" error={null}><select value={pid} onChange={(e) => setF({ ...f, projectId: e.target.value })} style={big} data-testid="bill-abs-project"><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('abs.period')} name="period" error={null}><input type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} style={big} data-testid="bill-abs-period" /></Field></div>
      <ErrorLine error={error} id="bill-error" />
      <div className="actions-row no-print"><button type="button" className="btn" disabled={!pid} onClick={() => run(() => bill.exportFile(`/mb-book/pdf${qs({ projectId: pid })}`, `mb-${pid}.pdf`), t('abs.pdfDone'))} data-testid="bill-abs-pdf">{t('abs.pdf')}</button></div>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !d ? <p className="muted">{t('abs.pick')}</p> : d.rows.length === 0 ? <div className="empty-state"><h2>{t('abs.emptyTitle')}</h2><p>{t('abs.emptyBody')}</p><Link to="/bill/mb-entries">{t('mb.title')}</Link></div> : (<>
        <p data-testid="bill-abs-totals">{t('abs.totals', { items: d.totals.items, entries: d.totals.entries, over: d.totals.over })}</p>
        <div className="table-scroll"><table className="data-table" data-testid="bill-abs-table"><thead><tr><th>{t('rec.item')}</th><th>{t('rec.description')}</th><th>{t('abs.uom')}</th><th className="num">{t('abs.boq')}</th><th className="num">{t('abs.previous')}</th><th className="num">{t('abs.current')}</th><th className="num">{t('abs.cumulative')}</th><th className="num">%</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.code} data-testid="bill-abs-row" data-over={r.over ? '1' : '0'}><td>{r.code}</td><td>{r.description}</td><td>{r.uom}</td><td className="num">{nf.format(r.boqQty)}</td><td className="num">{nf.format(r.previous)}</td><td className="num">{nf.format(r.current)}</td><td className="num">{nf.format(r.cumulative)}{r.over ? ' ⚠' : ''}</td><td className="num">{r.pct == null ? '—' : `${r.pct}%`}</td></tr>)}</tbody></table></div></>)}
    </section>
  );
}
