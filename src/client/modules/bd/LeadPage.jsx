import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { BANT, REGIONS, SECTORS, SOURCES, bd, inr } from './api.js';
import { InteractionsPanel, Tabs, TimelinePanel } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Lead (business development, part 08.01, FR-01): where it came from, who the client is (from the partner master, or a prospect not registered yet), the contact, the sector, place and estimated value, and the BANT-like qualification: budget, authority, need
// and timeline each rated Yes, Partly or No. A colleague reviews the qualification (never the maker); a qualified lead is locked, amended with a reason when it changes, and converted to an opportunity. The page keeps its interactions, files and history.
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', CONVERTED: 'COMPLETED' };
const blank = () => ({ title: '', source: 'CLIENT_ENQUIRY', sourceRef: '', clientPartnerId: '', clientName: '', contactName: '', phone: '', email: '', sector: 'BUILDING', location: '', region: '', estValue: '', owner: '', qualification: Object.fromEntries(BANT.map((k) => [k, { rating: '', note: '' }])) });
const fromLead = (l) => ({ title: l.title, source: l.source, sourceRef: l.sourceRef ?? '', clientPartnerId: l.clientPartnerId ?? '', clientName: l.clientPartnerId ? '' : l.clientName ?? '', contactName: l.contactName ?? '', phone: l.phone ?? '', email: l.email ?? '', sector: l.sector, location: l.location ?? '', region: l.region ?? '', estValue: String(l.estValue ?? ''), owner: l.owner, qualification: Object.fromEntries(BANT.map((k) => [k, { rating: l.qualification?.[k]?.rating ?? '', note: l.qualification?.[k]?.note ?? '' }])) });
const body = (v) => ({ title: v.title.trim(), source: v.source, sourceRef: v.sourceRef.trim() || null, clientPartnerId: v.clientPartnerId ? Number(v.clientPartnerId) : null, clientName: v.clientPartnerId ? null : v.clientName.trim() || null, contactName: v.contactName.trim() || null, phone: v.phone.trim() || null, email: v.email.trim() || null, sector: v.sector, location: v.location.trim() || null, region: v.region || null, estValue: Number(v.estValue || 0), ...(v.owner ? { owner: v.owner } : {}), qualification: Object.fromEntries(BANT.map((k) => [k, { rating: v.qualification[k].rating || null, note: v.qualification[k].note.trim() || null }])) });

export default function LeadPage({ create = false }) {
  const t = useT('bd');
  const qc = useQueryClient();
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  const q = useQuery({ queryKey: ['bd', 'lead', id], queryFn: () => bd.lead(id), enabled: Boolean(id) && !create, retry: false });
  const l = q.data;
  usePageTitle(create ? t('lead.new') : l ? l.docNo : t('lead.title'));
  const [v, setV] = useState(blank); const [mode, setMode] = useState(create ? 'form' : 'view'); const [reason, setReason] = useState('');
  const [tab, setTab] = useState('details'); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  useEffect(() => { if (l && mode === 'view') setV(fromLead(l)); }, [l, mode]);
  if (!create && !id) return <ErrorState error={new Error(t('lead.noId'))} />;
  if (!create && q.error?.status === 403) return <NoPermission what={t('lead.title')} permission="bd.lead.view" />;
  if (!create && q.isPending) return <Skeleton label={t('lead.title')} rows={5} />;
  if (!create && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const set = (k, x) => setV({ ...v, [k]: x });
  const rate = (k, patch) => setV({ ...v, qualification: { ...v.qualification, [k]: { ...v.qualification[k], ...patch } } });
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bd'] }); return r; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const save = async (submit) => {
    if (create) { const r = await run(() => bd.createLead({ ...body(v), submit })); if (r) navigateTo(`/bd/lead?id=${r.id}`, { force: true }); return; }
    if (mode === 'amend') { const r = await run(() => bd.leadAct(id, 'amend', { ...body(v), reason, version: l.rowVersion }), t('lead.amended')); if (r) setMode('view'); return; }
    const r = await run(() => bd.updateLead(id, { ...body(v), version: l.rowVersion }), t('act.saved')); if (r) { setMode('view'); if (submit) await run(() => bd.leadAct(id, 'submit', {}), t('lead.sent')); }
  };
  const editing = mode !== 'view';
  const ro = !editing;
  const form = (
    <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }} data-testid="lead-form" aria-label={t('lead.title')}>
      <Field label={t('lead.titleField')} name="title" error={error}><input value={v.title} maxLength={160} readOnly={ro} onChange={(e) => set('title', e.target.value)} required data-testid="ld-title" /></Field>
      <Field label={t('lead.source')} name="source" error={error}><select value={v.source} disabled={ro} onChange={(e) => set('source', e.target.value)} data-testid="ld-source">{SOURCES.map((k) => <option key={k} value={k}>{t(`source.${k}`)}</option>)}</select></Field>
      <Field label={t('lead.sourceRef')} name="sourceRef" error={error}><input value={v.sourceRef} readOnly={ro} onChange={(e) => set('sourceRef', e.target.value)} data-testid="ld-source-ref" /></Field>
      <LookupField id="ld-client" label={t('lead.client')} lookup="bd/clients" value={v.clientPartnerId} onChange={(x) => set('clientPartnerId', x)} disabled={ro} error={error?.fields?.clientPartnerId} hint={t('lead.clientHint')} />
      {!v.clientPartnerId && <Field label={t('lead.clientName')} name="clientName" error={error}><input value={v.clientName} readOnly={ro} onChange={(e) => set('clientName', e.target.value)} data-testid="ld-client-name" /></Field>}
      <Field label={t('lead.contact')} name="contactName" error={error}><input value={v.contactName} readOnly={ro} onChange={(e) => set('contactName', e.target.value)} data-testid="ld-contact" /></Field>
      <Field label={t('lead.phone')} name="phone" error={error}><input value={v.phone} inputMode="tel" readOnly={ro} onChange={(e) => set('phone', e.target.value)} data-testid="ld-phone" /></Field>
      <Field label={t('lead.email')} name="email" error={error}><input value={v.email} type="email" readOnly={ro} onChange={(e) => set('email', e.target.value)} data-testid="ld-email" /></Field>
      <Field label={t('lead.sector')} name="sector" error={error}><select value={v.sector} disabled={ro} onChange={(e) => set('sector', e.target.value)} data-testid="ld-sector">{SECTORS.map((k) => <option key={k} value={k}>{t(`sector.${k}`)}</option>)}</select></Field>
      <Field label={t('lead.location')} name="location" error={error}><input value={v.location} readOnly={ro} onChange={(e) => set('location', e.target.value)} data-testid="ld-location" /></Field>
      <Field label={t('lead.region')} name="region" error={error}><select value={v.region} disabled={ro} onChange={(e) => set('region', e.target.value)} data-testid="ld-region"><option value="">–</option>{REGIONS.map((k) => <option key={k} value={k}>{t(`region.${k}`)}</option>)}</select></Field>
      <Field label={t('lead.estValue')} name="estValue" error={error}><input type="number" min="0" step="0.01" inputMode="decimal" value={v.estValue} readOnly={ro} onChange={(e) => set('estValue', e.target.value)} data-testid="ld-value" /></Field>
      <LookupField id="ld-owner" label={t('lead.owner')} lookup="bd/owners" valueKey="code" value={v.owner} onChange={(x) => set('owner', x)} disabled={ro} />
      <fieldset className="mdm-fields" data-testid="ld-bant"><legend>{t('lead.qualification')}{l ? ` — ${t('lead.score', { n: l.qualScore })}` : ''}</legend>
        {BANT.map((k) => (
          <div key={k} className="mdm-fields">
            <Field label={t(`bant.${k}`)} name={`qualification.${k}`} error={error}><select value={v.qualification[k].rating} disabled={ro} onChange={(e) => rate(k, { rating: e.target.value })} data-testid={`ld-${k}`}><option value="">–</option>{['YES', 'PARTIAL', 'NO'].map((r) => <option key={r} value={r}>{t(`rating.${r}`)}</option>)}</select></Field>
            <Field label={t('lead.ratingNote', { what: t(`bant.${k}`) })} name={`${k}Note`} error={error}><input value={v.qualification[k].note} readOnly={ro} maxLength={300} onChange={(e) => rate(k, { note: e.target.value })} data-testid={`ld-${k}-note`} /></Field>
          </div>))}
      </fieldset>
      {mode === 'amend' && <Field label={t('act.amendReason')} name="reason" error={error}><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} required data-testid="ld-amend-reason" /></Field>}
      {editing && <div className="actions"><button type="button" className="btn" onClick={() => (create ? navigateTo('/bd/leads') : (setMode('view'), setV(fromLead(l))))}>{t('act.close')}</button><button type="submit" className="btn" data-testid="ld-save">{mode === 'amend' ? t('act.saveAmend') : t('act.saveDraft')}</button>{mode !== 'amend' && <button type="button" className="btn btn-primary" onClick={() => save(true)} data-testid="ld-save-send">{t('lead.saveSend')}</button>}</div>}
    </form>
  );
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="ld-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>;
  if (create) return (<section aria-labelledby="ld-title-h" data-testid="lead-new"><PageHeader id="ld-title-h" title={t('lead.new')} />{errBox}{form}<p className="small"><Link to="/bd/leads">{t('lead.list')}</Link></p></section>);
  return (
    <section aria-labelledby="ld-title-h" data-testid="lead" data-status={l.status}>
      <header>
        <PageHeader id="ld-title-h" title={<>{l.title} <StatusBadge status={TONE[l.status]} label={l.statusLabel} /></>} />
        <dl className="op-figures" data-testid="ld-figures"><div><dt>{t('lead.docNo')}</dt><dd>{l.docNo}</dd></div><div><dt>{t('lead.estValue')}</dt><dd data-testid="ld-fig-value">{inr(l.estValue)}</dd></div><div><dt>{t('lead.scoreLabel')}</dt><dd data-testid="ld-fig-score">{l.qualScore}/100</dd></div><div><dt>{t('lead.owner')}</dt><dd>{l.owner}</dd></div>{l.amendmentNo > 0 && <div><dt>{t('lead.amendment')}</dt><dd>{l.amendmentNo}</dd></div>}</dl>
        {errBox}{note && <p className="mdm-banner" role="status" data-testid="ld-note">{note}</p>}
        <div className="actions-row no-print" data-testid="ld-actions">
          {l.can.edit && !editing && <button type="button" className="btn" onClick={() => setMode('form')} data-testid="ld-edit">{t('act.edit')}</button>}
          {l.can.submit && !editing && <button type="button" className="btn btn-primary" onClick={() => run(() => bd.leadAct(id, 'submit', {}), t('lead.sent'))} data-testid="ld-submit">{t('lead.send')}</button>}
          {l.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => bd.leadAct(id, 'withdraw', { reason: r }), t('act.withdrawn'))} data-testid="ld-withdraw">{t('act.withdraw')}</button>}
          {l.can.amend && !editing && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="ld-amend">{t('act.amend')}</button>}
          {l.can.convert && <button type="button" className="btn btn-primary" onClick={async () => { const r = await run(() => bd.leadAct(id, 'convert', {})); if (r) navigateTo(`/bd/opportunity?id=${r.opportunity.id}`, { force: true }); }} data-testid="ld-convert">{t('lead.convert')}</button>}
          {l.can.cancel && <button type="button" className="btn" onClick={() => why((r) => bd.leadAct(id, 'cancel', { reason: r }), t('act.cancelled'))} data-testid="ld-cancel">{t('act.cancel')}</button>}
          {l.can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('act.confirmDelete'))) { const r = await run(() => bd.deleteLead(id)); if (r) navigateTo('/bd/leads', { force: true }); } }} data-testid="ld-delete">{t('act.delete')}</button>}
          {l.can.print && <a className="btn" href={`/api/v1/bd/leads/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
        </div>
      </header>
      <Tabs tabs={['details', 'interactions', 'documents', 'approvals', 'related']} active={tab} onChange={setTab} label={t('lead.title')} />
      {tab === 'details' && form}
      {tab === 'interactions' && <InteractionsPanel entity="LEAD" entityId={id} canLog={l.can.interact} />}
      {tab === 'documents' && <div data-testid="documents"><AttachmentList entity="bd_lead" entityId={id} canEdit={l.can.interact} />{l.can.interact && <FileUploader entity="bd_lead" entityId={id} />}</div>}
      {tab === 'approvals' && (<><TimelinePanel kind={`lead-${id}`} load={() => bd.leadHistory(id)} />{l.amendments.length > 0 && <div data-testid="amendments"><h2>{t('lead.amendments')}</h2>{l.amendments.map((a) => <p key={a.no}>#{a.no} · {a.by} · {a.reason} — {t('lead.before', { value: inr(a.before.estValue) })}</p>)}</div>}</>)}
      {tab === 'related' && (l.related.length === 0 ? <p className="muted">{t('related.none')}</p> : <ul className="mdm-list" data-testid="related">{l.related.map((r) => <li key={r.type + r.id}>{r.type}: <Link to={r.route}>{r.ref}</Link></li>)}</ul>)}
      <p className="small"><Link to="/bd/leads">{t('lead.list')}</Link></p>
    </section>
  );
}
