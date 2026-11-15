import { useState } from 'react';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, qa } from './api.js';
import { useRecord, useRunner } from './QaParts.jsx';
import { PlanPins } from './SnagParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Snag Register and snag object (part 18.06): the snag on its plan, before and after photographs, rectification by the responsible party, verification and closure by someone else (BR-01), reopening with a reason.
const transport = browserTransport(authHeaders); const SNAG_TONE = { OPEN: 'IN_REVIEW', RECTIFIED: 'RETURNED', CLOSED: 'APPROVED', CANCELLED: 'CANCELLED' };
function Snag({ id }) {
  const t = useT('qa'); const { q, guard } = useRecord('/snags', id, t('snag.title'), 'qa.snag.view'); const { error, run, busy, note } = useRunner(); const [rnote, setRnote] = useState(''); usePageTitle(t('snag.title')); if (guard) return guard; const x = q.data;
  const act = (action, body, msg) => run(() => qa.act('/snags', x.id, action, body), msg); const why = (action, msg) => { const r = globalThis.prompt(t('why')); if (r) act(action, { reason: r }, msg); };
  const addPhoto = (kind) => async (ev) => { const file = ev.target.files?.[0]; ev.target.value = ''; if (!file) return; await run(async () => { const up = await uploadFile(file, { transport, entity: 'qa_snags', entityId: x.id }); return qa.post(`/snags/${x.id}/photos`, { fileId: up.id, kind }); }, t('snag.photoAdded')); };
  const rectify = () => run(async () => { return qa.act('/snags', x.id, 'rectify', { note: rnote || null }); }, t('snag.rectified'));
  return (
    <div data-testid="qa-snag-object" data-status={x.status}><PageHeader id="sn-h" title={<>{x.docNo} <StatusBadge status={SNAG_TONE[x.status]} label={t(`snags.${x.status}`)} /> <StatusBadge status={x.punchClass === 'A' ? 'REJECTED' : x.punchClass === 'B' ? 'RETURNED' : 'DRAFT'} label={t(`punch.${x.punchClass}`)} /></>} meta={<><Link to="/qa/snags">{t('snag.title')}</Link> · {x.project} · {x.area ?? '—'} · {t(`scat.${x.category}`)} · {t(`prio.${x.priority}`)} · {x.responsible ?? t(`resp.${x.responsibleType}`)}{x.dueDate ? ` · ${t('snag.due')} ${fmtDate(x.dueDate)}` : ''}{x.overdue ? ` · ${t('ir.overdue')}` : ''}{x.reopenCount ? ` · ${t('snag.reopened', { n: x.reopenCount })}` : ''}</>} /><p>{x.description}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="sn-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="sn-note">{note}</p>}
      {x.pin && <PlanPins pins={[{ ...x.pin, label: x.docNo }]} label={t('snag.plan')} />}
      <p data-testid="sn-photos">{t('snag.before')}: {x.beforePhotos.length} · {t('snag.after')}: {x.afterPhotos.length}</p>
      <div className="actions-row no-print">
        {x.can.photo && <label className="btn" style={{ minHeight: 44 }}>{t('snag.addBefore')}<input type="file" accept="image/*" capture="environment" hidden onChange={addPhoto('BEFORE')} disabled={busy} data-testid="sn-before" /></label>}
        {x.can.rectify && <label className="btn" style={{ minHeight: 44 }}>{t('snag.addAfter')}<input type="file" accept="image/*" capture="environment" hidden onChange={addPhoto('AFTER')} disabled={busy} data-testid="sn-after" /></label>}
        {x.can.verify && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => act('close', {}, t('snag.closed'))} data-testid="sn-close">{t('snag.close')}</button>}
        {x.can.reopen && <button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => why('reopen', t('snag.reopenedNote'))} data-testid="sn-reopen">{t('snag.reopen')}</button>}
        {x.can.cancel && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => why('cancel', t('cancelled'))} data-testid="sn-cancel">{t('cancel')}</button>}</div>
      {x.can.rectify && <div className="mdm-panel no-print" data-testid="sn-rectify"><h2>{t('snag.rectification')}</h2><Field label={t('ncr.rectNote')} name="note" error={error}><textarea rows={2} value={rnote} onChange={(e) => setRnote(e.target.value)} maxLength={1000} style={{ width: '100%' }} data-testid="sn-note-input" /></Field><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !x.afterPhotos.length} onClick={rectify} data-testid="sn-rectify-go">{t('snag.reportRectified')}</button>{!x.afterPhotos.length && <p className="muted">{t('snag.afterNeeded')}</p>}</div>}
      {x.rectifiedBy && <p data-testid="sn-rectified-view">{t('snag.rectification')}: {x.rectifiedBy} · {fmtDate(x.rectifiedOn)}{x.rectificationNote ? ` · ${x.rectificationNote}` : ''}</p>}
      {x.closedBy && <p data-testid="sn-closed-view">{t('snag.verifiedBy')}: {x.closedBy} · {fmtDate(x.closedOn)}</p>}
    </div>
  );
}
export default function SnagsPage() {
  const t = useT('qa'); usePageTitle(t('snag.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="sn-h"><Snag id={id} /></section>;
  return (
    <section aria-labelledby="snl-h" data-testid="qa-snags"><PageHeader id="snl-h" title={t('snag.title')} subtitle={t('snag.intro')} />
      <div className="actions-row no-print"><Link to="/qa/snag-walk">{t('walk.title')}</Link><Link to="/qa/snag-status">{t('ss.title')}</Link><Link to="/qa/snag-report">{t('sr.title')}</Link><button type="button" className="btn" onClick={() => qa.exportFile('/snags/export', 'snags.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="snag-export">{t('export')}</button></div>
      <ListReport listCode="qa.snags" endpoint="/qa/snags" title={t('snag.title')} session={session.data} rowHref={(r) => `/qa/snags?id=${r.id}`} onOpen={(r) => navigateTo(`/qa/snags?id=${r.id}`)} cardFields={['docNo', 'area', 'punch', 'status']} statusKey="status" dateKey="due" empty={{ title: t('snag.emptyTitle'), text: t('snag.emptyBody') }} />
    </section>
  );
}
