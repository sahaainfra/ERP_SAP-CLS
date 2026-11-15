import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { STORE_TONE, iv } from './api.js';
import { History, useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Stores and bins (part 16.01, FR-01, FR-02): the store master (type, project and site, keepers, valuation, negative stock) approved by a store manager, the bins of each store, and change requests for the settings that affect the books.
function Store({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'store', id], queryFn: () => iv.store(id), retry: false }); const hq = useQuery({ queryKey: ['inv', 'store-history', id, q.data?.status], queryFn: () => iv.storeHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const [bin, setBin] = useState({ code: '', zone: '', rack: '', shelf: '' }); const [chg, setChg] = useState({ valuationMethod: '', allowNegative: '', reason: '' });
  usePageTitle(t('storeTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('storeTitle')} permission="inv.store.view" />;
  if (q.isPending) return <Skeleton label={t('storeTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const s = q.data; const can = s.can;
  const why = (action, msg) => { const x = window.prompt(t('why')); if (x) run(() => iv.storeAct(s.id, action, { reason: x }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => iv.decide(s.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  const change = () => { const b = { reason: chg.reason }; if (chg.valuationMethod) b.valuationMethod = chg.valuationMethod; if (chg.allowNegative) b.allowNegative = chg.allowNegative === 'yes'; run(() => iv.storeAct(s.id, 'change', b), t('changeSent')); };
  return (
    <div data-testid="st-object" data-status={s.status}>
      <PageHeader id="st-h" title={<>{s.code} {s.name} <StatusBadge status={STORE_TONE[s.status]} label={t(`s.${s.status}`)} /></>} meta={<Link to="/inv/stores">{t('back')}</Link>} />
      <dl className="kv" data-testid="st-figures"><div><dt>{t('type')}</dt><dd>{t(`ty.${s.type}`)}</dd></div><div><dt>{t('project')}</dt><dd>{s.project}</dd></div><div><dt>{t('site')}</dt><dd>{s.site ?? '—'}</dd></div><div><dt>{t('keepers')}</dt><dd>{s.keepers.join(', ') || '—'}</dd></div><div><dt>{t('valuation')}</dt><dd>{t(`va.${s.valuation}`)}</dd></div><div><dt>{t('negative')}</dt><dd>{s.allowNegative ? t('allowed') : t('blocked')}</dd></div>{s.address && <div><dt>{t('address')}</dt><dd>{s.address}</dd></div>}</dl>
      {error?.form && <p className="field-error" role="alert" data-testid="st-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="st-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="st-bins"><caption>{t('bins')}</caption><thead><tr><th>{t('bin')}</th><th>{t('zone')}</th><th>{t('rack')}</th><th>{t('shelf')}</th><th className="num">{t('capacity')}</th><th /></tr></thead>
        <tbody>{s.bins.map((b) => <tr key={b.id} data-testid="st-bin"><td>{b.code}{b.isDefault && <span className="muted"> · {t('default')}</span>}</td><td>{b.zone ?? ''}</td><td>{b.rack ?? ''}</td><td>{b.shelf ?? ''}</td><td className="num">{b.capacity ?? ''}</td><td>{can.bins && !b.isDefault && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => iv.binRemove(b.id), t('binRemoved'))}>{t('remove')}</button>}</td></tr>)}</tbody></table></div>
      {can.bins && <div className="mdm-panel no-print" data-testid="st-bin-add"><h2>{t('addBin')}</h2><div className="form-grid">{[['code', 'bin'], ['zone', 'zone'], ['rack', 'rack'], ['shelf', 'shelf']].map(([k, l]) => <label key={k}>{t(l)}<input value={bin[k]} maxLength={20} onChange={(ev) => setBin({ ...bin, [k]: ev.target.value })} style={{ minHeight: 44 }} data-testid={`st-bin-${k}`} /></label>)}</div>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy || !bin.code} onClick={() => run(() => iv.binAdd(s.id, { code: bin.code, zone: bin.zone || null, rack: bin.rack || null, shelf: bin.shelf || null }), t('binAdded')).then(() => setBin({ code: '', zone: '', rack: '', shelf: '' }))} data-testid="st-bin-save">{t('save')}</button></div></div>}
      {s.changes.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="st-changes"><caption>{t('changes')}</caption><thead><tr><th>{t('request')}</th><th>{t('change')}</th><th>{t('reason')}</th><th>{t('status')}</th></tr></thead><tbody>{s.changes.map((c) => <tr key={c.id}><td>{c.docNo}</td><td>{Object.entries(c.changes).map(([k, v]) => `${k}: ${v}`).join('; ')}</td><td>{c.reason}</td><td>{c.status}</td></tr>)}</tbody></table></div>}
      {can.change && <div className="mdm-panel no-print" data-testid="st-change"><h2>{t('requestChange')}</h2><p className="muted">{t('changeHelp')}</p><div className="form-grid">
        <label>{t('valuation')}<select value={chg.valuationMethod} onChange={(ev) => setChg({ ...chg, valuationMethod: ev.target.value })} style={{ minHeight: 44 }} data-testid="st-chg-val"><option value="">{t('keep')}</option><option value="WAVG">{t('va.WAVG')}</option><option value="FIFO">{t('va.FIFO')}</option></select></label>
        <label>{t('negative')}<select value={chg.allowNegative} onChange={(ev) => setChg({ ...chg, allowNegative: ev.target.value })} style={{ minHeight: 44 }} data-testid="st-chg-neg"><option value="">{t('keep')}</option><option value="yes">{t('allowed')}</option><option value="no">{t('blocked')}</option></select></label>
        <label>{t('reason')}<input value={chg.reason} maxLength={1000} onChange={(ev) => setChg({ ...chg, reason: ev.target.value })} style={{ minHeight: 44 }} data-testid="st-chg-reason" /></label></div>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy || chg.reason.trim().length < 5 || (!chg.valuationMethod && !chg.allowNegative)} onClick={change} data-testid="st-chg-send">{t('sendRequest')}</button></div></div>}
      <div className="actions-row no-print">
        {can.edit && ['DRAFT', 'RETURNED'].includes(s.status) && <Link to={`/inv/stores?new=1&edit=${s.id}`}>{t('edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => iv.storeAct(s.id, 'submit'), t('submitted'))} data-testid="st-submit">{t('submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))}>{t('cancel')}</button>}
        {can.deactivate && <button type="button" className="btn" onClick={() => why('deactivate', t('closed'))} data-testid="st-deactivate">{t('closeStore')}</button>}
        {can.reactivate && <button type="button" className="btn" onClick={() => why('reactivate', t('reopened'))}>{t('reopen')}</button>}
        {s.workflowInstanceId && <Link to={`/workflow/instance?id=${s.workflowInstanceId}`}>{t('approval')}</Link>}
      </div>
      {s.taskId && <div className="mdm-panel no-print" data-testid="st-decide"><h2>{t('decide')}</h2><label>{t('comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="st-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="st-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="st-history" />
    </div>
  );
}

function StoreForm({ t, editId }) {
  const oq = useQuery({ queryKey: ['inv', 'store-options'], queryFn: iv.storeOptions, retry: false }); const eq = useQuery({ queryKey: ['inv', 'store', editId], queryFn: () => iv.store(editId), enabled: Boolean(editId), retry: false }); const e = eq.data;
  const [f, setF] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  usePageTitle(t('newStore'));
  if (oq.error?.status === 403) return <NoPermission what={t('newStore')} permission="inv.store.create" />;
  if (oq.isPending || (editId && eq.isPending)) return <Skeleton label={t('newStore')} rows={4} />;
  const o = oq.data; const form = f ?? { code: e?.code ?? '', name: e?.name ?? '', type: e?.type ?? 'SITE_STORE', projectId: e?.projectId ? String(e.projectId) : '', siteId: e?.siteId ? String(e.siteId) : '', address: e?.address ?? '', keepers: e?.keepers.join(', ') ?? '', valuation: e?.valuation ?? 'WAVG', allowNegative: e?.allowNegative ?? false }; const set = (k, v) => setF({ ...form, [k]: v });
  const sites = o.sites.filter((x) => !form.projectId || String(x.projectId) === form.projectId);
  const body = () => ({ name: form.name, type: form.type, projectId: form.projectId ? Number(form.projectId) : null, siteId: form.siteId ? Number(form.siteId) : null, address: form.address || null, keepers: form.keepers.split(',').map((x) => x.trim()).filter(Boolean), valuation: form.valuation, allowNegative: form.allowNegative });
  const save = async (send) => { setError(null); setBusy(true); try { let d = editId ? await iv.storeUpdate(editId, { ...body(), rowVersion: e.rowVersion }) : await iv.storeCreate({ code: form.code, ...body() }); if (send) d = await iv.storeAct(d.id, 'submit'); navigateTo(`/inv/stores?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="stn-h" data-testid="inv-st-form"><PageHeader id="stn-h" title={editId ? t('edit') : t('newStore')} subtitle={t('newStoreHelp')} meta={<Link to="/inv/stores">{t('back')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate><div className="form-grid">
        <Field label={t('code')} name="code" error={error}><input value={form.code} disabled={Boolean(editId)} maxLength={20} onChange={(ev) => set('code', ev.target.value)} style={{ minHeight: 44 }} data-testid="stn-code" /></Field>
        <Field label={t('name')} name="name" error={error}><input value={form.name} maxLength={120} onChange={(ev) => set('name', ev.target.value)} style={{ minHeight: 44 }} data-testid="stn-name" /></Field>
        <Field label={t('type')} name="type" error={error}><select value={form.type} onChange={(ev) => set('type', ev.target.value)} style={{ minHeight: 44 }} data-testid="stn-type">{Object.keys(o.types).map((k) => <option key={k} value={k}>{t(`ty.${k}`)}</option>)}</select></Field>
        <Field label={t('project')} name="projectId" error={error}><select value={form.projectId} onChange={(ev) => setF({ ...form, projectId: ev.target.value, siteId: '' })} style={{ minHeight: 44 }} data-testid="stn-project"><option value="">{t('commonPool')}</option>{o.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        <Field label={t('site')} name="siteId" error={error}><select value={form.siteId} onChange={(ev) => set('siteId', ev.target.value)} style={{ minHeight: 44 }} data-testid="stn-site"><option value="">—</option>{sites.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></Field>
        <Field label={t('keepers')} name="keepers" error={error}><input value={form.keepers} placeholder={t('keepersHelp')} onChange={(ev) => set('keepers', ev.target.value)} style={{ minHeight: 44 }} data-testid="stn-keepers" /></Field>
        <Field label={t('valuation')} name="valuation" error={error}><select value={form.valuation} onChange={(ev) => set('valuation', ev.target.value)} style={{ minHeight: 44 }} data-testid="stn-valuation"><option value="WAVG">{t('va.WAVG')}</option><option value="FIFO">{t('va.FIFO')}</option></select></Field>
        <Field label={t('address')} name="address" error={error}><input value={form.address} maxLength={300} onChange={(ev) => set('address', ev.target.value)} style={{ minHeight: 44 }} /></Field></div>
        <label><input type="checkbox" checked={form.allowNegative} onChange={(ev) => set('allowNegative', ev.target.checked)} /> {t('allowNegativeHelp')}</label>
        {error?.form && <p className="field-error" role="alert" data-testid="stn-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy} data-testid="stn-save">{t('saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => save(true)} data-testid="stn-send">{t('sendForApproval')}</button></div></form></section>
  );
}

export default function StoresPage() {
  const t = useT('inv'); usePageTitle(t('storesTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <StoreForm key={sp.get('edit') ?? 'new'} t={t} editId={Number(sp.get('edit')) || null} />;
  if (id) return <section aria-labelledby="st-h" data-testid="inv-st"><Store key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="sts-h" data-testid="inv-st"><PageHeader id="sts-h" title={t('storesTitle')} subtitle={t('storesIntro')} />
      <div className="actions-row no-print">{perms.includes('inv.store.create') && <Link to="/inv/stores?new=1">{t('newStore')}</Link>} <Link to="/inv/dashboard">{t('dashTitle')}</Link></div>
      <ListReport listCode="inv.stores" endpoint="/inv/stores" title={t('storesTitle')} session={session.data} rowHref={(r) => `/inv/stores?id=${r.id}`} onOpen={(r) => navigateTo(`/inv/stores?id=${r.id}`)} cardFields={['code', 'name', 'typeLabel', 'project']} statusKey="status" empty={{ title: t('storesEmptyTitle'), text: t('storesEmptyBody') }} /></section>
  );
}
