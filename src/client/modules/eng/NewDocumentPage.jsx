import { useState } from 'react';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { useCreateDocument, useDocAction, useDocTypes, useDocument } from '../../platform/documents/api.js';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from './common.js';
import { LEVELS, RETENTION, docLink } from './documents-common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Upload / New Revision (part 04.10, section 7.3): a new controlled document, or the file of the open revision of an existing one. The file goes to the file service (it is scanned for
// viruses first); then the revision is sent for approval along the chain of the document type.
function Attach({ id }) {
  const q = useDocument(id);
  const act = useDocAction();
  const [error, setError] = useState(null);
  const [n, setN] = useState(0);
  if (q.isLoading) return <Skeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const v = d.versions.find((x) => x.id === d.draftVersionId);
  if (!v) return <p role="status" className="notice">This document has no open revision. Start a new revision from the document page.</p>;
  const send = () => { setError(null); act.mutate({ id, action: 'submit' }, { onSuccess: () => navigateTo(docLink(id)), onError: (er) => setError(errorInfo(er)) }); };
  return (
    <section aria-labelledby="nd-title" data-testid="attach-revision">
      <PageHeader id="nd-title" title={<>Revision {v.revision} of {d.docNo}</>} subtitle={<>{d.title}. Attach the file of this revision, then send it for approval.</>} />
      <FileUploader entity="doc_version" entityId={v.id} onDone={() => { setN((x) => x + 1); q.refetch(); }} />
      <AttachmentList key={n} entity="doc_version" entityId={v.id} canEdit onReplace={() => {}} />
      {error?.form && <p role="alert" className="error">{error.form}</p>}
      <div className="actions"><button type="button" className="btn btn-primary" disabled={act.isPending} onClick={send}>Send for approval</button><Link to={docLink(id)}>Back to the document</Link></div>
    </section>
  );
}

export default function NewDocumentPage() {
  usePageTitle('New Document');
  const search = useSearch();
  const existing = Number(search.get('document')) || null;
  const types = useDocTypes();
  const create = useCreateDocument();
  const [f, setF] = useState({ title: '', docType: '', projectId: '', discipline: '', confidentiality: '', retentionClass: '', validUntil: '', owner: '', tags: '' });
  const [error, setError] = useState(null);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  if (existing) return <Attach id={existing} />;
  const type = (types.data?.types ?? []).find((t) => t.code === f.docType);
  const submit = (e) => {
    e.preventDefault();
    setError(null);
    const body = {
      title: f.title, docType: f.docType, ...(f.projectId ? { projectId: Number(f.projectId) } : {}), ...(f.discipline ? { discipline: f.discipline } : {}), ...(f.confidentiality ? { confidentiality: f.confidentiality } : {}),
      ...(f.retentionClass ? { retentionClass: f.retentionClass } : {}), ...(f.validUntil ? { validUntil: f.validUntil } : {}), ...(f.owner ? { owner: f.owner } : {}),
      ...(f.tags.trim() ? { tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean) } : {}),
    };
    create.mutate(body, { onSuccess: (r) => navigateTo(`/documents/new?document=${r.id}`), onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <section aria-labelledby="nd-title" data-testid="new-document">
      <PageHeader id="nd-title" title={"New Document"} subtitle={"Give the details first; the next step attaches the file and sends it for approval. The document gets its number from the numbering service."} />
      <form className="form-grid" onSubmit={submit} aria-label="Register a document" data-testid="document-form">
        <Field label="Title" name="title" error={error}><input value={f.title} maxLength={200} required onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Document type" name="docType" error={error}>
          <select value={f.docType} required onChange={(e) => set({ docType: e.target.value })}><option value="">Choose a type</option>{(types.data?.types ?? []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
        </Field>
        {type && <p className="small muted">{type.requiresReview ? `Reviewed by ${type.reviewerRole.split('|').join(' or ')}, then ` : ''}approved by {type.approverRole}.</p>}
        <LookupField id="nd-project" label="Project" lookup="iam/projects" value={f.projectId} onChange={(v) => set({ projectId: v })} />
        <div className="wf-inline">
          <Field label="Discipline" name="discipline" error={error}><input value={f.discipline} maxLength={60} onChange={(e) => set({ discipline: e.target.value })} /></Field>
          <Field label="Owner" name="owner" error={error}><input value={f.owner} maxLength={60} onChange={(e) => set({ owner: e.target.value })} /></Field>
        </div>
        <div className="wf-inline">
          <label className="field"><span>Confidentiality</span><select value={f.confidentiality} onChange={(e) => set({ confidentiality: e.target.value })}><option value="">Type default{type ? ` (${LEVELS[type.defaultConfidentiality] ?? ''})` : ''}</option>{Object.entries(LEVELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field"><span>Retention</span><select value={f.retentionClass} onChange={(e) => set({ retentionClass: e.target.value })}><option value="">Type default</option>{Object.entries(RETENTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        {(type?.hasValidity ?? false) && <Field label="Valid until" name="validUntil" error={error}><input type="date" value={f.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></Field>}
        <Field label="Tags (separated by commas)" name="tags" error={error}><input value={f.tags} onChange={(e) => set({ tags: e.target.value })} /></Field>
        {error?.form && <p role="alert" className="error">{error.form}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={create.isPending || f.title.trim().length < 3 || !f.docType}>Register and go on to the file</button><Link to="/documents">Cancel</Link></div>
      </form>
    </section>
  );
}
