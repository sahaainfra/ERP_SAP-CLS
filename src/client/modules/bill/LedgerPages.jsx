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
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';

// Retention, security deposit and advance ledgers (part 22.07).
const mf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v) => (v == null ? '—' : `₹ ${mf.format(v)}`); const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const BUCKET_TONE = { OVERDUE: 'REJECTED', D30: 'RETURNED', D90: 'IN_REVIEW', LATER: 'APPROVED', UNKNOWN: 'DRAFT', NONE: 'DRAFT' };

export function RetentionPage() {
  const t = useT('bill'); usePageTitle(t('rt.title')); const o = useQuery({ queryKey: ['bill', 'recon-options'], queryFn: () => bill.get('/qty-recon/options'), retry: false }); const [f, setF] = useState({ partyType: 'CLIENT', projectId: '' }); const [open, setOpen] = useState(null); const { run } = useRunner();
  const q = useQuery({ queryKey: ['bill', 'retention', f.partyType, f.projectId], queryFn: () => bill.get(`/retention${qs({ partyType: f.partyType, projectId: f.projectId })}`), retry: false, placeholderData: (p) => p });
  const en = useQuery({ queryKey: ['bill', 'retention-entries', open?.partyType, open?.kind, open?.scopeId], queryFn: () => bill.get(`/retention/entries${qs({ partyType: f.partyType, kind: open.kind, scopeId: open.scopeId })}`), enabled: Boolean(open), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('rt.title')} permission="bill.retention.view" />; if (q.isPending) return <Skeleton label={t('rt.title')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data; const client = f.partyType === 'CLIENT';
  return (
    <section aria-labelledby="rt-h" data-testid="bill-retention"><PageHeader id="rt-h" title={t('rt.title')} subtitle={t('rt.intro')} />
      <div className="form-grid no-print"><Field label={t('rt.side')} name="partyType" error={null}><select value={f.partyType} onChange={(e) => { setF({ ...f, partyType: e.target.value }); setOpen(null); }} style={big} data-testid="bill-rt-side"><option value="CLIENT">{t('rt.client')}</option><option value="SUBCONTRACTOR">{t('rt.sub')}</option></select></Field>
        <Field label={t('project')} name="projectId" error={null}><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} style={big} data-testid="bill-rt-project"><option value="">{t('rc.allLevels')}</option>{(o.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field></div>
      <div className="actions-row no-print"><button type="button" className="btn" onClick={() => run(() => bill.exportFile(`/retention/export${qs({ partyType: f.partyType, projectId: f.projectId })}`, `retention-${f.partyType.toLowerCase()}.csv`))} data-testid="bill-rt-export">{t('rc.export')}</button> · <Link to="/bill/advances">{t('adv.title')}</Link> · <Link to="/bill/releases">{t('rel.title')}</Link></div>
      <KpiRow data-testid="bill-rt-totals">{[['deducted', d.totals.deducted], ['released', d.totals.released], ['balance', d.totals.balance]].map(([k, v]) => <KpiTile label={t(`rt.t.${k}`)} value={money(v)} amount={v} kind="money" key={k} data-testid={`bill-rt-t-${k}`} />)}</KpiRow>
      <h2>{t('rt.ageing')}</h2><div className="table-scroll"><table className="data-table" data-testid="bill-rt-ageing"><thead><tr><th>{t('rt.when')}</th><th className="num">{t('rt.count')}</th><th className="num">{t('rt.t.balance')}</th></tr></thead><tbody>{d.ageing.map((a) => <tr key={a.bucket} data-bucket={a.bucket}><td><StatusBadge status={BUCKET_TONE[a.bucket]} label={t(`rt.b.${a.bucket}`)} /></td><td className="num">{a.count}</td><td className="num">{money(a.balance)}</td></tr>)}</tbody></table></div>
      {d.rows.length === 0 ? <div className="empty-state"><h2>{t('rt.emptyTitle')}</h2><p>{t('rt.emptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="bill-rt-table"><thead><tr><th>{client ? t('rt.contract') : t('rt.wo')}</th><th>{t('rt.party')}</th><th>{t('rt.kind')}</th><th className="num">{t('rt.t.deducted')}</th><th className="num">{t('rt.t.released')}</th><th className="num">{t('rt.t.balance')}</th><th className="num">{t('rt.guarantee')}</th><th>{t('rt.expected')}</th><th>{t('rt.when')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={`${r.kind}-${r.scopeId}`} data-testid="bill-rt-row" data-bucket={r.bucket}><td><button type="button" className="btn" onClick={() => setOpen(r)} data-testid="bill-rt-open">{r.ref}</button></td><td>{r.party ?? '—'}</td><td>{t(`rt.k.${r.kind}`)}</td><td className="num">{money(r.deducted)}</td><td className="num">{money(r.released)}</td><td className="num">{money(r.balance)}</td><td className="num">{money(r.guarantee)}</td><td>{r.expectedDate ? fmtDate(r.expectedDate) : '—'}</td><td><StatusBadge status={BUCKET_TONE[r.bucket]} label={t(`rt.b.${r.bucket}`)} /></td></tr>)}</tbody></table></div>)}
      {open && <div className="mdm-panel" data-testid="bill-rt-entries"><h2>{open.ref} · {t(`rt.k.${open.kind}`)}</h2>{en.isPending ? <Skeleton label={t('rt.entries')} rows={2} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('when')}</th><th>{t('rt.txn')}</th><th>{t('rt.ref')}</th><th className="num">{t('cb.amount')}</th><th className="num">{t('rt.t.balance')}</th></tr></thead><tbody>{(en.data?.rows ?? []).map((e) => <tr key={e.id} data-testid="bill-rt-entry"><td>{fmtDate(e.date)}</td><td>{t(`rt.x.${e.type}`)}</td><td>{e.ref ?? '—'}</td><td className="num">{money(e.amount)}</td><td className="num">{money(e.balance)}</td></tr>)}</tbody></table></div>}
        <div className="actions-row no-print"><Link to={`/bill/releases?new=1&partyType=${f.partyType}&scopeId=${open.scopeId}&kind=${open.kind}`} data-testid="bill-rt-release">{t('rel.new')}</Link> <button type="button" className="btn" onClick={() => setOpen(null)}>{t('rc.close')}</button></div></div>}
    </section>
  );
}

function AdvanceForm() {
  const t = useT('bill'); const { error, run, busy } = useRunner(); const o = useQuery({ queryKey: ['bill', 'adv-options'], queryFn: () => bill.get('/advances/options'), retry: false });
  const [v, setV] = useState({ projectId: '', partyType: 'SUBCONTRACTOR', scopeId: '', refNo: '', type: 'MOBILISATION', amount: '', advanceDate: today(), ruleMode: 'PCT_OF_BILL', rulePct: '20', ruleFixed: '', interestPct: '0', bgId: '', notes: '' });
  if (o.error?.status === 403) return <NoPermission what={t('adv.new')} permission="bill.advance.create" />; if (o.isPending) return <Skeleton label={t('adv.new')} rows={4} />; if (o.isError) return <ErrorState error={o.error} onRetry={o.refetch} />;
  const d = o.data; const fe = error?.fields ?? {}; const set = (k) => (e) => setV({ ...v, [k]: e.target.value }); const client = v.partyType === 'CLIENT'; const scopes = (client ? d.contracts : d.workOrders).filter((x) => String(x.projectId) === String(v.projectId)); const scope = scopes.find((x) => String(x.id) === String(v.scopeId));
  const body = scope && v.refNo && v.amount ? { projectId: Number(v.projectId), siteId: null, direction: client ? 'RECEIVED' : 'GIVEN', partyType: v.partyType, partyId: scope.partyId ?? 0, contractId: client ? scope.id : null, woId: client ? null : scope.id, poId: null, refNo: v.refNo, type: v.type, amount: Number(v.amount), advanceDate: v.advanceDate, ruleMode: v.ruleMode, rulePct: v.ruleMode === 'PCT_OF_BILL' ? Number(v.rulePct) : 0, ruleFixed: v.ruleMode === 'FIXED' ? Number(v.ruleFixed) : 0, interestPct: Number(v.interestPct || 0), bgId: v.bgId ? Number(v.bgId) : null, notes: v.notes || null } : null;
  return (
    <form className="mdm-panel" data-testid="bill-adv-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bill.post('/advances', body)); if (r) navigateTo(`/bill/advances?id=${r.id}`); }}>
      <ErrorLine error={error} id="bill-error" />
      <div className="form-grid"><Field label={t('project')} name="projectId" error={fe.projectId}><select value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value, scopeId: '' })} style={big} data-testid="bill-adv-project"><option value="">—</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('adv.side')} name="partyType" error={fe.partyType}><select value={v.partyType} onChange={(e) => setV({ ...v, partyType: e.target.value, scopeId: '' })} style={big} data-testid="bill-adv-side"><option value="SUBCONTRACTOR">{t('adv.toSub')}</option><option value="CLIENT">{t('adv.fromClient')}</option></select></Field>
        <Field label={client ? t('rt.contract') : t('rt.wo')} name="scopeId" error={fe.contractId ?? fe.woId ?? fe.partyId}><select value={v.scopeId} onChange={set('scopeId')} style={big} data-testid="bill-adv-scope"><option value="">—</option>{scopes.map((x) => <option key={x.id} value={x.id}>{x.contractNo ?? x.woNo}</option>)}</select></Field>
        <Field label={t('adv.ref')} name="refNo" error={fe.refNo}><input value={v.refNo} onChange={set('refNo')} style={big} maxLength={60} data-testid="bill-adv-ref" /></Field>
        <Field label={t('cb.type')} name="type" error={fe.type}><select value={v.type} onChange={set('type')} style={big}>{d.types.map((x) => <option key={x.id} value={x.id}>{t(`adv.t.${x.id}`)}</option>)}</select></Field>
        <Field label={t('cb.amount')} name="amount" error={fe.amount}><input type="number" min="0" step="any" value={v.amount} onChange={set('amount')} style={big} data-testid="bill-adv-amount" /></Field><Field label={t('rec.date')} name="advanceDate" error={fe.advanceDate}><input type="date" value={v.advanceDate} onChange={set('advanceDate')} style={big} /></Field>
        <Field label={t('adv.rule')} name="ruleMode" error={fe.ruleMode}><select value={v.ruleMode} onChange={set('ruleMode')} style={big} data-testid="bill-adv-mode"><option value="PCT_OF_BILL">{t('adv.pctOfBill')}</option><option value="FIXED">{t('adv.fixed')}</option></select></Field>
        {v.ruleMode === 'PCT_OF_BILL' ? <Field label={t('adv.pct')} name="rulePct" error={fe.rulePct}><input type="number" min="0" max="100" step="any" value={v.rulePct} onChange={set('rulePct')} style={big} data-testid="bill-adv-pct" /></Field> : <Field label={t('adv.perBill')} name="ruleFixed" error={fe.ruleFixed}><input type="number" min="0" step="any" value={v.ruleFixed} onChange={set('ruleFixed')} style={big} data-testid="bill-adv-fixed" /></Field>}
        <Field label={t('adv.interest')} name="interestPct" error={fe.interestPct}><input type="number" min="0" max="100" step="any" value={v.interestPct} onChange={set('interestPct')} style={big} /></Field>
        <Field label={t('adv.bg')} name="bgId" error={fe.bgId}><select value={v.bgId} onChange={set('bgId')} style={big}><option value="">—</option>{d.guarantees.map((g) => <option key={g.id} value={g.id}>{g.bgNo}</option>)}</select></Field></div>
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || !body} data-testid="bill-adv-save">{t('cb.saveDraft')}</button></div></form>
  );
}
function Advance({ id }) {
  const t = useT('bill'); const { q, guard } = useRecord('/advances', id, t('adv.one'), 'bill.advance.view'); const [tab, setTab] = useState('recovery'); usePageTitle(t('adv.one')); const sched = useQuery({ queryKey: ['bill', 'adv-sched', id], queryFn: () => bill.get(`/advances/${id}/recovery-preview?bills=200000,250000,300000&asOf=${today()}`), enabled: Boolean(q.data) && q.data.state === 'ACTIVE', retry: false });
  if (guard) return guard; const x = q.data;
  return (
    <div data-testid="bill-adv-object" data-status={x.status} data-state={x.state}><PageHeader id="adv-h" title={<>{x.refNo} <Status x={x} /> <StatusBadge status={x.state === 'RECOVERED' ? 'APPROVED' : x.state === 'ACTIVE' ? 'IN_REVIEW' : 'DRAFT'} label={t(`adv.s.${x.state}`)} /></>} meta={<><Link to="/bill/advances">{t('adv.title')}</Link> · {x.docNo} · {x.project} · {x.party} · {t(`adv.d.${x.direction}`)} · {t(`adv.t.${x.type}`)}</>} />
      <KpiRow><KpiTile label={t('cb.amount')} value={money(x.amount)} amount={x.amount} kind="money" valueTestid="bill-adv-amount-value" /><KpiTile label={t('adv.recovered')} value={money(x.recovered)} amount={x.recovered} kind="money" valueTestid="bill-adv-recovered"><span className="muted">({x.recoveredPct}%)</span></KpiTile><KpiTile label={t('adv.outstanding')} value={money(x.outstanding)} amount={x.outstanding} kind="money" valueTestid="bill-adv-outstanding">{x.interestPct > 0 && <div className="muted">{t('adv.interestDue', { pct: x.interestPct, amount: money(x.interestAccrued) })}</div>}</KpiTile></KpiRow>
      <p className="muted">{x.rule.mode === 'FIXED' ? t('adv.ruleFixed', { amount: money(x.rule.fixed) }) : t('adv.rulePct', { pct: x.rule.pct })}{x.bg ? ` · ${t('adv.bg')} ${x.bg.bg_no}` : ''}</p>
      <div className="actions-row no-print" role="tablist">{['recovery', 'schedule', 'documents'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`bill-adv-tab-${k}`}>{t(`adv.tab.${k}`)}</button>)}</div>
      {tab === 'recovery' && <div className="table-scroll" data-testid="bill-adv-recoveries">{x.recoveries.length === 0 ? <p className="muted">{t('adv.noRecoveries')}</p> : <table className="data-table"><thead><tr><th>{t('when')}</th><th>{t('rt.ref')}</th><th className="num">{t('adv.principal')}</th><th className="num">{t('adv.interestCol')}</th><th className="num">{t('adv.outstanding')}</th></tr></thead><tbody>{x.recoveries.map((r) => <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{r.billRef ?? r.source}</td><td className="num">{money(r.principal)}</td><td className="num">{money(r.interest)}</td><td className="num">{money(r.outstanding)}</td></tr>)}</tbody></table>}</div>}
      {tab === 'schedule' && <div className="table-scroll" data-testid="bill-adv-schedule"><p className="muted">{t('adv.scheduleNote')}</p>{sched.data ? <table className="data-table"><thead><tr><th>{t('adv.bill')}</th><th className="num">{t('cb.s.gross')}</th><th className="num">{t('adv.principal')}</th><th className="num">{t('adv.outstanding')}</th></tr></thead><tbody>{sched.data.rows.map((r) => <tr key={r.bill}><td>{r.bill}</td><td className="num">{money(r.gross)}</td><td className="num">{money(r.principal)}</td><td className="num">{money(r.outstandingAfter)}</td></tr>)}</tbody></table> : <p className="muted">{t('adv.noSchedule')}</p>}</div>}
      {tab === 'documents' && <AttachmentPanel type="bill_advances" id={x.id} entity="bill_advances" canEdit={x.can.edit} />}
      <DocBar kind="/advances" x={x} printName={`${x.docNo.replaceAll('/', '-')}.pdf`} />
    </div>
  );
}
export function AdvancesPage() {
  const t = useT('bill'); usePageTitle(t('adv.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="adv-h"><Advance id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="advn-h"><PageHeader id="advn-h" title={t('adv.new')} meta={<Link to="/bill/advances">{t('adv.title')}</Link>} /><AdvanceForm /></section>;
  return (
    <section aria-labelledby="advs-h" data-testid="bill-advances"><PageHeader id="advs-h" title={t('adv.title')} subtitle={t('adv.intro')} />
      <div className="actions-row no-print"><Link to="/bill/advances?new=1" data-testid="bill-adv-new">{t('adv.new')}</Link> · <Link to="/bill/retention">{t('rt.title')}</Link></div>
      <ListReport listCode="bill.advances" endpoint="/bill/advances" title={t('adv.title')} session={session.data} rowHref={(r) => `/bill/advances?id=${r.id}`} onOpen={(r) => navigateTo(`/bill/advances?id=${r.id}`)} cardFields={['refNo', 'party', 'amount', 'recovered', 'outstanding', 'state']} statusKey="status" empty={{ title: t('adv.emptyTitle'), text: t('adv.emptyBody') }} />
    </section>
  );
}

function ReleaseForm({ defaults }) {
  const t = useT('bill'); const { error, run, busy } = useRunner(); const o = useQuery({ queryKey: ['bill', 'rel-options'], queryFn: () => bill.get('/releases/options'), retry: false });
  const [v, setV] = useState({ projectId: '', partyType: defaults.partyType ?? 'SUBCONTRACTOR', scopeId: defaults.scopeId ?? '', releaseType: defaults.kind ?? 'RETENTION', basis: 'DLP_END', amount: '', bgId: '', waiverReason: '', notes: '' });
  const client = v.partyType === 'CLIENT'; const body = v.projectId && v.scopeId && v.amount ? { projectId: Number(v.projectId), releaseType: v.releaseType, partyType: v.partyType, contractId: client ? Number(v.scopeId) : null, woId: client ? null : Number(v.scopeId), basis: v.basis, amount: Number(v.amount), bgId: v.bgId ? Number(v.bgId) : null } : null;
  const pv = useQuery({ queryKey: ['bill', 'rel-preview', JSON.stringify(body)], queryFn: () => bill.post('/releases/preview', body), enabled: Boolean(body), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('rel.new')} permission="bill.release.create" />; if (o.isPending) return <Skeleton label={t('rel.new')} rows={4} />; if (o.isError) return <ErrorState error={o.error} onRetry={o.refetch} />;
  const d = o.data; const fe = error?.fields ?? {}; const set = (k) => (e) => setV({ ...v, [k]: e.target.value }); const scopes = (client ? d.contracts : d.workOrders).filter((x) => String(x.projectId) === String(v.projectId));
  return (
    <form className="mdm-panel" data-testid="bill-rel-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bill.post('/releases', { ...body, siteId: null, waiverReason: v.waiverReason || null, notes: v.notes || null })); if (r) navigateTo(`/bill/releases?id=${r.id}`); }}>
      <ErrorLine error={error} id="bill-error" />
      <div className="form-grid"><Field label={t('project')} name="projectId" error={fe.projectId}><select value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value, scopeId: '' })} style={big} data-testid="bill-rel-project"><option value="">—</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('rt.side')} name="partyType" error={fe.partyType}><select value={v.partyType} onChange={(e) => setV({ ...v, partyType: e.target.value, scopeId: '' })} style={big} data-testid="bill-rel-side"><option value="SUBCONTRACTOR">{t('rt.sub')}</option><option value="CLIENT">{t('rt.client')}</option></select></Field>
        <Field label={client ? t('rt.contract') : t('rt.wo')} name="scopeId" error={fe.contractId ?? fe.woId}><select value={v.scopeId} onChange={set('scopeId')} style={big} data-testid="bill-rel-scope"><option value="">—</option>{scopes.map((x) => <option key={x.id} value={x.id}>{x.contractNo ?? x.woNo}</option>)}</select></Field>
        <Field label={t('rt.kind')} name="releaseType" error={fe.releaseType}><select value={v.releaseType} onChange={set('releaseType')} style={big}><option value="RETENTION">{t('rt.k.RETENTION')}</option><option value="SD">{t('rt.k.SD')}</option></select></Field>
        <Field label={t('rel.basis')} name="basis" error={fe.basis}><select value={v.basis} onChange={set('basis')} style={big} data-testid="bill-rel-basis">{d.bases.map((b) => <option key={b.id} value={b.id}>{t(`rel.b.${b.id}`)}</option>)}</select></Field>
        <Field label={t('cb.amount')} name="amount" error={fe.amount}><input type="number" min="0" step="any" value={v.amount} onChange={set('amount')} style={big} data-testid="bill-rel-amount" /></Field>
        {v.basis === 'AGAINST_BG' && <Field label={t('adv.bg')} name="bgId" error={fe.bgId}><select value={v.bgId} onChange={set('bgId')} style={big} data-testid="bill-rel-bg"><option value="">—</option>{d.guarantees.map((g) => <option key={g.id} value={g.id}>{g.bgNo}</option>)}</select></Field>}</div>
      <h2>{t('rel.checklist')}</h2>{!body ? <p className="muted">{t('rel.pick')}</p> : pv.isError ? <p className="field-error" role="alert">{pv.error?.message}</p> : pv.isPending ? <Skeleton label={t('rel.checklist')} rows={2} /> : (<div data-testid="bill-rel-preview"><p>{t('rel.balance', { amount: money(pv.data.balance) })}{pv.data.expectedDate ? ` · ${t('rt.expected')} ${fmtDate(pv.data.expectedDate)}` : ''}</p><Checklist items={pv.data.checklist} /></div>)}
      <Field label={t('rel.waiver')} name="waiverReason" error={fe.waiverReason}><input value={v.waiverReason} onChange={set('waiverReason')} style={big} maxLength={500} data-testid="bill-rel-waiver" /></Field>
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || !body} data-testid="bill-rel-save">{t('cb.saveDraft')}</button></div></form>
  );
}
function Checklist({ items }) {
  const t = useT('bill');
  return <ul data-testid="bill-rel-checklist">{items.map((c) => <li key={c.code} data-code={c.code} data-ok={c.ok ? '1' : '0'}>{c.ok ? '✔' : c.required ? '⛔' : 'ℹ'} <strong>{t(`rel.c.${c.code}`)}</strong>: {c.note}{c.required ? '' : ` (${t('rel.notRequired')})`}</li>)}</ul>;
}
function Release({ id }) {
  const t = useT('bill'); const { q, guard } = useRecord('/releases', id, t('rel.one'), 'bill.release.view'); usePageTitle(t('rel.one')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="bill-rel-object" data-status={x.status}><PageHeader id="rel-h" title={<>{x.docNo} <Status x={x} /></>} meta={<><Link to="/bill/releases">{t('rel.title')}</Link> · {x.project} · {t(`rt.k.${x.releaseType}`)} · {t(`rt.${x.partyType === 'CLIENT' ? 'client' : 'sub'}`)} {x.party ?? ''} · {t(`rel.b.${x.basis}`)}</>} />
      <KpiRow><KpiTile label={t('cb.amount')} value={money(x.amount)} amount={x.amount} kind="money" valueTestid="bill-rel-amount-value" /><KpiTile label={t('rel.balanceBefore')} value={money(x.balanceBefore)} amount={x.balanceBefore} kind="money">{x.releasedOn && <div className="muted">{t('rel.releasedOn', { date: fmtDate(x.releasedOn) })}</div>}</KpiTile></KpiRow>
      <h2>{t('rel.checklist')}</h2><Checklist items={x.checklist} />{x.waiverReason && <p data-testid="bill-rel-waived">{t('rel.waived')}: {x.waiverReason}</p>}
      <AttachmentPanel type="bill_releases" id={x.id} entity="bill_releases" canEdit={x.can.edit} />
      <DocBar kind="/releases" x={x} printName={`${x.docNo.replaceAll('/', '-')}.pdf`} />
    </div>
  );
}
export function ReleasesPage() {
  const t = useT('bill'); usePageTitle(t('rel.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="rel-h"><Release id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="reln-h"><PageHeader id="reln-h" title={t('rel.new')} meta={<Link to="/bill/releases">{t('rel.title')}</Link>} /><ReleaseForm defaults={{ partyType: sp.get('partyType'), scopeId: sp.get('scopeId'), kind: sp.get('kind') }} /></section>;
  return (
    <section aria-labelledby="rels-h" data-testid="bill-releases"><PageHeader id="rels-h" title={t('rel.title')} subtitle={t('rel.intro')} />
      <div className="actions-row no-print"><Link to="/bill/releases?new=1" data-testid="bill-rel-new">{t('rel.new')}</Link> · <Link to="/bill/retention">{t('rt.title')}</Link></div>
      <ListReport listCode="bill.releases" endpoint="/bill/releases" title={t('rel.title')} session={session.data} rowHref={(r) => `/bill/releases?id=${r.id}`} onOpen={(r) => navigateTo(`/bill/releases?id=${r.id}`)} cardFields={['docNo', 'project', 'kind', 'party', 'amount', 'status']} statusKey="status" empty={{ title: t('rel.emptyTitle'), text: t('rel.emptyBody') }} />
    </section>
  );
}
