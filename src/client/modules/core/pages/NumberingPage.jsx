import { useRef, useState } from 'react';
import {
  useCreateDocType, useCreateSeries, useDocumentTypes, useNumberSeries, useRequestSeriesChange,
} from '../api/index.js';
import { formatNumber, formatProblems } from '../../../../shared/numbering.js';
import { Field, FormDialog, QueryState, can, errorInfo, usePageTitle } from './ui.jsx';

const RESETS = [['never', 'Never'], ['financial_year', 'Every financial year'], ['monthly', 'Every month']];
const ASSIGN = [['create', 'When created'], ['submit', 'When submitted'], ['approval', 'When approved']];

/** The same formatter the server uses, fed sample values, so the preview cannot differ from an issued number. */
function livePreview(format, prefix, resetRule, statutory) {
  const problems = formatProblems(format, { resetRule, statutory, sample: { prefix } });
  if (problems.length) return { problems, text: null };
  try {
    const text = formatNumber(format, { prefix, branch: 'MUM', project: 'P001', fy: '2026-27', date: '2026-10-30', seq: 1 });
    return { problems: [], text };
  } catch (err) {
    return { problems: [err.message], text: null };
  }
}

export default function NumberingPage({ session }) {
  usePageTitle('Document Types & Numbering');
  const types = useDocumentTypes();
  const series = useNumberSeries();
  const createType = useCreateDocType();
  const createSeries = useCreateSeries();
  const requestChange = useRequestSeriesChange();
  const canConfigure = can(session, 'core.numbering.configure');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState(null);
  const [draft, setDraft] = useState({ docType: '', prefix: '', format: '{PREFIX}/{FY}/{SEQ:6}', resetRule: 'financial_year', gapFree: false });
  const typeDialog = useRef(null);
  const seriesDialog = useRef(null);
  const changeDialog = useRef(null);

  const statutory = Boolean(types.data?.find((t) => t.code === draft.docType)?.statutory) || draft.gapFree;
  const preview = livePreview(draft.format, draft.prefix, draft.resetRule, statutory);

  const open = (dialog, t = null) => {
    setError(null);
    setTarget(t);
    if (t?.series) setDraft({ docType: t.series.docType, prefix: t.series.prefix, format: t.series.format, resetRule: t.series.resetRule, gapFree: t.series.gapFree });
    dialog.current?.showModal();
  };
  const run = async (fn, dialog, done) => {
    setError(null);
    try {
      await fn();
      dialog.current?.close();
      setNotice(done);
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const draftFields = (
    <>
      <Field label="Prefix" name="prefix" error={error}><input value={draft.prefix} onChange={(e) => setDraft({ ...draft, prefix: e.target.value })} maxLength={12} /></Field>
      <Field label="Format" name="format" error={error} hint="Tokens: {PREFIX} {BRANCH} {PROJECT} {FY} {FYS} {YYYY} {YY} {MM} {DD} {SEQ:6}">
        <input value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value })} maxLength={60} />
      </Field>
      <Field label="Restart numbering" name="resetRule" error={error}>
        <select value={draft.resetRule} onChange={(e) => setDraft({ ...draft, resetRule: e.target.value })}>{RESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <label className="check"><input type="checkbox" checked={draft.gapFree} onChange={(e) => setDraft({ ...draft, gapFree: e.target.checked })} /> Gap-free (no number is ever skipped)</label>
      <div className="preview" aria-live="polite" data-testid="number-preview">
        {preview.text ? <>Example: <code>{preview.text}</code></> : preview.problems.map((p) => <p key={p} className="field-error">{p}</p>)}
      </div>
    </>
  );

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Configuration &rsaquo; Document Types &amp; Numbering</nav>
      <div className="page-head">
        <h1 id="page-title">Document Types &amp; Numbering</h1>
        <button type="button" className="btn" disabled={!canConfigure} onClick={() => open(typeDialog)}>Add document type</button>
        <button type="button" className="btn btn-primary" disabled={!canConfigure} onClick={() => { setDraft({ ...draft, docType: types.data?.[0]?.code ?? '' }); open(seriesDialog); }}>Add number series</button>
      </div>
      <p className="muted">A series turns a format such as <code>{'{PREFIX}/{PROJECT}/{FY}/{SEQ:6}'}</code> into document numbers. Gap-free series are for statutory documents; once a number has been issued, a change needs approval.</p>
      <p role="status" className="notice">{notice}</p>

      <QueryState query={types} what="document types" permission="core.numbering.view" />
      {types.data && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Document types</caption>
            <thead><tr><th>Code</th><th>Name</th><th>Module</th><th>Retention</th><th>Statutory</th><th>Number assigned</th></tr></thead>
            <tbody>
              {types.data.map((t) => (
                <tr key={t.id} data-testid={`type-${t.code}`}>
                  <td data-label="Code"><code>{t.code}</code></td><td data-label="Name">{t.name}</td><td data-label="Module">{t.module}</td>
                  <td data-label="Retention">{t.retentionClass}</td><td data-label="Statutory">{t.statutory ? 'Yes' : 'No'}</td>
                  <td data-label="Number assigned">{ASSIGN.find(([v]) => v === t.assignAt)?.[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Number series</h2>
      <QueryState query={series} what="number series" permission="core.numbering.view" />
      {series.data && series.data.length === 0 && <div className="state"><h2>No series yet</h2><p>Add a series so documents of a type can be numbered.</p></div>}
      {series.data?.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Number series</caption>
            <thead><tr><th>Type</th><th>Name</th><th>Format</th><th>Restart</th><th>Gap-free</th><th>Issued</th><th>Next number</th><th /></tr></thead>
            <tbody>
              {series.data.map((s) => (
                <tr key={s.id} data-testid={`series-${s.id}`}>
                  <td data-label="Type"><code>{s.docType}</code></td><td data-label="Name">{s.name}</td><td data-label="Format"><code>{s.format}</code></td>
                  <td data-label="Restart">{RESETS.find(([v]) => v === s.resetRule)?.[1]}</td><td data-label="Gap-free">{s.gapFree ? 'Yes' : 'No'}</td>
                  <td data-label="Issued" className="num">{s.issued}</td>
                  <td data-label="Next number">{s.nextNumber ? <code>{s.nextNumber}</code> : <span className="muted" title={s.previewNote ?? ''}>needs project or date</span>}</td>
                  <td>{canConfigure && <button type="button" className="link" aria-label={`Request a change to series ${s.name}`} onClick={() => open(changeDialog, { series: s })}>{s.used ? 'Request change' : 'Change'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FormDialog dialogRef={typeDialog} title="Add document type" error={error} busy={createType.isPending}
        onSubmit={(f) => run(() => createType.mutateAsync({ code: String(f.get('code')), name: String(f.get('name')), module: String(f.get('module')), statutory: f.get('statutory') === 'on', retentionClass: String(f.get('retentionClass')), assignAt: String(f.get('assignAt')), reason: String(f.get('reason')) }), typeDialog, 'Document type added.')}>
        <Field label="Code" name="code" error={error}><input name="code" required /></Field>
        <Field label="Name" name="name" error={error}><input name="name" required /></Field>
        <Field label="Module" name="module" error={error}><input name="module" required placeholder="fin" /></Field>
        <Field label="Retention" name="retentionClass" error={error}><select name="retentionClass" defaultValue="standard"><option>permanent</option><option>statutory</option><option>standard</option><option>short</option></select></Field>
        <Field label="Number assigned" name="assignAt" error={error}><select name="assignAt" defaultValue="create">{ASSIGN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <label className="check"><input name="statutory" type="checkbox" /> Statutory document</label>
      </FormDialog>

      <FormDialog dialogRef={seriesDialog} title="Add number series" error={error} busy={createSeries.isPending}
        onSubmit={(f) => run(() => createSeries.mutateAsync({ docType: draft.docType, name: String(f.get('name')), prefix: draft.prefix, format: draft.format, resetRule: draft.resetRule, gapFree: draft.gapFree, reason: String(f.get('reason')) }), seriesDialog, 'Number series added.')}>
        <Field label="Document type" name="docType" error={error}>
          <select value={draft.docType} onChange={(e) => setDraft({ ...draft, docType: e.target.value })}>{(types.data ?? []).map((t) => <option key={t.code} value={t.code}>{t.code} - {t.name}</option>)}</select>
        </Field>
        <Field label="Series name" name="name" error={error}><input name="name" required minLength={2} /></Field>
        {draftFields}
      </FormDialog>

      <FormDialog dialogRef={changeDialog} title={target ? `Change series ${target.series.name}` : ''} error={error} busy={requestChange.isPending} submitLabel="Send request"
        onSubmit={(f) => run(() => requestChange.mutateAsync({ id: target.series.id, changes: { prefix: draft.prefix, format: draft.format, resetRule: draft.resetRule, gapFree: draft.gapFree }, reason: String(f.get('reason')) }), changeDialog, 'Change request sent for approval.')}>
        <p className="muted">Changes to a series that has issued numbers are applied only after approval.</p>
        {draftFields}
      </FormDialog>
    </section>
  );
}
