import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import ListReport from '../../platform/list/ListReport.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, gl, gst, money } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.07: the GST pages — the e-invoice and e-way bill register (e-invoices with their status, error and retry; the IRN-due worklist; e-way bills with their
// validity, vehicle update, extension and cancellation) and the GST settings (dated versions proposed by the accounts manager and approved by the CFO, the GSP
// connector, the company GSTINs with their check, the tax engine to try).
const big = { minHeight: 'var(--erp-target-large)', fontSize: '1rem' };
const can = (session, p) => Boolean(session?.permissions?.includes(p));
const guardOf = (q, what, permission) => (q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null);
const TONE = { PENDING: 'IN_REVIEW', GENERATED: 'APPROVED', ACTIVE: 'APPROVED', PART_A: 'IN_REVIEW', FAILED: 'REJECTED', BLOCKED: 'REJECTED', CANCELLED: 'CANCELLED', EXPIRED: 'CANCELLED' };
const LEVEL = { GREEN: 'APPROVED', AMBER: 'IN_REVIEW', RED: 'RETURNED', BLOCKED: 'REJECTED' };
const Tabs = ({ tabs, tab, setTab, label }) => (
  <div className="actions-row" role="tablist" aria-label={label}>{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn pill${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => setTab(k)} data-testid={`gst-tab-${k}`}>{l}</button>)}</div>
);
const Rows = ({ rows }) => <dl className="kv-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, max-content) 1fr', gap: '4px 12px', margin: 0 }}>{rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt className="muted">{k}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v}</dd></div>)}</dl>;
const why = (t) => { const r = globalThis.prompt?.(t('gst.remarkPrompt')); return r && r.trim().length >= 3 ? r.trim() : null; };

// ---- one e-invoice ----
function Einvoice({ id }) {
  const t = useT('gst'); const q = useQuery({ queryKey: ['gl', 'gst-einv', id], queryFn: () => gst.einvoice(id), retry: false }); const { error, note, busy, run } = useGlRunner(); usePageTitle(t('ei.one'));
  const g = guardOf(q, t('ei.one'), 'fin.einvoice.view'); if (g) return g; const x = q.data;
  return (
    <div data-testid="gst-einvoice" data-status={x.status}>
      <PageHeader id="gei-h" title={<>{x.documentNo} <StatusBadge status={TONE[x.status]} label={t(`ei.st.${x.status}`)} /></>} subtitle={`${t(`ei.kind.${x.kind}`)} · ${x.documentDate} · ${money(x.total)}${x.mode === 'SANDBOX' ? ` · ${t('gst.sandbox')}` : ''}`} meta={<Link to="/finance/e-invoices">{t('ei.title')}</Link>} />
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      {x.error && x.status !== 'GENERATED' && <p className="field-error" role="alert" data-testid="gst-einv-error">{x.errorCode ? `${x.errorCode}: ` : ''}{x.error}</p>}
      <div className="mdm-panel"><Rows rows={[[t('ei.supplier'), x.sellerGstin], [t('ei.recipient'), x.buyerGstin ?? 'URP'], [t('ei.taxable'), money(x.taxable)], [t('ei.tax'), money(x.tax)], [t('ei.total'), money(x.total)], [t('ei.irn'), x.irn], [t('ei.ack'), x.ackNo ? `${x.ackNo} · ${x.ackDate}` : null], [t('ei.reportBy'), x.dueBy], [t('ei.attempts'), String(x.attempts)], [t('ei.cancelled'), x.cancelledAt ? `${x.cancelledAt} · ${x.cancelReason}: ${x.cancelRemark}` : null]]} /></div>
      {x.status === 'GENERATED' && <div className="mdm-panel" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}><img src={`/api/v1/fin/einvoices/${x.id}/qr`} alt={t('ei.qrAlt', { no: x.documentNo })} width={168} height={168} style={{ background: 'var(--erp-color-bg-surface)', padding: 4 }} data-testid="gst-qr" /><span className="muted small" style={{ maxWidth: '28rem' }}>{t('ei.qrNote')}</span></div>}
      <div className="actions-row ff-actionbar">
        {x.can.retry && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => gst.einvAct(x.id, 'retry'), t('ei.retried'))} data-testid="gst-retry">{t('ei.retry')}</button>}
        {x.can.print && <button type="button" className="btn" style={big} onClick={() => gl.file(`/einvoices/${x.id}/print`, `${x.documentNo.replaceAll('/', '-')}-e-invoice.pdf`).catch(() => globalThis.alert?.(t('gst.fileFailed')))}>{t('ei.print')}</button>}
        {x.can.cancel && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = why(t); if (r) run(() => gst.einvAct(x.id, 'cancel', { reasonCode: '2', remark: r }), t('ei.cancelledNote')); }} data-testid="gst-cancel">{t('ei.cancel')}</button>}
      </div>
      <h2>{t('gst.log')}</h2>
      {x.log.length === 0 ? <EmptyState compact title={t('gst.noLog')} message={t('gst.noLogBody')} /> : <ul className="lp-list" aria-label={t('gst.log')}>{x.log.map((l) => <li key={l.id} style={{ minHeight: 'var(--erp-target-min)' }}><StatusBadge status={l.outcome === 'OK' ? 'APPROVED' : 'REJECTED'} label={l.outcome} /> {l.at.slice(0, 19).replace('T', ' ')} · {l.action} · {l.by}{l.error ? ` · ${l.error}` : ''}{l.correlationId ? <span className="muted small"> ({l.correlationId})</span> : null}</li>)}</ul>}
    </div>
  );
}

// ---- the IRN-due worklist ----
function Due() {
  const t = useT('gst'); const session = useSession(); const q = useQuery({ queryKey: ['gl', 'gst-due'], queryFn: gst.due, retry: false }); const { error, note, busy, run } = useGlRunner();
  const g = guardOf(q, t('due.title'), 'fin.einvoice.view'); if (g) return g; const x = q.data;
  return (
    <div data-testid="gst-due"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <KpiRow label={t('due.title')}><KpiTile label={t('due.open')} value={String(x.counts.total)} valueTestid="gst-due-total" /><KpiTile label={t('due.amber')} value={String(x.counts.amber)} /><KpiTile label={t('due.red')} value={String(x.counts.red)} /><KpiTile label={t('due.blocked')} value={String(x.counts.blocked)} /></KpiRow>
      <p className="muted small">{x.windowApplies ? t('due.window', { days: x.windowDays, alerts: x.alertDays.join(', ') }) : t('due.noWindow')}</p>
      {x.rows.length === 0 ? <EmptyState title={t('due.none')} message={t('due.noneBody')} /> : <ul className="lp-list" aria-label={t('due.title')}>{x.rows.map((r) => (
        <li key={`${r.documentType}${r.documentId}`} className="mdm-panel" data-testid="gst-due-row" data-level={r.level} style={{ display: 'grid', gap: 6, padding: 12, margin: '8px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{r.documentNo}</strong><StatusBadge status={LEVEL[r.level]} label={r.daysLeft == null ? t('due.noLimit') : r.daysLeft < 0 ? t('due.lapsed') : t('due.daysLeft', { n: r.daysLeft })} /></div>
          <span className="muted small">{t(`due.kind.${r.documentType}`)} · {r.date} · {money(r.value)}{r.recipientGstin ? ` · ${r.recipientGstin}` : ''}{r.status !== 'NONE' ? ` · ${t(`ei.st.${r.status}`)}` : ''}</span>
          {r.error && <span className="field-error small">{r.error}</span>}
          <div className="actions-row">
            {r.can.generate && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => gst.generate({ documentType: r.documentType, documentId: r.documentId }), t('ei.generated')).then(() => q.refetch())} data-testid={`gst-gen-${r.documentId}`}>{t('due.generate')}</button>}
            {r.can.retry && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => gst.einvAct(r.einvoiceId, 'retry'), t('ei.retried')).then(() => q.refetch())}>{t('ei.retry')}</button>}
            {r.einvoiceId && <Link to={`/finance/e-invoices?id=${r.einvoiceId}`}>{t('due.open1')}</Link>}
          </div>
        </li>))}</ul>}
      {!can(session.data, 'fin.einvoice.generate') && <p className="muted small">{t('due.readOnly')}</p>}
    </div>
  );
}

// ---- e-way bills ----
function EwbForm({ onDone }) {
  const t = useT('gst'); const src = useQuery({ queryKey: ['gl', 'gst-ewb-sources'], queryFn: gst.ewbSources, retry: false }); const [pick, setPick] = useState(''); const [f, setF] = useState(null); const { error, busy, run } = useGlRunner();
  const g = guardOf(src, t('ewb.new'), 'fin.ewaybill.generate'); if (g) return g;
  const choose = async (v) => { setPick(v); if (!v) { setF(null); return; } const [documentType, documentId] = v.split(':'); const p = await run(() => gst.ewbPrepare({ documentType, documentId })); if (p) setF({ ...p, distance: '', vehicleNo: p.vehicleNo ?? '', toPin: p.toPin ?? '', fromPin: p.fromPin ?? '', hsn: p.hsn ?? '' }); };
  const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="mdm-panel" data-testid="gst-ewb-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => gst.ewbCreate({ documentType: f.documentType, documentId: f.documentId, fromGstin: f.fromGstin || undefined, toGstin: f.toGstin || null, fromState: f.fromState || undefined, toState: f.toState || undefined, fromPin: f.fromPin || undefined, toPin: f.toPin || undefined, distance: Number(f.distance), hsn: f.hsn || undefined, vehicleNo: f.vehicleNo || null }), t('ewb.made')); if (r) onDone(r); }}>
      <h2>{t('ewb.new')}</h2><GlError error={error} />
      <Field label={t('ewb.document')} name="doc" error={null}><select value={pick} onChange={(e) => choose(e.target.value)} style={big} data-testid="gst-ewb-doc"><option value="">—</option>{src.data.map((s) => <option key={`${s.documentType}:${s.documentId}`} value={`${s.documentType}:${s.documentId}`}>{t(`due.kind.${s.documentType}`)} {s.documentNo} · {s.date}{s.value ? ` · ${money(s.value)}` : ''}</option>)}</select></Field>
      {src.data.length === 0 && <EmptyState compact title={t('ewb.noSources')} message={t('ewb.noSourcesBody')} />}
      {f && <>
        {f.existing && <p className="mdm-banner">{t('ewb.exists', { no: f.existing.ewbNo ?? '—' })}</p>}
        {!f.enabled && <p className="field-error">{t('ewb.off')}</p>}
        <p className="muted small">{f.required ? t('ewb.required') : t('ewb.notRequired', { threshold: money(f.threshold) })}</p>
        <div className="form-grid">
          <Field label={t('ewb.fromGstin')} name="fromGstin" error={fe.fromGstin}><input value={f.fromGstin ?? ''} onChange={set('fromGstin')} style={big} maxLength={15} autoCapitalize="characters" /></Field>
          <Field label={t('ewb.toGstin')} name="toGstin" error={fe.toGstin}><input value={f.toGstin ?? ''} onChange={set('toGstin')} style={big} maxLength={15} autoCapitalize="characters" /></Field>
          <Field label={t('ewb.fromState')} name="fromState" error={fe.fromState}><input inputMode="numeric" value={f.fromState ?? ''} onChange={set('fromState')} style={big} maxLength={2} /></Field>
          <Field label={t('ewb.toState')} name="toState" error={fe.toState}><input inputMode="numeric" value={f.toState ?? ''} onChange={set('toState')} style={big} maxLength={2} /></Field>
          <Field label={t('ewb.fromPin')} name="fromPin" error={fe.fromPin}><input inputMode="numeric" value={f.fromPin} onChange={set('fromPin')} style={big} maxLength={6} /></Field>
          <Field label={t('ewb.toPin')} name="toPin" error={fe.toPin}><input inputMode="numeric" value={f.toPin} onChange={set('toPin')} style={big} maxLength={6} data-testid="gst-ewb-topin" /></Field>
          <Field label={t('ewb.distance')} name="distance" error={fe.distance}><input inputMode="numeric" value={f.distance} onChange={set('distance')} style={big} required data-testid="gst-ewb-distance" /></Field>
          <Field label={t('ewb.hsn')} name="hsn" error={fe.hsn}><input inputMode="numeric" value={f.hsn} onChange={set('hsn')} style={big} maxLength={8} /></Field>
          <Field label={t('ewb.vehicle')} name="vehicleNo" error={fe.vehicleNo}><input value={f.vehicleNo} onChange={set('vehicleNo')} style={big} maxLength={15} autoCapitalize="characters" data-testid="gst-ewb-vehicle" /></Field>
        </div>
        <p className="muted small">{t('ewb.value', { value: money(f.value), tax: money(f.tax) })}</p>
        <div className="ff-actionbar"><button type="submit" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy || !f.enabled || Boolean(f.existing)} data-testid="gst-ewb-go">{t('ewb.generate')}</button></div>
      </>}
    </form>
  );
}
function Ewb({ id }) {
  const t = useT('gst'); const q = useQuery({ queryKey: ['gl', 'gst-ewb', id], queryFn: () => gst.ewb(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); const [veh, setVeh] = useState(''); const [km, setKm] = useState(''); usePageTitle(t('ewb.one'));
  const g = guardOf(q, t('ewb.one'), 'fin.ewaybill.view'); if (g) return g; const x = q.data;
  return (
    <div data-testid="gst-ewb" data-status={x.status}>
      <PageHeader id="gew-h" title={<>{x.ewbNo ?? x.docNo} <StatusBadge status={TONE[x.status]} label={t(`ewb.st.${x.status}`)} /></>} subtitle={`${x.documentNo} · ${x.fromState} → ${x.toState} · ${x.distance} km${x.mode === 'SANDBOX' ? ` · ${t('gst.sandbox')}` : ''}`} meta={<Link to="/finance/e-invoices?tab=ewb">{t('ewb.title')}</Link>} />
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}{x.error && x.status === 'FAILED' && <p className="field-error" role="alert">{x.error}</p>}
      <KpiRow label={t('ewb.one')}><KpiTile label={t('ewb.validUntil')} value={x.validUntil ? new Date(x.validUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'} valueTestid="gst-ewb-valid" /><KpiTile label={t('ewb.hoursLeft')} value={x.hoursLeft == null ? '—' : String(Math.round(x.hoursLeft))} /><KpiTile label={t('ewb.extensions')} value={String(x.extensions)} /></KpiRow>
      <div className="mdm-panel"><Rows rows={[[t('ewb.fromGstin'), x.fromGstin], [t('ewb.toGstin'), x.toGstin ?? 'URP'], [t('ewb.pins'), `${x.fromPin} → ${x.toPin}`], [t('ewb.hsn'), x.hsn], [t('ewb.valueL'), money(x.value)], [t('ewb.vehicle'), x.vehicleNo ?? t('ewb.noVehicle')], [t('ewb.generatedAt'), x.ewbDate?.slice(0, 19).replace('T', ' ')]]} /></div>
      {x.can.vehicle && <div className="mdm-panel"><h2>{t('ewb.partB')}</h2><div className="form-grid"><Field label={t('ewb.vehicle')} name="veh" error={error?.fields?.vehicleNo}><input value={veh} onChange={(e) => setVeh(e.target.value)} style={big} autoCapitalize="characters" maxLength={15} data-testid="gst-ewb-newveh" /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !veh} onClick={() => { const r = why(t); if (r) run(() => gst.ewbAct(x.id, 'vehicle', { vehicleNo: veh, fromPlace: r.slice(0, 50), reasonCode: '4', remark: r.slice(0, 50), version: x.version }), t('ewb.vehicleDone')); }} data-testid="gst-ewb-partb">{t('ewb.updateVehicle')}</button></div></div>}
      {x.can.extend && <div className="mdm-panel"><h2>{t('ewb.extend')}</h2><div className="form-grid"><Field label={t('ewb.kmLeft')} name="km" error={error?.fields?.remainingKm}><input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} style={big} /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !km} onClick={() => { const r = why(t); if (r) run(() => gst.ewbAct(x.id, 'extend', { remainingKm: Number(km), fromPlace: r.slice(0, 50), reasonCode: '99', remark: r.slice(0, 50) }), t('ewb.extended')); else setError({ form: t('gst.remarkPrompt') }); }}>{t('ewb.extend')}</button></div></div>}
      <div className="actions-row ff-actionbar">
        {x.can.retry && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => gst.ewbAct(x.id, 'retry'), t('ei.retried'))}>{t('ei.retry')}</button>}
        {x.can.cancel && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = why(t); if (r) run(() => gst.ewbAct(x.id, 'cancel', { reasonCode: '4', remark: r.slice(0, 50) }), t('ewb.cancelledNote')); }} data-testid="gst-ewb-cancel">{t('ewb.cancel')}</button>}
      </div>
      <h2>{t('ewb.history')}</h2>
      <ul className="lp-list">{x.history.map((h, i) => <li key={i} style={{ minHeight: 'var(--erp-target-min)' }}>{h.at.slice(0, 19).replace('T', ' ')} · {t(`ewb.h.${h.what}`)}{h.vehicleNo ? ` · ${h.vehicleNo}` : ''}{h.reason ? ` · ${h.reason}` : ''} · {h.by}</li>)}</ul>
    </div>
  );
}

/** The e-way bills alone, for the store and transport people who do not see e-invoices. */
export function EwayBillRegisterPage() { return <EinvoiceRegisterPage initial="ewb" />; }
export function EinvoiceRegisterPage({ initial = 'einv' }) {
  const t = useT('gst'); usePageTitle(t('ei.title')); const sp = useSearch(); const session = useSession(); const [tab, setTab0] = useState(sp.get('tab') ?? initial); const [adding, setAdding] = useState(Boolean(sp.get('new')));
  const setTab = (k) => { setTab0(k); setAdding(false); };
  if (Number(sp.get('id'))) return <section aria-labelledby="gei-h"><Einvoice id={Number(sp.get('id'))} /></section>;
  if (Number(sp.get('ewb'))) return <section aria-labelledby="gew-h"><Ewb id={Number(sp.get('ewb'))} /></section>;
  const tabs = [['einv', t('ei.tab')], ['due', t('due.tab')], ['ewb', t('ewb.tab')]].filter(([k]) => (k === 'ewb' ? can(session.data, 'fin.ewaybill.view') : can(session.data, 'fin.einvoice.view')));
  return (
    <section aria-labelledby="gst-h" data-testid="gst-register">
      <PageHeader id="gst-h" title={t('ei.title')} subtitle={t('ei.intro')} meta={<Link to="/finance/gst-settings">{t('set.title')}</Link>} />
      <Tabs tabs={tabs} tab={tab} setTab={setTab} label={t('ei.title')} />
      {tab === 'einv' && <ListReport listCode="fin.einvoices" endpoint="/fin/einvoices" title={t('ei.tab')} session={session.data} rowHref={(r) => `/finance/e-invoices?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/e-invoices?id=${r.id}`)} cardFields={['documentNo', 'documentDate', 'total', 'irn', 'status']} statusKey="status" dateKey="documentDate" empty={{ title: t('ei.emptyTitle'), text: t('ei.emptyBody') }} />}
      {tab === 'due' && <Due />}
      {tab === 'ewb' && <>
        {adding ? <EwbForm onDone={(r) => navigateTo(`/finance/e-invoices?ewb=${r.id}`)} /> : null}
        <ListReport listCode="fin.ewaybills" endpoint="/fin/ewaybills" title={t('ewb.title')} session={session.data} rowHref={(r) => `/finance/e-invoices?ewb=${r.id}`} onOpen={(r) => navigateTo(`/finance/e-invoices?ewb=${r.id}`)} cardFields={['ewbNo', 'documentNo', 'vehicleNo', 'validUntil', 'hoursLeft', 'status']} statusKey="status"
          newAction={adding ? undefined : { label: t('ewb.new'), permission: 'fin.ewaybill.generate', onClick: () => setAdding(true) }} empty={{ title: t('ewb.emptyTitle'), text: t('ewb.emptyBody') }} />
      </>}
    </section>
  );
}

// ---- GST settings ----
const SET_FIELDS = [
  ['einvoice', [['einvoiceEnabled', 'bool'], ['aato', 'money'], ['einvoiceThreshold', 'money'], ['irnWindowAato', 'money'], ['irnWindowDays', 'int'], ['irnAlertDays', 'list'], ['irnCancelHours', 'int']]],
  ['eway', [['ewayEnabled', 'bool'], ['ewayThreshold', 'money'], ['ewayMaxDocAgeDays', 'int'], ['ewayKmPerDay', 'int'], ['ewayOdcKmPerDay', 'int'], ['ewayExtWindowHours', 'int'], ['ewayExtCapDays', 'int'], ['ewayCancelHours', 'int'], ['ewayAlertHours', 'int']]],
  ['gsp', [['gspConnector', 'connector'], ['gspMode', 'mode']]],
];
const shown = (t, k, ty, v) => (ty === 'bool' ? (v ? t('set.on') : t('set.off')) : ty === 'money' ? money(v) : ty === 'list' ? (v ?? []).join(', ') : v == null || v === '' ? '—' : String(v));
function SettingsForm({ cur, connectors, onDone }) {
  const t = useT('gst'); const [f, setF] = useState({ ...cur, effectiveFrom: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), changeNote: '', irnAlertDays: (cur.irnAlertDays ?? []).join(', ') }); const { error, busy, run } = useGlRunner(); const fe = error?.fields ?? {};
  const set = (k, ty) => (e) => setF({ ...f, [k]: ty === 'bool' ? e.target.checked : e.target.value });
  const body = () => { const b = { effectiveFrom: f.effectiveFrom, changeNote: f.changeNote }; for (const [, fs] of SET_FIELDS) for (const [k, ty] of fs) b[k] = ty === 'int' ? Number(f[k]) : ty === 'list' ? String(f[k]).split(/[,\s]+/).filter(Boolean).map(Number) : ty === 'money' ? String(f[k] ?? '0') : ty === 'connector' ? (f[k] || null) : f[k]; return b; };
  return (
    <form className="mdm-panel" data-testid="gst-set-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(async () => { const x = await gst.createSettings(body()); await gst.settingsAct(x.id, 'submit'); return x; }, t('set.sent')); if (r) onDone(); }}>
      <h2>{t('set.new')}</h2><p className="muted small">{t('set.newIntro')}</p><GlError error={error} />
      <div className="form-grid">
        <Field label={t('set.f.effectiveFrom')} name="effectiveFrom" error={fe.effectiveFrom}><input type="date" value={f.effectiveFrom} onChange={set('effectiveFrom')} style={big} /></Field>
        <Field label={t('set.f.changeNote')} name="changeNote" error={fe.changeNote}><input value={f.changeNote} onChange={set('changeNote')} style={big} maxLength={300} required data-testid="gst-set-note" /></Field>
      </div>
      {SET_FIELDS.map(([grp, fs]) => <fieldset key={grp} className="mdm-panel"><legend>{t(`set.g.${grp}`)}</legend><p className="muted small">{t(`set.g.${grp}.d`)}</p><div className="form-grid">{fs.map(([k, ty]) => (
        <Field key={k} label={t(`set.f.${k}`)} name={k} error={fe[k]}>{ty === 'bool' ? <input type="checkbox" checked={Boolean(f[k])} onChange={set(k, 'bool')} style={{ width: 28, height: 28 }} data-testid={`gst-set-${k}`} />
          : ty === 'connector' ? <select value={f[k] ?? ''} onChange={set(k)} style={big} data-testid="gst-set-connector"><option value="">—</option>{connectors.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name} ({c.provider}, {c.status})</option>)}</select>
            : ty === 'mode' ? <select value={f[k]} onChange={set(k)} style={big}><option value="SANDBOX">{t('set.SANDBOX')}</option><option value="PRODUCTION">{t('set.PRODUCTION')}</option></select>
              : <input inputMode={ty === 'money' ? 'decimal' : 'numeric'} value={f[k] ?? ''} onChange={set(k)} style={big} />}</Field>))}</div></fieldset>)}
      <div className="ff-actionbar"><button type="submit" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy} data-testid="gst-set-go">{t('set.send')}</button></div>
    </form>
  );
}
function Version({ id }) {
  const t = useT('gst'); const q = useQuery({ queryKey: ['gl', 'gst-set', id], queryFn: () => gst.settingsOne(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); const [comment, setComment] = useState('');
  const g = guardOf(q, t('set.version'), 'fin.gst_setting.view'); if (g) return g; const x = q.data;
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('set.sayWhy') }); return; } run(() => gl.decide(x.can.taskId, action, comment.trim() || null), t(`set.done.${action}`)); };
  return (
    <div data-testid="gst-set-version" data-status={x.status}>
      <PageHeader id="gsv-h" title={<>{x.docNo} <StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={t(`set.st.${x.status}`)} /></>} subtitle={`${t('set.f.effectiveFrom')} ${x.effectiveFrom} · ${x.changeNote ?? ''}`} meta={<Link to="/finance/gst-settings">{t('set.title')}</Link>} />
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      {SET_FIELDS.map(([grp, fs]) => <div key={grp} className="mdm-panel"><h2>{t(`set.g.${grp}`)}</h2><Rows rows={fs.map(([k, ty]) => [t(`set.f.${k}`), shown(t, k, ty, x[k])])} /></div>)}
      {x.can.approve && x.can.taskId && <div className="mdm-panel no-print"><h2>{t('set.decision')}</h2><label>{t('set.comment')}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => decide('approve')} data-testid="gst-set-approve">{t('set.approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('return')}>{t('set.return')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('reject')}>{t('set.reject')}</button></div></div>}
      <div className="actions-row">{x.can.withdraw && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = why(t); if (r) run(() => gst.settingsAct(x.id, 'withdraw', { reason: r }), t('set.withdrawn')); }}>{t('set.withdraw')}</button>}{x.can.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => gst.settingsAct(x.id, 'submit'), t('set.sent'))}>{t('set.send')}</button>}{x.can.delete && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(async () => { await gst.removeSettings(x.id); navigateTo('/finance/gst-settings'); })}>{t('set.delete')}</button>}</div>
      <h2>{t('set.history')}</h2><ul className="lp-list">{[...x.history.approvals.map((h) => ({ at: h.at, what: `${h.event}${h.step_code ? ` (${h.step_code})` : ''}`, who: h.actor, why: h.comment })), ...x.history.audit.map((h) => ({ at: h.at, what: h.action, who: h.actor, why: h.reason }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((h, i) => <li key={i} style={{ minHeight: 'var(--erp-target-min)' }}>{String(h.at).slice(0, 19).replace('T', ' ')} · {h.what} · {h.who}{h.why ? ` · ${h.why}` : ''}</li>)}</ul>
    </div>
  );
}
function Resolver() {
  const t = useT('gst'); const [f, setF] = useState({ docDate: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), supplierGstin: '', recipientGstin: '', propertyState: '', supplyKind: 'B2B', hsn: '', taxable: '' }); const { error, busy, run } = useGlRunner(); const [out, setOut] = useState(null); const set = (k) => (e) => setF({ ...f, [k]: e.target.value }); const fe = error?.fields ?? {};
  return (
    <form className="mdm-panel" data-testid="gst-resolver" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => gst.resolve({ docDate: f.docDate, supplierGstin: f.supplierGstin || null, recipientGstin: f.recipientGstin || null, propertyState: f.propertyState || null, supplyKind: f.supplyKind, lines: [{ hsn: f.hsn, taxable: f.taxable || '0' }] })); if (r) setOut(r); }}>
      <h2>{t('res.title')}</h2><p className="muted small">{t('res.intro')}</p><GlError error={error} />
      <div className="form-grid">
        <Field label={t('res.date')} name="docDate" error={fe.docDate}><input type="date" value={f.docDate} onChange={set('docDate')} style={big} /></Field>
        <Field label={t('res.supplier')} name="supplierGstin" error={fe.supplierGstin}><input value={f.supplierGstin} onChange={set('supplierGstin')} style={big} maxLength={15} autoCapitalize="characters" /></Field>
        <Field label={t('res.recipient')} name="recipientGstin" error={fe.recipientGstin}><input value={f.recipientGstin} onChange={set('recipientGstin')} style={big} maxLength={15} autoCapitalize="characters" /></Field>
        <Field label={t('res.property')} name="propertyState" error={fe.propertyState}><input inputMode="numeric" value={f.propertyState} onChange={set('propertyState')} style={big} maxLength={2} /></Field>
        <Field label={t('res.kind')} name="supplyKind" error={fe.supplyKind}><select value={f.supplyKind} onChange={set('supplyKind')} style={big}>{['B2B', 'B2C', 'SEZ', 'EXPORT', 'IMPORT'].map((k) => <option key={k} value={k}>{t(`res.k.${k}`)}</option>)}</select></Field>
        <Field label={t('res.hsn')} name="hsn" error={fe['lines.0.hsn'] ?? fe.lines}><input inputMode="numeric" value={f.hsn} onChange={set('hsn')} style={big} maxLength={8} /></Field>
        <Field label={t('res.taxable')} name="taxable" error={fe['lines.0.taxable']}><input inputMode="decimal" value={f.taxable} onChange={set('taxable')} style={big} /></Field>
      </div>
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy}>{t('res.go')}</button></div>
      {out && <div data-testid="gst-resolved"><Rows rows={[[t('res.pos'), out.placeOfSupply], [t('res.heads'), out.taxHeads], [t('res.rate'), `${out.lines[0].gstRate}% (${out.lines[0].rateCode}, ${out.lines[0].rateDate})`], ['CGST', money(out.lines[0].cgst)], ['SGST', money(out.lines[0].sgst)], ['IGST', money(out.lines[0].igst)], [t('res.rcm'), out.lines[0].reverseCharge ? t('set.on') : t('set.off')], [t('res.value'), money(out.totals.invoiceValue)]]} /><ul className="muted small">{out.basis.map((b) => <li key={b}>{b}</li>)}</ul></div>}
    </form>
  );
}
export function GstSettingsPage() {
  const t = useT('gst'); usePageTitle(t('set.title')); const sp = useSearch(); const session = useSession(); const [adding, setAdding] = useState(false); const q = useQuery({ queryKey: ['gl', 'gst-settings'], queryFn: gst.settings, retry: false }); const { error, note, busy, run } = useGlRunner();
  if (Number(sp.get('id'))) return <section aria-labelledby="gsv-h"><Version id={Number(sp.get('id'))} /></section>;
  const g = guardOf(q, t('set.title'), 'fin.gst_setting.view'); const x = q.data;
  const importFile = async (file) => { const content = JSON.parse(await file.text()); const r = await run(() => gst.importSettings({ content, effectiveFrom: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), changeNote: file.name.slice(0, 100) }), t('set.imported')); if (r) navigateTo(`/finance/gst-settings?id=${r.id}`); };
  return (
    <section aria-labelledby="gset-h" data-testid="gst-settings">
      <PageHeader id="gset-h" title={t('set.title')} subtitle={t('set.intro')} meta={<Link to="/finance/e-invoices">{t('ei.title')}</Link>} actions={x?.canCreate && !adding ? <button type="button" className="btn btn-primary" style={big} onClick={() => setAdding(true)} data-testid="gst-set-new">{t('set.new')}</button> : null} />
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      {g ?? <>
        {adding && <SettingsForm cur={x.current} connectors={x.connectors} onDone={() => { setAdding(false); q.refetch(); }} />}
        <KpiRow label={t('set.title')}><KpiTile label={t('set.f.einvoiceEnabled')} value={shown(t, '', 'bool', x.current.einvoiceEnabled)} valueTestid="gst-set-einv" /><KpiTile label={t('set.f.ewayEnabled')} value={shown(t, '', 'bool', x.current.ewayEnabled)} /><KpiTile label={t('set.f.gspMode')} value={t(`set.${x.current.gspMode}`)} /><KpiTile label={t('set.f.aato')} value={money(x.current.aato)} amount={x.current.aato} kind="money" /></KpiRow>
        {!x.current.id && <p className="mdm-banner">{t('set.none')}</p>}
        {SET_FIELDS.map(([grp, fs]) => <div key={grp} className="mdm-panel"><h2>{t(`set.g.${grp}`)}</h2><p className="muted small">{t(`set.g.${grp}.d`)}</p><Rows rows={fs.map(([k, ty]) => [t(`set.f.${k}`), shown(t, k, ty, x.current[k])])} /></div>)}
        <div className="mdm-panel" data-testid="gst-gstins"><h2>{t('set.gstins')}</h2><p className="muted small">{t('set.gstinsD')}</p>
          {x.gstins.length === 0 ? <EmptyState compact title={t('set.noGstin')} message={t('set.noGstinBody')} action={<Link to="/admin/company-settings">{t('set.companySettings')}</Link>} /> : <ul className="lp-list">{x.gstins.map((s) => <li key={s.gstin} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minHeight: 'var(--erp-target-min)' }}><strong>{s.gstin}</strong><span className="muted small">{s.name} · {s.source}</span>{s.check && <StatusBadge status={s.check.status === 'ACTIVE' ? 'APPROVED' : s.check.formatOk ? 'IN_REVIEW' : 'REJECTED'} label={`${s.check.status} · ${s.check.checkedAt.slice(0, 10)}`} />}{can(session.data, 'fin.gstin.check') && <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy} onClick={() => run(() => gst.checkGstin({ gstin: s.gstin }), t('set.checked')).then(() => q.refetch())}>{t('set.check')}</button>}</li>)}</ul>}
        </div>
        <h2>{t('set.versions')}</h2>
        {x.versions.length === 0 ? <EmptyState compact title={t('set.noVersions')} message={t('set.noVersionsBody')} /> : <ul className="lp-list" aria-label={t('set.versions')}>{x.versions.map((v) => <li key={v.id} className="mdm-panel" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minHeight: 'var(--erp-target-min)', padding: 12 }}><Link to={`/finance/gst-settings?id=${v.id}`}>{v.docNo}</Link><StatusBadge status={JN_TONE[v.status] ?? 'CANCELLED'} label={t(`set.st.${v.status}`)} /><span className="muted small">{t('set.f.effectiveFrom')} {v.effectiveFrom} · {v.changeNote} · {v.requestedBy}{v.approvedBy ? ` → ${v.approvedBy}` : ''}</span></li>)}</ul>}
        <div className="actions-row">
          {can(session.data, 'fin.gst_setting.export') && <button type="button" className="btn" style={big} onClick={() => gl.file('/gst/settings/export', 'gst-settings.json').catch(() => globalThis.alert?.(t('gst.fileFailed')))}>{t('set.export')}</button>}
          {x.canCreate && <label className="btn" style={{ ...big, display: 'inline-flex', alignItems: 'center' }}>{t('set.import')}<input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} /></label>}
        </div>
        {can(session.data, 'fin.gst.resolve') && <Resolver />}
      </>}
    </section>
  );
}
