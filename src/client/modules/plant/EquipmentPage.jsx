import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { filePhoto } from '../inv/GateParts.jsx';
import { CERT_TONE, EQUIP_TONE, STATE_TONE, fmtDate, fmtQty, fmtRs, pl } from './api.js';
import { useRunner } from './PlantParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Equipment register and Equipment 360 (part 17.01, FR-01 to FR-04): the list, and the machine with its particulars, documents and certificates, history, status and tag. Deployment, logs, fuel, maintenance and costs come from the parts that record them.
const TABS = ['details', 'documents', 'history', 'deployment', 'logs', 'fuel', 'maintenance', 'costs']; const LATER = { deployment: '17.02', logs: '17.03', fuel: '17.04', maintenance: '17.05', costs: '17.07' };
const DOC_TYPES = ['RC', 'INSURANCE', 'FITNESS', 'PUC', 'ROAD_PERMIT', 'LOAD_TEST', 'THIRD_PARTY_INSPECTION', 'OTHER'];

function Documents({ t, x, run, busy, error }) {
  const [f, setF] = useState({ docType: 'INSURANCE', number: '', issuer: '', validFrom: '', validUntil: '', mandatory: true }); const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const add = async () => { const r = await run(() => pl.docAdd(x.id, { docType: f.docType, number: f.number || null, issuer: f.issuer || null, validFrom: f.validFrom || null, validUntil: f.validUntil || null, mandatory: f.mandatory }), t('docAdded')); if (r) setF({ ...f, number: '', issuer: '', validFrom: '', validUntil: '' }); };
  const scan = (d, file) => run(async () => { const up = await filePhoto(file, 'plt_documents', d.id); return pl.docAttach(d.id, up.id); }, t('scanAttached'));
  const remove = (d) => { const r = globalThis.prompt(t('why')); if (r && r.length >= 5) run(() => pl.docRemove(d.id, r), t('docRemoved')); };
  return (
    <div data-testid="eq-documents">
      {x.certificates.some((c) => c.state === 'MISSING') && <p className="mdm-banner" role="alert" data-testid="eq-missing">{t('missingCerts', { list: x.certificates.filter((c) => c.state === 'MISSING').map((c) => t(`dt.${c.docType}`)).join(', ') })}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="eq-docs-table"><caption>{t('docsTitle')}</caption><thead><tr><th>{t('docType')}</th><th>{t('number')}</th><th>{t('validUntil')}</th><th>{t('state')}</th><th>{t('scan')}</th><th /></tr></thead>
        <tbody>{x.certificates.map((c) => { const d = x.documents.find((y) => y.id === c.docId); return (
          <tr key={`${c.docType}-${c.docId ?? 'x'}`} data-testid="eq-doc-row" data-state={c.state}><td>{t(`dt.${c.docType}`)}{c.required ? <span className="muted small"> · {t('required')}</span> : null}</td><td>{c.number ?? '—'}</td><td>{c.validUntil ? fmtDate(c.validUntil) : '—'}{c.daysLeft != null ? <span className="muted small"> ({c.daysLeft} {t('days')})</span> : null}</td><td><StatusBadge status={CERT_TONE[c.state]} label={t(`cs.${c.state}`)} /></td>
            <td>{d?.fileId ? <a href={`/api/v1/core/files/${d.fileId}/download`} target="_blank" rel="noreferrer">{d.fileName ?? t('open')}</a> : d && x.can.manageDocuments ? <label className="btn">{t('upload')}<input type="file" accept="image/*,application/pdf" className="sr-only" data-testid="eq-doc-file" onChange={(ev) => { const file = ev.target.files?.[0]; if (file) scan(d, file); ev.target.value = ''; }} /></label> : '—'}</td>
            <td>{d && x.can.manageDocuments && <button type="button" className="btn" onClick={() => remove(d)}>{t('remove')}</button>}</td></tr>); })}</tbody></table></div>
      {x.superseded.length > 0 && <p className="muted small" data-testid="eq-superseded">{t('superseded', { n: x.superseded.length })}</p>}
      {x.can.manageDocuments && <div className="mdm-panel" data-testid="eq-doc-form"><h3>{t('addDoc')}</h3>{error?.form && <p className="field-error" role="alert">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        <div className="form-grid"><Field label={t('docType')} name="docType" error={error}><select value={f.docType} onChange={(ev) => set('docType', ev.target.value)} style={{ minHeight: 44 }} data-testid="eq-doc-type">{DOC_TYPES.map((d) => <option key={d} value={d}>{t(`dt.${d}`)}</option>)}</select></Field>
          <Field label={t('number')} name="number" error={error}><input value={f.number} onChange={(ev) => set('number', ev.target.value)} maxLength={60} style={{ minHeight: 44 }} data-testid="eq-doc-number" /></Field>
          <Field label={t('issuer')} name="issuer" error={error}><input value={f.issuer} onChange={(ev) => set('issuer', ev.target.value)} maxLength={120} style={{ minHeight: 44 }} /></Field>
          <Field label={t('validFrom')} name="validFrom" error={error}><input type="date" value={f.validFrom} onChange={(ev) => set('validFrom', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <Field label={t('validUntil')} name="validUntil" error={error}><input type="date" value={f.validUntil} onChange={(ev) => set('validUntil', ev.target.value)} style={{ minHeight: 44 }} data-testid="eq-doc-until" /></Field></div>
        <label className="check"><input type="checkbox" checked={f.mandatory} onChange={(ev) => set('mandatory', ev.target.checked)} /> {t('mandatory')}</label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={add} data-testid="eq-doc-add">{t('addDocBtn')}</button></div></div>}
    </div>
  );
}

function Equipment({ id }) {
  const t = useT('plant'); const q = useQuery({ queryKey: ['plant', 'eq', id], queryFn: () => pl.equipment(id), retry: false }); const hq = useQuery({ queryKey: ['plant', 'eq-history', id, q.data?.status, q.data?.timeline?.length], queryFn: () => pl.history(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [tab, setTab] = useState('details'); const [comment, setComment] = useState(''); const [sv, setSv] = useState({ state: '', projectId: '', siteId: '', note: '' }); const [qr, setQr] = useState(null); const oq = useQuery({ queryKey: ['plant', 'options'], queryFn: pl.options, retry: false });
  usePageTitle(t('registerTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('registerTitle')} permission="plant.equipment.view" />;
  if (q.isPending) return <Skeleton label={t('registerTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const can = x.can; const o = oq.data;
  const why = (action, msg) => { const r = globalThis.prompt(t('why')); if (r) run(() => pl.act(x.id, action, { reason: r }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => pl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  const photo = (file) => run(() => filePhoto(file, 'plt_equipment', x.id), t('photoAdded'));
  const kv = (k, v) => <div><dt>{t(k)}</dt><dd>{v ?? '—'}</dd></div>;
  const sites = (o?.sites ?? []).filter((s) => String(s.projectId) === String(sv.projectId));
  return (
    <div data-testid="eq-object" data-status={x.status} data-state={x.state}>
      <PageHeader id="eq-h" title={<>{x.assetCode} <StatusBadge status={EQUIP_TONE[x.status]} label={t(`es.${x.status}`)} /> <StatusBadge status={STATE_TONE[x.state]} label={t(`st.${x.state}`)} /></>} meta={<><Link to="/plant/equipment">{t('registerTitle')}</Link> · {x.class} · {x.make} {x.model}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="eq-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="eq-note">{note}</p>}
      {x.compliance.blocking.length > 0 && x.approvedAt && <p className="mdm-banner" role="alert" data-testid="eq-blocked">{x.compliance.blocks ? t('blockedNote') : t('warnNote')} {x.compliance.blocking.join('; ')}</p>}
      <div className="actions-row no-print">
        {can.edit && <Link to={`/plant/equipment/new?id=${x.id}`}>{t('edit')}</Link>}{can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pl.act(x.id, 'submit'), t('submitted'))} data-testid="eq-submit">{t('sendForApproval')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}{can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="eq-cancel">{t('cancel')}</button>}{can.amend && <button type="button" className="btn" onClick={() => why('amend', t('amended'))} data-testid="eq-amend">{t('amend')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => pl.exportFile({}, `${x.assetCode}.pdf`, `/equipment/${x.id}/print`).catch(() => setError({ form: t('exportFailed') }))} data-testid="eq-print">{t('print')}</button>}{can.print && <button type="button" className="btn" disabled={busy} onClick={async () => setQr(await pl.tag(x.id))} data-testid="eq-tag">{t('showTag')}</button>}</div>
      {qr && <div className="mdm-panel" data-testid="eq-qr" style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ width: 120 }} dangerouslySetInnerHTML={{ __html: qr.svg }} /><span><strong>{qr.assetCode}</strong><br />{qr.title}<br /><code>{qr.code}</code><br /><button type="button" className="btn no-print" onClick={() => window.print()}>{t('print')}</button></span></div>}
      {x.approve && x.taskId && <div className="mdm-panel no-print" data-testid="eq-decide"><h2>{t('decision')}</h2><label>{t('comment')}<textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={2} style={{ width: '100%' }} data-testid="eq-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="eq-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      <div role="tablist" className="tabs no-print" aria-label={t('registerTitle')}>{TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 44 }} onClick={() => setTab(k)} data-testid={`eq-tab-${k}`}>{t(`tab.${k}`)}</button>)}</div>
      {tab === 'details' && <div data-testid="eq-details"><dl className="kv">{kv('class', x.class)}{kv('makeModel', [x.make, x.model, x.year].filter(Boolean).join(' '))}{kv('regNo', x.regNo)}{kv('serialNo', x.serialNo)}{kv('chassisNo', x.chassisNo)}{kv('engineNo', x.engineNo)}{kv('capacity', x.capacity)}{kv('ownership', `${t(`ow.${x.ownership}`)}${x.owner ? `: ${x.owner}` : ''}`)}
        {x.purchaseValue != null && kv('purchaseValue', fmtRs(x.purchaseValue))}{kv('meter', t(`mt.${x.meterType}`))}{kv('fuelType', t(`ft.${x.fuelType}`))}{kv('tank', `${fmtQty(x.tankCapacity)} l`)}{kv('fuelNorm', `${fmtQty(x.fuelNorm)} ${x.fuelNormUnit === 'L_PER_HOUR' ? t('lph') : t('kmpl')}`)}{kv('gps', x.gpsDeviceId)}
        {kv('operator', x.operatorRequired ? `${t('yes')}${x.operatorLicenceClass ? ` (${x.operatorLicenceClass})` : ''}` : t('no'))}{kv('currentProject', x.project ? `${x.project}${x.site ? `/${x.site}` : ''}` : t('yard'))}{kv('since', x.stateSince ? fmtDate(x.stateSince) : null)}{x.stateNote ? kv('stateNote', x.stateNote) : null}</dl>
        {can.setState && x.allowedStates.length > 0 && <div className="mdm-panel no-print" data-testid="eq-status"><h2>{t('changeStatus')}</h2><div className="form-grid">
          <Field label={t('newStatus')} name="state" error={error}><select value={sv.state} onChange={(ev) => setSv({ ...sv, state: ev.target.value })} style={{ minHeight: 44 }} data-testid="eq-state">{[<option key="" value="">—</option>, ...x.allowedStates.map((s) => <option key={s} value={s}>{t(`st.${s}`)}</option>)]}</select></Field>
          {sv.state === 'DEPLOYED' && <><Field label={t('project')} name="projectId" error={error}><select value={sv.projectId} onChange={(ev) => setSv({ ...sv, projectId: ev.target.value, siteId: '' })} style={{ minHeight: 44 }} data-testid="eq-state-project"><option value="">—</option>{(o?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
            <Field label={t('site')} name="siteId" error={error}><select value={sv.siteId} onChange={(ev) => setSv({ ...sv, siteId: ev.target.value })} style={{ minHeight: 44 }}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></Field></>}
          <Field label={t('note')} name="note" error={error}><input value={sv.note} onChange={(ev) => setSv({ ...sv, note: ev.target.value })} maxLength={500} style={{ minHeight: 44 }} data-testid="eq-state-note" /></Field></div>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !sv.state} onClick={() => run(() => pl.act(x.id, 'status', { state: sv.state, projectId: sv.projectId ? Number(sv.projectId) : null, siteId: sv.siteId ? Number(sv.siteId) : null, note: sv.note || null, rowVersion: x.version }), t('statusChanged'))} data-testid="eq-state-go">{t('apply')}</button></div></div>}
        <div className="mdm-panel" data-testid="eq-photos"><h2>{t('photos')}</h2>{x.photos.length === 0 ? <p className="muted">{t('noPhotos')}</p> : <ul>{x.photos.map((p) => <li key={p.id}><a href={`/api/v1/core/files/${p.id}/download`} target="_blank" rel="noreferrer">{p.name}</a></li>)}</ul>}
          {can.manageDocuments && <label className="btn no-print" style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center' }}>{t('addPhoto')}<input type="file" accept="image/*" capture="environment" className="sr-only" data-testid="eq-photo" onChange={(ev) => { const f = ev.target.files?.[0]; if (f) photo(f); ev.target.value = ''; }} /></label>}</div></div>}
      {tab === 'documents' && <Documents t={t} x={x} run={run} busy={busy} error={error} />}
      {tab === 'history' && <div data-testid="eq-history"><div className="table-scroll"><table className="data-table" data-testid="eq-timeline"><caption>{t('timeline')}</caption><thead><tr><th>{t('when')}</th><th>{t('event')}</th><th>{t('where')}</th><th>{t('note')}</th><th>{t('who')}</th></tr></thead>
        <tbody>{x.timeline.map((e) => <tr key={e.id}><td>{String(e.at).slice(0, 16).replace('T', ' ')}</td><td>{t(`ev.${e.event}`, {}) }{e.fromState || e.toState ? ` ${e.fromState ? t(`st.${e.fromState}`) : ''} → ${e.toState ? t(`st.${e.toState}`) : ''}` : ''}</td><td>{e.project}{e.site ? `/${e.site}` : ''}</td><td>{e.note ?? ''}</td><td>{e.doneBy}</td></tr>)}</tbody></table></div>
        {hq.data && hq.data.approvals.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="eq-approvals"><caption>{t('approvals')}</caption><thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('event')}</th><th>{t('comment')}</th></tr></thead><tbody>{hq.data.approvals.map((a, i) => <tr key={i}><td>{String(a.at).slice(0, 16).replace('T', ' ')}</td><td>{a.actor}</td><td>{a.event}{a.step_code ? ` (${a.step_code})` : ''}</td><td>{a.comment ?? ''}</td></tr>)}</tbody></table></div>}</div>}
      {LATER[tab] && <div className="mdm-panel" data-testid={`eq-later-${tab}`}><p className="muted">{t('laterPart', { part: LATER[tab] })}</p></div>}
    </div>
  );
}

export default function EquipmentPage() {
  const t = useT('plant'); usePageTitle(t('registerTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="eq-h"><Equipment id={id} /></section>;
  return (
    <section aria-labelledby="eql-h" data-testid="plant-eq-list"><PageHeader id="eql-h" title={t('registerTitle')} subtitle={t('registerIntro')} />
      <div className="actions-row no-print"><Link to="/plant/equipment/new">{t('newTitle')}</Link><Link to="/plant/dashboard">{t('dashTitle')}</Link></div>
      <ListReport listCode="plant.equipment" endpoint="/plant/equipment" exportEndpoint="/ui/lists/plant.equipment/export" title={t('registerTitle')} session={session.data} rowHref={(r) => `/plant/equipment?id=${r.id}`} onOpen={(r) => navigateTo(`/plant/equipment?id=${r.id}`)} cardFields={['assetCode', 'class', 'regNo', 'state']} statusKey="status" dateKey="created" empty={{ title: t('emptyTitle'), text: t('emptyBody') }} />
    </section>
  );
}
