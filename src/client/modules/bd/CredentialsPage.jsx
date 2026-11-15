import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { CRED_TYPES, SECTORS, aw, inr } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Credentials Library (business development, part 08.03, FR-01): the work orders, completion certificates, audited financials, machinery and CVs of key people the company qualifies with, kept once with their files and linked to every tender that uses them.
// A credential past its validity is not linked until it is renewed.
const blank = { type: 'COMPLETION_CERTIFICATE', title: '', clientName: '', sector: '', value: '', completionDate: '', validUntil: '', tags: '' };
export default function CredentialsPage() {
  const t = useT('bd');
  usePageTitle(t('cr.title'));
  const qc = useQueryClient();
  const session = useSession();
  const can = (session.data?.permissions ?? []).includes('bd.credential.manage');
  const [adding, setAdding] = useState(false); const [v, setV] = useState(blank); const [open, setOpen] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const q = useQuery({ queryKey: ['bd', 'credential', open], queryFn: () => aw.credential(open), enabled: Boolean(open), retry: false });
  const save = async (e) => {
    e.preventDefault(); setError(null); setNote(null);
    try { const r = await aw.createCredential({ type: v.type, title: v.title.trim(), clientName: v.clientName.trim() || null, sector: v.sector || null, value: v.value === '' ? null : Number(v.value), completionDate: v.completionDate || null, validUntil: v.validUntil || null, tags: v.tags.split(',').map((x) => x.trim()).filter(Boolean) }); setNote(t('cr.added', { no: r.docNo })); setV(blank); setAdding(false); setOpen(r.id); qc.invalidateQueries({ queryKey: ['ui', 'list'] }); } catch (x) { setError(errorInfo(x)); }
  };
  return (
    <section aria-labelledby="cr-title" data-testid="credentials">
      <PageHeader id="cr-title" srOnly title={t('cr.title')} />
      {error?.form && <p className="field-error" role="alert" data-testid="cr-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="cr-note">{note}</p>}
      <ListReport listCode="bd.credentials" endpoint="/bd/credentials" title={t('cr.title')} session={session.data} onOpen={(r) => setOpen(r.id)} cardFields={['title', 'type', 'client', 'validUntil']}
        newAction={can ? { label: t('cr.new'), onClick: () => setAdding(true) } : undefined} empty={{ title: t('cr.emptyTitle'), text: t('cr.emptyText') }} />
      {adding && (
        <form className="mdm-panel mdm-fields" onSubmit={save} data-testid="cr-form" aria-label={t('cr.new')}>
          <h2>{t('cr.new')}</h2>
          <Field label={t('cr.type')} name="type" error={error}><select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} data-testid="cr-type">{CRED_TYPES.map((k) => <option key={k} value={k}>{t(`ctype.${k}`)}</option>)}</select></Field>
          <Field label={t('dc.title')} name="title" error={error}><input value={v.title} maxLength={200} onChange={(e) => setV({ ...v, title: e.target.value })} required data-testid="cr-name" /></Field>
          <Field label={t('lead.client')} name="clientName" error={error}><input value={v.clientName} onChange={(e) => setV({ ...v, clientName: e.target.value })} data-testid="cr-client" /></Field>
          <Field label={t('lead.sector')} name="sector" error={error}><select value={v.sector} onChange={(e) => setV({ ...v, sector: e.target.value })} data-testid="cr-sector"><option value="">–</option>{SECTORS.map((k) => <option key={k} value={k}>{t(`sector.${k}`)}</option>)}</select></Field>
          <Field label={t('cr.value')} name="value" error={error}><input type="number" min="0" step="0.01" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} data-testid="cr-value" /></Field>
          <Field label={t('cr.completed')} name="completionDate" error={error}><input type="date" value={v.completionDate} onChange={(e) => setV({ ...v, completionDate: e.target.value })} data-testid="cr-completed" /></Field>
          <Field label={t('cr.validUntil')} name="validUntil" error={error}><input type="date" value={v.validUntil} onChange={(e) => setV({ ...v, validUntil: e.target.value })} /></Field>
          <Field label={t('cr.tags')} name="tags" error={error} hint={t('int.participantsHint')}><input value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} data-testid="cr-tags" /></Field>
          <div className="actions"><button type="button" className="btn" onClick={() => setAdding(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="cr-save">{t('act.save')}</button></div>
        </form>)}
      {open && (q.isPending ? <Skeleton label={t('cr.title')} rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <div className="mdm-panel" data-testid="cr-detail">
          <h2>{q.data.docNo} · {q.data.title}</h2>
          <p className="muted">{q.data.typeLabel}{q.data.clientName ? ` · ${q.data.clientName}` : ''}{q.data.value != null ? ` · ${inr(q.data.value)}` : ''}{q.data.completionDate ? ` · ${t('cr.completedOn', { date: q.data.completionDate })}` : ''}{q.data.expired ? ` · ${t('cr.expired')}` : ''}</p>
          <p className="small">{t('cr.usedIn', { n: q.data.tenders.length })} {q.data.tenders.map((x) => <Link key={x.id} to={`/bd/tender?id=${x.id}`}>{x.docNo} </Link>)}</p>
          <AttachmentList entity="tdr_credential" entityId={q.data.id} canEdit={can} />
          {can && <FileUploader entity="tdr_credential" entityId={q.data.id} />}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(null)}>{t('act.close')}</button></div>
        </div>))}
    </section>
  );
}
