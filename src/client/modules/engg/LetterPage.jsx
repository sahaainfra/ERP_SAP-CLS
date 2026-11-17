import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { Tabs } from '../proj/parts.jsx';
import { ISSUE_MODES, LETTER_TONE, lt, openPrint } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Letter (part 11.05): the letter with its scan, thread, links and response; an outward letter shows its approval and, once approved, its number and letterhead.
const TABS = ['details', 'thread', 'links', 'files'];
export default function LetterPage() {
  const t = useT('engg');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['engg', 'letter', id], queryFn: () => lt.get(id), enabled: Boolean(id), retry: false });
  const th = useQuery({ queryKey: ['engg', 'letter-thread', id], queryFn: () => lt.thread(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [tab, setTab] = useState('details'); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [uploaded, setUploaded] = useState(0); const [edit, setEdit] = useState(null);
  const [iss, setIss] = useState({ issueMode: 'EMAIL', deliveryRef: '' }); const [ack, setAck] = useState({ ackBy: '', ackNote: '' });
  usePageTitle(q.data ? `${q.data.letterNo ?? t('letter.draft')} ${q.data.subject}` : t('letter.title'));
  if (!id) return <section aria-labelledby="lt-h" data-testid="lt-none"><PageHeader id="lt-h" title={t('letter.title')} subtitle={<Link to="/engg/letters">{t('nav.letters')}</Link>} /></section>;
  if (q.error?.status === 403) return <NoPermission what={t('nav.letters')} permission="engg.letter.view" />;
  if (q.isPending) return <Skeleton label={t('letter.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const l = q.data; const c = l.can;
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['engg'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  const save = (e) => { e.preventDefault(); run(async () => { await lt.update(l.id, { subject: edit.subject.trim(), bodyText: edit.bodyText, responseDue: edit.responseDue || null, rowVersion: l.rowVersion }); setEdit(null); }, t('dwg.saved')); };
  return (
    <section aria-labelledby="lt-h" data-testid="letter" data-status={l.status} data-direction={l.direction} data-number={l.letterNo ?? ''}>
      <header>
        <PageHeader id="lt-h" title={<>{l.letterNo ?? t('letter.draft')} · {l.subject} <StatusBadge status={LETTER_TONE[l.status]} label={t(`lst.${l.status}`)} /></>} subtitle={<>{l.projectCode} · {l.direction === 'IN' ? t('letter.inward') : t('letter.outward')} · {l.party} · {t(`lcat.${l.category}`)}{l.clauseRef ? ` · ${t('letter.clause')} ${l.clauseRef}` : ''}{l.contractual ? ` · ${t('letter.contractual')}` : ''}{l.confidentiality === 'CONFIDENTIAL' ? ` · ${t('letter.confidential')}` : ''}</>} />
        {l.direction === 'IN' && <p data-testid="lt-response">{t('letter.responseDue')}: {l.responseDue ?? '—'} · <strong>{t(`lresp.${l.responseStatus}`)}</strong>{l.overdue ? ` (${t('dwg.overdue')})` : ''}</p>}
        {error?.form && <p className="field-error" role="alert" data-testid="lt-act-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="lt-note">{note}</p>}
        <div className="actions-row no-print">
          {c.edit && <button type="button" className="btn" onClick={() => setEdit({ subject: l.subject, bodyText: l.bodyText ?? '', responseDue: l.responseDue ?? '' })} data-testid="lt-edit">{t('act.edit')}</button>}
          {c.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => lt.act(l.id, 'submit'), t('letter.sent'))} data-testid="lt-submit">{t('letter.sendApproval')}</button>}
          {c.close && <button type="button" className="btn" onClick={() => run(() => lt.act(l.id, 'close'), t('letter.closed'))} data-testid="lt-close">{t('letter.close')}</button>}
          {c.reply && <button type="button" className="btn" onClick={() => navigateTo(`/engg/letter-draft?parent=${l.id}&projectId=${l.projectId}`)} data-testid="lt-reply">{t('letter.reply')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((x) => lt.act(l.id, 'withdraw', { reason: x }), t('rev.withdrawn'))} data-testid="lt-withdraw">{t('act.withdraw')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((x) => lt.act(l.id, 'cancel', { reason: x }), t('letter.cancelled'))} data-testid="lt-cancel">{t('act.cancel')}</button>}
          {c.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => lt.act(l.id, 'amend', { reason: x })); if (n && n.id !== l.id) navigateTo(`/engg/letter?id=${n.id}`); } }} data-testid="lt-amend">{l.direction === 'IN' ? t('letter.reopen') : t('letter.corrigendum')}</button>}
          {c.delete && <button type="button" className="btn" onClick={async () => { if (await run(() => lt.remove(l.id))) navigateTo('/engg/letters'); }} data-testid="lt-delete">{t('act.delete')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => openPrint(`/letters/${l.id}/print`, `${l.letterNo ?? 'letter'}.html`)} data-testid="lt-print">{l.onLetterhead ? t('letter.printLetterhead') : t('act.print')}</button>}
          {l.workflowInstanceId && <Link to={`/workflow/instance?id=${l.workflowInstanceId}`}>{t('rev.approval')}</Link>}
        </div>
      </header>
      {c.issue && (
        <form className="mdm-panel" aria-label={t('letter.issue')} data-testid="lt-issue-form" onSubmit={(e) => { e.preventDefault(); run(() => lt.act(l.id, 'issue', { issueMode: iss.issueMode, deliveryRef: iss.deliveryRef.trim() || null }), t('letter.issued')); }}>
          <h2>{t('letter.issue')}</h2>
          <div className="form-grid">
            <Field label={t('letter.mode')} name="issueMode" error={error}><select value={iss.issueMode} onChange={(e) => setIss({ ...iss, issueMode: e.target.value })} data-testid="lt-mode">{ISSUE_MODES.map((k) => <option key={k} value={k}>{t(`lmode.${k}`)}</option>)}</select></Field>
            <Field label={t('letter.deliveryRef')} name="deliveryRef" error={error}><input value={iss.deliveryRef} onChange={(e) => setIss({ ...iss, deliveryRef: e.target.value })} maxLength={160} data-testid="lt-delivery" /></Field>
          </div>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="lt-issue">{t('letter.issue')}</button></div>
        </form>
      )}
      {c.acknowledge && (
        <form className="mdm-panel" aria-label={t('letter.acknowledge')} data-testid="lt-ack-form" onSubmit={(e) => { e.preventDefault(); run(() => lt.act(l.id, 'acknowledge', { ackBy: ack.ackBy.trim(), ackNote: ack.ackNote.trim() || null }), t('letter.acknowledged')); }}>
          <h2>{t('letter.acknowledge')}</h2>
          <div className="form-grid">
            <Field label={t('letter.ackBy')} name="ackBy" error={error}><input value={ack.ackBy} onChange={(e) => setAck({ ...ack, ackBy: e.target.value })} maxLength={160} data-testid="lt-ackby" /></Field>
            <Field label={t('letter.ackNote')} name="ackNote" error={error}><input value={ack.ackNote} onChange={(e) => setAck({ ...ack, ackNote: e.target.value })} maxLength={1000} data-testid="lt-acknote" /></Field>
          </div>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={ack.ackBy.trim().length < 2} data-testid="lt-ack">{t('letter.acknowledge')}</button></div>
        </form>
      )}
      {edit && (
        <form className="mdm-panel" aria-label={t('act.edit')} data-testid="lt-edit-form" onSubmit={save}>
          <div className="form-grid">
            <Field label={t('letter.subject')} name="subject" error={error}><input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} required maxLength={300} data-testid="lt-e-subject" /></Field>
            {l.direction === 'OUT' && <Field label={t('letter.body')} name="bodyText" error={error}><textarea value={edit.bodyText} onChange={(e) => setEdit({ ...edit, bodyText: e.target.value })} rows={8} maxLength={20000} data-testid="lt-e-body" /></Field>}
            {l.direction === 'IN' && <Field label={t('letter.responseDue')} name="responseDue" error={error}><input type="date" value={edit.responseDue} onChange={(e) => setEdit({ ...edit, responseDue: e.target.value })} /></Field>}
          </div>
          <div className="actions"><button type="button" className="btn" onClick={() => setEdit(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="lt-save">{t('act.save')}</button></div>
        </form>
      )}
      <Tabs tabs={TABS} active={tab} onChange={setTab} label={t('letter.title')} labelOf={(k) => t(`ltab.${k}`)} />
      {tab === 'details' && (
        <div className="mdm-panel" data-testid="lt-details"><dl>
          <dt>{t('letter.theirRef')}</dt><dd>{l.theirRef || '—'}</dd><dt>{t('letter.date')}</dt><dd>{l.letterDate}{l.receivedOn ? ` (${t('letter.receivedOn')} ${l.receivedOn})` : ''}{l.issuedOn ? ` (${t('rev.issuedOn')} ${l.issuedOn})` : ''}</dd>
          <dt>{t('letter.assignedTo')}</dt><dd>{l.assignedTo || '—'}</dd><dt>{t('letter.tags')}</dt><dd>{l.tagList.length ? l.tagList.join(', ') : '—'}</dd>
          {l.timeBar && <><dt>{t('tb.serves')}</dt><dd data-testid="lt-timebar"><Link to="/engg/time-bars">{l.timeBar.barNo}</Link> · {l.timeBar.deadline} · {t(`tbs.${l.timeBar.status}`)}</dd></>}
          {l.issueMode && <><dt>{t('letter.mode')}</dt><dd data-testid="lt-issued-mode">{t(`lmode.${l.issueMode}`)}{l.deliveryRef ? ` · ${l.deliveryRef}` : ''}</dd></>}
          {l.ackOn && <><dt>{t('letter.acknowledge')}</dt><dd data-testid="lt-acked">{l.ackBy} · {l.ackOn}{l.ackNote ? ` · ${l.ackNote}` : ''}</dd></>}
          {l.parent && <><dt>{t('letter.answers')}</dt><dd><Link to={`/engg/letter?id=${l.parent.id}`}>{l.parent.letterNo ?? l.parent.subject}</Link></dd></>}
        </dl>{l.bodyText && <><h2>{t('letter.body')}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{l.bodyText}</p></>}</div>
      )}
      {tab === 'thread' && (
        <div className="mdm-panel" data-testid="lt-thread"><h2>{t('ltab.thread')}</h2>
          {!th.data ? <Skeleton label={t('ltab.thread')} rows={2} /> : <ul style={{ listStyle: 'none', padding: 0 }}>{th.data.letters.map((x) => <li key={x.id} style={{ marginLeft: `${x.depth * 1.5}rem` }} data-testid={`lt-th-${x.id}`} data-current={x.id === id ? '1' : '0'}>{x.direction === 'IN' ? '←' : '→'} <Link to={`/engg/letter?id=${x.id}`}>{x.letterNo ?? t('letter.draft')}</Link> · {x.subject} · {t(`lst.${x.status}`)}{x.overdue ? ` · ${t('dwg.overdue')}` : ''}</li>)}</ul>}</div>
      )}
      {tab === 'links' && (
        <div className="mdm-panel" data-testid="lt-links"><h2>{t('ltab.links')}</h2>
          {l.links.length === 0 ? <p className="muted">{t('dwg.noLinks')}</p> : <ul>{l.links.map((x) => <li key={x.id}>{t(`lent.${x.entity}`)}: {x.entity === 'RFI' && x.entityId ? <Link to={`/engg/rfi?id=${x.entityId}`}>{x.ref}</Link> : x.entity === 'DRAWING' && x.entityId ? <Link to={`/engg/drawing?id=${x.entityId}`}>{x.ref}</Link> : x.ref}</li>)}</ul>}</div>
      )}
      {tab === 'files' && (
        <div className="mdm-panel" data-testid="lt-files"><h2>{t('ltab.files')}</h2>
          {(c.edit || c.issue) && <FileUploader entity="engg_letter" entityId={l.id} onDone={() => { setUploaded((n) => n + 1); qc.invalidateQueries({ queryKey: ['engg'] }); }} />}
          <AttachmentList key={uploaded} entity="engg_letter" entityId={l.id} canEdit={c.edit || c.issue} onReplace={() => {}} /></div>
      )}
    </section>
  );
}
