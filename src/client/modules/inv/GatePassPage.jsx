import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { GATE_TONE, download, fmtDate, fmtTime, gt, iv, today } from './api.js';
import { OfflineNotice, useOnline } from './GateParts.jsx';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Gate Pass request (part 16.02, FR-05): what leaves the site, where it goes and why. Returnable material needs a return date. The construction manager (or the store manager) approves; non-returnable material and scrap also need the project manager. The approved pass carries the QR code that the gate scans.
const TYPES = ['RETURNABLE', 'NON_RETURNABLE', 'SCRAP', 'VENDOR_RETURN'];
const blank = () => ({ siteId: '', type: 'RETURNABLE', expectedReturn: '', vendorId: '', vehicleNo: '', driverName: '', destination: '', purpose: '', items: [{ description: '', qty: '', uom: 'nos' }] });
const toBody = (f, withSite) => ({ ...(withSite ? { siteId: Number(f.siteId) } : {}), type: f.type, expectedReturn: f.type === 'RETURNABLE' ? f.expectedReturn || null : null, vendorId: f.type === 'VENDOR_RETURN' && f.vendorId ? Number(f.vendorId) : null, vehicleNo: f.vehicleNo || null, driverName: f.driverName || null, destination: f.destination, purpose: f.purpose, items: f.items.map((l) => ({ description: l.description, qty: Number(l.qty), uom: l.uom })) });

function PassForm({ t, edit }) {
  const opt = useQuery({ queryKey: ['inv', 'gate-options'], queryFn: gt.options, retry: false }); const vq = useQuery({ queryKey: ['inv', 'gate-vendors', ''], queryFn: () => gt.vendors(''), retry: false });
  const [f, setF] = useState(() => (edit ? { siteId: String(edit.siteId), type: edit.type, expectedReturn: edit.expectedReturn ?? '', vendorId: edit.vendorId ? String(edit.vendorId) : '', vehicleNo: edit.vehicleNo ?? '', driverName: edit.driverName ?? '', destination: edit.destination, purpose: edit.purpose, items: edit.items.map((l) => ({ description: l.description, qty: String(l.qty), uom: l.uom })) } : blank()));
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const set = (k, v) => setF((x) => ({ ...x, [k]: v })); const line = (i, k, v) => setF((x) => ({ ...x, items: x.items.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  usePageTitle(t('g.passTitle'));
  if (opt.error?.status === 403) return <NoPermission what={t('g.passTitle')} permission="inv.pass.create" />;
  if (opt.isPending) return <Skeleton label={t('g.passTitle')} rows={4} />;
  const save = async (send) => { setError(null); setBusy(true); try { let d = edit ? await gt.passUpdate(edit.id, { ...toBody(f, false), rowVersion: edit.rowVersion }) : await gt.passCreate(toBody(f, true)); if (send) d = await gt.passAct(d.id, 'submit'); navigateTo(`/inv/gate-pass?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const bad = !f.siteId || f.destination.trim().length < 2 || f.purpose.trim().length < 3 || f.items.some((l) => l.description.trim().length < 2 || !(Number(l.qty) > 0)) || (f.type === 'RETURNABLE' && !f.expectedReturn);
  return (
    <section aria-labelledby="gp-h" data-testid="gate-pass-form"><PageHeader id="gp-h" title={edit ? edit.docNo : t('g.passTitle')} subtitle={t('g.passHelp')} meta={<Link to="/inv/gate-passes">{t('g.returnables')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate><div className="form-grid">
        <Field label={t('g.site')} name="siteId" error={error}><select value={f.siteId} disabled={Boolean(edit)} onChange={(ev) => set('siteId', ev.target.value)} style={{ minHeight: 48 }} data-testid="gp-site"><option value="">{t('choose')}</option>{opt.data.sites.map((s) => <option key={s.id} value={s.id}>{s.project} · {s.name}</option>)}</select></Field>
        <Field label={t('g.passType')} name="type" error={error}><select value={f.type} onChange={(ev) => set('type', ev.target.value)} style={{ minHeight: 48 }} data-testid="gp-type">{TYPES.map((x) => <option key={x} value={x}>{t(`g.pt.${x}`)}</option>)}</select></Field>
        {f.type === 'RETURNABLE' && <Field label={t('g.expectedReturn')} name="expectedReturn" error={error}><input type="date" min={today()} value={f.expectedReturn} onChange={(ev) => set('expectedReturn', ev.target.value)} style={{ minHeight: 48 }} data-testid="gp-return" /></Field>}
        {f.type === 'VENDOR_RETURN' && <Field label={t('g.vendor')} name="vendorId" error={error}><select value={f.vendorId} onChange={(ev) => set('vendorId', ev.target.value)} style={{ minHeight: 48 }} data-testid="gp-vendor"><option value="">{t('choose')}</option>{(vq.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>}
        <Field label={t('g.destination')} name="destination" error={error}><input value={f.destination} onChange={(ev) => set('destination', ev.target.value)} maxLength={200} style={{ minHeight: 48 }} data-testid="gp-destination" /></Field>
        <Field label={t('g.purpose')} name="purpose" error={error}><input value={f.purpose} onChange={(ev) => set('purpose', ev.target.value)} maxLength={300} style={{ minHeight: 48 }} data-testid="gp-purpose" /></Field>
        <Field label={t('g.vehicleNo')} name="vehicleNo" error={error}><input value={f.vehicleNo} onChange={(ev) => set('vehicleNo', ev.target.value.toUpperCase())} maxLength={20} style={{ minHeight: 48 }} data-testid="gp-vehicle" /></Field>
        <Field label={t('g.driver')} name="driverName" error={error}><input value={f.driverName} onChange={(ev) => set('driverName', ev.target.value)} maxLength={80} style={{ minHeight: 48 }} /></Field></div>
        <div className="table-scroll"><table className="data-table" data-testid="gp-items"><caption>{t('g.items')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('qty')}</th><th>{t('uom')}</th><th /></tr></thead><tbody>{f.items.map((l, i) => <tr key={i}><td data-label={t('item')}><input aria-label={t('item')} value={l.description} onChange={(ev) => line(i, 'description', ev.target.value)} maxLength={200} style={{ minHeight: 44 }} data-testid={`gp-item-${i}`} /></td><td data-label={t('qty')}><input aria-label={t('qty')} type="number" inputMode="decimal" min="0" step="0.001" value={l.qty} onChange={(ev) => line(i, 'qty', ev.target.value)} style={{ minHeight: 44 }} data-testid={`gp-qty-${i}`} /></td><td data-label={t('uom')}><input aria-label={t('uom')} value={l.uom} onChange={(ev) => line(i, 'uom', ev.target.value)} maxLength={20} style={{ minHeight: 44, width: 90 }} /></td><td>{f.items.length > 1 && <button type="button" className="btn" onClick={() => setF((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))}>{t('remove')}</button>}</td></tr>)}</tbody></table></div>
        <button type="button" className="btn" onClick={() => setF((x) => ({ ...x, items: [...x.items, { description: '', qty: '', uom: 'nos' }] }))} data-testid="gp-add-item">{t('g.addItem')}</button>
        {error?.form && <p className="field-error" role="alert" data-testid="gp-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy || !f.siteId} data-testid="gp-save">{t('saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || bad} onClick={() => save(true)} data-testid="gp-send">{t('sendForApproval')}</button></div></form></section>
  );
}

function Pass({ t, id }) {
  const online = useOnline(); const q = useQuery({ queryKey: ['inv', 'pass', id], queryFn: () => gt.pass(id), retry: false }); const hq = useQuery({ queryKey: ['inv', 'pass-history', id, q.data?.status], queryFn: () => gt.passHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); usePageTitle(t('g.passTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('g.passTitle')} permission="inv.pass.view" />;
  if (q.isPending) return <Skeleton label={t('g.passTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const p = q.data; const can = p.can; const why = (action, msg) => { const x = window.prompt(t('why')); if (x) run(() => gt.passAct(p.id, action, { reason: x }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(p.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div data-testid="gp-object" data-status={p.status}>
      <PageHeader id="gp-h" title={<>{p.docNo} <StatusBadge status={GATE_TONE[p.status]} label={t(`gps.${p.status}`)} /> {p.overdue && <strong data-testid="gp-overdue">{t('g.overdueDays', { n: p.daysOverdue })}</strong>}</>} meta={<><Link to="/inv/gate-passes">{t('g.returnables')}</Link> · {p.site} · {t(`g.pt.${p.type}`)}</>} />
      <OfflineNotice t={t} on={online} />{error?.form && <p className="field-error" role="alert" data-testid="gp-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="gp-note">{note}</p>}
      <dl className="kv"><div><dt>{t('g.destination')}</dt><dd>{p.destination}</dd></div><div><dt>{t('g.purpose')}</dt><dd>{p.purpose}</dd></div>{p.returnable && <div><dt>{t('g.expectedReturn')}</dt><dd>{fmtDate(p.expectedReturn)}</dd></div>}{p.vendor && <div><dt>{t('g.vendor')}</dt><dd>{p.vendor}</dd></div>}<div><dt>{t('g.vehicleNo')}</dt><dd>{p.vehicleNo ?? '—'} {p.driverName ?? ''}</dd></div><div><dt>{t('g.requestedBy')}</dt><dd>{p.requestedBy}</dd></div>{p.approvedBy && <div><dt>{t('approvedBy')}</dt><dd>{p.approvedBy}</dd></div>}{p.timeOut && <div><dt>{t('g.timeOut')}</dt><dd>{fmtTime(p.timeOut)} ({p.verifiedBy})</dd></div>}{p.returnedOn && <div><dt>{t('g.returnedOn')}</dt><dd>{fmtDate(p.returnedOn)}</dd></div>}</dl>
      <div className="table-scroll"><table className="data-table" data-testid="gp-lines"><caption>{t('g.items')}</caption><thead><tr><th>{t('item')}</th><th className="num">{t('qty')}</th><th>{t('uom')}</th></tr></thead><tbody>{p.items.map((l, i) => <tr key={i}><td>{l.description}</td><td className="num">{l.qty}</td><td>{l.uom}</td></tr>)}</tbody></table></div>
      {p.qrImage && <figure className="mdm-panel" data-testid="gp-qr"><img src={p.qrImage} alt={t('g.qrAlt', { code: p.docNo })} width={220} height={220} /><figcaption>{p.qrCode}</figcaption></figure>}
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => gt.passAct(p.id, 'submit'), t('submitted'))} data-testid="gp-submit">{t('sendForApproval')}</button>}
        {can.edit && <Link to={`/inv/gate-pass?edit=${p.id}`}>{t('g.edit')}</Link>}
        {can.markReturned && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => gt.passAct(p.id, 'return', {}), t('g.markedBack'))} data-testid="gp-return-btn">{t('g.markBack')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend', t('g.amended'))} data-testid="gp-amend">{t('g.amend')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="gp-cancel">{t('cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { try { await gt.passDelete(p.id); navigateTo('/inv/gate-passes'); } catch (x) { setError(errorInfo(x)); } }}>{t('g.discard')}</button>}
        {['APPROVED', 'OUT', 'CLOSED'].includes(p.status) && <button type="button" className="btn" onClick={() => download(`/passes/${p.id}/print`, `${p.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('g.fileFailed') }))} data-testid="gp-print">{t('g.print')}</button>}
        {p.workflowInstanceId && <Link to={`/workflow/instance?id=${p.workflowInstanceId}`}>{t('approval')}</Link>}
      </div>
      {p.taskId && <div className="mdm-panel no-print" data-testid="gp-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="gp-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="gp-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')} data-testid="gp-reject">{t('reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="gp-history" />
    </div>
  );
}
export default function GatePassPage() {
  const t = useT('inv'); const sp = useSearch(); const id = Number(sp.get('id')) || null; const edit = Number(sp.get('edit')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  const eq = useQuery({ queryKey: ['inv', 'pass', edit], queryFn: () => gt.pass(edit), enabled: Boolean(edit), retry: false });
  if (edit) return eq.isPending ? <Skeleton label={t('g.passTitle')} rows={4} /> : eq.isError ? <ErrorState error={eq.error} onRetry={eq.refetch} /> : <PassForm key={edit} t={t} edit={eq.data} />;
  if (id) return <section aria-labelledby="gp-h" data-testid="gate-pass"><Pass key={id} t={t} id={id} /></section>;
  if (session.isSuccess && !perms.includes('inv.pass.create')) return <NoPermission what={t('g.passTitle')} permission="inv.pass.create" />;
  return <PassForm t={t} edit={null} />;
}
