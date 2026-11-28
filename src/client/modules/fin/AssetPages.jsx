import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import ListReport from '../../platform/list/ListReport.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, fa, gl, money } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.09: the asset register (list, the asset with its depreciation schedule, transfer, disposal and their approvals, physical verification by QR tag) and the
// asset accounting page (capitalise from a bill, CWIP, the equipment register or a small asset; run the month's depreciation; the fixed asset schedule; the tax
// depreciation by block).
const big = { minHeight: 'var(--erp-target-large)', fontSize: '1rem' };
const can = (session, p) => Boolean(session?.permissions?.includes(p));
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const lastMonth = () => { const d = new Date(`${istToday().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const fyNow = () => { const t = istToday(); const y = Number(t.slice(0, 4)); const s = Number(t.slice(5, 7)) >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };
const guardOf = (q, what, permission) => (q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null);
const Pills = ({ tabs, tab, setTab, label, prefix }) => <div className="actions-row" role="tablist" aria-label={label}>{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => setTab(k)} data-testid={`${prefix}-${k}`}>{l}</button>)}</div>;
const Rows = ({ rows }) => <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, max-content) 1fr', gap: '4px 12px', margin: 0 }}>{rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt className="muted">{k}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v}</dd></div>)}</dl>;
function Decide({ x, run, busy, t, testid }) {
  const [comment, setComment] = useState(''); const [err, setErr] = useState(null);
  if (!x?.can?.approve || !x.can.taskId) return null;
  const go = (a) => { if (a !== 'approve' && comment.trim().length < 5) { setErr(t('fa.sayWhy')); return; } run(() => gl.decide(x.can.taskId, a, comment.trim() || null), t(`fa.done.${a}`)); };
  return <div className="mdm-panel no-print" data-testid={testid}><h2>{t('fa.decision')}</h2>{err && <p className="field-error" role="alert">{err}</p>}<label>{t('fa.comment')}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label><div className="actions-row"><button type="button" className="btn btn-primary" style={{ ...big, flex: '1 1 10rem' }} disabled={busy} onClick={() => go('approve')} data-testid={`${testid}-approve`}>{t('fa.approve')}</button><button type="button" className="btn" style={{ ...big, flex: '1 1 10rem' }} disabled={busy} onClick={() => go('return')}>{t('fa.return')}</button><button type="button" className="btn" style={{ ...big, flex: '1 1 10rem' }} disabled={busy} onClick={() => go('reject')}>{t('fa.reject')}</button></div></div>;
}

// ---- one asset ----
function DisposeForm({ asset, onDone }) {
  const t = useT('fa'); const [f, setF] = useState({ date: istToday(), method: 'SALE', buyerPartnerId: '', proceeds: '', hsn: asset.hsn ?? '', reason: '' }); const { error, busy, run } = useGlRunner(); const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="mdm-panel" data-testid="fa-dispose-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(async () => { const d = await fa.createDisposal({ assetId: asset.id, date: f.date, method: f.method, buyerPartnerId: f.buyerPartnerId ? Number(f.buyerPartnerId) : null, proceeds: f.method === 'WRITE_OFF' ? undefined : f.proceeds || '0', hsn: f.hsn || null, reason: f.reason }); await fa.disposalAct(d.id, 'submit'); return d; }, t('fa.disposalSent')); if (r) onDone(); }}>
      <h2>{t('fa.dispose')}</h2><p className="muted small">{t('fa.disposeIntro')}</p><GlError error={error} />
      <div className="form-grid">
        <Field label={t('fa.method')} name="method" error={fe.method}><select value={f.method} onChange={set('method')} style={big}>{['SALE', 'SCRAP', 'WRITE_OFF'].map((m) => <option key={m} value={m}>{t(`fa.m.${m}`)}</option>)}</select></Field>
        <Field label={t('fa.date')} name="date" error={fe.date}><input type="date" value={f.date} onChange={set('date')} style={big} /></Field>
        {f.method !== 'WRITE_OFF' && <Field label={t('fa.proceeds')} name="proceeds" error={fe.proceeds}><input inputMode="decimal" value={f.proceeds} onChange={set('proceeds')} style={big} data-testid="fa-proceeds" /></Field>}
        {f.method === 'SALE' && <Field label={t('fa.buyer')} name="buyerPartnerId" error={fe.buyerPartnerId}><input inputMode="numeric" value={f.buyerPartnerId} onChange={set('buyerPartnerId')} style={big} /></Field>}
        {f.method !== 'WRITE_OFF' && <Field label={t('fa.hsn')} name="hsn" error={fe.hsn}><input inputMode="numeric" value={f.hsn} onChange={set('hsn')} style={big} maxLength={8} /></Field>}
        <Field label={t('fa.reason')} name="reason" error={fe.reason}><input value={f.reason} onChange={set('reason')} style={big} maxLength={300} required data-testid="fa-reason" /></Field>
      </div>
      <div className="ff-actionbar"><button type="submit" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy} data-testid="fa-dispose-go">{t('fa.sendDisposal')}</button></div>
    </form>
  );
}
function Asset({ id }) {
  const t = useT('fa'); const q = useQuery({ queryKey: ['gl', 'fa-asset', id], queryFn: () => fa.asset(id), retry: false }); const { error, note, busy, run } = useGlRunner(); const [tab, setTab] = useState('schedule'); const [mode, setMode] = useState(null); const [to, setTo] = useState({ projectId: '', custodian: '', reason: '' }); usePageTitle(t('fa.asset'));
  const g = guardOf(q, t('fa.asset'), 'fin.asset.view'); if (g) return g; const x = q.data; const c = x.can; const sched = x.depreciation;
  return (
    <div data-testid="fa-asset" data-status={x.status} data-state={x.state}>
      <PageHeader id="faa-h" title={<>{x.docNo} <StatusBadge status={x.state === 'DISPOSED' ? 'CANCELLED' : JN_TONE[x.status] ?? 'DRAFT'} label={x.state === 'IN_USE' ? t('fa.s.IN_USE') : x.state === 'DISPOSED' ? t('fa.s.DISPOSED') : t(`fa.st.${x.status}`)} /></>} subtitle={`${x.description} · ${x.className}`} meta={<Link to="/finance/assets">{t('fa.register')}</Link>} />
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <KpiRow label={t('fa.asset')}><KpiTile label={t('fa.nbv')} value={money(x.wdv)} amount={x.wdv} kind="money" valueTestid="fa-nbv" /><KpiTile label={t('fa.cost')} value={money(x.cost)} amount={x.cost} kind="money" /><KpiTile label={t('fa.accumulated')} value={money(x.accumulated)} amount={x.accumulated} kind="money" /></KpiRow>
      <div className="mdm-panel"><Rows rows={[[t('fa.capDate'), x.capDate], [t('fa.source'), x.sourceLabel], [t('fa.project'), x.project], [t('fa.custodian'), x.custodian], [t('fa.methodL'), `${x.method}${x.wdvRatePct ? ` ${x.wdvRatePct}%` : ''} · ${t('fa.life', { n: x.lifeMonths })} · ${t('fa.residualL')} ${money(x.residual)}`], [t('fa.taxBlock'), `${x.taxBlock} · ${x.taxRate}%`], [t('fa.qr'), x.qr], [t('fa.verified'), x.lastVerifiedOn]]} /></div>
      {(x.components?.length > 0 || x.parent) && <div className="mdm-panel" data-testid="fa-components"><h2>{x.parent ? t('fa.componentOf') : t('fa.components')}</h2>{x.parent ? <p><Link to={`/finance/assets?id=${x.parent.id}`}>{x.parent.docNo} · {x.parent.description}</Link></p> : <><ul className="lp-list">{x.components.map((k) => <li key={k.id} style={{ minHeight: 'var(--erp-target-min)' }}><Link to={`/finance/assets?id=${k.id}`}>{k.docNo}</Link> · {k.description} · {k.capDate} · {money(k.cost)} → {money(k.wdv)} <StatusBadge status={JN_TONE[k.status] ?? 'CANCELLED'} label={t(`fa.st.${k.status}`)} /></li>)}</ul><Rows rows={[[t('fa.totalCost'), money(x.totalCost)], [t('fa.totalWdv'), money(x.totalWdv)]]} /></>}</div>}
      <Decide x={x} run={run} busy={busy} t={t} testid="fa-decide" />
      {x.disposals.map((d) => <div key={d.id} className="mdm-panel" data-testid="fa-disposal" data-status={d.status}><h2 style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{d.docNo} · {d.methodLabel} <StatusBadge status={JN_TONE[d.status] ?? 'CANCELLED'} label={t(`fa.st.${d.status}`)} /></h2><Rows rows={[[t('fa.date'), d.date], [t('fa.depToDate'), money(d.depToDate)], [t('fa.wdv'), money(d.wdv)], [t('fa.proceeds'), `${money(d.proceeds)}${d.gst ? ` + GST ${money(d.gst)}` : ''}`], [d.gainLoss >= 0 ? t('fa.gain') : t('fa.loss'), money(Math.abs(d.gainLoss))], [t('fa.reason'), d.reason], [t('fa.receivable'), d.arInvoiceRef]]} /><Decide x={d} run={run} busy={busy} t={t} testid="fa-disposal-decide" /></div>)}
      <div className="actions-row ff-actionbar">
        {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => fa.assetAct(x.id, 'submit'), t('fa.sent'))} data-testid="fa-submit">{t('fa.submit')}</button>}
        {c.transfer && <button type="button" className="btn" style={big} onClick={() => setMode(mode === 'transfer' ? null : 'transfer')}>{t('fa.transfer')}</button>}
        {c.addComponent && <button type="button" className="btn" style={big} onClick={() => navigateTo(`/finance/asset-accounting?step=capitalise&parent=${x.id}`)} data-testid="fa-add-component">{t('fa.addComponent')}</button>}
        {c.dispose && <button type="button" className="btn" style={big} onClick={() => setMode(mode === 'dispose' ? null : 'dispose')} data-testid="fa-dispose">{t('fa.dispose')}</button>}
        {c.print && <button type="button" className="btn" style={big} onClick={() => gl.file(`/assets/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('fa.fileFailed')))}>{t('fa.print')}</button>}
      </div>
      {mode === 'transfer' && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => fa.transfer(x.id, { date: istToday(), toProjectId: to.projectId ? Number(to.projectId) : null, toCustodian: to.custodian || null, reason: to.reason, version: x.version }), t('fa.transferred')).then((r) => r && setMode(null)); }}><h2>{t('fa.transfer')}</h2><div className="form-grid"><Field label={t('fa.toProject')} name="toProjectId" error={error?.fields?.toProjectId}><input inputMode="numeric" value={to.projectId} onChange={(e) => setTo({ ...to, projectId: e.target.value })} style={big} /></Field><Field label={t('fa.toCustodian')} name="toCustodian" error={null}><input value={to.custodian} onChange={(e) => setTo({ ...to, custodian: e.target.value })} style={big} /></Field><Field label={t('fa.reason')} name="reason" error={error?.fields?.reason}><input value={to.reason} onChange={(e) => setTo({ ...to, reason: e.target.value })} style={big} required /></Field></div><div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy}>{t('fa.transfer')}</button></div></form>}
      {mode === 'dispose' && <DisposeForm asset={x} onDone={() => { setMode(null); q.refetch(); }} />}
      <Pills tabs={[['schedule', t('fa.schedule')], ['history', t('fa.history')]]} tab={tab} setTab={setTab} label={t('fa.asset')} prefix="fa-tab" />
      {tab === 'schedule' && (sched.length === 0 ? <EmptyState compact title={t('fa.noDep')} message={t('fa.noDepBody')} /> : <ul className="lp-list" data-testid="fa-schedule">{sched.map((d) => <li key={`${d.period}${d.kind}`} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', minHeight: 'var(--erp-target-min)', alignItems: 'center' }}><span>{d.period} {d.kind === 'TO_DISPOSAL' ? `(${t('fa.toDisposal')})` : ''}</span><span className="num">{money(d.dep)} → {money(d.wdvAfter)}</span><StatusBadge status={d.posted ? 'APPROVED' : 'DRAFT'} label={d.posted ? t('fa.posted') : t('fa.projected')} /></li>)}</ul>)}
      {tab === 'history' && <ul className="lp-list">{[...x.transfers.map((tr) => ({ at: tr.date, what: `${t('fa.transfer')} ${tr.from ?? ''} → ${tr.to ?? ''} · ${tr.toCustodian ?? ''} · ${tr.reason}` })), ...x.history.approvals.map((h) => ({ at: String(h.at), what: `${h.event}${h.step_code ? ` (${h.step_code})` : ''} · ${h.actor}${h.comment ? ` · ${h.comment}` : ''}` })), ...x.history.audit.map((h) => ({ at: String(h.at), what: `${h.action} · ${h.actor}${h.reason ? ` · ${h.reason}` : ''}` }))].sort((a, b) => a.at.localeCompare(b.at)).map((h, i) => <li key={i} style={{ minHeight: 'var(--erp-target-min)' }}>{h.at.slice(0, 19).replace('T', ' ')} · {h.what}</li>)}</ul>}
    </div>
  );
}

// ---- physical verification (phone) ----
function Verify() {
  const t = useT('fa'); const session = useSession(); const sp = useSearch(); const list = useQuery({ queryKey: ['gl', 'fa-ver'], queryFn: fa.verifications, retry: false }); const [id, setId] = useState(Number(sp.get('verification')) || null); const one = useQuery({ queryKey: ['gl', 'fa-ver', id], queryFn: () => fa.verification(id), enabled: Boolean(id), retry: false }); const { error, note, busy, run } = useGlRunner(); const [code, setCode] = useState(''); const [project, setProject] = useState('');
  const g = guardOf(list, t('fa.verify'), 'fin.asset.view'); if (g) return g;
  if (id && one.data) { const v = one.data; return (
    <div data-testid="fa-verification" data-status={v.status}><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <KpiRow label={t('fa.verify')}><KpiTile label={t('fa.expected')} value={String(v.expected)} /><KpiTile label={t('fa.found')} value={String(v.found)} valueTestid="fa-found" /></KpiRow>
      {v.can.scan && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); if (code.trim()) run(() => fa.scan(v.id, { code: code.trim() }), t('fa.scanned')).then(() => { setCode(''); one.refetch(); }); }}><Field label={t('fa.tag')} name="code" error={error?.fields?.code}><input value={code} onChange={(e) => setCode(e.target.value)} style={big} autoCapitalize="characters" autoFocus data-testid="fa-scan" /></Field><div className="actions-row"><button type="submit" className="btn btn-primary" style={{ ...big, flex: '1 1 10rem' }} disabled={busy}>{t('fa.record')}</button><button type="button" className="btn" style={{ ...big, flex: '1 1 10rem' }} disabled={busy} onClick={() => run(() => fa.closeVerification(v.id), t('fa.closed')).then(() => one.refetch())}>{t('fa.close')}</button></div></form>}
      <ul className="lp-list">{v.lines.map((l) => <li key={l.assetId} className="mdm-panel" style={{ display: 'grid', gap: 4, padding: 12, margin: '6px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{l.docNo}</strong><StatusBadge status={l.status === 'FOUND' ? 'APPROVED' : l.status === 'MISSING' ? 'REJECTED' : l.status === 'FOUND_ELSEWHERE' ? 'RETURNED' : 'DRAFT'} label={t(`fa.v.${l.status}`)} /></div><span className="muted small">{l.description}{l.custodian ? ` · ${l.custodian}` : ''}</span></li>)}</ul>
      <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => setId(null)}>{t('fa.allVerifications')}</button>
    </div>); }
  return (
    <div data-testid="fa-verifications">
      {can(session.data, 'fin.asset.verify') && <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => fa.createVerification({ projectId: project ? Number(project) : null, date: istToday() }), t('fa.started')); if (r) setId(r.id); }}><p className="muted small">{t('fa.verifyIntro')}</p><Field label={t('fa.projectId')} name="project" error={null}><input inputMode="numeric" value={project} onChange={(e) => setProject(e.target.value)} style={big} /></Field><button type="submit" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy} data-testid="fa-verify-start">{t('fa.startVerify')}</button></form>}
      {list.data.length === 0 ? <EmptyState compact title={t('fa.noVerifications')} message={t('fa.noVerificationsBody')} /> : <ul className="lp-list">{list.data.map((v) => <li key={v.id} style={{ minHeight: 'var(--erp-target-large)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => setId(v.id)}>{v.docNo} · {v.date}</button><span className="muted small">{v.found}/{v.expected} · {t(`fa.vs.${v.status}`)}</span></li>)}</ul>}
    </div>
  );
}

export function AssetRegisterPage() {
  const t = useT('fa'); usePageTitle(t('fa.register')); const sp = useSearch(); const session = useSession(); const [tab, setTab] = useState(sp.get('tab') ?? 'list');
  const disp = Number(sp.get('disposal')) || null; const dq = useQuery({ queryKey: ['gl', 'fa-disp', disp], queryFn: () => fa.disposal(disp), enabled: Boolean(disp), retry: false });
  if (Number(sp.get('id'))) return <section aria-labelledby="faa-h"><Asset id={Number(sp.get('id'))} /></section>;
  if (disp) return dq.data ? <section aria-labelledby="faa-h"><Asset id={dq.data.assetId} /></section> : guardOf(dq, t('fa.asset'), 'fin.disposal.view');
  return (
    <section aria-labelledby="fa-h" data-testid="fa-register">
      <PageHeader id="fa-h" title={t('fa.register')} subtitle={t('fa.intro')} meta={<Link to="/finance/asset-accounting">{t('fa.accounting')}</Link>} />
      <Pills tabs={[['list', t('fa.tabList')], ['verify', t('fa.verify')]]} tab={tab} setTab={setTab} label={t('fa.register')} prefix="fa-reg" />
      {tab === 'list' ? <ListReport listCode="fin.fa_assets" endpoint="/fin/assets" title={t('fa.register')} session={session.data} rowHref={(r) => `/finance/assets?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/assets?id=${r.id}`)} cardFields={['docNo', 'description', 'project', 'wdv', 'state', 'status']} statusKey="status" dateKey="capDate"
        newAction={{ label: t('fa.new'), permission: 'fin.asset.create', onClick: () => navigateTo('/finance/asset-accounting?step=capitalise') }} empty={{ title: t('fa.emptyTitle'), text: t('fa.emptyBody') }} /> : <Verify />}
    </section>
  );
}

// ---- capitalise, depreciate, the schedules ----
function Capitalise() {
  const parent = Number(useSearch().get('parent')) || null; const t = useT('fa'); const q = useQuery({ queryKey: ['gl', 'fa-sources'], queryFn: fa.sources, retry: false }); const { error, note, busy, run } = useGlRunner(); const [src, setSrc] = useState(''); const [f, setF] = useState({ classCode: '', description: '', capDate: '', projectId: '', custodian: '', cost: '' }); const [pick, setPick] = useState([]); const [title, setTitle] = useState('');
  const g = guardOf(q, t('fa.capitalise'), 'fin.asset.create'); if (g) return g; const x = q.data; const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [kind, idStr] = src.split(':'); const cls = x.classes.find((c) => c.code === f.classCode);
  const submit = async (e) => { e.preventDefault(); const body = { source: kind, ...(parent ? { parentAssetId: parent } : {}), classCode: f.classCode, description: f.description || undefined, capDate: f.capDate || undefined, projectId: f.projectId ? Number(f.projectId) : null, custodian: f.custodian || null, cost: f.cost || undefined, ...(kind === 'AP_BILL' ? { billId: Number(idStr) } : kind === 'CWIP' ? { cwipId: Number(idStr) } : kind === 'EQUIPMENT' ? { equipmentId: Number(idStr) } : kind === 'SMALL_ASSET' ? { smallAssetId: Number(idStr) } : {}) }; const r = await run(async () => { const a = await fa.createAsset(body); await fa.assetAct(a.id, 'submit'); return a; }, t('fa.sent')); if (r) navigateTo(`/finance/assets?id=${r.id}`); };
  return (
    <div data-testid="fa-capitalise"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}{parent && <p className="mdm-banner" role="status" data-testid="fa-cap-parent">{t('fa.addingTo', { id: parent })}</p>}
      {x.cwipBills.length > 0 && <div className="mdm-panel"><h2>{t('fa.cwipNew')}</h2><p className="muted small">{t('fa.cwipIntro')}</p><ul className="lp-list">{x.cwipBills.map((b) => <li key={b.id} style={{ minHeight: 'var(--erp-target-min)' }}><label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={pick.includes(b.id)} onChange={(e) => setPick(e.target.checked ? [...pick, b.id] : pick.filter((v) => v !== b.id))} style={{ width: 24, height: 24 }} />{b.docNo} · {b.payee} · {b.date} · {money(b.amount)}</label></li>)}</ul><Field label={t('fa.cwipTitle')} name="title" error={fe.title}><input value={title} onChange={(e) => setTitle(e.target.value)} style={big} /></Field><button type="button" className="btn" style={big} disabled={busy || !pick.length || title.trim().length < 3} onClick={() => run(() => fa.createCwip({ title, billIds: pick }), t('fa.cwipMade')).then(() => { setPick([]); setTitle(''); q.refetch(); })}>{t('fa.cwipMake')}</button></div>}
      <form className="mdm-panel" onSubmit={submit}><h2><span className="pill">1</span> {t('fa.from')}</h2>
        <Field label={t('fa.source')} name="src" error={fe.billId ?? fe.cwipId}><select value={src} onChange={(e) => { setSrc(e.target.value); }} style={big} data-testid="fa-src"><option value="">—</option>
          {x.bills.length > 0 && <optgroup label={t('fa.src.AP_BILL')}>{x.bills.map((b) => <option key={`b${b.id}`} value={`AP_BILL:${b.id}`}>{b.docNo} · {b.payee} · {money(b.left)}</option>)}</optgroup>}
          {x.cwip.length > 0 && <optgroup label={t('fa.src.CWIP')}>{x.cwip.map((w) => <option key={`w${w.id}`} value={`CWIP:${w.id}`}>{w.docNo} · {w.title} · {money(w.left)}</option>)}</optgroup>}
          {x.equipment.length > 0 && <optgroup label={t('fa.src.EQUIPMENT')}>{x.equipment.map((e) => <option key={`e${e.id}`} value={`EQUIPMENT:${e.id}`}>{e.label} · {money(e.value)}</option>)}</optgroup>}
          {x.smallAssets.length > 0 && <optgroup label={t('fa.src.SMALL_ASSET')}>{x.smallAssets.map((s) => <option key={`s${s.id}`} value={`SMALL_ASSET:${s.id}`}>{s.label} · {money(s.value)}</option>)}</optgroup>}
          <option value="OPENING:0">{t('fa.src.OPENING')}</option></select></Field>
        {src && <><h2><span className="pill">2</span> {t('fa.details')}</h2><div className="form-grid">
          <Field label={t('fa.class')} name="classCode" error={fe.classCode}><select value={f.classCode} onChange={set('classCode')} style={big} required data-testid="fa-class"><option value="">—</option>{x.classes.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></Field>
          <Field label={t('fa.description')} name="description" error={fe.description}><input value={f.description} onChange={set('description')} style={big} maxLength={300} /></Field>
          <Field label={t('fa.capDate')} name="capDate" error={fe.capDate}><input type="date" value={f.capDate} onChange={set('capDate')} style={big} max={istToday()} /></Field>
          <Field label={t('fa.cost')} name="cost" error={fe.cost}><input inputMode="decimal" value={f.cost} onChange={set('cost')} style={big} placeholder={t('fa.costFromSource')} /></Field>
          <Field label={t('fa.projectId')} name="projectId" error={fe.projectId}><input inputMode="numeric" value={f.projectId} onChange={set('projectId')} style={big} /></Field>
          <Field label={t('fa.custodian')} name="custodian" error={fe.custodian}><input value={f.custodian} onChange={set('custodian')} style={big} /></Field>
        </div>{cls && <p className="muted small">{t('fa.classNote', { method: cls.method, life: cls.lifeMonths, residual: cls.residualPct, block: cls.taxBlock, rate: cls.taxRate })}</p>}
        <div className="ff-actionbar"><button type="submit" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy || !f.classCode} data-testid="fa-cap-go">{t('fa.capitaliseSend')}</button></div></>}
      </form>
    </div>
  );
}
function Depreciation() {
  const t = useT('fa'); const session = useSession(); const [period, setPeriod] = useState(lastMonth()); const q = useQuery({ queryKey: ['gl', 'fa-dep', period], queryFn: () => fa.depreciation({ period }), retry: false }); const { error, note, busy, run } = useGlRunner();
  const g = guardOf(q, t('fa.depreciation'), 'fin.depreciation.view'); const x = q.data;
  return (
    <div data-testid="fa-dep"><div className="form-grid"><Field label={t('fa.period')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} /></Field></div>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      {g ?? <>
        <KpiRow label={t('fa.depreciation')}><KpiTile label={t('fa.depTotal')} value={money(x.total)} amount={x.total} kind="money" valueTestid="fa-dep-total" /><KpiTile label={t('fa.assets')} value={String(x.lines.length)} /><KpiTile label={t('fa.lastRun')} value={x.lastRun ?? '—'} /></KpiRow>
        {x.done ? <p className="mdm-banner" data-testid="fa-dep-done">{t('fa.runDone', { doc: x.done.docNo, by: x.done.by })}</p> : <p className="muted small">{t('fa.preview')}</p>}
        {x.byClass.length > 0 && <div className="mdm-panel"><Chart type="bar" data={{ categories: x.byClass.map((c) => c.classCode), series: [{ name: t('fa.depTotal'), values: x.byClass.map((c) => Math.round(c.dep)) }], unit: '₹' }} title={t('fa.byClass')} exportName={`depreciation-${period}`} tableSwitch /></div>}
        {x.lines.length === 0 ? <EmptyState compact title={t('fa.nothingToDep')} message={t('fa.nothingToDepBody')} /> : <ul className="lp-list">{x.lines.map((l) => <li key={l.assetId} className="mdm-panel" style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', padding: 12 }}><span><strong>{l.docNo}</strong> · {l.description} <span className="muted small">{l.from} – {l.to}</span></span><span className="num">{money(l.dep)} → {money(l.wdvAfter)}</span></li>)}</ul>}
        <div className="ff-actionbar"><span>{t('fa.depTotal')} <strong>{money(x.total)}</strong></span>{x.canRun && can(session.data, 'fin.depreciation.run') && <button type="button" className="btn btn-primary" style={big} disabled={busy || x.lines.length === 0} onClick={() => run(() => fa.runDepreciation({ period }), t('fa.ran'))} data-testid="fa-dep-run">{t('fa.run', { period })}</button>}</div>
      </>}
    </div>
  );
}
function ScheduleIII() {
  const t = useT('fa'); const [fy, setFy] = useState(fyNow()); const q = useQuery({ queryKey: ['gl', 'fa-sch', fy], queryFn: () => fa.schedule({ fy }), retry: false });
  const g = guardOf(q, t('fa.sch3'), 'fin.depreciation.view'); const x = q.data;
  return (<div data-testid="fa-sch3"><div className="form-grid"><Field label={t('fa.fy')} name="fy" error={null}><input value={fy} onChange={(e) => setFy(e.target.value)} style={big} /></Field></div>{g ?? (x.rows.length === 0 ? <EmptyState compact title={t('fa.noAssets')} message={t('fa.noAssetsBody')} /> : <>
    <ul className="lp-list">{x.rows.map((r) => <li key={r.classCode} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><strong>{r.className}</strong><Rows rows={[[t('fa.grossOpen'), money(r.grossOpen)], [t('fa.additions'), money(r.additions)], [t('fa.deletions'), money(r.deletions)], [t('fa.grossClose'), money(r.grossClose)], [t('fa.depYear'), money(r.depYear)], [t('fa.depClose'), money(r.depClose)], [t('fa.netClose'), money(r.netClose)]]} /></li>)}</ul>
    <div className="ff-actionbar"><span>{t('fa.grossClose')} <strong>{money(x.totals.grossClose)}</strong></span><span>{t('fa.netClose')} <strong>{money(x.totals.netClose)}</strong></span></div></>)}</div>);
}
function TaxBlocks() {
  const t = useT('fa'); const [fy, setFy] = useState(fyNow()); const q = useQuery({ queryKey: ['gl', 'fa-tax', fy], queryFn: () => fa.taxBlocks({ fy }), retry: false });
  const g = guardOf(q, t('fa.taxDep'), 'fin.depreciation.view'); const x = q.data;
  return (<div data-testid="fa-tax"><div className="form-grid"><Field label={t('fa.fy')} name="fy" error={null}><input value={fy} onChange={(e) => setFy(e.target.value)} style={big} /></Field></div>{g ?? (x.blocks.length === 0 ? <EmptyState compact title={t('fa.noAssets')} message={t('fa.noAssetsBody')} /> : <>
    <ul className="lp-list">{x.blocks.map((b) => <li key={b.block} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><strong>{b.block} · {b.ratePct}%</strong><Rows rows={[[t('fa.opening'), money(b.opening)], [t('fa.addFull'), money(b.additionsFull)], [t('fa.addHalf'), money(b.additionsHalf)], [t('fa.deletions'), money(b.deletions)], [t('fa.taxDepL'), money(b.depreciation)], [t('fa.closing'), money(b.closing)], [t('fa.stcg'), b.stcg ? money(b.stcg) : null]]} /></li>)}</ul>
    <p className="muted small">{x.note}</p><div className="ff-actionbar"><span>{t('fa.taxDepL')} <strong>{money(x.totals.depreciation)}</strong></span></div></>)}<TaxOpenings fy={fy} /></div>);
}
/** D-740: the opening WDV of a block for the first tax year the register computes (assets taken over at go-live). */
function TaxOpenings({ fy }) {
  const t = useT('fa'); const session = useSession(); const q = useQuery({ queryKey: ['gl', 'fa-tax-open'], queryFn: () => fa.taxOpenings(), retry: false }); const { error, note, busy, run } = useGlRunner();
  const [f, setF] = useState({ block: '', fy, openingWdv: '' }); const fe = error?.fields ?? {}; const edit = can(session.data, 'fin.depreciation.run'); const rows = q.data ?? [];
  if (!q.data && !edit) return null;
  return (<div className="mdm-panel" style={{ padding: 12, marginTop: 12 }} data-testid="fa-tax-open"><h3>{t('fa.taxOpening')}</h3><p className="muted small">{t('fa.taxOpeningIntro')}</p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    {rows.length > 0 && <ul className="lp-list">{rows.map((o) => <li key={o.id}><strong>{o.block}</strong> · {o.fy} · {money(o.openingWdv)}{edit && <> <button type="button" className="btn" disabled={busy} onClick={() => run(() => fa.removeTaxOpening(o.id), t('fa.removedOpening'))}>{t('fa.removeOpening')}</button></>}</li>)}</ul>}
    {edit && <><div className="form-grid"><Field label={t('fa.block')} name="block" error={fe.block}><input value={f.block} onChange={(e) => setF({ ...f, block: e.target.value.toUpperCase() })} style={big} data-testid="fa-open-block" /></Field><Field label={t('fa.fy')} name="openFy" error={fe.fy}><input value={f.fy} onChange={(e) => setF({ ...f, fy: e.target.value })} style={big} /></Field><Field label={t('fa.openingWdv')} name="openingWdv" error={fe.openingWdv}><input inputMode="decimal" value={f.openingWdv} onChange={(e) => setF({ ...f, openingWdv: e.target.value })} style={big} data-testid="fa-open-wdv" /></Field></div>
      <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy || !f.block || f.openingWdv === ''} onClick={() => run(() => fa.setTaxOpening({ block: f.block, fy: f.fy, openingWdv: Number(f.openingWdv) }), t('fa.savedOpening'))} data-testid="fa-open-save">{t('fa.saveOpening')}</button></div></>}</div>);
}
export function AssetAccountingPage() {
  const t = useT('fa'); usePageTitle(t('fa.accounting')); const sp = useSearch(); const session = useSession(); const [step, setStep] = useState(sp.get('step') ?? (can(session.data, 'fin.asset.create') ? 'capitalise' : 'depreciation'));
  const steps = [['capitalise', `1 · ${t('fa.capitalise')}`], ['depreciation', `2 · ${t('fa.depreciation')}`], ['sch3', `3 · ${t('fa.sch3')}`], ['tax', `4 · ${t('fa.taxDep')}`]].filter(([k]) => k !== 'capitalise' || can(session.data, 'fin.asset.create'));
  return (
    <section aria-labelledby="fac-h" data-testid="fa-accounting">
      <PageHeader id="fac-h" title={t('fa.accounting')} subtitle={t('fa.accountingIntro')} meta={<Link to="/finance/assets">{t('fa.register')}</Link>} />
      <Pills tabs={steps} tab={step} setTab={setStep} label={t('fa.accounting')} prefix="fa-step" />
      {step === 'capitalise' && <Capitalise />}{step === 'depreciation' && <Depreciation />}{step === 'sch3' && <ScheduleIII />}{step === 'tax' && <TaxBlocks />}
    </section>
  );
}
