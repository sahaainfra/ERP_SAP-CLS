import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { ctr, fmtDate, qs } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './CtrParts.jsx';

// Securities (part 21.02): the Bank Guarantee Register, Insurance Policies, and the Securities Exposure report with the bank limits and the security position of a contract.
const nf = new Intl.NumberFormat('en-IN'); const money = (n) => (n == null ? '—' : `₹ ${nf.format(n)}`);
const STATE_TONE = { REQUESTED: 'DRAFT', ACTIVE: 'APPROVED', EXTENDED: 'APPROVED', REDUCED: 'APPROVED', RELEASED: 'CANCELLED', INVOKED: 'REJECTED', EXPIRED: 'REJECTED', RENEWED: 'CANCELLED' };
const EV_TONE = { REQUESTED: 'IN_REVIEW', DONE: 'APPROVED', REJECTED: 'REJECTED' };
const BG_TYPES = ['PERFORMANCE', 'ADVANCE', 'BID', 'RETENTION', 'SECURITY_DEPOSIT', 'FINANCIAL', 'OTHER'];
const blankBg = { projectId: '', contractId: '', direction: 'GIVEN', bgType: 'PERFORMANCE', bgNo: '', bankName: '', partnerId: '', amount: '', issueDate: '', expiryDate: '', claimExpiry: '', marginPct: '0', commissionPct: '0', linkedRef: '' };

function BgForm({ initial, onSave, busy, error, isNew }) {
  const t = useT('ctr'); const o = useQuery({ queryKey: ['ctr', 'bg-options'], queryFn: () => ctr.get('/bank-guarantees/options'), retry: false }); const [v, setV] = useState(initial); const fe = error?.fields ?? {};
  if (o.error?.status === 403) return <NoPermission what={t('bg.title')} permission="ctr.bank_guarantee.create" />; if (o.isPending) return <Skeleton label={t('bg.title')} rows={4} />;
  const f = (k, label, props = {}) => <Field label={t(label)} name={k} error={fe[k]}><input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} style={big} data-testid={`ctr-bg-${k}`} {...props} /></Field>;
  const contracts = o.data.contracts.filter((c) => !v.projectId || String(c.projectId) === String(v.projectId));
  return (<div className="mdm-panel" data-testid="ctr-bg-form"><div className="form-grid">
    {isNew && <Field label={t('project')} name="projectId" error={fe.projectId}><select value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value, contractId: '' })} style={big} data-testid="ctr-bg-project"><option value="">—</option>{o.data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>}
    <Field label={t('bg.direction')} name="direction" error={fe.direction}><select value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value })} style={big} data-testid="ctr-bg-direction">{['GIVEN', 'RECEIVED'].map((k) => <option key={k} value={k}>{t(`bg.d.${k}`)}</option>)}</select></Field>
    <Field label={t('bg.type')} name="bgType" error={fe.bgType}><select value={v.bgType} onChange={(e) => setV({ ...v, bgType: e.target.value })} style={big} data-testid="ctr-bg-bgType">{BG_TYPES.map((k) => <option key={k} value={k}>{t(`bg.t.${k}`)}</option>)}</select></Field>
    <Field label={t('bg.contract')} name="contractId" error={fe.contractId}><select value={v.contractId} onChange={(e) => setV({ ...v, contractId: e.target.value })} style={big} data-testid="ctr-bg-contract"><option value="">—</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.contractNo}</option>)}</select></Field>
    <Field label={t('bg.party')} name="partnerId" error={fe.partnerId}><select value={v.partnerId} onChange={(e) => setV({ ...v, partnerId: e.target.value })} style={big} data-testid="ctr-bg-partner"><option value="">—</option>{o.data.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    {f('bgNo', 'bg.no', { maxLength: 60 })}{f('bankName', 'bg.bank', { maxLength: 120 })}{f('amount', 'bg.amount', { type: 'number', min: 0, step: 'any', inputMode: 'decimal' })}
    {f('issueDate', 'bg.issue', { type: 'date' })}{f('expiryDate', 'bg.expiry', { type: 'date' })}{f('claimExpiry', 'bg.claimExpiry', { type: 'date' })}{f('marginPct', 'bg.margin', { type: 'number', min: 0, step: 'any' })}{f('commissionPct', 'bg.commission', { type: 'number', min: 0, step: 'any' })}{f('linkedRef', 'bg.linkedRef', { maxLength: 120 })}</div>
    <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.projectId && isNew || !v.bgNo || !v.bankName || !v.amount || !v.issueDate || !v.expiryDate} onClick={() => onSave(v)} data-testid="ctr-bg-save">{t('save')}</button></div></div>);
}
const bgPayload = (v) => ({ ...(v.projectId ? { projectId: Number(v.projectId) } : {}), direction: v.direction, bgType: v.bgType, contractId: v.contractId ? Number(v.contractId) : null, partnerId: v.partnerId ? Number(v.partnerId) : null, bgNo: v.bgNo, bankName: v.bankName, amount: Number(v.amount), issueDate: v.issueDate, expiryDate: v.expiryDate, claimExpiry: v.claimExpiry || null, marginPct: Number(v.marginPct || 0), commissionPct: Number(v.commissionPct || 0), linkedRef: v.linkedRef || null });
const bgFrom = (x) => ({ projectId: '', contractId: x.contractId ? String(x.contractId) : '', direction: x.direction, bgType: x.bgType, bgNo: x.bgNo, bankName: x.bankName, partnerId: x.partnerId ? String(x.partnerId) : '', amount: String(x.original), issueDate: x.issueDate, expiryDate: x.expiryDate, claimExpiry: x.claimExpiry ?? '', marginPct: String(x.marginPct), commissionPct: String(x.commissionPct), linkedRef: x.linkedRef ?? '' });

function RequestPanel({ x, run, busy }) {
  const t = useT('ctr'); const [r, setR] = useState({ kind: 'EXTEND', newExpiry: '', newAmount: '', referenceNo: '', reason: '' });
  return (<form className="mdm-panel no-print" data-testid="ctr-bg-request" onSubmit={async (e) => { e.preventDefault(); const b = { kind: r.kind, reason: r.reason, referenceNo: r.referenceNo || undefined, ...(r.kind === 'EXTEND' ? { newExpiry: r.newExpiry } : {}), ...(r.kind === 'REDUCE' ? { newAmount: Number(r.newAmount) } : {}) }; if (await run(() => ctr.post(`/bank-guarantees/${x.id}/requests`, b), t('bg.requested'))) setR({ ...r, reason: '' }); }}>
    <h2>{t('bg.requestTitle')}</h2>{x.advance && <p className="muted" data-testid="ctr-bg-advance">{t('bg.advanceInfo', { given: money(x.advance.given), recovered: money(x.advance.recovered), outstanding: money(x.advance.outstanding) })}</p>}
    <div className="form-grid"><Field label={t('bg.requestKind')} name="kind" error={null}><select value={r.kind} onChange={(e) => setR({ ...r, kind: e.target.value })} style={big} data-testid="ctr-bgr-kind">{['EXTEND', 'REDUCE', 'RELEASE', 'INVOKE'].map((k) => <option key={k} value={k}>{t(`bg.k.${k}`)}</option>)}</select></Field>
      {r.kind === 'EXTEND' && <Field label={t('bg.newExpiry')} name="newExpiry" error={null}><input type="date" value={r.newExpiry} onChange={(e) => setR({ ...r, newExpiry: e.target.value })} style={big} data-testid="ctr-bgr-expiry" /></Field>}
      {r.kind === 'REDUCE' && <Field label={t('bg.newAmount')} name="newAmount" error={null}><input type="number" min="0" step="any" value={r.newAmount} onChange={(e) => setR({ ...r, newAmount: e.target.value })} style={big} data-testid="ctr-bgr-amount" /></Field>}
      <Field label={t('bg.reference')} name="referenceNo" error={null}><input value={r.referenceNo} onChange={(e) => setR({ ...r, referenceNo: e.target.value })} style={big} /></Field>
      <Field label={t('bg.reason')} name="reason" error={null}><input value={r.reason} onChange={(e) => setR({ ...r, reason: e.target.value })} style={big} data-testid="ctr-bgr-reason" /></Field></div>
    <div className="actions-row"><button className="btn" style={big} disabled={busy || r.reason.length < 5 || (r.kind === 'EXTEND' && !r.newExpiry) || (r.kind === 'REDUCE' && !r.newAmount)} data-testid="ctr-bgr-send">{t('bg.sendRequest')}</button></div></form>);
}
function BankGuarantee({ id }) {
  const t = useT('ctr'); const { q, guard } = useRecord('/bank-guarantees', id, t('bg.title'), 'ctr.bank_guarantee.view'); const { error, run, busy, note } = useRunner(); const [editing, setEditing] = useState(false); usePageTitle(t('bg.title')); if (guard) return guard; const x = q.data;
  const decide = (e, approve) => { let n = null; if (!approve) { n = globalThis.prompt(t('bg.refuseWhy')); if (!n) return; } run(() => ctr.post(`/bg-requests/${e.id}/decide`, { approve, note: n ?? undefined }), approve ? t('bg.confirmed') : t('bg.refused')); };
  const row = (k, val) => <tr><th scope="row">{t(k)}</th><td>{val}</td></tr>;
  return (
    <div data-testid="ctr-bg-object" data-status={x.status} data-state={x.state}><h1 id="bg-h">{x.bgNo} <Status x={x} /> <StatusBadge status={STATE_TONE[x.state]} label={t(`bg.s.${x.state}`)} /></h1>
      <p><Link to="/ctr/bank-guarantees">{t('bg.title')}</Link> · {x.docNo} · {x.project} · {t(`bg.d.${x.direction}`)} · {t(`bg.t.${x.bgType}`)}{x.contractNo ? <> · <Link to={`/ctr/contracts?id=${x.contractId}`}>{x.contractNo}</Link></> : null}</p><ErrorLine error={error} id="ctr-error" />{note && <p className="mdm-banner" role="status" data-testid="ctr-note">{note}</p>}
      {x.expiring && <p className="mdm-banner" role="alert" data-testid="ctr-bg-expiring">{t('bg.expiring', { n: x.daysLeft })}</p>}
      {x.problems?.length > 0 && <div className="mdm-panel" data-testid="ctr-problems"><h2>{t('k.before')}</h2><ul>{x.problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul></div>}
      {x.can.edit && editing ? <BgForm initial={bgFrom(x)} isNew={false} busy={busy} error={error} onSave={async (v) => { if (await run(() => ctr.edit('/bank-guarantees', x.id, { ...bgPayload(v), rowVersion: x.version }), t('k.saved'))) setEditing(false); }} /> : (
        <div className="table-scroll"><table className="data-table" data-testid="ctr-bg-terms"><tbody>
          {row('bg.amount', <strong data-testid="ctr-bg-amount">{money(x.amount)}</strong>)}{x.amount !== x.original && row('bg.original', money(x.original))}{row('bg.bank', x.bankName)}{row('bg.party', x.party ?? '—')}{row('bg.issue', fmtDate(x.issueDate))}{row('bg.expiry', <span data-testid="ctr-bg-expiryDate">{fmtDate(x.expiryDate)}{x.daysLeft != null ? ` (${t('bg.daysLeft', { n: x.daysLeft })})` : ''}</span>)}{row('bg.claimExpiry', x.claimExpiry ? fmtDate(x.claimExpiry) : '—')}{row('bg.margin', `${x.marginPct}% · ${money(x.margin)}`)}{row('bg.commission', `${x.commissionPct}% · ${money(x.commission)}`)}{x.linkedRef && row('bg.linkedRef', x.linkedRef)}</tbody></table></div>)}
      <div className="actions-row no-print">{x.can.edit && !editing && <button type="button" className="btn" onClick={() => setEditing(true)} data-testid="ctr-bg-edit">{t('edit')}</button>}{x.status === 'APPROVED' && <button type="button" className="btn" onClick={() => ctr.exportFile(`/bank-guarantees/${x.id}/letter?kind=${x.state === 'RELEASED' ? 'RELEASE' : 'EXTEND'}`, `${x.docNo}-letter.pdf`).catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="ctr-bg-letter">{t('bg.letter')}</button>}</div>
      {x.events.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="ctr-bg-events"><caption>{t('bg.events')}</caption><thead><tr><th>{t('k.when')}</th><th>{t('bg.requestKind')}</th><th className="num">{t('bg.amount')}</th><th>{t('bg.expiry')}</th><th>{t('bg.reason')}</th><th>{t('k.state')}</th><th /></tr></thead>
        <tbody>{x.events.map((e) => <tr key={e.id} data-testid="ctr-bg-event" data-kind={e.kind} data-status={e.status}><td>{fmtDate(e.at)}</td><td>{t(`bg.k.${e.kind}`)}{e.requestedBy ? ` · ${e.requestedBy}` : ''}</td><td className="num">{money(e.amountAfter)}</td><td>{e.expiryAfter ? fmtDate(e.expiryAfter) : '—'}</td><td>{e.reason ?? ''}{e.decisionNote ? ` — ${e.decisionNote}` : ''}</td><td><StatusBadge status={EV_TONE[e.status]} label={t(`bg.es.${e.status}`)} /></td>
          <td>{e.can?.decide && <div className="actions-row"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide(e, true)} data-testid="ctr-bge-confirm">{t('bg.confirm')}</button><button type="button" className="btn" disabled={busy} onClick={() => decide(e, false)} data-testid="ctr-bge-refuse">{t('bg.refuse')}</button></div>}</td></tr>)}</tbody></table></div>}
      {x.can.request && <RequestPanel x={x} run={run} busy={busy} />}
      <DocBar kind="/bank-guarantees" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
export function BankGuaranteesPage() {
  const t = useT('ctr'); usePageTitle(t('bg.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const { error, run, busy } = useRunner();
  if (id) return <section aria-labelledby="bg-h"><BankGuarantee id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="bgn-h"><h1 id="bgn-h">{t('bg.new')}</h1><p><Link to="/ctr/bank-guarantees">{t('bg.title')}</Link></p><ErrorLine error={error} id="ctr-error" /><BgForm initial={blankBg} isNew busy={busy} error={error} onSave={async (v) => { const r = await run(() => ctr.make('/bank-guarantees', bgPayload(v))); if (r) navigateTo(`/ctr/bank-guarantees?id=${r.id}`); }} /></section>;
  return (
    <section aria-labelledby="bgs-h" data-testid="ctr-bank-guarantees"><h1 id="bgs-h">{t('bg.title')}</h1><p className="muted">{t('bg.intro')}</p>
      <div className="actions-row no-print"><Link to="/ctr/bank-guarantees?new=1" data-testid="ctr-bg-new">{t('bg.new')}</Link> · <Link to="/ctr/securities">{t('sx.title')}</Link> · <Link to="/ctr/insurances">{t('ins.title')}</Link></div>
      <ListReport listCode="ctr.bank_guarantees" endpoint="/ctr/bank-guarantees" title={t('bg.title')} session={session.data} rowHref={(r) => `/ctr/bank-guarantees?id=${r.id}`} onOpen={(r) => navigateTo(`/ctr/bank-guarantees?id=${r.id}`)} cardFields={['bgNo', 'bank', 'amount', 'expiry', 'state']} statusKey="status" empty={{ title: t('bg.emptyTitle'), text: t('bg.emptyBody') }} />
    </section>
  );
}

// ---- insurance policies -------------------------------------------------------------------------------------------------------------
const TYPES = ['CAR', 'EAR', 'WORKMEN_COMP', 'THIRD_PARTY', 'VEHICLE', 'MARINE', 'FIRE', 'OTHER'];
const blankIns = { projectId: '', contractId: '', policyType: 'CAR', policyNo: '', insurer: '', sumInsured: '', premium: '', validFrom: '', validTo: '', coverage: '' };
const insPayload = (v) => ({ ...(v.projectId ? { projectId: Number(v.projectId) } : {}), contractId: v.contractId ? Number(v.contractId) : null, policyType: v.policyType, policyNo: v.policyNo, insurer: v.insurer, sumInsured: Number(v.sumInsured), premium: Number(v.premium || 0), validFrom: v.validFrom, validTo: v.validTo, coverage: v.coverage || null });
function InsForm({ initial, isNew, onSave, busy, error }) {
  const t = useT('ctr'); const o = useQuery({ queryKey: ['ctr', 'ins-options'], queryFn: () => ctr.get('/insurances/options'), retry: false }); const [v, setV] = useState(initial); const fe = error?.fields ?? {};
  if (o.error?.status === 403) return <NoPermission what={t('ins.title')} permission="ctr.insurance.create" />; if (o.isPending) return <Skeleton label={t('ins.title')} rows={3} />;
  const f = (k, label, props = {}) => <Field label={t(label)} name={k} error={fe[k]}><input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} style={big} data-testid={`ctr-ins-${k}`} {...props} /></Field>;
  return (<div className="mdm-panel" data-testid="ctr-ins-form"><div className="form-grid">
    {isNew && <Field label={t('project')} name="projectId" error={fe.projectId}><select value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value, contractId: '' })} style={big} data-testid="ctr-ins-project"><option value="">—</option>{o.data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>}
    <Field label={t('bg.contract')} name="contractId" error={fe.contractId}><select value={v.contractId} onChange={(e) => setV({ ...v, contractId: e.target.value })} style={big} data-testid="ctr-ins-contract"><option value="">—</option>{o.data.contracts.filter((c) => !v.projectId || String(c.projectId) === String(v.projectId)).map((c) => <option key={c.id} value={c.id}>{c.contractNo}</option>)}</select></Field>
    <Field label={t('ins.type')} name="policyType" error={fe.policyType}><select value={v.policyType} onChange={(e) => setV({ ...v, policyType: e.target.value })} style={big} data-testid="ctr-ins-policyType">{TYPES.map((k) => <option key={k} value={k}>{t(`ins.t.${k}`)}</option>)}</select></Field>
    {f('policyNo', 'ins.no', { maxLength: 60 })}{f('insurer', 'ins.insurer', { maxLength: 120 })}{f('sumInsured', 'ins.sum', { type: 'number', min: 0, step: 'any' })}{f('premium', 'ins.premium', { type: 'number', min: 0, step: 'any' })}{f('validFrom', 'ins.from', { type: 'date' })}{f('validTo', 'ins.to', { type: 'date' })}{f('coverage', 'ins.coverage', { maxLength: 500 })}</div>
    <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || (isNew && !v.projectId) || !v.policyNo || !v.insurer || !v.sumInsured || !v.validFrom || !v.validTo} onClick={() => onSave(v)} data-testid="ctr-ins-save">{t('save')}</button></div></div>);
}
function Claims({ x, run, busy }) {
  const t = useT('ctr'); const [c, setC] = useState({ claimNo: '', incidentRef: '', incidentDate: '', description: '', claimed: '' });
  return (<div data-testid="ctr-ins-claims"><h2>{t('ins.claims')}</h2>
    {x.claims.length === 0 ? <p className="muted">{t('ins.noClaims')}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('ins.claimNo')}</th><th>{t('ins.incident')}</th><th>{t('k.when')}</th><th className="num">{t('ins.claimed')}</th><th className="num">{t('ins.settled')}</th><th>{t('k.state')}</th><th /></tr></thead>
      <tbody>{x.claims.map((k) => <tr key={k.id} data-testid="ctr-claim-row" data-status={k.status}><td>{k.claimNo}</td><td>{k.description}</td><td>{fmtDate(k.incidentDate)}</td><td className="num">{money(k.claimed)}</td><td className="num">{k.status === 'SETTLED' ? money(k.settled) : '—'}</td><td>{t(`ins.cs.${k.status}`)}</td>
        <td>{['LODGED', 'UNDER_REVIEW'].includes(k.status) && x.can.claim && <button type="button" className="btn" disabled={busy} onClick={() => { const s = globalThis.prompt(t('ins.settledAmount')); if (s) run(() => ctr.patch(`/insurance-claims/${k.id}`, { status: 'SETTLED', settled: Number(s), settledOn: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10) }), t('ins.settledDone')); }} data-testid="ctr-claim-settle">{t('ins.settle')}</button>}</td></tr>)}</tbody></table></div>}
    {x.can.claim && <form className="form-grid no-print" data-testid="ctr-claim-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => ctr.post(`/insurances/${x.id}/claims`, { claimNo: c.claimNo, incidentRef: c.incidentRef || undefined, incidentDate: c.incidentDate, description: c.description, claimed: Number(c.claimed) }), t('ins.claimAdded'))) setC({ claimNo: '', incidentRef: '', incidentDate: '', description: '', claimed: '' }); }}>
      <Field label={t('ins.claimNo')} name="claimNo" error={null}><input value={c.claimNo} onChange={(e) => setC({ ...c, claimNo: e.target.value })} style={big} data-testid="ctr-claim-no" /></Field><Field label={t('ins.incident')} name="description" error={null}><input value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} style={big} data-testid="ctr-claim-desc" /></Field>
      <Field label={t('ins.incidentDate')} name="incidentDate" error={null}><input type="date" value={c.incidentDate} onChange={(e) => setC({ ...c, incidentDate: e.target.value })} style={big} data-testid="ctr-claim-date" /></Field><Field label={t('ins.claimed')} name="claimed" error={null}><input type="number" min="0" step="any" value={c.claimed} onChange={(e) => setC({ ...c, claimed: e.target.value })} style={big} data-testid="ctr-claim-amount" /></Field>
      <div className="actions-row"><button className="btn" style={big} disabled={busy || !c.claimNo || c.description.length < 5 || !c.incidentDate || !c.claimed} data-testid="ctr-claim-add">{t('ins.addClaim')}</button></div></form>}</div>);
}
function Insurance({ id }) {
  const t = useT('ctr'); const { q, guard } = useRecord('/insurances', id, t('ins.title'), 'ctr.insurance.view'); const { error, run, busy, note } = useRunner(); const [editing, setEditing] = useState(false); usePageTitle(t('ins.title')); if (guard) return guard; const x = q.data;
  const row = (k, val) => <tr><th scope="row">{t(k)}</th><td>{val}</td></tr>;
  return (
    <div data-testid="ctr-ins-object" data-status={x.status} data-state={x.state}><h1 id="ins-h">{x.policyNo} <Status x={x} /> <StatusBadge status={STATE_TONE[x.state]} label={t(`ins.s.${x.state}`)} /></h1>
      <p><Link to="/ctr/insurances">{t('ins.title')}</Link> · {x.docNo} · {x.project} · {t(`ins.t.${x.policyType}`)}</p><ErrorLine error={error} id="ctr-error" />{note && <p className="mdm-banner" role="status" data-testid="ctr-note">{note}</p>}
      {x.expiring && <p className="mdm-banner" role="alert" data-testid="ctr-ins-expiring">{t('ins.expiring', { n: x.daysLeft })}</p>}
      {x.can.edit && editing ? <InsForm initial={{ projectId: '', contractId: x.contractId ? String(x.contractId) : '', policyType: x.policyType, policyNo: x.policyNo, insurer: x.insurer, sumInsured: String(x.sumInsured), premium: String(x.premium), validFrom: x.validFrom, validTo: x.validTo, coverage: x.coverage ?? '' }} isNew={false} busy={busy} error={error} onSave={async (v) => { if (await run(() => ctr.edit('/insurances', x.id, { ...insPayload(v), rowVersion: x.version }), t('k.saved'))) setEditing(false); }} /> : (
        <div className="table-scroll"><table className="data-table" data-testid="ctr-ins-terms"><tbody>{row('ins.insurer', x.insurer)}{row('ins.sum', money(x.sumInsured))}{row('ins.premium', money(x.premium))}{row('ins.period', `${fmtDate(x.validFrom)} → ${fmtDate(x.validTo)}${x.daysLeft != null ? ` (${t('bg.daysLeft', { n: x.daysLeft })})` : ''}`)}{row('ins.coverage', x.coverage ?? '—')}{row('ins.claimedTotal', money(x.claimedTotal))}{row('ins.settledTotal', money(x.settledTotal))}</tbody></table></div>)}
      <div className="actions-row no-print">{x.can.edit && !editing && <button type="button" className="btn" onClick={() => setEditing(true)} data-testid="ctr-ins-edit">{t('edit')}</button>}
        {x.can.renew && <button type="button" className="btn btn-primary" disabled={busy} onClick={async () => { const r = globalThis.prompt(t('ins.renewWhy')); if (!r) return; const n = await run(() => ctr.post(`/insurances/${x.id}/renew`, { reason: r }), t('ins.renewed')); if (n) navigateTo(`/ctr/insurances?id=${n.id}`); }} data-testid="ctr-ins-renew">{t('ins.renew')}</button>}</div>
      {x.status === 'APPROVED' && <Claims x={x} run={run} busy={busy} />}
      <DocBar kind="/insurances" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
export function InsurancesPage() {
  const t = useT('ctr'); usePageTitle(t('ins.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const { error, run, busy } = useRunner();
  if (id) return <section aria-labelledby="ins-h"><Insurance id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="insn-h"><h1 id="insn-h">{t('ins.new')}</h1><p><Link to="/ctr/insurances">{t('ins.title')}</Link></p><ErrorLine error={error} id="ctr-error" /><InsForm initial={blankIns} isNew busy={busy} error={error} onSave={async (v) => { const r = await run(() => ctr.make('/insurances', insPayload(v))); if (r) navigateTo(`/ctr/insurances?id=${r.id}`); }} /></section>;
  return (
    <section aria-labelledby="inss-h" data-testid="ctr-insurances"><h1 id="inss-h">{t('ins.title')}</h1><p className="muted">{t('ins.intro')}</p>
      <div className="actions-row no-print"><Link to="/ctr/insurances?new=1" data-testid="ctr-ins-new">{t('ins.new')}</Link> · <Link to="/ctr/securities">{t('sx.title')}</Link> · <Link to="/ctr/bank-guarantees">{t('bg.title')}</Link></div>
      <ListReport listCode="ctr.insurances" endpoint="/ctr/insurances" title={t('ins.title')} session={session.data} rowHref={(r) => `/ctr/insurances?id=${r.id}`} onOpen={(r) => navigateTo(`/ctr/insurances?id=${r.id}`)} cardFields={['policyNo', 'insurer', 'sumInsured', 'validTo', 'state']} statusKey="status" empty={{ title: t('ins.emptyTitle'), text: t('ins.emptyBody') }} />
    </section>
  );
}

// ---- exposure, limits and the position of a contract --------------------------------------------------------------------------------
function Limits({ run, busy }) {
  const t = useT('ctr'); const q = useQuery({ queryKey: ['ctr', 'limits'], queryFn: () => ctr.get('/bank-limits'), retry: false }); const [l, setL] = useState({ bankName: '', limitKind: 'BG', limit: '', validTo: '', marginPct: '10' });
  if (!q.data) return null;
  return (<div data-testid="ctr-limits"><h2>{t('sx.limits')}</h2>
    {q.data.length === 0 ? <p className="muted">{t('sx.noLimits')}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('bg.bank')}</th><th>{t('sx.kind')}</th><th className="num">{t('sx.limit')}</th><th>{t('sx.validTo')}</th><th className="num">{t('bg.margin')}</th><th /></tr></thead><tbody>{q.data.map((x) => <tr key={x.id} data-testid="ctr-limit-row"><td>{x.bank}</td><td>{x.kind}</td><td className="num">{money(x.limit)}</td><td>{x.validTo ? fmtDate(x.validTo) : '—'}</td><td className="num">{x.marginPct}%</td><td><button type="button" className="btn" disabled={busy} onClick={() => run(() => ctr.remove(`/bank-limits/${x.id}`), t('sx.limitRemoved'))}>{t('remove')}</button></td></tr>)}</tbody></table></div>}
    <form className="form-grid no-print" data-testid="ctr-limit-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => ctr.put('/bank-limits', { bankName: l.bankName, limitKind: l.limitKind, limit: Number(l.limit), validTo: l.validTo || null, marginPct: Number(l.marginPct || 0) }), t('sx.limitSaved'))) setL({ ...l, bankName: '', limit: '' }); }}>
      <Field label={t('bg.bank')} name="bankName" error={null}><input value={l.bankName} onChange={(e) => setL({ ...l, bankName: e.target.value })} style={big} data-testid="ctr-limit-bank" /></Field><Field label={t('sx.limit')} name="limit" error={null}><input type="number" min="0" step="any" value={l.limit} onChange={(e) => setL({ ...l, limit: e.target.value })} style={big} data-testid="ctr-limit-amount" /></Field>
      <Field label={t('sx.validTo')} name="validTo" error={null}><input type="date" value={l.validTo} onChange={(e) => setL({ ...l, validTo: e.target.value })} style={big} /></Field><Field label={t('bg.margin')} name="marginPct" error={null}><input type="number" min="0" step="any" value={l.marginPct} onChange={(e) => setL({ ...l, marginPct: e.target.value })} style={big} /></Field>
      <div className="actions-row"><button className="btn" style={big} disabled={busy || !l.bankName || !l.limit} data-testid="ctr-limit-save">{t('sx.setLimit')}</button></div></form></div>);
}
export function SecuritiesPage() {
  const t = useT('ctr'); usePageTitle(t('sx.title')); const { error, run, busy, note } = useRunner(); const [f, setF] = useState({ within: '90' }); const query = qs({ within: f.within });
  const q = useQuery({ queryKey: ['ctr', 'exposure', query], queryFn: () => ctr.get(`/securities/exposure${query}`), retry: false, placeholderData: (p) => p });
  if (q.error?.status === 403) return <NoPermission what={t('sx.title')} permission="ctr.bank_guarantee.view" />; if (q.isPending) return <Skeleton label={t('sx.title')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data;
  return (
    <section aria-labelledby="sx-h" data-testid="ctr-securities"><h1 id="sx-h">{t('sx.title')}</h1><p className="muted">{t('sx.intro', { date: fmtDate(d.asOf) })}</p><ErrorLine error={error} id="ctr-error" />{note && <p className="mdm-banner" role="status" data-testid="ctr-note">{note}</p>}
      <div className="form-grid" data-testid="ctr-sx-totals">{[['given', money(d.totals.given), d.totals.givenCount], ['margin', money(d.totals.margin)], ['received', money(d.totals.received), d.totals.receivedCount], ['expiring', d.totals.expiring + d.totals.policiesExpiring], ['sumInsured', money(d.totals.sumInsured), d.totals.policiesInForce]].map(([k, val, n]) => <div className="mdm-panel" key={k} data-testid={`ctr-sx-${k}`}><div className="muted">{t(`sx.t.${k}`)}{n != null ? ` (${n})` : ''}</div><strong style={{ fontSize: '1.3rem' }}>{val}</strong></div>)}</div>
      <div className="mdm-panel no-print"><div className="form-grid"><Field label={t('sx.within')} name="within" error={null}><select value={f.within} onChange={(e) => setF({ ...f, within: e.target.value })} style={big} data-testid="ctr-sx-within">{['30', '60', '90', '180', '365'].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field></div></div>
      <h2>{t('sx.byBank')}</h2>{d.banks.length === 0 ? <div className="empty-state"><h2>{t('sx.emptyTitle')}</h2><p>{t('sx.emptyBody')}</p><Link to="/ctr/bank-guarantees">{t('bg.title')}</Link></div> : <div className="table-scroll"><table className="data-table" data-testid="ctr-sx-banks"><thead><tr><th>{t('bg.bank')}</th><th className="num">{t('sx.limit')}</th><th className="num">{t('sx.used')}</th><th className="num">{t('sx.headroom')}</th><th className="num">{t('sx.utilisation')}</th><th className="num">{t('bg.margin')}</th></tr></thead>
        <tbody>{d.banks.map((b) => <tr key={b.bank} data-testid="ctr-sx-bank" data-over={b.over ? '1' : '0'}><td>{b.bank}</td><td className="num">{money(b.limit)}</td><td className="num">{money(b.used)}</td><td className="num">{money(b.headroom)}</td><td className="num">{b.utilisationPct == null ? '—' : <>{b.utilisationPct}% {b.over ? '⚠' : b.overAlert ? '!' : ''}</>}</td><td className="num">{money(b.margin)}</td></tr>)}</tbody></table></div>}
      <h2>{t('sx.expiringBg')}</h2>{d.expiringGuarantees.length === 0 ? <p className="muted">{t('sx.noneExpiring')}</p> : <div className="table-scroll"><table className="data-table" data-testid="ctr-sx-expiring"><thead><tr><th>{t('bg.no')}</th><th>{t('bg.bank')}</th><th className="num">{t('bg.amount')}</th><th>{t('bg.expiry')}</th><th className="num">{t('sx.days')}</th></tr></thead><tbody>{d.expiringGuarantees.map((g) => <tr key={g.id}><td><Link to={`/ctr/bank-guarantees?id=${g.id}`}>{g.bgNo}</Link></td><td>{g.bankName}</td><td className="num">{money(g.amount)}</td><td>{fmtDate(g.expiryDate)}</td><td className="num">{g.daysLeft}</td></tr>)}</tbody></table></div>}
      <h2>{t('sx.expiringIns')}</h2>{d.expiringPolicies.length === 0 ? <p className="muted">{t('sx.noneExpiring')}</p> : <div className="table-scroll"><table className="data-table" data-testid="ctr-sx-policies"><thead><tr><th>{t('ins.no')}</th><th>{t('ins.insurer')}</th><th className="num">{t('ins.sum')}</th><th>{t('ins.to')}</th><th className="num">{t('sx.days')}</th></tr></thead><tbody>{d.expiringPolicies.map((p) => <tr key={p.id}><td><Link to={`/ctr/insurances?id=${p.id}`}>{p.policyNo}</Link></td><td>{p.insurer}</td><td className="num">{money(p.sumInsured)}</td><td>{fmtDate(p.validTo)}</td><td className="num">{p.daysLeft}</td></tr>)}</tbody></table></div>}
      <Limits run={run} busy={busy} />
    </section>
  );
}
