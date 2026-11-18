import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, gl, ic, money } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';
import { Decide, Pills, Rows, big, guardOf, istToday, lastMonth } from './finparts.jsx';

// Part 23.15: inter-company transactions (a list report of what the company sent and received; one transaction with its mirror, the approval, the counterpart's
// acceptance or dispute, the reversal; the relationships), the inter-company reconciliation, the consolidated statements and the JV partner statement.
const row = { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
const neg = (v) => (v ? { color: 'var(--erp-color-status-error-fg)', fontWeight: 700 } : undefined);
const TYPES = ['CHARGE', 'TRANSFER', 'LOAN', 'SETTLEMENT'];

function Accept({ x, t, run, busy }) {
  const oq = useQuery({ queryKey: ['gl', 'jn-options'], queryFn: gl.options, retry: false }); const [accountId, setAccountId] = useState(''); const [cc, setCc] = useState('');
  return (<div className="mdm-panel" data-testid="ic-accept"><h2>{t('ic.acceptTitle')}</h2><p className="muted small">{t('ic.acceptBody')}</p><div className="form-grid">
    <Field label={t('ic.yourAccount')} name="acc" error={null}><select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={big} data-testid="ic-accept-account"><option value="">{t('ic.choose')}</option>{(oq.data?.accounts ?? []).filter((a) => !a.control).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
    {(oq.data?.costCentres ?? []).length > 0 && <Field label={t('ic.costCentre')} name="cc" error={null}><select value={cc} onChange={(e) => setCc(e.target.value)} style={big} data-testid="ic-accept-cc"><option value="">—</option>{oq.data.costCentres.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></Field>}</div>
    <div className="actions-row ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy || !accountId} onClick={() => run(() => ic.act(x.id, 'accept', { accountId: Number(accountId), ...(cc ? { dimensions: { costCentreId: Number(cc) } } : {}) }), t('ic.accepted'))} data-testid="ic-accept-save">{t('ic.accept')}</button>
      <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt?.(t('ic.whyDispute')); if (r && r.trim().length >= 5) run(() => ic.act(x.id, 'dispute', { reason: r.trim() }), t('ic.disputed')); }}>{t('ic.dispute')}</button></div></div>);
}

function Txn({ id }) {
  const t = useT('ic'); const q = useQuery({ queryKey: ['gl', 'ic', id], queryFn: () => ic.get(id), retry: false }); const { error, note, busy, run } = useGlRunner(); usePageTitle(t('ic.title'));
  const g = guardOf(q, t('ic.title'), 'fin.transaction.view'); if (g) return g; const x = q.data; const c = x.can;
  const why = () => { const r = globalThis.prompt?.(t('ic.why')); return r && r.trim().length >= 5 ? r.trim() : null; };
  return (<section aria-labelledby="ict-h" data-testid="ic-txn" data-state={x.state} data-status={x.status}>
    <PageHeader id="ict-h" title={`${x.docNo} · ${t(`ic.type.${x.type}`)}`} subtitle={`${x.from} → ${x.to} · ${x.date}`} meta={<StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={t(`ic.state.${x.state}`)} />} />
    <p><Link to="/finance/inter-company">{t('ic.back')}</Link></p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <KpiRow label={t('ic.title')}><KpiTile label={t('ic.amount')} value={money(x.amount)} amount={x.amount} kind="money" valueTestid="ic-amount" /><KpiTile label={t('ic.status')} value={t(`ic.st.${x.status}`)} /></KpiRow>
    <div className="mdm-panel"><Rows rows={[[t('ic.description'), x.description], [t('ic.reference'), x.reference], [t('ic.disputeReason'), x.disputeReason], [t('ic.acceptedBy'), x.acceptedBy ? `${x.acceptedBy} · ${String(x.acceptedAt).slice(0, 16).replace('T', ' ')}` : null]]} /></div>
    {x.mirror && <div className="mdm-panel" data-testid="ic-mirror"><h2>{t('ic.mirror')}</h2>{[['from', x.from], ['to', x.to]].map(([k, who]) => <div key={k} style={{ padding: '6px 0' }}><strong>{who}</strong><p className="small" style={{ margin: 0 }}>{t('ic.icAccount')} {x.mirror[k].ic} · {t('ic.otherAccount')} {x.mirror[k].account ?? t('ic.onAcceptance')}{x.mirror[k].journal ? ` · ${x.mirror[k].journal.voucher_no ?? x.mirror[k].journal.doc_no}` : ''}</p></div>)}</div>}
    {c.accept && <Accept x={x} t={t} run={run} busy={busy} />}
    <Decide x={x} run={run} busy={busy} t={t} p="ic" testid="ic-decide" />
    <div className="actions-row ff-actionbar">
      {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => ic.act(x.id, 'submit'), t('ic.sent'))} data-testid="ic-submit">{t('ic.submit')}</button>}
      {c.delete && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => ic.remove(x.id), t('ic.deleted')).then((r) => r && navigateTo('/finance/inter-company'))}>{t('ic.delete')}</button>}
      {c.drop && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = why(); if (r) run(() => ic.act(x.id, 'drop', { reason: r }), t('ic.dropped')); }}>{t('ic.drop')}</button>}
      {c.reverse && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = why(); if (r) run(() => ic.act(x.id, 'reverse', { reason: r }), t('ic.reversed')); }} data-testid="ic-reverse">{t('ic.reverse')}</button>}
      <button type="button" className="btn" style={big} onClick={() => gl.file(`/ic-transactions/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('ic.fileFailed')))}>{t('ic.print')}</button>
    </div>
    {x.history?.approvals?.length > 0 && <div className="mdm-panel"><h2>{t('ic.history')}</h2><ul className="lp-list">{x.history.approvals.map((h, i) => <li key={i} style={{ minHeight: 44 }}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.event}{h.step_code ? ` (${h.step_code})` : ''} · {h.actor}</li>)}</ul></div>}
  </section>);
}

function NewTxn({ t, rels, run, busy, onDone }) {
  const oq = useQuery({ queryKey: ['gl', 'jn-options'], queryFn: gl.options, retry: false }); const [f, setF] = useState({ counterpartCompanyId: '', type: 'CHARGE', date: istToday(), amount: '', accountId: '', description: '' }); const set = (k) => (e) => setF({ ...f, [k]: e.target.value }); const [err, setErr] = useState(null);
  const go = () => { if (!f.counterpartCompanyId || !f.accountId || !(Number(f.amount) > 0) || f.description.trim().length < 3) { setErr(t('ic.fillAll')); return; } setErr(null); run(() => ic.create({ counterpartCompanyId: Number(f.counterpartCompanyId), type: f.type, date: f.date, amount: Number(f.amount), accountId: Number(f.accountId), description: f.description.trim() }), t('ic.created')).then((r) => r && onDone(r.id)); };
  return (<div className="mdm-panel" data-testid="ic-new"><h2>{t('ic.new')}</h2>{err && <p className="field-error" role="alert">{err}</p>}<div className="form-grid">
    <Field label={t('ic.counterpart')} name="cp" error={null}><select value={f.counterpartCompanyId} onChange={set('counterpartCompanyId')} style={big} data-testid="ic-new-cp"><option value="">{t('ic.choose')}</option>{rels.filter((r) => r.status === 'ACTIVE').map((r) => <option key={r.id} value={r.otherId}>{r.other}</option>)}</select></Field>
    <Field label={t('ic.typeLabel')} name="type" error={null}><select value={f.type} onChange={set('type')} style={big}>{TYPES.map((k) => <option key={k} value={k}>{t(`ic.type.${k}`)}</option>)}</select></Field>
    <Field label={t('ic.date')} name="date" error={null}><input type="date" value={f.date} onChange={set('date')} style={big} /></Field>
    <Field label={t('ic.amount')} name="amount" error={null}><input inputMode="decimal" value={f.amount} onChange={set('amount')} style={big} data-testid="ic-new-amount" /></Field>
    <Field label={t('ic.yourAccount')} name="acc" error={null}><select value={f.accountId} onChange={set('accountId')} style={big} data-testid="ic-new-account"><option value="">{t('ic.choose')}</option>{(oq.data?.accounts ?? []).filter((a) => !a.control).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
    <Field label={t('ic.description')} name="desc" error={null}><input value={f.description} onChange={set('description')} style={big} data-testid="ic-new-desc" /></Field></div>
    <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy} onClick={go} data-testid="ic-new-save">{t('ic.save')}</button></div></div>);
}

function Relationships({ t, q, run, busy }) {
  const [f, setF] = useState({ counterpartCompanyId: '', type: 'SUBSIDIARY', holdingPct: '100' }); const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (<div className="mdm-panel" data-testid="ic-rels"><h2>{t('ic.relationships')}</h2>{q.data.length === 0 ? <p className="muted">{t('ic.noRelationships')}</p> : <ul className="lp-list">{q.data.map((r) => <li key={r.id} style={{ display: 'grid', gap: 2, minHeight: 44 }}><span style={row}><strong>{r.other}</strong><span>{t(`ic.rel.${r.type}`)} · {r.holdingPct} %</span></span><span className="muted small">{t('ic.yourAccounts')} {r.accounts.own.rec} / {r.accounts.own.pay} · {r.side === 'PARENT' ? t('ic.youKeep') : t('ic.theyKeep')}</span></li>)}</ul>}
    <h3>{t('ic.addRelationship')}</h3><div className="form-grid"><Field label={t('ic.companyId')} name="cp" error={null}><input inputMode="numeric" value={f.counterpartCompanyId} onChange={set('counterpartCompanyId')} style={big} /></Field>
      <Field label={t('ic.relType')} name="rt" error={null}><select value={f.type} onChange={set('type')} style={big}>{['SUBSIDIARY', 'ASSOCIATE', 'JOINT_VENTURE', 'FELLOW'].map((k) => <option key={k} value={k}>{t(`ic.rel.${k}`)}</option>)}</select></Field>
      <Field label={t('ic.holding')} name="h" error={null}><input inputMode="decimal" value={f.holdingPct} onChange={set('holdingPct')} style={big} /></Field>
      <button type="button" className="btn" style={big} disabled={busy || !f.counterpartCompanyId} onClick={() => run(() => ic.saveRelationship({ counterpartCompanyId: Number(f.counterpartCompanyId), type: f.type, holdingPct: Number(f.holdingPct) }), t('ic.relSaved')).then(() => q.refetch())}>{t('ic.save')}</button></div></div>);
}

export function InterCompanyPage() {
  const t = useT('ic'); usePageTitle(t('ic.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const [side, setSide] = useState('all'); const [newOpen, setNewOpen] = useState(false); const [tab, setTab] = useState('list'); const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'ic-list', side], queryFn: () => ic.list({ side, pageSize: 25 }), retry: false, enabled: !id }); const rq = useQuery({ queryKey: ['gl', 'ic-rels'], queryFn: ic.relationships, retry: false, enabled: !id });
  if (id) return <Txn id={id} />;
  const g = guardOf(q, t('ic.title'), 'fin.transaction.view'); if (g) return g;
  return (<section aria-labelledby="ic-h" data-testid="ic-page"><PageHeader id="ic-h" title={t('ic.title')} subtitle={t('ic.intro')} meta={<><Link to="/finance/ic-reconciliation">{t('icr.title')}</Link> · <Link to="/finance/consolidation">{t('con.title')}</Link></>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} onClick={() => setNewOpen(!newOpen)} data-testid="ic-new-btn">{t('ic.new')}</button>
    {newOpen && rq.data && <NewTxn t={t} rels={rq.data} run={run} busy={busy} onDone={(nid) => navigateTo(`/finance/inter-company?id=${nid}`)} />}
    <Pills tabs={[['list', t('ic.tab.list')], ['rels', t('ic.relationships')]]} tab={tab} setTab={setTab} label={t('ic.title')} prefix="ic-tab" />
    {tab === 'rels' ? (rq.data ? <Relationships t={t} q={rq} run={run} busy={busy} /> : null) : <>
      <Pills tabs={[['all', t('ic.side.all')], ['out', t('ic.side.out')], ['in', t('ic.side.in')]]} tab={side} setTab={setSide} label={t('ic.side.label')} prefix="ic-side" />
      {q.data.length === 0 ? <EmptyState compact title={t('ic.none')} message={t('ic.noneBody')} /> : <ul className="lp-list" data-testid="ic-list">{q.data.map((x) => <li key={x.id} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><Link to={`/finance/inter-company?id=${x.id}`} style={{ display: 'grid', gap: 4, minHeight: 44, textDecoration: 'none', color: 'inherit' }}>
        <span style={row}><strong>{x.docNo}</strong><span className="num">{money(x.amount)} ›</span></span><span className="small">{x.side === 'OUT' ? `→ ${x.to}` : `← ${x.from}`} · {t(`ic.type.${x.type}`)} · {x.date}</span><span className="small"><StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={t(`ic.state.${x.state}`)} /> {x.description}</span></Link></li>)}</ul>}
      <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => gl.file(`/ic-transactions/export?side=${side}`, 'inter-company-transactions.csv').catch(() => globalThis.alert?.(t('ic.fileFailed')))}>{t('ic.export')}</button></div></>}
  </section>);
}

export function IcReconciliationPage() {
  const t = useT('ic'); usePageTitle(t('icr.title')); const [asOf, setAsOf] = useState(istToday()); const q = useQuery({ queryKey: ['gl', 'icr', asOf], queryFn: () => ic.reconciliation({ asOf }), retry: false }); const x = q.data;
  return (<section aria-labelledby="icr-h" data-testid="icr-page"><PageHeader id="icr-h" title={t('icr.title')} subtitle={t('icr.intro')} meta={<Link to="/finance/inter-company">{t('ic.title')}</Link>} />
    <Field label={t('icr.asOf')} name="asOf" error={null}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={big} /></Field>
    {guardOf(q, t('icr.title'), 'fin.transaction.view') ?? <>
      {x.pairs.length === 0 ? <EmptyState compact title={t('ic.noRelationships')} message={t('icr.noPairsBody')} /> : <ul className="lp-list" data-testid="icr-pairs">{x.pairs.map((p) => <li key={p.relationshipId} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><div style={row}><strong>{p.counterpart}</strong><span>{p.matched ? t('icr.matched') : <span style={neg(1)}>{t('icr.difference')} {money(p.difference)}</span>}</span></div><span className="small">{t('icr.ours')} {money(p.own)} · {t('icr.theirs')} {money(p.theirs)}</span></li>)}</ul>}
      <div className="mdm-panel" data-testid="icr-strays"><h2>{t('icr.strays')}</h2>{x.strays.length === 0 ? <p className="muted">{t('icr.noStrays')}</p> : <ul className="lp-list">{x.strays.map((s) => <li key={s.lineId} style={{ ...row, minHeight: 44 }}><Link to={`/finance/journals?id=${s.journalId}`}>{s.voucherNo ?? s.journalId} · {s.date} · {s.account}</Link><span className="num">{s.debit ? `Dr ${money(s.debit)}` : `Cr ${money(s.credit)}`}</span></li>)}</ul>}<p className="muted small">{t('icr.strayHelp')}</p></div>
      <div className="mdm-panel"><h2>{t('icr.open')}</h2>{x.open.length === 0 ? <p className="muted">{t('icr.noOpen')}</p> : <ul className="lp-list">{x.open.map((o) => <li key={o.id} style={{ ...row, minHeight: 44 }}><Link to={`/finance/inter-company?id=${o.id}`}>{o.docNo} · {o.from} → {o.to}</Link><span>{t(`ic.state.${o.state}`)} · {money(o.amount)}</span></li>)}</ul>}</div>
    </>}</section>);
}

export function ConsolidationPage() {
  const t = useT('ic'); usePageTitle(t('con.title')); const [period, setPeriod] = useState(lastMonth()); const [basis, setBasis] = useState('YTD'); const [tab, setTab] = useState('BS'); const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'con', period, basis], queryFn: () => ic.preview({ period, basis }), retry: false }); const rq = useQuery({ queryKey: ['gl', 'con-runs'], queryFn: ic.runs, retry: false }); const x = q.data;
  return (<section aria-labelledby="con-h" data-testid="con-page"><PageHeader id="con-h" title={t('con.title')} subtitle={t('con.intro')} meta={<Link to="/finance/ic-reconciliation">{t('icr.title')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <div className="form-grid"><Field label={t('con.month')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="con-period" /></Field><Field label={t('con.basis')} name="basis" error={null}><select value={basis} onChange={(e) => setBasis(e.target.value)} style={big}>{['MONTH', 'QUARTER', 'YTD', 'YEAR'].map((b) => <option key={b} value={b}>{t(`con.b.${b}`)}</option>)}</select></Field></div>
    {guardOf(q, t('con.title'), 'fin.consolidation.view') ?? <>
      <p className="muted small">{x.from} – {x.to} · {x.companies.map((c) => `${c.name} (${c.holdingPct} %)`).join(', ')}</p>
      <KpiRow label={t('con.title')}><KpiTile label={t('con.assets')} value={money(x.balanceSheet.totals.assets)} amount={x.balanceSheet.totals.assets} kind="money" valueTestid="con-assets" /><KpiTile label={t('con.pat')} value={money(x.profitAndLoss.totals.pat)} amount={x.profitAndLoss.totals.pat} kind="money" /><KpiTile label={t('con.eliminations')} value={money(x.eliminations.debit)} amount={x.eliminations.debit} kind="money" valueTestid="con-elim" /><KpiTile label={t('con.unmatched')} value={x.unmatched ? money(x.unmatched) : t('con.none')} valueTestid="con-unmatched" /></KpiRow>
      <p className="small" data-testid="con-check">{x.balanceSheet.totals.balanced && x.eliminations.balanced ? t('con.balanced') : t('con.notBalanced')}{x.canFinalise ? '' : ` · ${t('con.blocked')}`}</p>
      <Pills tabs={[['BS', t('con.bs')], ['PL', t('con.pl')], ['EL', t('con.el')]]} tab={tab} setTab={setTab} label={t('con.title')} prefix="con-tab" />
      <div className="mdm-panel">{tab === 'EL' ? <ul className="lp-list" data-testid="con-EL">{x.eliminations.entries.map((e, i) => <li key={i} style={{ display: 'grid', gap: 2, minHeight: 44 }}><span style={row}><span>{e.description}</span><span className="num">{e.debit ? `Dr ${money(e.debit)}` : `Cr ${money(e.credit)}`}</span></span><span className="muted small">{e.line}</span></li>)}<li style={{ ...row, fontWeight: 700 }}><span>{t('con.total')}</span><span className="num">{money(x.eliminations.debit)} / {money(x.eliminations.credit)}</span></li></ul>
        : <ul className="lp-list" data-testid={`con-${tab}`}>{(tab === 'BS' ? x.balanceSheet.rows : x.profitAndLoss.rows).map((r) => <li key={r.code} style={{ display: 'grid', gap: 2, minHeight: 44 }}><span style={row}><span>{r.label}</span><span className="num">{money(r.amount)}</span></span>{r.byCompany.length > 0 && <span className="muted small">{r.byCompany.map((b) => `${b.company}: ${money(b.amount)}`).join(' · ')}</span>}</li>)}</ul>}
        {tab === 'PL' && <Rows rows={[[t('con.pat'), money(x.profitAndLoss.totals.pat)], [t('con.owners'), money(x.profitAndLoss.totals.attributableToOwners)], [t('con.nci'), money(x.profitAndLoss.totals.attributableToNci)]]} />}</div>
      <div className="actions-row ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => ic.run({ period, basis }), t('con.saved'))} data-testid="con-run">{t('con.run')}</button><button type="button" className="btn" style={big} onClick={() => gl.file(`/consolidations/export?period=${period}&basis=${basis}`, `consolidated-${period}.csv`).catch(() => globalThis.alert?.(t('ic.fileFailed')))}>{t('ic.export')}</button></div>
    </>}
    {rq.data?.length > 0 && <div className="mdm-panel" data-testid="con-runs"><h2>{t('con.runs')}</h2><ul className="lp-list">{rq.data.map((r) => <li key={r.id} style={{ ...row, minHeight: 44, alignItems: 'center' }}><span>{r.docNo} · {t(`con.rs.${r.status}`)}{r.unmatched ? ` · ${t('con.unmatched')} ${money(r.unmatched)}` : ''}</span>{r.status === 'DRAFT' && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => ic.finalise(r.id), t('con.finalised'))} data-testid={`con-finalise-${r.id}`}>{t('con.finalise')}</button>}</li>)}</ul></div>}
  </section>);
}

export function JvStatementPage() {
  const t = useT('ic'); usePageTitle(t('jv.title')); const oq = useQuery({ queryKey: ['gl', 'jn-options'], queryFn: gl.options, retry: false }); const [projectId, setProjectId] = useState(''); const [from, setFrom] = useState(`${istToday().slice(0, 4)}-04-01`); const [to, setTo] = useState(istToday()); const [f, setF] = useState({ partnerName: '', sharePct: '' }); const { error, note, busy, run } = useGlRunner();
  const sq = useQuery({ queryKey: ['gl', 'jv', projectId], queryFn: () => ic.jvShares({ projectId }), retry: false, enabled: Boolean(projectId) }); const q = useQuery({ queryKey: ['gl', 'jvs', projectId, from, to], queryFn: () => ic.jvStatement({ projectId, from, to }), retry: false, enabled: Boolean(projectId) }); const x = q.data;
  return (<section aria-labelledby="jv-h" data-testid="jv-page"><PageHeader id="jv-h" title={t('jv.title')} subtitle={t('jv.intro')} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <div className="form-grid"><Field label={t('jv.project')} name="p" error={null}><select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={big} data-testid="jv-project"><option value="">{t('ic.choose')}</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
      <Field label={t('jv.from')} name="from" error={null}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={big} /></Field><Field label={t('jv.to')} name="to" error={null}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={big} /></Field></div>
    {!projectId ? <EmptyState compact title={t('jv.choose')} message={t('jv.chooseBody')} /> : guardOf(q, t('jv.title'), 'fin.jv.view') ?? <>
      <KpiRow label={x.project}><KpiTile label={t('jv.revenue')} value={money(x.revenue)} amount={x.revenue} kind="money" valueTestid="jv-revenue" /><KpiTile label={t('jv.cost')} value={money(x.cost)} amount={x.cost} kind="money" /><KpiTile label={t('jv.result')} value={money(x.result)} amount={x.result} kind="money" /></KpiRow>
      <ul className="lp-list" data-testid="jv-shares">{x.shares.map((s) => <li key={s.name} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><div style={row}><strong>{s.name}{s.own ? ` · ${t('jv.own')}` : ''}</strong><span>{s.sharePct} %</span></div><span className="small">{t('jv.revenue')} {money(s.revenue)} · {t('jv.cost')} {money(s.cost)} · {t('jv.result')} {money(s.result)}</span></li>)}</ul>
      {sq.data && <div className="mdm-panel"><h3>{t('jv.addPartner')}</h3><div className="form-grid"><Field label={t('jv.partner')} name="pn" error={null}><input value={f.partnerName} onChange={(e) => setF({ ...f, partnerName: e.target.value })} style={big} /></Field><Field label={t('jv.share')} name="sp" error={null}><input inputMode="decimal" value={f.sharePct} onChange={(e) => setF({ ...f, sharePct: e.target.value })} style={big} /></Field>
        <button type="button" className="btn" style={big} disabled={busy || f.partnerName.trim().length < 2 || !(Number(f.sharePct) > 0)} onClick={() => run(() => ic.saveJvShare({ projectId: Number(projectId), partnerName: f.partnerName.trim(), sharePct: Number(f.sharePct) }), t('jv.saved')).then(() => setF({ partnerName: '', sharePct: '' }))}>{t('ic.save')}</button></div></div>}
    </>}</section>);
}
