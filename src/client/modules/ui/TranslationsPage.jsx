import { useEffect, useRef, useState } from 'react';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { downloadWorkbookUrl, importWorkbook, useDecideChange, useMissingKeys, usePendingChanges, useProposeChanges, useTextHistory, useTranslationList } from '../../platform/i18n/api.js';
import { authHeaders } from '../../platform/api/index.js';
import { formatDateTime } from '../../platform/format.js';
import { Field, FormDialog, Pager, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import Icon from '../../platform/design/Icon.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Translations (part 03.09, FR-02): the text of the screens and messages in English and Hindi. Find a text, change its wording (a request that another
// system administrator approves), send the strings to a translator as a workbook and read the translated one back, and see what has no Hindi yet.

const SHOW = [['all', 'All texts'], ['missing', 'Missing in Hindi'], ['overridden', 'Changed by the company']];
const SIZES = [25, 50, 100];

function EditDialog({ row, dialogRef, onDone }) {
  const propose = useProposeChanges();
  const history = useTextHistory(row?.namespace, row?.key);
  const [error, setError] = useState(null);
  if (!row) return <dialog ref={dialogRef} className="dialog" aria-label="Change wording" />;
  const submit = (data) => {
    const changes = [];
    for (const lang of ['en', 'hi']) {
      const text = String(data.get(lang) ?? '');
      if (text !== (row[lang] ?? '') && text.trim() !== '') changes.push({ namespace: row.namespace, key: row.key, lang, text });
    }
    if (changes.length === 0) { setError({ form: 'Nothing is different from the text in force.', fields: {} }); return; }
    setError(null);
    propose.mutate({ changes, reason: String(data.get('reason') ?? '') }, {
      onSuccess: (req) => { dialogRef.current?.close(); onDone(`Change to ${row.namespace}.${row.key} requested (request ${req.id}). Another system administrator must approve it before it applies.`); },
      onError: (e) => setError(errorInfo(e)),
    });
  };
  const revert = (lang) => propose.mutate({ changes: [{ namespace: row.namespace, key: row.key, lang, text: null }], reason: 'Back to the standard wording' }, {
    onSuccess: (req) => { dialogRef.current?.close(); onDone(`Return to the standard ${lang === 'hi' ? 'Hindi' : 'English'} wording of ${row.namespace}.${row.key} requested (request ${req.id}).`); },
    onError: (e) => setError(errorInfo(e)),
  });
  return (
    <FormDialog dialogRef={dialogRef} title={`Change ${row.namespace}.${row.key}`} onSubmit={submit} error={error} busy={propose.isPending} submitLabel="Request change">
      <p className="muted small">Keep every <code>{'{placeholder}'}</code> exactly as in the English: the program fills them in. The change applies after another system administrator approves it.</p>
      <Field label="English" name="en" error={error}><textarea name="en" rows={3} defaultValue={row.en} maxLength={2000} lang="en" /></Field>
      <Field label="हिन्दी (Hindi)" name="hi" error={error}><textarea name="hi" rows={3} defaultValue={row.hi ?? ''} maxLength={2000} lang="hi" /></Field>
      {(row.enOverridden || row.hiOverridden) && (
        <p className="small">Changed by the company: {row.enOverridden && <button type="button" className="btn btn-small" onClick={() => revert('en')}>Back to standard English</button>} {row.hiOverridden && <button type="button" className="btn btn-small" onClick={() => revert('hi')}>Back to standard Hindi</button>}</p>
      )}
      {history.data?.length > 0 && (
        <details><summary>History of this text</summary>
          <ol className="history">{history.data.map((a) => <li key={a.id}><strong>{a.actor}</strong> <span className="muted">{formatDateTime(a.at)}</span> {a.reason && <em>{a.reason}</em>}{a.hi[1] !== undefined && <div lang="hi">{a.hi[0] ?? '-'} → {a.hi[1]}</div>}{a.en[1] !== undefined && <div>{a.en[0] ?? '-'} → {a.en[1]}</div>}</li>)}</ol>
        </details>
      )}
    </FormDialog>
  );
}

function Pending({ me }) {
  const pending = usePendingChanges();
  const decide = useDecideChange();
  const [comment, setComment] = useState({});
  if (!pending.data || pending.data.length === 0) return null;
  return (
    <section aria-labelledby="tr-pending"><h2 id="tr-pending">Changes waiting for approval</h2>
      <table className="grid" aria-label="Changes waiting for approval">
        <thead><tr><th>Change</th><th>Requested by</th><th>Reason</th><th>Decision</th></tr></thead>
        <tbody>
          {pending.data.map((p) => (
            <tr key={p.id}>
              <td data-label="Change">{p.changes.slice(0, 5).map((c) => <div key={`${c.namespace}.${c.key}.${c.lang}`}><code>{c.namespace}.{c.key}</code> ({c.lang}): <span lang={c.lang}>{c.text ?? 'standard wording'}</span></div>)}{p.changes.length > 5 && <div className="muted">and {p.changes.length - 5} more</div>}</td>
              <td data-label="Requested by">{p.requestedBy}</td>
              <td data-label="Reason">{p.reason}</td>
              <td data-label="Decision">
                {p.requestedBy === me ? <span className="muted">Waiting for another administrator</span> : (
                  <>
                    <input aria-label={`Comment for request ${p.id}`} placeholder="Comment (needed to reject)" value={comment[p.id] ?? ''} onChange={(e) => setComment({ ...comment, [p.id]: e.target.value })} />
                    <button type="button" className="btn btn-small btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, action: 'approve', comment: comment[p.id] || 'Approved' })}>Approve</button>
                    <button type="button" className="btn btn-small btn-danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, action: 'reject', comment: comment[p.id] ?? '' })}>Reject</button>
                    {decide.isError && decide.variables?.id === p.id && <span className="field-error" role="alert">{errorInfo(decide.error).form}</span>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function TranslationsPage({ session }) {
  usePageTitle('Translations');
  const [q, setQ] = useState('');
  const [namespace, setNamespace] = useState('');
  const [show, setShow] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [upload, setUpload] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [reason, setReason] = useState('');
  const dialog = useRef(null);
  const file = useRef(null);
  const [needle, setNeedle] = useState('');
  useEffect(() => { const t = setTimeout(() => { setNeedle(q); setPage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const list = useTranslationList({ q: needle, namespace, show, page, pageSize });
  const missing = useMissingKeys();
  const forbidden = list.error?.status === 403;

  const download = async () => {
    const res = await fetch(downloadWorkbookUrl, { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The workbook could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'translations.xlsx' }).click();
    URL.revokeObjectURL(url);
  };
  const pickFile = async (f) => {
    setUploadError(null);
    if (!f) return;
    try { setUpload({ file: f, preview: await importWorkbook(f) }); } catch (e) { setUpload(null); setUploadError(e); }
  };
  const sendFile = async () => {
    try {
      const out = await importWorkbook(upload.file, { commit: true, reason });
      setNotice(`The file was sent as request ${out.request.id} (${out.changes} texts). Another system administrator must approve it before it applies.`);
      setUpload(null); setReason('');
    } catch (e) { setUploadError(e); }
  };

  if (forbidden) return <div className="state" role="alert" data-testid="no-permission"><h2><Icon name="erp.state.locked" size={20} /> You do not have access to Translations</h2><p>This needs the ui.translation.manage permission. Ask a system administrator to grant it.</p></div>;
  const total = missing.data?.perNamespace?.reduce((n, x) => n + x.total, 0) ?? 0;
  const done = missing.data?.perNamespace?.reduce((n, x) => n + x.translated, 0) ?? 0;
  return (
    <section aria-labelledby="tr-title" data-testid="translations">
      <PageHeader id="tr-title" title={"Translations"} subtitle={"The text of the screens and messages in English and Hindi. A change to the wording applies after another system administrator approves it, and is kept with the old and new text."} />
      {notice && <p role="status" className="notice" data-testid="tr-notice">{notice}</p>}
      {missing.data && (
        <p data-testid="tr-coverage"><strong>{done}</strong> of <strong>{total}</strong> texts have Hindi. {missing.data.missing.length > 0 ? <>{missing.data.missing.length} missing: use "Missing in Hindi" below.</> : 'Nothing is missing.'}{missing.data.placeholders.length > 0 && ` ${missing.data.placeholders.length} Hindi text(s) lack a {placeholder} of the English.`}</p>
      )}
      <Pending me={session?.user} />
      <div className="srch-tools">
        <label className="field field-inline"><span>Search</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="A word or a key such as field.title" /></label>
        <label className="field field-inline"><span>Area</span><select value={namespace} onChange={(e) => { setNamespace(e.target.value); setPage(1); }}><option value="">All areas</option>{(list.data?.namespaces ?? []).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="field field-inline"><span>Show</span><select value={show} onChange={(e) => { setShow(e.target.value); setPage(1); }}>{SHOW.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="field field-inline"><span>Per page</span><select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <button type="button" className="btn" onClick={download}><Icon name="erp.action.export" size={16} /> Export for translators (.xlsx)</button>
        <button type="button" className="btn" onClick={() => file.current?.click()}><Icon name="erp.action.import" size={16} /> Import translated file</button>
        <input ref={file} type="file" accept=".xlsx" className="visually-hidden" tabIndex={-1} aria-label="Translated workbook" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {uploadError && <div role="alert" className="state state-error"><p>{uploadError.message}</p>{uploadError.correlationId && <p className="muted small">Correlation ID: <code>{uploadError.correlationId}</code></p>}</div>}
      {upload && (
        <div className="card" data-testid="tr-import">
          <h2>Import {upload.file.name}</h2>
          <p>{upload.preview.rows} rows read: <strong>{upload.preview.changes}</strong> text(s) would change{upload.preview.errors.length > 0 && <>, <strong>{upload.preview.errors.length}</strong> problem(s)</>}.</p>
          {upload.preview.errors.length > 0 && <ul>{upload.preview.errors.slice(0, 10).map((e, i) => <li key={i}>Row {e.line}: {e.message}</li>)}</ul>}
          {upload.preview.errors.length === 0 && upload.preview.changes > 0 && (
            <>
              <label className="field"><span>Reason</span><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} /></label>
              <button type="button" className="btn btn-primary" disabled={reason.trim().length < 5} onClick={sendFile}>Request these changes</button>
            </>
          )}
          {upload.preview.errors.length === 0 && upload.preview.changes === 0 && <p className="muted">Nothing in the file differs from the text in force.</p>}
          <button type="button" className="btn" onClick={() => setUpload(null)}>Cancel</button>
        </div>
      )}
      {list.isPending && <Skeleton label="Loading the texts" rows={5} />}
      {list.isError && !forbidden && <ErrorState title="The texts could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {list.data && list.data.rows.length === 0 && <EmptyState title="No text matches" message={show === 'missing' ? 'Every text has Hindi.' : 'Change the search or the filters.'} action={show !== 'all' || needle || namespace ? { label: 'Clear filters', onClick: () => { setQ(''); setNamespace(''); setShow('all'); } } : null} />}
      {list.data && list.data.rows.length > 0 && (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Texts">
            <table className="grid">
              <thead><tr><th>Key</th><th>English</th><th>हिन्दी</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <tr key={`${r.namespace}.${r.key}`}>
                    <th scope="row" data-label="Key"><code>{r.namespace}.{r.key}</code></th>
                    <td data-label="English" lang="en">{r.en}{r.enOverridden && <span className="muted small"> (changed)</span>}</td>
                    <td data-label="Hindi" lang="hi">{r.hi || <em className="muted" lang="en">missing</em>}{r.hiOverridden && <span className="muted small" lang="en"> (changed)</span>}</td>
                    <td><button type="button" className="btn btn-small" onClick={() => { setEditing(r); setTimeout(() => dialog.current?.showModal(), 0); }} aria-label={`Change ${r.namespace}.${r.key}`}>Change</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="texts" />
        </>
      )}
      <EditDialog key={editing ? `${editing.namespace}.${editing.key}` : 'none'} row={editing} dialogRef={dialog} onDone={(m) => { setNotice(m); setEditing(null); }} />
    </section>
  );
}
