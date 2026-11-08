import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { REV_TONE, STATUS_CODES, TX_TONE, eg, openPrint } from './api.js';
import { Tabs } from '../proj/parts.jsx';
import { FileView, useSearch } from './parts.jsx';

// Drawing (part 11.01, FR-01 to FR-05): the drawing with its revisions, the comparison viewer, the transmittals it is on, its links, its controlled copies and its RFIs. A superseded revision is marked and its file is closed to the site.
const TABS = ['revisions', 'compare', 'transmittals', 'links', 'copies', 'rfis'];
export default function DrawingPage() {
  const t = useT('engg');
  const qc = useQueryClient();
  const params = useSearch(); const revisionParam = Number(params.get('revision')) || null; const idParam = Number(params.get('id')) || null;
  const rq = useQuery({ queryKey: ['engg', 'revision', revisionParam], queryFn: () => eg.revision(revisionParam), enabled: Boolean(revisionParam && !idParam), retry: false });
  const id = idParam ?? rq.data?.drawingId ?? null;
  const q = useQuery({ queryKey: ['engg', 'drawing', id], queryFn: () => eg.drawing(id), enabled: Boolean(id), retry: false });
  const h = useQuery({ queryKey: ['engg', 'drawing-history', id], queryFn: () => eg.drawingHistory(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [tab, setTab] = useState('revisions'); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [form, setForm] = useState(null);
  const [cmp, setCmp] = useState({ from: '', to: '' }); const [amend, setAmend] = useState({ label: '', statusCode: 'IFC', changeNote: '', cloudSummary: '' }); const [dist, setDist] = useState({ revisionId: '', users: '' });
  usePageTitle(q.data ? `${q.data.drawingNo} ${q.data.title}` : t('dwg.title'));
  const compare = useQuery({ queryKey: ['engg', 'compare', cmp.from, cmp.to], queryFn: () => eg.compare(cmp.from, cmp.to), enabled: Boolean(cmp.from && cmp.to && cmp.from !== cmp.to), retry: false });
  if (!id && !revisionParam) return <section aria-labelledby="dwg-h" data-testid="dwg-none"><h1 id="dwg-h">{t('dwg.title')}</h1><p className="muted"><Link to="/engg/drawings">{t('nav.drawings')}</Link></p></section>;
  if (q.error?.status === 403 || rq.error?.status === 403) return <NoPermission what={t('nav.drawings')} permission="engg.drawing.view" />;
  if (q.isPending || (revisionParam && !id && rq.isPending)) return <Skeleton label={t('dwg.title')} rows={5} />;
  if (q.isError || rq.isError) return <ErrorState error={q.error ?? rq.error} onRetry={q.refetch} />;
  const d = q.data; const c = d.can;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['engg'] }); } catch (e) { setError(errorInfo(e)); } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const revs = d.revisions; const drafts = revs.some((r) => ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status));
  const startEdit = () => setForm({ title: d.title, packageName: d.packageName ?? '', scale: d.scale ?? '', plannedReceipt: d.plannedReceipt ?? '', originator: d.originator ?? '' });
  const save = (e) => { e.preventDefault(); run(async () => { await eg.updateDrawing(d.id, { title: form.title.trim(), packageName: form.packageName.trim() || null, scale: form.scale.trim() || null, plannedReceipt: form.plannedReceipt || null, originator: form.originator.trim() || null, rowVersion: d.rowVersion }); setForm(null); }, t('dwg.saved')); };
  const makeRevision = (e) => { e.preventDefault(); run(async () => { await eg.drawingAct(d.id, 'amend', { label: amend.label.trim(), statusCode: amend.statusCode, changeNote: amend.changeNote.trim(), cloudSummary: amend.cloudSummary.trim() || null }); setAmend({ label: '', statusCode: 'IFC', changeNote: '', cloudSummary: '' }); }, t('dwg.revisionMade')); };
  const distribute = (e) => { e.preventDefault(); const users = dist.users.split(/[,\s]+/).filter(Boolean); run(() => eg.drawingAct(d.id, 'distribute', { revisionId: Number(dist.revisionId), holders: users.map((u) => ({ user: u })) }), t('dwg.distributed')); };
  const issued = revs.filter((r) => r.status === 'ISSUED');
  return (
    <section aria-labelledby="dwg-h" data-testid="drawing" data-status={d.registerStatus} data-usable={d.usable ? '1' : '0'}>
      <header>
        <h1 id="dwg-h">{d.drawingNo} · {d.title} {d.registerStatus === 'CANCELLED' ? <StatusBadge status="CANCELLED" label={t('dwg.cancelled')} /> : d.usable ? <StatusBadge status="APPROVED" label={t('dwg.currentIfc')} /> : <StatusBadge status="DRAFT" label={t('dwg.noIfc')} />}</h1>
        <p className="muted">{d.projectCode} · {t(`disc.${d.discipline}`)}{d.packageName ? ` · ${d.packageName}` : ''}{d.scale ? ` · ${d.scale}` : ''}{d.sheetSize ? ` · ${d.sheetSize}` : ''} · {t(`orig.${d.originatorType}`)}{d.originator ? ` (${d.originator})` : ''}</p>
        <p data-testid="dwg-current">{t('dwg.current')}: <strong>{d.currentRevision ?? '—'}</strong> {d.currentStatusCode ? t(`code.${d.currentStatusCode}`) : ''}{d.responseCode ? ` · ${t('dwg.response')}: ${d.responseLabel}` : ''}{d.overdue ? ` · ${t('dwg.overdue')}` : ''}</p>
        {error?.form && <p className="field-error" role="alert" data-testid="dwg-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="dwg-note">{note}</p>}
        <div className="actions-row no-print">
          {c.edit && <button type="button" className="btn" onClick={startEdit} data-testid="dwg-edit">{t('act.edit')}</button>}
          {c.cancel && !drafts && <button type="button" className="btn" onClick={() => why((r) => eg.drawingAct(d.id, 'cancel', { reason: r }), t('dwg.cancelledNote'))} data-testid="dwg-cancel">{t('act.cancelDrawing')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => openPrint(`/drawings/${d.id}/print`, `${d.drawingNo}.html`)} data-testid="dwg-print">{t('act.print')}</button>}
        </div>
      </header>
      {form && (
        <form className="mdm-panel" aria-label={t('act.edit')} data-testid="dwg-edit-form" onSubmit={save}>
          <div className="form-grid">
            <Field label={t('col.title')} name="title" error={error}><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} data-testid="dwg-f-title" /></Field>
            <Field label={t('col.package')} name="packageName" error={error}><input value={form.packageName} onChange={(e) => setForm({ ...form, packageName: e.target.value })} maxLength={80} /></Field>
            <Field label={t('f.scale')} name="scale" error={error}><input value={form.scale} onChange={(e) => setForm({ ...form, scale: e.target.value })} maxLength={20} /></Field>
            <Field label={t('f.originator')} name="originator" error={error}><input value={form.originator} onChange={(e) => setForm({ ...form, originator: e.target.value })} maxLength={120} /></Field>
            <Field label={t('col.planned')} name="plannedReceipt" error={error}><input type="date" value={form.plannedReceipt} onChange={(e) => setForm({ ...form, plannedReceipt: e.target.value })} /></Field>
          </div>
          <div className="actions"><button type="button" className="btn" onClick={() => setForm(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="dwg-save">{t('act.save')}</button></div>
        </form>
      )}
      <Tabs tabs={TABS} active={tab} onChange={setTab} label={t('dwg.title')} labelOf={(k) => t(`tab.${k}`)} />
      {tab === 'revisions' && (
        <div data-testid="dwg-revisions">
          {c.amend && !drafts && (
            <form className="mdm-panel" aria-label={t('rev.new')} data-testid="dwg-amend-form" onSubmit={makeRevision}>
              <h2>{t('rev.new')}</h2>
              <div className="form-grid">
                <Field label={t('f.revision')} name="label" error={error}><input value={amend.label} onChange={(e) => setAmend({ ...amend, label: e.target.value })} required maxLength={10} data-testid="rev-f-label" /></Field>
                <Field label={t('f.statusCode')} name="statusCode" error={error}><select value={amend.statusCode} onChange={(e) => setAmend({ ...amend, statusCode: e.target.value })} data-testid="rev-f-code">{STATUS_CODES.map((k) => <option key={k} value={k}>{t(`code.${k}`)}</option>)}</select></Field>
                <Field label={t('f.changeNote')} name="changeNote" error={error}><input value={amend.changeNote} onChange={(e) => setAmend({ ...amend, changeNote: e.target.value })} required maxLength={2000} data-testid="rev-f-note" /></Field>
                <Field label={t('f.cloud')} name="cloudSummary" error={error}><input value={amend.cloudSummary} onChange={(e) => setAmend({ ...amend, cloudSummary: e.target.value })} maxLength={2000} data-testid="rev-f-cloud" /></Field>
              </div>
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={!amend.label.trim() || amend.changeNote.trim().length < 5} data-testid="rev-create">{t('rev.create')}</button></div>
            </form>
          )}
          {revs.map((r) => (
            <article key={r.id} className="mdm-panel" data-testid={`rev-${r.label}`} data-status={r.status}>
              <h2>{t('f.revision')} {r.label} · {t(`code.${r.statusCode}`)} <StatusBadge status={REV_TONE[r.status]} label={r.statusLabel} /></h2>
              {r.banner && <p className="field-error" role="status" data-testid={`rev-banner-${r.label}`}><strong>{r.banner}</strong></p>}
              <p className="muted">{r.issuedOn ? `${t('rev.issuedOn')}: ${r.issuedOn}` : ''}{r.receivedOn ? ` · ${t('rev.receivedOn')}: ${r.receivedOn}` : ''}{r.requestedBy ? ` · ${t('rev.sentBy')}: ${r.requestedBy}` : ''}</p>
              <dl><dt>{t('f.changeNote')}</dt><dd>{r.changeNote || '—'}</dd><dt>{t('f.cloud')}</dt><dd>{r.cloudSummary || '—'}</dd></dl>
              {r.fileHidden ? <p className="muted" data-testid={`rev-hidden-${r.label}`}>{t('rev.fileClosed')}</p> : <FileView file={r.file} testId={`rev-file-${r.label}`} />}
              {r.can.edit && <FileUploader entity="engg_drawing_revision" entityId={r.id} onDone={() => qc.invalidateQueries({ queryKey: ['engg'] })} />}
              {(r.can.edit || r.file) && !r.fileHidden && r.status !== 'SUPERSEDED' && r.status !== 'ISSUED' && <AttachmentList entity="engg_drawing_revision" entityId={r.id} canEdit={r.can.edit} onReplace={() => {}} />}
              <div className="actions-row no-print">
                {r.can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => eg.revisionAct(r.id, 'submit'), r.needsApproval ? t('rev.sentForApproval') : t('rev.issued'))} data-testid={`rev-submit-${r.label}`}>{r.needsApproval ? t('rev.submitIfc') : t('rev.issue')}</button>}
                {r.can.withdraw && <button type="button" className="btn" onClick={() => why((x) => eg.revisionAct(r.id, 'withdraw', { reason: x }), t('rev.withdrawn'))} data-testid={`rev-withdraw-${r.label}`}>{t('act.withdraw')}</button>}
                {r.can.cancel && <button type="button" className="btn" onClick={() => why((x) => eg.revisionAct(r.id, 'cancel', { reason: x }), t('rev.cancelled'))} data-testid={`rev-cancel-${r.label}`}>{t('act.cancel')}</button>}
                {r.can.delete && <button type="button" className="btn" onClick={() => run(() => eg.removeRevision(r.id), t('rev.deleted'))} data-testid={`rev-delete-${r.label}`}>{t('act.delete')}</button>}
                {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('rev.approval')}</Link>}
              </div>
            </article>
          ))}
          <div className="mdm-panel" data-testid="dwg-history"><h2>{t('dwg.history')}</h2>
            <ol>{(h.data?.audit ?? []).map((a, n) => <li key={n}>{String(a.at).slice(0, 16).replace('T', ' ')} · {a.actor} · {a.action}{a.reason ? ` — ${a.reason}` : ''}</li>)}</ol></div>
        </div>
      )}
      {tab === 'compare' && (
        <div className="mdm-panel" data-testid="dwg-compare">
          <h2>{t('tab.compare')}</h2>
          <div className="form-grid">
            {['from', 'to'].map((k) => <Field key={k} label={t(`cmp.${k}`)} name={k}><select value={cmp[k]} onChange={(e) => setCmp({ ...cmp, [k]: e.target.value })} data-testid={`cmp-${k}`}><option value="">—</option>{revs.map((r) => <option key={r.id} value={r.id}>{r.label} · {t(`code.${r.statusCode}`)}</option>)}</select></Field>)}
          </div>
          {compare.data && (
            <>
              <table data-testid="cmp-diff"><thead><tr><th>{t('cmp.field')}</th><th>{compare.data.from.label}</th><th>{compare.data.to.label}</th></tr></thead>
                <tbody>{compare.data.differences.map((x) => <tr key={x.field}><td>{t(`cmp.f.${x.field}`)}</td><td>{String(x.from ?? '—')}</td><td>{String(x.to ?? '—')}</td></tr>)}</tbody></table>
              <div className="eg-side" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: '1rem' }}>
                <div data-testid="cmp-left"><h3>{compare.data.from.label}</h3>{compare.data.from.banner && <p className="field-error"><strong>{compare.data.from.banner}</strong></p>}{compare.data.from.fileHidden ? <p className="muted">{t('rev.fileClosed')}</p> : <FileView file={compare.data.from.file} testId="cmp-file-left" />}</div>
                <div data-testid="cmp-right"><h3>{compare.data.to.label}</h3>{compare.data.to.banner && <p className="field-error"><strong>{compare.data.to.banner}</strong></p>}{compare.data.to.fileHidden ? <p className="muted">{t('rev.fileClosed')}</p> : <FileView file={compare.data.to.file} testId="cmp-file-right" />}</div>
              </div>
            </>
          )}
          {revs.length < 2 && <p className="muted">{t('cmp.needTwo')}</p>}
        </div>
      )}
      {tab === 'transmittals' && (
        <div className="mdm-panel" data-testid="dwg-transmittals"><h2>{t('tab.transmittals')}</h2>
          {d.transmittals.length === 0 ? <p className="muted">{t('dwg.noTransmittals')}</p> : (
            <table><thead><tr><th>{t('col.docNo')}</th><th>{t('tx.direction')}</th><th>{t('tx.purpose')}</th><th>{t('f.revision')}</th><th>{t('col.status')}</th><th>{t('tx.response')}</th></tr></thead>
              <tbody>{d.transmittals.map((x) => <tr key={x.id}><td><Link to={`/engg/transmittal?id=${x.id}`}>{x.docNo}</Link></td><td>{t(`dir.${x.direction}`)}</td><td>{t(`purpose.${x.purpose}`)}</td><td>{x.revision}</td><td><StatusBadge status={TX_TONE[x.status]} label={t(`txs.${x.status}`)} /></td><td>{x.responseCode ?? '—'}</td></tr>)}</tbody></table>
          )}</div>
      )}
      {tab === 'links' && (
        <div className="mdm-panel" data-testid="dwg-links"><h2>{t('tab.links')}</h2>
          {d.links.length === 0 ? <p className="muted">{t('dwg.noLinks')}</p> : <ul>{d.links.map((l) => <li key={l.id}>{t(`link.${l.type}`)}: {l.ref}</li>)}</ul>}</div>
      )}
      {tab === 'copies' && (
        <div className="mdm-panel" data-testid="dwg-copies"><h2>{t('tab.copies')}</h2>
          {c.distribute && issued.length > 0 && (
            <form aria-label={t('copy.distribute')} data-testid="dwg-dist-form" onSubmit={distribute}>
              <div className="form-grid">
                <Field label={t('f.revision')} name="revisionId" error={error}><select value={dist.revisionId} onChange={(e) => setDist({ ...dist, revisionId: e.target.value })} data-testid="dist-revision"><option value="">—</option>{issued.map((r) => <option key={r.id} value={r.id}>{r.label} · {t(`code.${r.statusCode}`)}</option>)}</select></Field>
                <Field label={t('copy.holders')} name="holders" error={error}><input value={dist.users} onChange={(e) => setDist({ ...dist, users: e.target.value })} data-testid="dist-users" placeholder="user1, user2" /></Field>
              </div>
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={!dist.revisionId || !dist.users.trim()} data-testid="dist-send">{t('copy.distribute')}</button></div>
            </form>
          )}
          {d.copies.length === 0 ? <p className="muted">{t('copy.none')}</p> : (
            <table><thead><tr><th>{t('f.revision')}</th><th>{t('copy.holder')}</th><th>{t('col.status')}</th><th>{t('copy.ack')}</th></tr></thead>
              <tbody>{d.copies.map((x) => <tr key={x.id} data-status={x.status}><td>{x.revision}</td><td>{x.holder}</td><td>{x.banner ? <strong>{x.banner}</strong> : x.statusLabel}</td><td>{x.acknowledgedAt ? String(x.acknowledgedAt).slice(0, 10) : '—'}</td></tr>)}</tbody></table>
          )}</div>
      )}
      {tab === 'rfis' && <div className="mdm-panel" data-testid="dwg-rfis"><h2>{t('tab.rfis')}</h2><p className="muted">{t('dwg.rfiLater')}</p></div>}
      <p className="no-print"><Link to="/engg/drawings">{t('nav.drawings')}</Link>{' · '}<button type="button" className="btn" onClick={() => navigateTo(`/engg/transmittals?projectId=${d.projectId}`)} data-testid="dwg-to-tx">{t('nav.transmittals')}</button></p>
    </section>
  );
}
