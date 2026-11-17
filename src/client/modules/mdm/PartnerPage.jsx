import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DiscussionTab, TimelineTab } from '../../platform/collab/CollabTabs.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { api } from '../../platform/api/index.js';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CONSTITUTIONS, DOC_TYPES, PARTNER_ROLES, PARTNER_STATUS, partners } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Partner 360 (Administration, part 06.04): one business partner. The header: code, status, roles, steward, payments (held or free, and why) and the actions the person may take on this status: send a prospect for
// approval or edit it, put on hold or release, make inactive, ask to blacklist or lift it, ask for a bank change. Tabs: Details · GST registrations (verify) · Bank accounts (masked; finance may show the full number,
// logged; a change is confirmed by the partner and approved) · Documents (expiry, verification by a second person) · Contacts and addresses · TDS · Activity (what other modules hold, history) · Approvals ·
// Timeline · Discussion.
const TABS = [['details', 'Details'], ['gstins', 'GST registrations'], ['banks', 'Bank accounts'], ['documents', 'Documents'], ['contacts', 'Contacts and addresses'], ['tds', 'TDS'], ['activity', 'Activity'], ['approvals', 'Approvals'], ['timeline', 'Timeline'], ['discussion', 'Discussion']];
const DOC_STATE = { EXPIRED: ['OVERDUE', 'Expired'], DUE: ['AT_RISK', 'Expires soon'], VALID: ['ACTIVE', 'Valid'], NO_EXPIRY: ['ACTIVE', 'No expiry'] };
const roleLabel = (r) => PARTNER_ROLES.find(([k]) => k === r)?.[1] ?? r;
export default function PartnerPage() {
  const sp = new URLSearchParams(window.location.search);
  const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['mdm', 'partner', id], queryFn: () => partners.get(id), enabled: Boolean(id), retry: false });
  usePageTitle(q.data ? `${q.data.code} ${q.data.legalName}` : 'Partner 360');
  const [tab, setTab] = useState(() => sp.get('tab') ?? 'details');
  if (!id) return <ErrorState title="No partner chosen" error={{ message: 'Open a partner from Business Partners.' }} />;
  if (q.error?.status === 403) return <NoPermission what="the business partners" permission="mdm.record.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the partner" rows={6} />;
  const p = q.data;
  const onKey = (e) => { const i = TABS.findIndex(([k]) => k === tab); const n = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i - 1 + TABS.length) % TABS.length] : null; if (n) { e.preventDefault(); setTab(n[0]); document.getElementById(`pp-tab-${n[0]}`)?.focus(); } };
  return (
    <section aria-labelledby="pp-title" data-testid="partner-page">
      <p><Link to="/admin/partners">← Business Partners</Link></p>
      {sp.get('sent') && <p className="mdm-banner" role="status" data-testid="pp-sent">Sent for approval: the {p.stewardRole === 'PROCMGR' ? 'procurement' : 'commercial'} manager, then the accounts manager.</p>}
      {sp.get('saved') && p.status === 'PROSPECT' && <p className="mdm-banner" role="status">Saved as a prospect. Send it for approval when it is complete.</p>}
      <header className="op-header">
        <PageHeader id="pp-title" title={<>{p.code} · {p.legalName}</>} status={<StatusBadge status={PARTNER_STATUS[p.status][0]} label={PARTNER_STATUS[p.status][1]} />} />
        <dl className="op-figures">
          <div><dt>Roles</dt><dd data-testid="pp-roles">{p.roles.map(roleLabel).join(', ')}</dd></div><div><dt>Constitution</dt><dd>{CONSTITUTIONS.find(([k]) => k === p.constitution)?.[1]}</dd></div><div><dt>PAN</dt><dd data-testid="pp-pan">{p.pan ?? '—'}</dd></div>
          <div><dt>Steward</dt><dd>{p.stewardRole === 'PROCMGR' ? 'Procurement' : 'Commercial'}</dd></div><div><dt>Payments</dt><dd data-testid="pp-payment">{p.payment.held ? <StatusBadge status="ON_HOLD" label={`On hold${p.payment.until ? ` until ${formatDate(p.payment.until)}` : ''}`} /> : 'Free'}{p.payment.held && <div className="muted small">{p.payment.reason}</div>}</dd></div>
          <div><dt>Documents</dt><dd>{p.expiredDocuments ? <StatusBadge status="OVERDUE" label={`${p.expiredDocuments} expired`} /> : p.dueDocuments ? <StatusBadge status="AT_RISK" label={`${p.dueDocuments} expiring`} /> : `${p.documents.length} on file`}</dd></div>
          {p.status === 'BLACKLISTED' && <div><dt>Blacklisted</dt><dd>{p.blacklistReason}{p.blacklistUntil ? ` (until ${formatDate(p.blacklistUntil)})` : ''}</dd></div>}
        </dl>
        <Actions p={p} />
      </header>
      <div role="tablist" aria-label="Partner sections" className="op-tabs" onKeyDown={onKey}>{TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`pp-tab-${k}`} aria-selected={tab === k} aria-controls={`pp-panel-${k}`} tabIndex={tab === k ? 0 : -1} className={`op-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)} data-testid={`pp-tab-${k}`}>{l}</button>)}</div>
      <div role="tabpanel" id={`pp-panel-${tab}`} aria-labelledby={`pp-tab-${tab}`} className="op-panel" tabIndex={0}>
        {tab === 'details' && <dl className="kv-list">{[['Legal name', p.legalName], ['Trade name', p.tradeName], ['Constitution', CONSTITUTIONS.find(([k]) => k === p.constitution)?.[1]], ['PAN', p.pan], ['Udyam (MSME)', p.msmeNo ? `${p.msmeNo} · ${p.msmeCategory?.toLowerCase()}` : null], ['CIN', p.cin], ['Categories', p.categories.join(', ')], ['Regions', p.regions.join(', ')], ['Requested by', p.requestedBy], ['Active since', p.activatedAt ? formatDateTime(p.activatedAt) : null], ['Status reason', p.statusReason]].map(([k, x]) => <div className="kv" key={k}><dt>{k}</dt><dd>{x || '—'}</dd></div>)}</dl>}
        {tab === 'gstins' && <Gstins p={p} />}
        {tab === 'banks' && <Banks p={p} />}
        {tab === 'documents' && <Documents p={p} />}
        {tab === 'contacts' && <><h3>Contacts</h3><ul className="mdm-list">{p.contacts.map((c) => <li key={c.id}>{c.name}{c.designation ? `, ${c.designation}` : ''} · {c.mobile ?? '—'} · {c.email ?? '—'}{c.isPrimary ? ' · primary' : ''}</li>)}</ul><h3>Addresses</h3><ul className="mdm-list">{p.addresses.map((a) => <li key={a.id}><strong>{a.type.toLowerCase()}</strong>: {a.address}{a.city ? `, ${a.city}` : ''}, {a.state}{a.pin ? ` ${a.pin}` : ''}</li>)}</ul></>}
        {tab === 'tds' && <Tds p={p} />}
        {tab === 'activity' && <Activity p={p} />}
        {tab === 'approvals' && <Approvals p={p} />}
        {tab === 'timeline' && <TimelineTab entity="mdm_partner" id={p.id} />}
        {tab === 'discussion' && <DiscussionTab entity="mdm_partner" id={p.id} />}
      </div>
    </section>
  );
}

function useRun(p) {
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const run = async (fn, done) => { setError(null); setNote(null); try { const out = await fn(); if (done) setNote(typeof done === 'function' ? done(out) : done); qc.invalidateQueries({ queryKey: ['mdm', 'partner', p.id] }); return out; } catch (e) { setError(errorInfo(e)); return null; } };
  return { run, error, note, setNote };
}

function Actions({ p }) {
  const { run, error, note } = useRun(p);
  const [mode, setMode] = useState(null);
  const [f, setF] = useState({});
  const st = (action) => run(() => partners.setStatus(p.id, { action, reason: f.reason, version: p.rowVersion }), 'Saved.').then(() => setMode(null));
  return (
    <div data-testid="pp-actions">
      <div className="actions-row">
        {p.status === 'PROSPECT' && p.canEdit && <><button type="button" className="btn btn-primary" onClick={() => run(() => partners.submit(p.id), 'Sent for approval.')} data-testid="pp-submit">Send for approval</button><button type="button" className="btn" onClick={() => navigateTo(`/admin/partners/new?id=${p.id}`)}>Edit</button></>}
        {p.status === 'PENDING' && p.canEdit && <button type="button" className="btn" onClick={() => navigateTo(`/admin/partners/new?id=${p.id}`)}>Correct (if returned)</button>}
        {p.canHold && p.status === 'ACTIVE' && <button type="button" className="btn" onClick={() => { setF({ reason: '' }); setMode('HOLD'); }} data-testid="pp-hold">Put on hold</button>}
        {p.canHold && p.status === 'ON_HOLD' && <button type="button" className="btn" onClick={() => { setF({ reason: '' }); setMode('RELEASE'); }} data-testid="pp-release">Release the hold</button>}
        {p.canEdit && p.status === 'ACTIVE' && <button type="button" className="btn" onClick={() => { setF({ reason: '' }); setMode('INACTIVATE'); }}>Make inactive</button>}
        {p.canEdit && p.status === 'INACTIVE' && <button type="button" className="btn" onClick={() => { setF({ reason: '' }); setMode('REACTIVATE'); }}>Make active again</button>}
        {p.canBlacklist && ['ACTIVE', 'ON_HOLD', 'INACTIVE'].includes(p.status) && <button type="button" className="btn" onClick={() => { setF({ reason: '', until: '' }); setMode('BLACKLIST'); }} data-testid="pp-blacklist">Ask to blacklist</button>}
        {p.canBlacklist && p.status === 'BLACKLISTED' && <button type="button" className="btn" onClick={() => { setF({ reason: '' }); setMode('LIFT'); }}>Ask to lift the blacklist</button>}
      </div>
      {mode && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); if (mode === 'BLACKLIST' || mode === 'LIFT') run(() => partners.blacklist(p.id, { action: mode === 'LIFT' ? 'LIFT_BLACKLIST' : 'BLACKLIST', reason: f.reason, until: f.until || null }), 'Sent to the director for approval.').then(() => setMode(null)); else st(mode); }} data-testid="pp-action-form">
        <Field label="Reason (required)" name="reason" error={error}><textarea rows="2" required minLength={mode === 'BLACKLIST' || mode === 'LIFT' ? 10 : 5} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} data-testid="pp-reason" /></Field>
        {mode === 'BLACKLIST' && <Field label="Until (empty: no end date)" name="until" error={error}><input type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></Field>}
        <div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="pp-action-go">{mode === 'BLACKLIST' || mode === 'LIFT' ? 'Send for approval' : 'Confirm'}</button></div></form>}
      {note && <p role="status" className="mdm-banner" data-testid="pp-note">{note}</p>}
      {error?.form && !mode && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Gstins({ p }) {
  const { run, error } = useRun(p);
  const [g, setG] = useState({ stateCode: '', gstin: '' });
  return (
    <div data-testid="pp-gstins">
      <div className="table-wrap" tabIndex={0} role="region" aria-label="GST registrations"><table className="grid"><thead><tr><th>State</th><th>GSTIN</th><th>Status</th><th>Verified</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{p.gstins.map((x) => <tr key={x.id}><th scope="row" data-label="State">{x.state}</th><td data-label="GSTIN">{x.gstin}</td><td data-label="Status">{x.status.toLowerCase()}</td><td data-label="Verified">{x.verifySource === 'API' ? `on the portal by ${x.verifiedBy}, ${formatDate(x.verifiedAt)}` : 'format and check character'}</td>
          <td>{p.canVerify && x.verifySource !== 'API' && <button type="button" className="btn btn-small" onClick={() => { if (window.confirm(`Did you check ${x.gstin} on the GST portal and find it active?`)) run(() => partners.verifyGstin(p.id, { gstinId: x.id, checkedOnPortal: true })); }} data-testid="pp-gst-verify">Verified on the portal</button>}</td></tr>)}</tbody></table></div>
      {p.gstins.length === 0 && <p className="muted">No GST registration.</p>}
      {p.canEdit && ['ACTIVE', 'ON_HOLD'].includes(p.status) && <form className="actions-row" onSubmit={(e) => { e.preventDefault(); run(() => partners.addGstin(p.id, g)).then((o) => o && setG({ stateCode: '', gstin: '' })); }}><Field label="State code" name="stateCode" error={error}><input value={g.stateCode} maxLength={3} onChange={(e) => setG({ ...g, stateCode: e.target.value.toUpperCase() })} /></Field><Field label="GSTIN" name="gstin" error={error}><input value={g.gstin} maxLength={15} onChange={(e) => setG({ ...g, gstin: e.target.value.toUpperCase() })} /></Field><button type="submit" className="btn btn-small">Add</button></form>}
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Banks({ p }) {
  const { run, error, note } = useRun(p);
  const [shown, setShown] = useState({});
  const [req, setReq] = useState(null);
  const [conf, setConf] = useState({ code: '', spokeTo: '', number: '', note: '' });
  const pending = p.banks.find((b) => b.status === 'PENDING_CONFIRMATION');
  return (
    <div data-testid="pp-banks">
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Bank accounts"><table className="grid"><thead><tr><th>Account</th><th>IFSC · bank</th><th>Name</th><th>Status</th><th>Verified</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{p.banks.map((b) => <tr key={b.id} data-testid="pp-bank"><th scope="row" data-label="Account" className="num">{shown[b.id] ?? b.account}</th><td data-label="IFSC">{b.ifsc}{b.bankName ? <div className="muted small">{b.bankName}, {b.branch}</div> : null}</td><td data-label="Name">{b.accountName}</td>
          <td data-label="Status">{b.status.toLowerCase().replace(/_/g, ' ')}{b.coolingOffUntil && b.status === 'ACTIVE' && b.coolingOffUntil > new Date().toISOString() ? <div className="muted small">cooling off until {formatDateTime(b.coolingOffUntil)}</div> : null}</td>
          <td data-label="Verified">{b.verifyMethod ? `${b.verifyMethod.toLowerCase()}${b.verifyNote ? `: ${b.verifyNote}` : ''}` : b.verified.toLowerCase()}</td>
          <td>{p.canSeeBank && !shown[b.id] && <button type="button" className="btn btn-small" onClick={async () => { const o = await run(() => partners.revealBank(p.id, b.id)); if (o) setShown({ ...shown, [b.id]: o.accountNo }); }} data-testid="pp-bank-show">Show (logged)</button>}</td></tr>)}</tbody></table></div>
      {p.banks.length === 0 && <p className="muted">No bank account.</p>}
      {pending && p.canRequestBank && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => partners.confirmBank(p.id, pending.id, conf.code ? { code: conf.code } : { callback: { spokeTo: conf.spokeTo, number: conf.number, note: conf.note } }), 'Confirmed and sent to the accounts manager and the CFO.'); }} data-testid="pp-confirm">
        <h3>Confirm the change to the account ending {pending.last4}</h3>
        <p className="muted small">Ask the partner's registered contact for the code sent to them, or call back a number registered before this change and note the call.</p>
        <Field label="Code from the partner" name="code" error={error}><input inputMode="numeric" maxLength={6} value={conf.code} onChange={(e) => setConf({ ...conf, code: e.target.value })} data-testid="pp-code" /></Field>
        <details><summary>No code: note a call-back</summary><Field label="Spoke to" name="spokeTo" error={error}><input value={conf.spokeTo} onChange={(e) => setConf({ ...conf, spokeTo: e.target.value })} /></Field><Field label="Registered number called" name="number" error={error}><input inputMode="tel" value={conf.number} onChange={(e) => setConf({ ...conf, number: e.target.value })} /></Field><Field label="What was confirmed" name="note" error={error}><input value={conf.note} onChange={(e) => setConf({ ...conf, note: e.target.value })} /></Field></details>
        <button type="submit" className="btn btn-primary" data-testid="pp-confirm-go">Confirm</button></form>}
      {p.canRequestBank && ['ACTIVE', 'ON_HOLD'].includes(p.status) && !p.banks.some((b) => ['PENDING_CONFIRMATION', 'PENDING_APPROVAL'].includes(b.status)) && (req ? <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => partners.requestBank(p.id, req), (o) => (o.confirmation.sent ? `Payments are on hold. A code was sent to ${o.confirmation.to}: enter it below.` : `Payments are on hold. ${o.confirmation.message}`)).then((o) => o && setReq(null)); }} data-testid="pp-bank-form">
        <Field label="New account number" name="accountNo" error={error}><input inputMode="numeric" autoComplete="off" value={req.accountNo} onChange={(e) => setReq({ ...req, accountNo: e.target.value })} data-testid="pp-new-acct" /></Field>
        <Field label="IFSC" name="ifsc" error={error}><input maxLength={11} value={req.ifsc} onChange={(e) => setReq({ ...req, ifsc: e.target.value.toUpperCase() })} data-testid="pp-new-ifsc" /></Field>
        <Field label="Name on the account" name="accountName" error={error}><input value={req.accountName} onChange={(e) => setReq({ ...req, accountName: e.target.value })} data-testid="pp-new-name" /></Field>
        <Field label="Why (required)" name="reason" error={error}><textarea rows="2" required minLength={10} value={req.reason} onChange={(e) => setReq({ ...req, reason: e.target.value })} data-testid="pp-new-why" /></Field>
        <p className="muted small">Payments to this partner are held from now until the change is approved and the cooling-off period has passed.</p>
        <div className="actions"><button type="button" className="btn" onClick={() => setReq(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="pp-new-go">Ask for the change</button></div></form>
        : <button type="button" className="btn" onClick={() => setReq({ accountNo: '', ifsc: '', accountName: p.legalName, reason: '' })} data-testid="pp-bank-change">Ask for a bank change</button>)}
      {note && <p role="status" className="mdm-banner" data-testid="pp-bank-note">{note}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="pp-bank-error">{error.form}</p>}
      <h3>Cancelled cheque and other files</h3>
      <AttachmentList entity="mdm_partner" entityId={p.id} canEdit={p.canEdit || p.canVerify} />{(p.canEdit || p.canRequestBank) && <FileUploader entity="mdm_partner" entityId={p.id} />}
    </div>
  );
}

function Documents({ p }) {
  const { run, error } = useRun(p);
  const [d, setD] = useState(null);
  return (
    <div data-testid="pp-documents">
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Compliance documents"><table className="grid"><thead><tr><th>Document</th><th>Number</th><th>Valid</th><th>State</th><th>Verified</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{p.documents.map((x) => <tr key={x.id} className={x.state === 'EXPIRED' ? 'is-overdue' : x.state === 'DUE' ? 'is-soon' : ''} data-testid="pp-doc"><th scope="row" data-label="Document">{x.typeLabel}</th><td data-label="Number">{x.number ?? '—'}</td><td data-label="Valid">{x.validFrom ? formatDate(x.validFrom) : '—'} to {x.validUntil ? formatDate(x.validUntil) : 'no expiry'}</td>
          <td data-label="State"><StatusBadge status={DOC_STATE[x.state][0]} label={DOC_STATE[x.state][1]} /></td><td data-label="Verified">{x.verifiedBy ? `${x.verifiedBy}, ${formatDate(x.verifiedAt)}` : '—'}</td>
          <td>{p.canVerify && !x.verifiedBy && <button type="button" className="btn btn-small" onClick={() => run(() => partners.verifyDocument(p.id, x.id))} data-testid="pp-doc-verify">Verify</button>}</td></tr>)}</tbody></table></div>
      {p.documents.length === 0 && <p className="muted">No compliance document yet.</p>}
      {(p.canEdit || p.canVerify) && (d ? <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => partners.addDocument(p.id, { docType: d.docType, docNo: d.docNo || null, validFrom: d.validFrom || null, validUntil: d.validUntil || null })).then((o) => o && setD(null)); }} data-testid="pp-doc-form">
        <Field label="Document" name="docType" error={error}><select value={d.docType} onChange={(e) => setD({ ...d, docType: e.target.value })} data-testid="pp-doc-type">{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Number" name="docNo" error={error}><input value={d.docNo} onChange={(e) => setD({ ...d, docNo: e.target.value })} /></Field>
        <Field label="Valid from" name="validFrom" error={error}><input type="date" value={d.validFrom} onChange={(e) => setD({ ...d, validFrom: e.target.value })} /></Field>
        <Field label="Valid until" name="validUntil" error={error}><input type="date" value={d.validUntil} onChange={(e) => setD({ ...d, validUntil: e.target.value })} data-testid="pp-doc-until" /></Field>
        <div className="actions"><button type="button" className="btn" onClick={() => setD(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="pp-doc-save">Add</button></div></form>
        : <button type="button" className="btn" onClick={() => setD({ docType: 'GST_CERTIFICATE', docNo: '', validFrom: '', validUntil: '' })} data-testid="pp-doc-add">Add a document</button>)}
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      <p className="muted small">Attach the scanned document on the Bank accounts tab (files of the partner) or in the Discussion.</p>
    </div>
  );
}

function Tds({ p }) {
  const { run, error, note } = useRun(p);
  const [rows, setRows] = useState(p.tds.map((t) => ({ section: t.section, ldcNo: t.ldcNo ?? '', ldcRate: t.ldcRate ?? '', ldcLimit: t.ldcLimit ?? '', validFrom: t.validFrom ?? '', validUntil: t.validUntil ?? '' })));
  return (
    <div data-testid="pp-tds">
      <div className="table-wrap" tabIndex={0} role="region" aria-label="TDS"><table className="grid"><thead><tr><th>Section</th><th>Lower-deduction certificate</th><th className="num">Rate %</th><th className="num">Limit (₹)</th><th>Valid</th></tr></thead>
        <tbody>{rows.map((t, i) => <tr key={i}><th scope="row" data-label="Section">{p.canVerify ? <input aria-label="Section" value={t.section} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, section: e.target.value } : x)))} /> : t.section}</th>
          <td data-label="Certificate">{p.canVerify ? <input aria-label="Certificate number" value={t.ldcNo} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ldcNo: e.target.value } : x)))} /> : t.ldcNo || '—'}</td>
          <td className="num" data-label="Rate">{p.canVerify ? <input aria-label="Rate" inputMode="decimal" value={t.ldcRate} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ldcRate: e.target.value } : x)))} /> : t.ldcRate || '—'}</td>
          <td className="num" data-label="Limit">{p.canVerify ? <input aria-label="Limit" inputMode="decimal" value={t.ldcLimit} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ldcLimit: e.target.value } : x)))} /> : t.ldcLimit || '—'}</td>
          <td data-label="Valid">{p.canVerify ? <><input aria-label="Valid from" type="date" value={t.validFrom} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, validFrom: e.target.value } : x)))} /><input aria-label="Valid until" type="date" value={t.validUntil} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, validUntil: e.target.value } : x)))} /></> : `${t.validFrom || '—'} to ${t.validUntil || '—'}`}</td></tr>)}</tbody></table></div>
      {p.canVerify && <div className="actions-row"><button type="button" className="btn btn-small" onClick={() => setRows([...rows, { section: '', ldcNo: '', ldcRate: '', ldcLimit: '', validFrom: '', validUntil: '' }])}>Add a section</button><button type="button" className="btn btn-primary btn-small" onClick={() => run(() => partners.setTds(p.id, { tds: rows.filter((t) => t.section).map((t) => ({ section: t.section, ldcNo: t.ldcNo || null, ldcRate: t.ldcRate || null, ldcLimit: t.ldcLimit || null, validFrom: t.validFrom || null, validUntil: t.validUntil || null })) }), 'Saved.')} data-testid="pp-tds-save">Save TDS</button></div>}
      {note && <p role="status">{note}</p>}{error?.form && <p className="field-error" role="alert">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
    </div>
  );
}

function Activity({ p }) {
  const q = useQuery({ queryKey: ['mdm', 'partner', p.id, 'summary'], queryFn: () => partners.summary(p.id), retry: false });
  if (q.isPending) return <Skeleton label="Loading the activity" rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const s = q.data;
  return (
    <div data-testid="pp-activity">
      <div className="cc-tiles">{s.tiles.map((t) => <div key={t.label} className="cc-tile"><span className="cc-value num">{t.value}</span><span className="cc-label">{t.label}</span></div>)}</div>
      <p>{s.selectable.selectable ? 'Can be chosen for a new RFQ, PO or work order.' : <strong>Cannot be chosen for a new RFQ, PO or work order: {s.selectable.reasons.join('; ')}.</strong>}</p>
      {s.modules.length ? <ul className="mdm-list">{s.modules.map((m) => <li key={`${m.source}${m.label}`}>{m.source}: {m.route ? <Link to={m.route}>{m.label}</Link> : m.label} {m.value}</li>)}</ul> : <p className="muted">{s.note}</p>}
      <h3>History</h3><ul className="mdm-list">{s.history.map((h, i) => <li key={i}>{formatDateTime(h.at)} · {h.action.replace(/_/g, ' ')} · {h.by}{h.reason ? `: ${h.reason}` : ''}</li>)}</ul>
    </div>
  );
}

function Approvals({ p }) {
  const ids = [p.instanceId, ...p.banks.map((b) => b.instanceId), ...p.statusRequests.map((s) => s.instanceId)].filter(Boolean);
  const q = useQuery({ queryKey: ['workflow', 'instances', ids], queryFn: async () => Promise.all(ids.map(async (i) => (await api.get(`/workflow/instances/${i}`)).data)), enabled: ids.length > 0, retry: false });
  if (!ids.length) return <p className="muted">Nothing sent for approval yet.</p>;
  if (q.isPending) return <Skeleton label="Loading the approvals" rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <ul className="mdm-list" data-testid="pp-approvals">{q.data.map((i) => <li key={i.id}><strong>{i.docTypeLabel ?? i.docType}</strong> · {String(i.status).toLowerCase()} · sent by {i.submittedBy}{i.submittedAt ? ` on ${formatDateTime(i.submittedAt)}` : ''}{(i.history ?? []).length ? <ol>{i.history.map((h, k) => <li key={k}>{formatDateTime(h.at ?? h.createdAt)} · {String(h.event ?? h.action ?? '').toLowerCase().replace(/_/g, ' ')} · {h.actor ?? h.by ?? ''}{h.comment ? `: ${h.comment}` : ''}</li>)}</ol> : null}</li>)}<li><Link to="/approvals">Open My Approvals</Link></li></ul>;
}
