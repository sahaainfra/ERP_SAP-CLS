import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { Tabs } from '../proj/parts.jsx';
import { RESPONSES, SUB_TONE, openPrint, sb } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Submittal (part 11.03): the submittal with its revisions and the responses of the consultant, its documents and the approved make.
const TABS = ['details', 'revisions', 'files'];
export default function SubmittalPage() {
  const t = useT('engg');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['engg', 'submittal', id], queryFn: () => sb.get(id), enabled: Boolean(id), retry: false });
  const [tab, setTab] = useState('details'); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [uploaded, setUploaded] = useState(0); const [resp, setResp] = useState({ code: 'A', text: '' }); const [change, setChange] = useState('');
  usePageTitle(q.data ? `${q.data.submittalNo} ${q.data.title}` : t('sub.title'));
  if (!id) return <section aria-labelledby="sub-h" data-testid="sub-none"><PageHeader id="sub-h" title={t('sub.title')} subtitle={<Link to="/engg/submittals">{t('nav.submittals')}</Link>} /></section>;
  if (q.error?.status === 403) return <NoPermission what={t('nav.submittals')} permission="engg.submittal.view" />;
  if (q.isPending) return <Skeleton label={t('sub.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const s = q.data; const c = s.can;
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['engg'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  return (
    <section aria-labelledby="sub-h" data-testid="submittal" data-status={s.status} data-revision={s.revision}>
      <header>
        <PageHeader id="sub-h" title={<>{s.submittalNo} · {s.title} <StatusBadge status={SUB_TONE[s.status]} label={t(`subs.${s.status}`)} /></>} subtitle={<>{s.projectCode} · {t(`stype.${s.type}`)} · {t('f.revision')} {s.revision} · {t('rfi.requiredBy')} {s.requiredBy}{s.overdue ? ` · ${t('dwg.overdue')}` : ''}{s.responseCode ? ` · ${t('sub.response')}: ${s.responseLabel}` : ''}</>} />
        {error?.form && <p className="field-error" role="alert" data-testid="sub-act-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="sub-note">{note}</p>}
        <div className="actions-row no-print">
          {c.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => sb.act(s.id, 'submit'), t('sub.sent'))} data-testid="sub-submit">{t('sub.send')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((x) => sb.act(s.id, 'withdraw', { reason: x }), t('rev.withdrawn'))} data-testid="sub-withdraw">{t('act.withdraw')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((x) => sb.act(s.id, 'cancel', { reason: x }), t('sub.cancelled'))} data-testid="sub-cancel">{t('act.cancel')}</button>}
          {c.amend && <button type="button" className="btn" onClick={() => why((x) => sb.act(s.id, 'amend', { reason: x }), t('sub.amended'))} data-testid="sub-amend">{t('act.amend')}</button>}
          {c.delete && <button type="button" className="btn" onClick={async () => { if (await run(() => sb.remove(s.id))) navigateTo('/engg/submittals'); }} data-testid="sub-delete">{t('act.delete')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => openPrint(`/submittals/${s.id}/print`, `${s.submittalNo}.html`)} data-testid="sub-print">{t('act.print')}</button>}
          {s.workflowInstanceId && <Link to={`/workflow/instance?id=${s.workflowInstanceId}`}>{t('rev.approval')}</Link>}
        </div>
      </header>
      {c.respond && (
        <form className="mdm-panel" aria-label={t('sub.recordResponse')} data-testid="sub-response-form" onSubmit={(e) => { e.preventDefault(); run(() => sb.act(s.id, 'respond', { code: resp.code, text: resp.text.trim() || null }), t('sub.responded')); }}>
          <h2>{t('sub.recordResponse')}</h2>
          <div className="form-grid">
            <Field label={t('sub.response')} name="code" error={error}><select value={resp.code} onChange={(e) => setResp({ ...resp, code: e.target.value })} data-testid="sub-code">{RESPONSES.map((k) => <option key={k} value={k}>{k} {t(`sresp.${k}`)}</option>)}</select></Field>
            <Field label={t('tx.comments')} name="text" error={error}><textarea value={resp.text} onChange={(e) => setResp({ ...resp, text: e.target.value })} rows={3} maxLength={2000} data-testid="sub-comment" /></Field>
          </div>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="sub-record">{t('sub.record')}</button></div>
        </form>
      )}
      {c.resubmit && (
        <form className="mdm-panel" aria-label={t('sub.resubmit')} data-testid="sub-resubmit-form" onSubmit={(e) => { e.preventDefault(); run(() => sb.act(s.id, 'resubmit', { changeNote: change.trim() }), t('sub.revisionMade')); }}>
          <h2>{t('sub.resubmit')}</h2>
          <Field label={t('f.changeNote')} name="changeNote" error={error}><input value={change} onChange={(e) => setChange(e.target.value)} maxLength={2000} data-testid="sub-change" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={change.trim().length < 5} data-testid="sub-resubmit">{t('sub.makeRevision')}</button></div>
        </form>
      )}
      <Tabs tabs={TABS} active={tab} onChange={setTab} label={t('sub.title')} labelOf={(k) => t(`subt.${k}`)} />
      {tab === 'details' && (
        <div className="mdm-panel" data-testid="sub-details"><dl>
          <dt>{t('sub.spec')}</dt><dd>{s.specSection || '—'}</dd><dt>{t('f.activity')}</dt><dd>{s.activityRef || '—'}</dd>
          <dt>{t('sub.item')}</dt><dd>{s.itemCode ? `${s.itemCode} · ${s.itemName}` : s.materialRef || '—'}</dd><dt>{t('sub.make')}</dt><dd>{[s.make, s.model].filter(Boolean).join(' ') || '—'}</dd><dt>{t('sub.supplier')}</dt><dd>{s.supplier || '—'}</dd>
          <dt>{t('rfi.consultant')}</dt><dd>{s.consultant || '—'}</dd><dt>{t('sub.hse')}</dt><dd>{s.hseRef || '—'}</dd><dt>{t('rfi.drawing')}</dt><dd>{s.drawingId ? <Link to={`/engg/drawing?id=${s.drawingId}`}>{s.drawingNo}</Link> : '—'}</dd>
          <dt>{t('sub.needDate')}</dt><dd>{s.needDate || '—'} ({t('sub.leadTime')} {s.leadTimeDays}, {t('sub.reviewDays')} {s.reviewDays})</dd>
          <dt>{t('sub.internalApprover')}</dt><dd>{t(`appr.${s.internalApprover}`)}</dd>
          {s.approvedMake && <><dt>{t('sub.approvedMake')}</dt><dd data-testid="sub-make">{s.approvedMake.make} {s.approvedMake.model} · {s.approvedMake.code} · {s.approvedMake.status === 'ACTIVE' ? t('sub.makeActive') : t('sub.makeWithdrawn')}</dd></>}
        </dl></div>
      )}
      {tab === 'revisions' && (
        <div className="mdm-panel" data-testid="sub-revisions"><h2>{t('subt.revisions')}</h2>
          <div className="table-scroll"><table><thead><tr><th>{t('f.revision')}</th><th>{t('sub.submittedOn')}</th><th>{t('sub.response')}</th><th>{t('tx.comments')}</th><th>{t('f.changeNote')}</th></tr></thead>
            <tbody>{s.revisions.map((v) => <tr key={v.id} data-testid={`sub-rev-${v.revNo}`}><td>{v.revNo}</td><td>{v.submittedOn ?? '—'}</td><td>{v.responseLabel ?? t('sub.waiting')}{v.responseOn ? ` (${v.responseOn})` : ''}</td><td>{v.responseText ?? '—'}</td><td>{v.changeNote ?? '—'}</td></tr>)}</tbody></table></div></div>
      )}
      {tab === 'files' && (
        <div className="mdm-panel" data-testid="sub-files"><h2>{t('rfit.files')}</h2>
          {(c.edit || c.respond) && <FileUploader entity="engg_submittal" entityId={s.id} onDone={() => { setUploaded((n) => n + 1); qc.invalidateQueries({ queryKey: ['engg'] }); }} />}
          <AttachmentList key={uploaded} entity="engg_submittal" entityId={s.id} canEdit={c.edit || c.respond} onReplace={() => {}} /></div>
      )}
    </section>
  );
}
