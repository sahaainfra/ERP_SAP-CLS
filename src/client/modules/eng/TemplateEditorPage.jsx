import { useEffect, useMemo, useRef, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { previewPdf, useCatalogue, useCreateTemplate, useDiscardTemplate, useSubmitTemplate, useTemplate, useTemplates, useTplRecords, useUpdateTemplate, useValidate } from '../../platform/templates/api.js';
import { Field, Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { PdfPages } from './DocumentViewer.jsx';
import { TEMPLATE_STATUS, templateLink } from './templates-common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Template Editor (part 04.11, section 7.2): the HTML and the style of a format, a picker of the variables the document type allows (nothing else can be used), a check against that catalogue as you type, and a
// live preview drawn by the server with the sample record or a real record. A draft is saved, then sent for approval; an active template is changed by making a new version of it.
const empty = { docType: '', code: '', name: '', html: '', css: '', orientation: 'portrait', changeNote: '', effectiveFrom: '', brand: { address: '', phone: '', email: '', footerNote: '', logo: '' } };
const params = () => new URLSearchParams(globalThis.location?.search ?? '');
const FILTERS = 'money · inr · qty · rate · int · pct · date · datetime · upper · lower · words · wordsHi · mask';

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function TemplateEditorPage({ session }) {
  const id = Number(params().get('id')) || null;
  const isNew = params().get('new') === '1';
  usePageTitle('Template Editor');
  const q = useTemplate(id);
  const lib = useTemplates({ limit: 1 });
  const [f, setF] = useState(empty);
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [problems, setProblems] = useState(null);
  const [live, setLive] = useState(true);
  const [recordId, setRecordId] = useState('');
  const [group, setGroup] = useState('');
  const [pdf, setPdf] = useState({ url: null, buffer: null, pages: 0, error: null, busy: false });
  const area = useRef(null);
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const submit = useSubmitTemplate();
  const discard = useDiscardTemplate();
  const validate = useValidate();
  const cat = useCatalogue(f.docType);
  const records = useTplRecords({ docType: f.docType, limit: 50 });
  const docTypes = lib.data?.docTypes ?? [];

  useEffect(() => {
    if (q.data && loaded !== q.data.id) {
      const t = q.data;
      setF({ docType: t.docType, code: t.code, name: t.name, html: t.html, css: t.css, orientation: t.orientation, changeNote: t.changeNote ?? '', effectiveFrom: t.effectiveFrom ?? '', brand: { address: '', phone: '', email: '', footerNote: '', logo: '', ...t.brand } });
      setLoaded(t.id);
    }
  }, [q.data, loaded]);
  // a new template starts from the standard format of its type
  useEffect(() => {
    if (isNew && cat.data && !f.html && f.docType === cat.data.code) setF((x) => ({ ...x, html: cat.data.standard.html, css: cat.data.standard.css, name: x.name || cat.data.standard.name, code: x.code || `${f.docType}_CUSTOM` }));
  }, [isNew, cat.data, f.html, f.docType]);

  const t = q.data;
  const editable = isNew ? can(session, 'tpl.template.edit') : Boolean(t && t.status === 'DRAFT' && !t.shared && t.canEdit);
  const dHtml = useDebounced(f.html, 600);
  const dCss = useDebounced(f.css, 600);
  const dType = f.docType;
  useEffect(() => {
    if (!dType || !dHtml) return;
    validate.mutate({ docType: dType, html: dHtml, css: dCss }, { onSuccess: setProblems, onError: () => setProblems(null) });
  }, [dType, dHtml, dCss]);

  const runPreview = async () => {
    setPdf((p) => ({ ...p, busy: true, error: null }));
    try {
      const out = await previewPdf({ ...(id && !isNew ? { templateId: id } : {}), docType: f.docType, html: f.html, css: f.css, orientation: f.orientation, brand: Object.fromEntries(Object.entries(f.brand).filter(([, v]) => v)), ...(recordId ? { recordId: Number(recordId) } : {}) });
      const buffer = await out.blob.arrayBuffer();
      setPdf((p) => { if (p.url) URL.revokeObjectURL(p.url); return { url: URL.createObjectURL(out.blob), buffer, pages: out.pages, error: null, busy: false }; });
    } catch (e) { setPdf((p) => ({ ...p, busy: false, error: e.message })); }
  };
  const ready = problems?.ok === true;
  const dReady = useDebounced(ready, 800);
  useEffect(() => {
    if (live && dReady && f.docType && f.html) runPreview();
  }, [live, dReady, dHtml, dCss, recordId, f.orientation]);
  useEffect(() => () => { if (pdf.url) URL.revokeObjectURL(pdf.url); }, [pdf.url]);

  const vars = useMemo(() => (cat.data?.variables ?? []).filter((v) => (group === '' ? !v.group : v.group === group)), [cat.data, group]);
  const insert = (text) => {
    const el = area.current;
    const at = el ? [el.selectionStart, el.selectionEnd] : [f.html.length, f.html.length];
    setF((x) => ({ ...x, html: x.html.slice(0, at[0]) + text + x.html.slice(at[1]) }));
    setTimeout(() => { if (el) { el.focus(); el.setSelectionRange(at[0] + text.length, at[0] + text.length); } }, 0);
  };
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setBrand = (patch) => setF((x) => ({ ...x, brand: { ...x.brand, ...patch } }));
  const logo = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 150_000) { setError({ form: 'The logo must be a PNG or JPEG picture of at most 150 KB.', fields: {} }); return; }
    const r = new FileReader();
    r.onload = () => setBrand({ logo: String(r.result) });
    r.readAsDataURL(file);
  };
  const brand = () => Object.fromEntries(Object.entries(f.brand).filter(([, v]) => v));
  const save = (e) => {
    e?.preventDefault();
    setError(null); setNotice('');
    const body = { name: f.name, html: f.html, css: f.css, orientation: f.orientation, brand: brand(), changeNote: f.changeNote || undefined, effectiveFrom: f.effectiveFrom || null };
    if (isNew) create.mutate({ ...body, docType: f.docType, code: f.code }, { onSuccess: (r) => { setNotice('Draft saved.'); navigateTo(templateLink(r.id)); }, onError: (er) => setError(errorInfo(er)) });
    else update.mutate({ id, ...body, rowVersion: t.rowVersion }, { onSuccess: () => setNotice('Draft saved.'), onError: (er) => setError(errorInfo(er)) });
  };
  const send = () => { setError(null); submit.mutate(id, { onSuccess: (r) => setNotice(`Sent for approval to the process owner (${r.owner}).`), onError: (er) => setError(errorInfo(er)) }); };
  const newVersion = () => {
    setError(null);
    create.mutate({ docType: t.docType, code: t.code, name: t.name, html: t.html, css: t.css, orientation: t.orientation, brand: Object.fromEntries(Object.entries(t.brand).filter(([, v]) => v)), changeNote: `New version of ${t.code} (version ${t.version})` }, { onSuccess: (r) => navigateTo(templateLink(r.id)), onError: (er) => setError(errorInfo(er)) });
  };
  const drop = () => { setError(null); discard.mutate(id, { onSuccess: () => navigateTo('/admin/templates'), onError: (er) => setError(errorInfo(er)) }); };

  if (!can(session, 'tpl.template.view')) return <NoPermission what="the template editor" permission="tpl.template.view" />;
  if (id && q.isPending) return <Skeleton label="Loading the template" rows={5} />;
  if (id && q.isError) return <ErrorState title="The template could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  if (!id && !isNew) return (<section aria-labelledby="te-title" data-testid="template-editor"><PageHeader id="te-title" title={"Template Editor"} /><EmptyState title="No template chosen" message="Open a template from the library, or make a new one." action={{ label: 'Open the library', onClick: () => navigateTo('/admin/templates') }} /></section>);
  return (
    <section aria-labelledby="te-title" data-testid="template-editor">
      <p className="muted small"><Link to="/admin/templates">Templates</Link> › {isNew ? 'New template' : f.code}</p>
      <PageHeader id="te-title" title={isNew ? 'New template' : `${f.code} version ${t.version}`} />
      {t && <p><StatusBadge status={TEMPLATE_STATUS[t.status][0]} label={TEMPLATE_STATUS[t.status][1]} />{t.shared && <span className="muted"> A standard format of the library: make your own version to change it.</span>}{t.approvedBy && <span className="muted"> Approved by {t.approvedBy}{t.approvedAt ? ` on ${formatDate(t.approvedAt)}` : ''}.</span>}{t.instanceId && t.status === 'IN_REVIEW' && <> <Link to={`/workflow/instance?id=${t.instanceId}`}>Open the approval</Link></>}</p>}
      {notice && <p role="status" className="notice" data-testid="te-notice">{notice}</p>}
      {error?.form && <p role="alert" className="error" data-testid="te-error">{error.form}{error.correlationId ? ` (reference ${error.correlationId})` : ''}</p>}
      <div className="tpl-editor">
        <form className="form-grid" onSubmit={save} aria-label="The template">
          <fieldset disabled={!editable} className="form-section">
            <legend>The template</legend>
            <Field label="Document type" name="docType" error={error}>
              <select required value={f.docType} disabled={!isNew} onChange={(e) => set({ docType: e.target.value, html: '', css: '', code: '' })}><option value="">Choose the document</option>{docTypes.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}</select>
            </Field>
            <Field label="Code" name="code" error={error} hint="Capital letters, digits and underscores. Use the code of an existing template to make its next version."><input required value={f.code} disabled={!isNew} maxLength={40} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Name" name="name" error={error}><input required value={f.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Page" name="orientation" error={error}><select value={f.orientation} onChange={(e) => set({ orientation: e.target.value })}><option value="portrait">A4 portrait</option><option value="landscape">A4 landscape</option></select></Field>
            <Field label="Takes effect from" name="effectiveFrom" error={error} hint="Leave empty to use it from the day it is approved."><input type="date" value={f.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} /></Field>
            <Field label="What changed" name="changeNote" error={error}><input value={f.changeNote} maxLength={500} onChange={(e) => set({ changeNote: e.target.value })} /></Field>
          </fieldset>
          <fieldset disabled={!editable} className="form-section">
            <legend>Letterhead of the company</legend>
            <Field label="Address" name="brand.address" error={error}><input value={f.brand.address} maxLength={300} onChange={(e) => setBrand({ address: e.target.value })} /></Field>
            <Field label="Phone" name="brand.phone" error={error}><input value={f.brand.phone} maxLength={40} onChange={(e) => setBrand({ phone: e.target.value })} /></Field>
            <Field label="E-mail" name="brand.email" error={error}><input value={f.brand.email} maxLength={120} onChange={(e) => setBrand({ email: e.target.value })} /></Field>
            <Field label="Footer note" name="brand.footerNote" error={error}><input value={f.brand.footerNote} maxLength={200} onChange={(e) => setBrand({ footerNote: e.target.value })} /></Field>
            <Field label="Logo (PNG or JPEG, at most 150 KB)" name="brand.logo" error={error}><input type="file" accept="image/png,image/jpeg" onChange={(e) => logo(e.target.files?.[0])} />{f.brand.logo && <button type="button" className="btn btn-small" onClick={() => setBrand({ logo: '' })}>Remove the logo</button>}</Field>
          </fieldset>
          <div className="form-section">
            <h2>Variables</h2>
            <p className="muted small">Click a variable to put it where the cursor is. Only these can be used; a filter follows a bar, as in {'{{grandTotal | money}}'}. Filters: {FILTERS}.</p>
            <label className="field"><span>Show</span><select value={group} onChange={(e) => setGroup(e.target.value)} data-testid="var-group"><option value="">The document</option>{Object.entries(cat.data?.groups ?? {}).map(([k, l]) => <option key={k} value={k}>{l} (inside a loop)</option>)}</select></label>
            {group && editable && <button type="button" className="btn btn-small" onClick={() => insert(`{{#each ${group}}}\n\n{{/each}}`)}>Insert a loop over {cat.data?.groups[group]}</button>}
            {editable && <button type="button" className="btn btn-small" onClick={() => insert('{{#if variable}}\n\n{{else}}\n\n{{/if}}')}>Insert a condition</button>}
            {cat.isPending && f.docType && <Skeleton label="Loading the variables" rows={2} />}
            <ul className="tpl-vars" data-testid="var-list">{vars.map((v) => <li key={v.path}><button type="button" className="btn btn-small" disabled={!editable} title={`${v.label} (${v.type})`} onClick={() => insert(`{{${v.path}}}`)}>{v.path}</button> <span className="muted small">{v.label}</span></li>)}</ul>
            {f.docType && vars.length === 0 && !cat.isPending && <p className="muted">No variable in this group.</p>}
          </div>
          <Field label="HTML of the template" name="html" error={error}>
            <textarea ref={area} className="code-editor" rows="18" spellCheck="false" value={f.html} readOnly={!editable} data-testid="html-editor" onChange={(e) => set({ html: e.target.value })} />
          </Field>
          <Field label="Style (CSS)" name="css" error={error}><textarea className="code-editor" rows="8" spellCheck="false" value={f.css} readOnly={!editable} data-testid="css-editor" onChange={(e) => set({ css: e.target.value })} /></Field>
          <div role="status" aria-live="polite" data-testid="check-result">
            {problems?.ok && <p className="notice">The template passes the check against the catalogue. It uses {problems.variables.length} variable(s).</p>}
            {problems && !problems.ok && (<div className="error" role="alert"><p>{problems.problems.length} problem(s) with the template:</p><ul>{problems.problems.slice(0, 20).map((p, i) => <li key={i}>Line {p.line}: {p.message}</li>)}</ul></div>)}
            {problems?.warnings?.length > 0 && <ul className="muted small">{problems.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          </div>
          <div className="actions">
            {editable && <button type="submit" className="btn btn-primary" disabled={create.isPending || update.isPending || problems?.ok === false}>Save draft</button>}
            {editable && !isNew && <button type="button" className="btn" disabled={submit.isPending || problems?.ok === false} onClick={send}>Send for approval</button>}
            {editable && !isNew && <button type="button" className="btn" disabled={discard.isPending} onClick={() => { if (globalThis.confirm('Discard this draft?')) drop(); }}>Discard the draft</button>}
            {!isNew && t && !editable && t.canEdit && !['IN_REVIEW'].includes(t.status) && <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={newVersion} data-testid="new-version">Make a new version</button>}
            <button type="button" className="btn" onClick={() => navigateTo('/admin/templates')}>Back to the library</button>
          </div>
        </form>
        <aside className="tpl-preview" aria-label="Preview" data-testid="preview-panel">
          <h2>Preview</h2>
          <div className="srch-form">
            <label className="field"><span>Data</span><select value={recordId} onChange={(e) => setRecordId(e.target.value)} data-testid="preview-record"><option value="">The sample record of the catalogue</option>{(records.data?.rows ?? []).map((r) => <option key={r.id} value={r.id}>{r.docNo}{r.sample ? ' (sample)' : ''}</option>)}</select></label>
            <label className="field"><span><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Update as I type</span></label>
            <button type="button" className="btn" onClick={runPreview} disabled={pdf.busy || !f.docType || !f.html} data-testid="preview-now">Preview now</button>
          </div>
          {pdf.busy && <Skeleton label="Drawing the preview" rows={2} />}
          {pdf.error && <p role="alert" className="error" data-testid="preview-error">{pdf.error}</p>}
          {pdf.url && <><p className="muted small" data-testid="preview-pages">{pdf.pages} page(s), watermarked PREVIEW. <a href={pdf.url} target="_blank" rel="noopener noreferrer">Open in a new tab</a></p><div className="tpl-frame" data-testid="preview-frame"><PdfPages buffer={pdf.buffer} render={(p) => <img key={p.n} src={p.url} width={p.width} height={p.height} alt={`Page ${p.n} of the preview`} data-testid={`preview-page-${p.n}`} className="tpl-page" />} /></div></>}
          {!pdf.url && !pdf.busy && !pdf.error && <p className="muted">The preview appears when the template passes the check.</p>}
          {t?.versions?.length > 1 && (<><h3>Versions</h3><ul>{t.versions.map((v) => <li key={v.id}><Link to={templateLink(v.id)}>Version {v.version}</Link> <StatusBadge status={TEMPLATE_STATUS[v.status][0]} label={TEMPLATE_STATUS[v.status][1]} /></li>)}</ul></>)}
        </aside>
      </div>
    </section>
  );
}
