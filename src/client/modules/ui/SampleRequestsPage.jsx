import { contextFiltersFor, useWorkContext } from '../../platform/shell/useWorkContext.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createFromSource, useFormDefinition, useSampleRequest, useSampleRequestActions, useSampleRequestBulk } from './api.js';
import ObjectPage from '../../platform/object/ObjectPage.jsx';
import { Banner, useToast } from '../../platform/feedback/Feedback.jsx';
import { navigateTo, QueryState, usePageTitle } from '../core/pages/ui.jsx';
import ListReport from '../../platform/list/ListReport.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import Icon from '../../platform/design/Icon.jsx';
import ItemSelector from '../../platform/items/ItemSelector.jsx';
import { useFeatureFlag } from '../core/api/index.js';
import { formatDateTime } from '../../platform/format.js';
import { formatBusinessDate } from '../../platform/forms/index.js';
import {
  ActionBar, DraftBanner, DuplicateWarning, ErrorSummary, FormSection, LineGrid, MetaField, ReadOnlyField, computeCell, draftStatus, fetchLookup,
  newRow, useDraft, useForm, useFormContext, useUnsavedGuard,
} from '../../platform/forms/index.js';
import { formatNumberInput, total as sumOf } from '../../../shared/forms/numbers.js';
import { SAMPLE_REQUEST_FORM, isShown, sampleRequestSchema } from '../../../shared/forms/sample-request.js';

// The reference form of the data-entry framework (part 03.02, AC-02): a sample material request. It shows context auto-fill, dependent
// lookups, conditional fields, the line grid with paste from Excel, server drafts, the duplicate warning, "create from" and server
// errors placed on their fields. The layout comes from the form definition the server holds (FR-10).

const params = () => new URLSearchParams(window.location.search);
const emptyValues = (ctx) => ({
  title: '', docDate: ctx.today, requiredBy: '', projectId: ctx.projectId || '', siteId: ctx.projectId ? ctx.siteId || '' : '', costCentreId: '', departmentId: ctx.departmentId || '',
  priority: 'NORMAL', urgencyReason: '', returnable: false, returnBy: '', deliveryNote: '', deliveryLocation: null, lines: [newRow()],
});
const fromRecord = (r) => ({
  title: r.title, docDate: r.docDate, requiredBy: r.requiredBy, projectId: r.projectId, siteId: r.siteId ?? '', costCentreId: r.costCentreId ?? '', departmentId: r.departmentId ?? '',
  priority: r.priority, urgencyReason: r.urgencyReason ?? '', returnable: r.returnable, returnBy: r.returnBy ?? '', deliveryNote: r.deliveryNote ?? '',
  deliveryLocation: r.deliveryLat ? { lat: r.deliveryLat, lng: r.deliveryLng, accuracy: '' } : null,
  lines: r.lines.map((l) => newRow({ id: l.id, description: l.description, uom: l.uom, quantity: l.quantity, unitRate: l.unitRate, neededOn: l.neededOn ?? '', comment: l.comment ?? '' })),
  ...(r.sourceType ? { sourceType: r.sourceType, sourceId: Number(r.sourceId) } : {}),
});

/** What the form sends: the values, each line's amount and the total as the person saw them (the server compares, section 6). */
export function toRequestBody(values, columns) {
  const amountCol = columns.find((c) => c.computed);
  const lines = values.lines.filter((l) => Object.entries(l).some(([k, v]) => !['_k', 'id'].includes(k) && v !== '' && v !== null && v !== undefined)).map(({ _k, ...l }) => ({ ...l, amount: computeCell(amountCol, l) || undefined }));
  const { deliveryLocation, ...rest } = values;
  return {
    ...rest,
    deliveryLat: deliveryLocation?.lat || null,
    deliveryLng: deliveryLocation?.lng || null,
    lines,
    total: lines.every((l) => l.amount) ? sumOf(lines.map((l) => l.amount)) : undefined,
  };
}

function RequestForm({ def, id, onDone, initialNotice = '' }) {
  const ctx = useFormContext();
  const record = useSampleRequest(id);
  const actions = useSampleRequestActions();
  const columns = def.grids.lines.columns;
  const form = useForm({ initial: emptyValues(ctx), schema: null });
  const { values, set, update, errors, setErrors, setFormError, formError, dirty, reset, markSaved, showServerError } = form;
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(initialNotice);
  const [createdNote, setCreatedNote] = useState('');
  const [rowFiles, setRowFiles] = useState(null);
  const [picking, setPicking] = useState(false);
  const itemsOn = useFeatureFlag('ff.mdm.p0603');
  const loaded = useRef(false);
  const rec = record.data;
  const readOnly = Boolean(rec && rec.status !== 'DRAFT');
  const draft = useDraft({ formCode: SAMPLE_REQUEST_FORM, entityKey: id ? String(id) : '', values, dirty, enabled: !readOnly && (!id || Boolean(rec)), title: values.title, projectId: values.projectId, siteId: values.siteId });
  useUnsavedGuard(dirty && !readOnly);

  // a saved record, or a new form started from another document, or the context defaults once the session is known
  useEffect(() => {
    if (loaded.current) return;
    if (id && rec) { loaded.current = true; reset(fromRecord(rec)); return; }
    if (id || !ctx.ready) return;
    loaded.current = true;
    const p = params();
    if (p.get('source') && p.get('id')) {
      createFromSource(SAMPLE_REQUEST_FORM, p.get('source'), p.get('id'))
        .then((r) => { reset({ ...emptyValues(ctx), ...r.values }, { asSaved: false }); setCreatedNote(r.note); })
        .catch((err) => setFormError({ form: `Could not start from that document: ${err.message}`, correlationId: err.correlationId }));
    } else reset(emptyValues(ctx));
  }, [id, rec, ctx, reset, setFormError]);

  const labelOf = (path) => {
    const m = /^lines\.(\d+)\.(\w+)$/.exec(path);
    if (m) return `Items, row ${Number(m[1]) + 1}: ${columns.find((c) => c.key === m[2])?.label ?? m[2]}`;
    if (path === 'deliveryLat' || path === 'deliveryLng') return def.fields.deliveryLocation.label;
    if (path === 'total') return 'Total';
    return def.fields[path]?.label ?? path;
  };
  const mapErrors = (errs) => Object.fromEntries(Object.entries(errs).map(([k, v]) => [k === 'deliveryLat' || k === 'deliveryLng' ? 'deliveryLocation' : k, v]));

  /** Validate with the shared schema (the server checks again), showing every problem on its field. */
  const check = () => {
    const body = toRequestBody(values, columns);
    const r = sampleRequestSchema.safeParse(body);
    if (r.success) { setErrors({}); setFormError(null); return body; }
    const errs = {};
    for (const i of r.error.issues) { const p = i.path.join('.') || 'form'; if (!errs[p]) errs[p] = i.message; }
    setErrors(mapErrors(errs));
    setFormError({ form: `Please correct ${Object.keys(errs).length === 1 ? 'the field' : `the ${Object.keys(errs).length} fields`} marked below. Nothing was saved.` });
    return null;
  };
  const failed = (err) => { const s = showServerError(err); setErrors(mapErrors(s.fields)); };

  const save = async ({ thenSubmit = false } = {}) => {
    setNotice('');
    const body = check();
    if (!body) return;
    setBusy(thenSubmit ? 'submit' : 'save');
    try {
      let saved = rec && !dirty ? rec : id ? await actions.update(id, { ...body, version: rec.version }) : await actions.create(body);
      if (thenSubmit) saved = await actions.submit(saved.id, saved.version);
      draft.consumed();
      reset(fromRecord(saved));
      setNotice(thenSubmit ? `Submitted as ${saved.docNo}.` : `Saved. Total ${formatNumberInput(saved.total)} for ${saved.lineCount} item(s), as calculated by the server.`);
      onDone(saved.id, thenSubmit ? `Submitted as ${saved.docNo}.` : 'Saved as a draft request.');
    } catch (err) {
      failed(err);
    } finally {
      setBusy('');
    }
  };
  const saveDraft = async () => { setNotice(''); const d = await draft.save('manual'); if (d) { markSaved(); setNotice('Draft kept. You can close this page and resume it later from My Drafts.'); } };
  const leave = () => onDone(id ?? null, null);

  // dependent lookups and defaults from masters (FR-04, FR-05)
  const onProject = (v) => update((cur) => ({ ...cur, projectId: v, siteId: '', costCentreId: '' }));
  const onSite = (v, row) => update((cur) => ({ ...cur, siteId: v, costCentreId: '', ...(row?.extra?.projectId && !cur.projectId ? { projectId: row.extra.projectId } : {}) }));

  // a site that came from the working context gets its cost centre as well (default "firstOfParent")
  useEffect(() => {
    if (readOnly || !values.siteId || values.costCentreId) return undefined;
    let live = true;
    fetchLookup('iam/cost-centres', { parent: values.siteId, pageSize: 1 }).then((cc) => {
      if (live && cc?.data?.[0]) update((cur) => (String(cur.siteId) === String(values.siteId) && !cur.costCentreId ? { ...cur, costCentreId: cc.data[0].id } : cur));
    }).catch(() => {});
    return () => { live = false; };
  }, [values.siteId, values.costCentreId, readOnly, update]);

  if (id && record.isPending) return <QueryState query={record} what="the request" permission="core.sample.use" />;
  if (id && record.isError) return <QueryState query={record} what="the request" permission="core.sample.use" />;
  const field = (name) => {
    const f = def.fields[name];
    if (!isShown(f, values)) return null;
    if (name === 'requestedBy') return <ReadOnlyField key={name} id="f-requestedBy" label={f.label} text={rec ? rec.requestedBy : ctx.user} />;
    const onChange = name === 'projectId' ? onProject : name === 'siteId' ? (v) => { if (!v) onSite('', null); } : (v) => set(name, v);
    return (
      <MetaField key={name} name={name} def={f} value={values[name]} onChange={onChange} onPick={name === 'siteId' ? (row) => onSite(row ? row.id : '', row) : undefined}
        onBlur={draft.onBlur} error={errors[name]} readOnly={readOnly} parentValue={f.parent ? values[f.parent] : undefined} parentLabel={f.parent ? def.fields[f.parent].label.toLowerCase() : undefined} siteId={values.siteId || undefined} />
    );
  };
  const title = rec ? `Change ${rec.docNo ?? `draft request #${rec.id}`}` : 'New sample material request';
  return (
    <section aria-labelledby="form-title" className="ff-form" data-testid="request-form">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Reference &rsaquo; <a href="/admin/sample-requests" onClick={(e) => { e.preventDefault(); onDone(null); }}>Sample Material Requests</a> &rsaquo; {title}</nav>
      <div className="page-head">
        <h1 id="form-title">{title}</h1>
        {rec && <StatusBadge status={rec.status} />}
        <span className="spacer" />
        <span className="muted small">Financial year {ctx.financialYear}{rec?.submittedAt ? ` · submitted ${formatDateTime(rec.submittedAt)}` : ''}</span>
      </div>
      {createdNote && <p className="ff-note" role="status"><Icon name="erp.action.info" size={16} /> {createdNote}</p>}
      {!readOnly && <DraftBanner draft={draft} onResume={() => { const p = draft.resume(); if (p) reset(p, { asSaved: false }); }} onDiscard={() => draft.discard()} />}
      <p role="status" className="notice" data-testid="form-notice">{notice}</p>
      <ErrorSummary formError={formError} errors={errors} labelOf={labelOf} />
      {!readOnly && <DuplicateWarning check={def.duplicateCheck} fields={{ title: values.title, projectId: values.projectId, docDate: values.docDate, excludeId: id ?? '' }} />}
      <form noValidate onSubmit={(e) => { e.preventDefault(); save(); }} onBlur={draft.onBlur}>
        {def.sections.map((s) => (s.grid
          ? (
            <section key={s.id} className="ff-section" aria-labelledby={`${s.id}-title`}>
              <h2 className="ff-section-title" id={`${s.id}-title`}>{s.title}</h2>
              <LineGrid id="lines" label={def.grids.lines.label} columns={columns.map((c) => (c.type === 'lookup' ? { ...c, valueKey: 'code' } : c))} rows={values.lines} onChange={(rows) => set('lines', rows)} errors={errors} maxRows={def.grids.lines.maxRows} readOnly={readOnly} onBlur={draft.onBlur}
                rowExtra={rec ? (row) => (row.id ? <button type="button" className="btn btn-small" onClick={() => setRowFiles(row)} aria-label={`Files of row ${row.description}`}><Icon name="erp.action.attach" size={16} />Files</button> : <span className="muted small">Save first</span>) : undefined} />
              {!readOnly && itemsOn && <p><button type="button" className="btn btn-small" onClick={() => setPicking(true)} data-testid="lines-from-catalogue"><Icon name="erp.action.search" size={16} /> Add items from the catalogue</button></p>}
              {itemsOn && <ItemSelector open={picking} onClose={() => setPicking(false)} types={['MATERIAL', 'CONSUMABLE', 'SPARE', 'TOOL', 'RETURNABLE']}
                onPick={(list) => set('lines', [...values.lines.filter((l) => Object.entries(l).some(([k, x]) => !['_k', 'id'].includes(k) && x !== '' && x != null)), ...list.map((it) => newRow({ description: `${it.code} ${it.name}`.slice(0, 200), uom: it.uom, quantity: '', unitRate: it.standardRate ?? '', neededOn: '', comment: '' }))])} />}
              {errors.total && <p className="ff-error" role="alert" id="f-total">{errors.total}</p>}
            </section>
          )
          : <FormSection key={s.id} id={s.id} title={s.title} columns={s.columns} collapsible={s.collapsible}>{s.fields.map(field)}</FormSection>))}
        <ActionBar status={readOnly ? `This request is ${rec.status.toLowerCase()} and can no longer be changed.` : draftStatus(draft, dirty)}>
          {!readOnly && <button type="button" className="btn" onClick={saveDraft} disabled={Boolean(busy) || !dirty}><Icon name="erp.state.draft" size={16} />Save draft</button>}
          {!readOnly && <button type="submit" className="btn" disabled={Boolean(busy)}><Icon name="erp.action.save" size={16} />{busy === 'save' ? 'Saving...' : 'Save'}</button>}
          {!readOnly && <button type="button" className="btn btn-primary" onClick={() => save({ thenSubmit: true })} disabled={Boolean(busy)}><Icon name="erp.action.submit" size={16} />{busy === 'submit' ? 'Submitting...' : 'Submit'}</button>}
          <button type="button" className="btn" onClick={leave}>{id ? 'Back to the request' : 'Back to the list'}</button>
        </ActionBar>
      </form>
      <p className="muted small">Documents, photos and drawings are attached on the request's Attachments tab once it is saved.</p>
      {rowFiles && (
        <dialog open className="dialog" aria-labelledby="row-files-title">
          <h2 id="row-files-title">Files of row: {rowFiles.description}</h2>
          <FileUploader entity="sample_request_line" entityId={rowFiles.id} disabled={readOnly && rec?.status === 'CANCELLED'} />
          <AttachmentList entity="sample_request_line" entityId={rowFiles.id} canEdit={!readOnly} />
          <div className="actions"><button type="button" className="btn" onClick={() => setRowFiles(null)}>Close</button></div>
        </dialog>
      )}
    </section>
  );
}

const APPROVAL_LABEL = { APPROVED: 'Approved', REJECTED: 'Rejected', RETURNED: 'Returned', CANCELLED: 'Withdrawn' };
const showMoney = (v) => (/^•+$/.test(String(v)) ? v : formatNumberInput(v));

/** A request on the Object Page (part 03.04, AC-01): header, key figures, the buttons the server allows, and every tab. */
function RequestObject({ def, id, notice, onEdit, onBack }) {
  const toast = useToast();
  const query = useSampleRequest(id);
  const actions = useSampleRequestActions();
  const rec = query.data;
  const values = useMemo(() => (rec ? fromRecord(rec) : null), [rec]);
  const [rowFiles, setRowFiles] = useState(null);
  const columns = useMemo(() => def.grids.lines.columns.map((c) => (c.type === 'lookup' ? { ...c, valueKey: 'code' } : c)), [def]);
  const told = useRef(false); // the notice of the save that brought us here is shown once, though React may run the effect twice
  useEffect(() => { if (notice && !told.current) { told.current = true; toast.success(notice); } }, []);
  const onAction = async (action, p) => {
    if (action.id === 'submit') return actions.submit(id, rec.version);
    if (action.id === 'cancel') return actions.cancel(id, rec.version, p.reason, p.reasonCode);
    return actions.decide(id, { action: action.id, reasonCode: p.reasonCode, comment: p.reason, version: rec.approval.version });
  };
  const details = (r) => (
    <div data-testid="request-details">
      {r.status === 'DRAFT' && r.approval?.status === 'RETURNED' && <Banner tone="warning" title="Returned for changes." testId="returned-banner">An approver sent this request back. Read the reason on the Approvals tab, change the request and submit it again; it keeps its number.</Banner>}
      {r.status === 'CANCELLED' && <Banner tone="info" title="Cancelled." testId="cancelled-banner">{r.docNo ? `${r.docNo} keeps its number.` : 'It never got a number.'} A cancelled request cannot be changed or submitted.</Banner>}
      {def.sections.filter((x) => !x.grid).map((sec) => (
        <FormSection key={sec.id} id={sec.id} title={sec.title} columns={sec.columns}>
          {sec.fields.map((name) => {
            const fd = def.fields[name];
            if (!isShown(fd, values)) return null;
            if (name === 'requestedBy') return <ReadOnlyField key={name} id="f-requestedBy" label={fd.label} text={r.requestedBy} />;
            return <MetaField key={name} name={name} def={fd} value={values[name]} onChange={() => {}} readOnly />;
          })}
        </FormSection>
      ))}
    </div>
  );
  const lines = (r) => (
    <div data-testid="request-lines">
      <LineGrid id="lines" label={def.grids.lines.label} columns={columns} rows={r.lines.map((l) => newRow({ id: l.id, description: l.description, uom: l.uom, quantity: l.quantity, unitRate: l.unitRate, amount: l.amount, neededOn: l.neededOn ?? '', comment: l.comment ?? '' }))} onChange={() => {}} readOnly maxRows={def.grids.lines.maxRows}
        rowExtra={(row) => (row.id ? <button type="button" className="btn btn-small" onClick={() => setRowFiles(row)} aria-label={`Files of row ${row.description}`}><Icon name="erp.action.attach" size={16} />Files</button> : null)} />
      {rowFiles && (
        <dialog open className="dialog" aria-labelledby="row-files-title">
          <h2 id="row-files-title">Files of row: {rowFiles.description}</h2>
          <FileUploader entity="sample_request_line" entityId={rowFiles.id} disabled={rec?.status === 'CANCELLED'} />
          <AttachmentList entity="sample_request_line" entityId={rowFiles.id} canEdit={rec?.status !== 'CANCELLED'} />
          <div className="actions"><button type="button" className="btn" onClick={() => setRowFiles(null)}>Close</button></div>
        </dialog>
      )}
    </div>
  );
  return (
    <ObjectPage type="sample_request" id={id} query={query} title="Request" section="Administration &rsaquo; Reference" listLabel="Sample Material Requests" listPath="/admin/sample-requests"
      heading={(r) => r.docNo ?? `Draft request #${r.id}`} subtitle={(r) => r.title}
      chips={(r) => [{ status: r.status, label: r.status === 'DRAFT' ? 'Draft' : r.status === 'SUBMITTED' ? 'Submitted' : 'Cancelled' }, ...(r.approval && r.status !== 'CANCELLED' ? [r.approval.status === 'SUBMITTED' ? { status: 'IN_REVIEW', label: `Awaiting ${r.approval.chain[r.approval.currentStep - 1].replace('|', ' or ')}` } : { status: r.approval.status === 'CANCELLED' ? 'CANCELLED' : r.approval.status, label: APPROVAL_LABEL[r.approval.status] }] : [])]}
      figures={(r) => [{ label: 'Total (₹)', value: showMoney(r.total) }, { label: 'Items', value: r.lineCount }, { label: 'Required by', value: formatBusinessDate(r.requiredBy) }, { label: 'Project / site', value: `${r.projectCode}${r.siteCode ? ` / ${r.siteCode}` : ''}` }]}
      meta={(r) => [{ label: 'Requested by', value: r.requestedBy }, { label: 'Request date', value: formatBusinessDate(r.docDate) }, { label: 'Created', value: formatDateTime(r.createdAt) }, ...(r.submittedAt ? [{ label: 'Submitted', value: formatDateTime(r.submittedAt) }] : []), { label: 'Priority', value: r.priority === 'URGENT' ? 'Urgent' : 'Normal' }]}
      renderDetails={details} renderLines={lines} attachmentEntity="sample_request" onAction={onAction} onEdit={onEdit} onBack={onBack} navigate={navigateTo} />
  );
}

/**
 * The register on the List Report component (part 03.03, AC-01): search, status chips, "my records", date presets, the filter builder,
 * saved views, the column chooser, totals of the whole filtered set, bulk submit and cancel, exports and cards on a phone.
 */
function RequestList({ onOpen, onNew, notice, session }) {
  const bulk = useSampleRequestBulk();
  const contextFilters = contextFiltersFor(useWorkContext());
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Reference &rsaquo; Sample Material Requests</nav>
      <div className="page-head"><h1 id="page-title">Sample Material Requests</h1></div>
      <p className="muted">The reference register of the List Report and of the data-entry framework: filter, save a view, choose columns, select requests to submit or cancel together, and export the current view to Excel, CSV or PDF. A new request fills itself from your working project and site.</p>
      {notice && <p role="status" className="notice">{notice}</p>}
      <ListReport
        listCode="ui.sample_requests" endpoint="/ui/sample-requests" title="Requests" permission="core.sample.use" session={session} contextFilters={contextFilters}
        rowHref={(r) => `/admin/sample-requests?open=${r.id}`} onOpen={(r) => onOpen(r.id)}
        cardFields={['docNo', 'title', 'status', 'projectCode', 'docDate', 'total']}
        statusKey="status" mineFilter={{ key: 'requestedBy' }} dateKey="docDate"
        newAction={{ label: 'New request', onClick: onNew, permission: 'core.sample.use' }}
        empty={{ title: 'No sample material requests yet', text: 'Start one to see context auto-fill, dependent lookups, the line grid and drafts working.' }}
        bulkActions={[
          { id: 'submit', label: 'Submit selected', permission: 'core.sample.use', confirm: (n) => `Submit ${n} request(s)? Each draft gets its number; requests that are not drafts are left as they are.`, run: (ids) => bulk('submit', ids) },
          { id: 'cancel', label: 'Cancel selected', permission: 'core.sample.use', reasonFor: 'cancel', confirm: (n) => `Cancel ${n} request(s)? Only the person who raised a request can cancel it; numbered requests keep their numbers.`, run: (ids, p) => bulk('cancel', ids, p) },
        ]}
        rowActions={(r) => [
          { label: 'Open', onSelect: () => onOpen(r.id) },
          { label: 'Open in a new tab', onSelect: () => window.open(`/admin/sample-requests?open=${r.id}`, '_blank', 'noopener') },
          { label: 'Submit', disabled: r.status !== 'DRAFT', onSelect: () => bulk('submit', [r.id]) },
        ]}
      />
    </section>
  );
}

const readView = () => {
  const p = params();
  if (p.get('open')) return { mode: 'open', id: Number(p.get('open')) };
  if (p.get('edit')) return { mode: 'edit', id: Number(p.get('edit')) };
  if (p.get('new')) return { mode: 'new', id: null };
  return null;
};

export default function SampleRequestsPage({ session }) {
  usePageTitle('Sample Material Requests');
  const def = useFormDefinition(SAMPLE_REQUEST_FORM);
  const [view, setView] = useState(readView);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const onPop = () => setView(readView());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (path, next, force = false) => { if (navigateTo(path, { force })) setView(next); };
  const open = (id, message = '', force = false) => { setNotice(message ?? ''); go(`/admin/sample-requests?open=${id}`, { mode: 'open', id }, force); };
  const definition = useMemo(() => def.data, [def.data]);
  if (!definition) return <QueryState query={def} what="the form definition" permission="a signed-in account" />;
  if (view?.mode === 'open') return <RequestObject key={view.id} def={definition} id={view.id} notice={notice} onEdit={() => go(`/admin/sample-requests?edit=${view.id}`, { mode: 'edit', id: view.id })} onBack={() => { setNotice(''); go('/admin/sample-requests', null); }} />;
  if (view) {
    return (
      <RequestForm key={`${view.mode}-${view.id ?? 'new'}`} def={definition} id={view.id}
        initialNotice="" onDone={(savedId, message) => { if (savedId) open(savedId, message, true); else { setNotice(''); go('/admin/sample-requests', null); } }} />
    );
  }
  return <RequestList session={session} notice={notice} onOpen={(id) => open(id)} onNew={() => go('/admin/sample-requests?new=1', { mode: 'new', id: null })} />;
}
