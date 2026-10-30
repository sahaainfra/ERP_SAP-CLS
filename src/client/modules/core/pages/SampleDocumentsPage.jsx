import { useRef, useState } from 'react';
import { useCreateSampleDocument, useSampleDocuments, useSubmitSampleDocument } from '../api/index.js';
import { AttachmentList, FileUploader } from '../components/Attachments.jsx';
import { formatDate } from '../../../platform/format.js';
import { Field, FormDialog, Pager, QueryState, errorInfo, usePageTitle } from './ui.jsx';

/**
 * The reference record page: a numbered sample document with an attachments panel (part 01.05). A real module's record
 * page embeds the same two components with its own entity name; whoever may edit the record may attach files to it.
 */
export default function SampleDocumentsPage() {
  usePageTitle('Sample Documents');
  const [page, setPage] = useState(1);
  const list = useSampleDocuments(page);
  const create = useCreateSampleDocument();
  const submit = useSubmitSampleDocument();
  const [selectedId, setSelectedId] = useState(null);
  const [replacing, setReplacing] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const rows = list.data?.data ?? [];
  const selected = rows.find((d) => d.id === selectedId) ?? rows[0] ?? null;
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

  const submitNew = async (f) => {
    setError(null);
    try {
      const doc = await create.mutateAsync({ title: String(f.get('title')), docDate: String(f.get('docDate')) });
      dialog.current?.close();
      setSelectedId(doc.id);
      setNotice(`Created ${doc.docNo}.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const submitDoc = async (d) => {
    setNotice('');
    try {
      await submit.mutateAsync({ id: d.id, version: d.version });
      setNotice(`${d.docNo} submitted. Its files are now locked: they can be replaced by a new version but not removed.`);
    } catch (err) {
      setNotice(err.message);
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Reference &rsaquo; Sample Documents</nav>
      <div className="page-head">
        <h1 id="page-title">Sample Documents</h1>
        <button type="button" className="btn btn-primary" onClick={() => { setError(null); dialog.current?.showModal(); }}>New sample document</button>
      </div>
      <p className="muted">A small numbered document that shows how any record takes attachments: drag files in, take a photo on a phone, watch the scan, open a file through a short-lived link, replace it with a new version. Submitting the document locks its files.</p>
      <p role="status" className="notice">{notice}</p>
      <QueryState query={list} what="sample documents" permission="core.sample.use" />
      {list.data && rows.length === 0 && <div className="state"><h2>No sample documents yet</h2><p>Create one to try the attachment panel.</p><button type="button" className="btn btn-primary" onClick={() => dialog.current?.showModal()}>New sample document</button></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Sample documents</caption>
              <thead><tr><th>Number</th><th>Title</th><th>Date</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className={selected?.id === d.id ? 'row-selected' : ''} data-testid={`doc-${d.id}`}>
                    <td data-label="Number"><button type="button" className="link" onClick={() => { setSelectedId(d.id); setReplacing(null); }} aria-label={`Open ${d.docNo}`}>{d.docNo}</button></td>
                    <td data-label="Title">{d.title}</td>
                    <td data-label="Date">{formatDate(d.docDate)}</td>
                    <td data-label="Status"><span className={`chip ${d.status === 'DRAFT' ? 'chip-off' : 'chip-on'}`}>{d.status}</span></td>
                    <td>{d.status === 'DRAFT' && <button type="button" className="link" onClick={() => submitDoc(d)} aria-label={`Submit ${d.docNo}`}>Submit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="documents" />
        </>
      )}

      {selected && (
        <section aria-labelledby="att-title" className="card" data-testid="attachments-panel">
          <h2 id="att-title">Attachments of {selected.docNo}</h2>
          <FileUploader key={replacing?.id ?? 'new'} entity="sample_document" entityId={selected.id} supersedes={replacing} onDone={() => setReplacing(null)} />
          {replacing && <p className="small">Replacing {replacing.name}. <button type="button" className="link" onClick={() => setReplacing(null)}>Cancel</button></p>}
          <AttachmentList entity="sample_document" entityId={selected.id} canEdit onReplace={setReplacing} />
        </section>
      )}

      <FormDialog dialogRef={dialog} title="New sample document" reason={false} error={error} busy={create.isPending} submitLabel="Create" onSubmit={submitNew}>
        <Field label="Title" name="title" error={error}><input name="title" required minLength={2} maxLength={120} /></Field>
        <Field label="Document date" name="docDate" error={error} hint="Must fall in an open financial year (create one under Financial Years)"><input name="docDate" type="date" defaultValue={today} required /></Field>
      </FormDialog>
    </section>
  );
}
