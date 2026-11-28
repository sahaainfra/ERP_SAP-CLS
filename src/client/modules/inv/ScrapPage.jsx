import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { COUNT_TONE, cn, download, fmtDate, fmtQty, fmtRs, iv } from './api.js';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Scrap, Disposal and Expiry (part 16.06, FR-05 and FR-06): the scrap register, the disposals (sale, auction, write-off) that go through approval and make the gate pass, and the shelf-life stock that is expired or about to expire.
const SOURCES = ['DAMAGED', 'EXPIRED', 'CUT_PIECES', 'OTHER'];
function NewEntry({ t, stores }) {
  const { error, run, busy, note } = useRunner(); const [f, setF] = useState({ storeId: '', source: 'DAMAGED', description: '', qty: '', uom: '', weightKg: '', itemId: '', fromStock: false });
  const iq = useQuery({ queryKey: ['inv', 'items-pick'], queryFn: () => iv.items(''), retry: false }); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const go = async () => { const body = { storeId: Number(f.storeId), source: f.source, description: f.description, qty: Number(f.qty), ...(f.uom ? { uom: f.uom } : {}), ...(f.weightKg ? { weightKg: Number(f.weightKg) } : {}), ...(f.itemId ? { itemId: Number(f.itemId), fromStock: f.fromStock } : {}) }; const d = await run(() => cn.entryCreate(body), t('cn.entryAdded')); if (d) setF({ ...f, description: '', qty: '', weightKg: '' }); };
  return (
    <div className="mdm-panel" data-testid="entry-new"><h2>{t('cn.entryTitle')}</h2>{error?.form && <p className="field-error" role="alert" data-testid="entry-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="entry-note">{note}</p>}
      <div className="form-grid">
        <Field label={t('tr.store')} name="storeId" error={error}><select value={f.storeId} onChange={(ev) => set('storeId', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="entry-store"><option value="">—</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label={t('cn.source')} name="source" error={error}><select value={f.source} onChange={(ev) => set('source', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="entry-source">{SOURCES.map((s) => <option key={s} value={s}>{t(`cn.src.${s}`)}</option>)}</select></Field>
        <Field label={t('cn.what')} name="description" error={error}><input value={f.description} onChange={(ev) => set('description', ev.target.value)} maxLength={200} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="entry-what" /></Field>
        <Field label={t('item')} name="itemId" error={error}><select value={f.itemId} onChange={(ev) => set('itemId', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="entry-item"><option value="">{t('cn.notAnItem')}</option>{(iq.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></Field>
        <Field label={t('i.qty')} name="qty" error={error}><input type="number" min="0" step="any" value={f.qty} onChange={(ev) => set('qty', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="entry-qty" /></Field>
        {!f.itemId && <Field label={t('cn.uom')} name="uom" error={error}><input value={f.uom} onChange={(ev) => set('uom', ev.target.value)} maxLength={20} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="entry-uom" /></Field>}
        <Field label={t('cn.weight')} name="weightKg" error={error}><input type="number" min="0" step="any" value={f.weightKg} onChange={(ev) => set('weightKg', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="entry-weight" /></Field></div>
      {f.itemId && <label className="check"><input type="checkbox" checked={f.fromStock} onChange={(ev) => set('fromStock', ev.target.checked)} data-testid="entry-from-stock" /> {t('cn.fromStock')}</label>}
      <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || !f.storeId || !f.description || !f.qty} onClick={go} data-testid="entry-save">{t('cn.addEntry')}</button></div></div>
  );
}
function NewDisposal({ t, stores, onDone }) {
  const { error, run, busy } = useRunner(); const [f, setF] = useState({ storeId: '', method: 'SALE', buyerPartnerId: '', amount: '', reason: '', ids: [] }); const [dq, setDq] = useState(''); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const eq = useQuery({ queryKey: ['inv', 'entries-held'], queryFn: () => cn.entries({ pageSize: 100, 'filter[status]': 'HELD' }), retry: false }); const dl = useQuery({ queryKey: ['inv', 'dealers', dq], queryFn: () => cn.dealers(dq), retry: false, enabled: f.method !== 'WRITE_OFF' });
  const held = (Array.isArray(eq.data) ? eq.data : eq.data?.rows ?? []).filter((e) => String(e.storeId) === f.storeId); const toggle = (id) => set('ids', f.ids.includes(id) ? f.ids.filter((x) => x !== id) : [...f.ids, id]);
  const go = async () => { const d = await run(() => cn.disposalCreate({ storeId: Number(f.storeId), method: f.method, entryIds: f.ids, reason: f.reason || undefined, ...(f.method !== 'WRITE_OFF' ? { buyerPartnerId: Number(f.buyerPartnerId), amount: Number(f.amount) } : {}) })); if (d) onDone(d); };
  return (
    <div className="mdm-panel" data-testid="disposal-new"><h2>{t('cn.disposalNew')}</h2>{error?.form && <p className="field-error" role="alert" data-testid="disposal-new-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="form-grid">
        <Field label={t('tr.store')} name="storeId" error={error}><select value={f.storeId} onChange={(ev) => setF({ ...f, storeId: ev.target.value, ids: [] })} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="disp-store"><option value="">—</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
        <Field label={t('cn.method')} name="method" error={error}><select value={f.method} onChange={(ev) => set('method', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="disp-method">{['SALE', 'AUCTION', 'WRITE_OFF'].map((m) => <option key={m} value={m}>{t(`cn.m.${m}`)}</option>)}</select></Field>
        {f.method !== 'WRITE_OFF' && <><Field label={t('cn.dealer')} name="buyerPartnerId" error={error}><input value={dq} onChange={(ev) => setDq(ev.target.value)} placeholder={t('cn.searchDealer')} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="disp-dealer-search" /><select value={f.buyerPartnerId} onChange={(ev) => set('buyerPartnerId', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="disp-dealer"><option value="">—</option>{(dl.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
          <Field label={t('cn.amount')} name="amount" error={error}><input type="number" min="0" step="any" value={f.amount} onChange={(ev) => set('amount', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="disp-amount" /></Field></>}
        <Field label={t('cn.reason')} name="reason" error={error}><input value={f.reason} onChange={(ev) => set('reason', ev.target.value)} maxLength={500} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="disp-reason" /></Field></div>
      <fieldset><legend>{t('cn.pickScrap')}</legend>{held.length === 0 ? <p className="muted" data-testid="disp-no-scrap">{t('cn.noScrapHeld')}</p> : held.map((e) => <label key={e.id} className="check"><input type="checkbox" checked={f.ids.includes(e.id)} onChange={() => toggle(e.id)} data-testid={`disp-pick-${e.id}`} /> {e.docNo} · {e.description} · {fmtQty(e.qty)} {e.uom}</label>)}</fieldset>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || f.ids.length === 0} onClick={go} data-testid="disp-create">{t('cn.createDisposal')}</button></div></div>
  );
}
function Disposal({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'disposal', id], queryFn: () => cn.disposal(id), retry: false }); const hq = useQuery({ queryKey: ['inv', 'disposal-history', id, q.data?.status], queryFn: () => cn.disposalHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const [invoice, setInvoice] = useState(null);
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('cn.disposalTitle')} permission="inv.scrap_disposal.view" />;
  if (q.isPending) return <Skeleton label={t('cn.disposalTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const can = x.can; const why = (action, msg) => { const r = window.prompt(t('why')); if (r) run(() => cn.disposalAct(x.id, action, { reason: r }), msg); };
  const decide = (taskId, action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div data-testid="disposal-object" data-status={x.status}>
      <PageHeader id="dsp-h" title={<>{x.docNo} <StatusBadge status={COUNT_TONE[x.status]} label={t(`cn.ds.${x.status}`)} /></>} meta={<><Link to="/inv/scrap?tab=disposals">{t('cn.disposalTitle')}</Link> · {x.store} · {t(`cn.m.${x.method}`)}{x.buyer ? ` · ${x.buyer}` : ''}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="disposal-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="disposal-note">{note}</p>}
      <dl className="kv"><div><dt>{t('cn.weight')}</dt><dd>{fmtQty(x.weightKg)} kg</dd></div>{x.amount != null && <div><dt>{t('cn.amount')}</dt><dd data-testid="disposal-amount">{fmtRs(x.amount)}</dd></div>}{x.bookValue != null && <div><dt>{t('cn.bookValue')}</dt><dd data-testid="disposal-book">{fmtRs(x.bookValue)}</dd></div>}<div><dt>{t('cn.invoice')}</dt><dd>{x.invoiceNo ?? '—'}</dd></div>{x.gatePass && <div><dt>{t('r.gatePass')}</dt><dd data-testid="disposal-pass"><Link to={`/inv/gate-pass?id=${x.gatePass.id}`}>{x.gatePass.doc_no}</Link></dd></div>}<div><dt>{t('g.requestedBy')}</dt><dd>{x.requestedBy}</dd></div>{x.reason && <div><dt>{t('cn.reason')}</dt><dd>{x.reason}</dd></div>}</dl>
      <div className="table-scroll"><table className="data-table" data-testid="disposal-entries"><caption>{t('cn.pickScrap')}</caption><thead><tr><th>{t('cn.entry')}</th><th>{t('cn.what')}</th><th className="num">{t('i.qty')}</th><th className="num">{t('cn.weight')}</th><th>{t('tr.status')}</th></tr></thead><tbody>{x.entries.map((e) => <tr key={e.id}><td data-label={t('cn.entry')}>{e.docNo}</td><td data-label={t('cn.what')}>{e.description}</td><td className="num" data-label={t('i.qty')}>{fmtQty(e.qty)} {e.uom}</td><td className="num" data-label={t('cn.weight')}>{fmtQty(e.weightKg)}</td><td data-label={t('tr.status')}>{t(`cn.es.${e.status}`)}</td></tr>)}</tbody></table></div>
      {can.edit && x.method !== 'WRITE_OFF' && <div className="mdm-panel no-print"><Field label={t('cn.invoice')} name="invoiceNo" error={error}><input value={invoice ?? x.invoiceNo ?? ''} onChange={(ev) => setInvoice(ev.target.value)} maxLength={40} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="disp-invoice" /></Field><div className="actions-row"><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy || invoice == null} onClick={() => run(() => cn.disposalUpdate(x.id, { invoiceNo: invoice }), t('cn.invoiceSaved'))} data-testid="disp-invoice-save">{t('cn.saveInvoice')}</button></div></div>}
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => run(() => cn.disposalAct(x.id, 'submit'), t('submitted'))} data-testid="disposal-submit">{t('sendForApproval')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}{can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="disposal-cancel">{t('cancel')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/scrap-disposals/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('g.fileFailed') }))} data-testid="disposal-print">{t('g.print')}</button>}{x.workflowInstanceId && <Link to={`/workflow/instance?id=${x.workflowInstanceId}`}>{t('approval')}</Link>}</div>
      {x.taskId && <div className="mdm-panel no-print" data-testid="disposal-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(ev) => setComment(ev.target.value)} maxLength={500} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="disposal-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide(x.taskId, 'approve')} data-testid="disposal-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide(x.taskId, 'return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide(x.taskId, 'reject')}>{t('reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="disposal-history" />
    </div>
  );
}
function Expiry({ t }) {
  const [all, setAll] = useState(false); const q = useQuery({ queryKey: ['inv', 'expiry', all], queryFn: () => cn.expiry(all ? { all: '1' } : {}), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cn.expiryTitle')} permission="inv.scrap_disposal.view" />; if (q.isPending) return <Skeleton label={t('cn.expiryTitle')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <div data-testid="expiry"><p className="muted">{t('cn.expiryIntro', { days: d.alertDays })}</p><label className="check"><input type="checkbox" checked={all} onChange={(ev) => setAll(ev.target.checked)} data-testid="expiry-all" /> {t('cn.showAllShelf')}</label>
      <p data-testid="expiry-totals">{t('cn.expiryTotals', { e: d.totals.expired, s: d.totals.expiring })}</p>
      {d.rows.length === 0 ? <div className="mdm-panel" data-testid="expiry-empty"><h2>{t('cn.expiryEmptyTitle')}</h2><p>{t('cn.expiryEmptyBody')}</p></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="expiry-table"><caption>{t('cn.expiryTitle')}</caption><thead><tr><th>{t('item')}</th><th>{t('tr.store')}</th><th>{t('cn.batch')}</th><th className="num">{t('i.qty')}</th><th>{t('cn.mfg')}</th><th>{t('cn.expires')}</th><th className="num">{t('cn.daysLeft')}</th><th className="num">{t('r.value')}</th><th>{t('tr.status')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.balanceId} className={r.status === 'EXPIRED' ? 'is-warn' : ''} data-testid={`expiry-row-${r.balanceId}`}><td data-label={t('item')}>{r.item}</td><td data-label={t('tr.store')}>{r.store}</td><td data-label={t('cn.batch')}>{r.batchNo || '—'}</td><td className="num" data-label={t('i.qty')}>{fmtQty(r.qty)} {r.uom}</td><td data-label={t('cn.mfg')}>{fmtDate(r.mfgDate)}</td><td data-label={t('cn.expires')}>{fmtDate(r.expiryDate)}</td><td className="num" data-label={t('cn.daysLeft')}>{r.daysLeft}</td><td className="num" data-label={t('r.value')}>{r.value == null ? '—' : fmtRs(r.value)}</td><td data-label={t('tr.status')}>{t(`cn.x.${r.status}`)}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}
export default function ScrapPage() {
  const t = useT('inv'); usePageTitle(t('cn.scrapTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const tab = sp.get('tab') ?? 'register'; const session = useSession(); const perms = session.data?.permissions ?? [];
  const sq = useQuery({ queryKey: ['inv', 'stores-pick'], queryFn: iv.stores, retry: false }); const stores = sq.data ?? []; const [adding, setAdding] = useState(false);
  if (session.isSuccess && !perms.includes('inv.scrap_disposal.view')) return <NoPermission what={t('cn.scrapTitle')} permission="inv.scrap_disposal.view" />;
  if (id) return <section aria-labelledby="dsp-h" data-testid="scrap"><Disposal key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="sc-h" data-testid="scrap"><PageHeader id="sc-h" title={t('cn.scrapTitle')} subtitle={t('cn.scrapIntro')} />
      <nav className="actions-row no-print" aria-label={t('cn.scrapTitle')}>{['register', 'disposals', 'expiry'].map((k) => <Link key={k} to={`/inv/scrap?tab=${k}`} aria-current={tab === k ? 'page' : undefined} data-testid={`scrap-tab-${k}`}>{t(`cn.tab.${k}`)}</Link>)}</nav>
      {tab === 'register' && <>{perms.includes('inv.scrap_disposal.register') && <NewEntry t={t} stores={stores} />}<ListReport listCode="inv.scrap_entries" endpoint="/inv/scrap-entries" exportEndpoint="/ui/lists/inv.scrap_entries/export" title={t('cn.tab.register')} session={session.data} cardFields={['docNo', 'description', 'store', 'status']} statusKey="status" dateKey="date" empty={{ title: t('cn.regEmptyTitle'), text: t('cn.regEmptyBody') }} /></>}
      {tab === 'disposals' && <>{perms.includes('inv.scrap_disposal.create') && <div className="actions-row no-print"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => setAdding(!adding)} data-testid="disposal-add">{t('cn.disposalNew')}</button></div>}{adding && <NewDisposal t={t} stores={stores} onDone={(d) => navigateTo(`/inv/scrap?id=${d.id}`)} />}<ListReport listCode="inv.scrap_disposals" endpoint="/inv/scrap-disposals" exportEndpoint="/ui/lists/inv.scrap_disposals/export" title={t('cn.tab.disposals')} session={session.data} rowHref={(r) => `/inv/scrap?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/scrap?id=${r.id}`)} cardFields={['docNo', 'store', 'method', 'status']} statusKey="status" dateKey="date" empty={{ title: t('cn.dispEmptyTitle'), text: t('cn.dispEmptyBody') }} /></>}
      {tab === 'expiry' && <Expiry t={t} />}
    </section>
  );
}
