import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { DiscussionTab } from '../../platform/collab/CollabTabs.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { fetchFileUrl, useSession } from '../core/api/index.js';
import { DPR_TONE, download, fmtDate, fmtQty, openPrint, st } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// DPR Register and the DPR itself (part 14.02, FR-03, FR-05, FR-06): the register with the missing and late days highlighted; one report with its sections, the labour against the attendance, the photos
// with their position and markups, the approval (the construction manager or the project manager decides from here or from the inbox), the amendment of an approved report and the PDF.
function Photo({ t, dprId, p, canEdit, onSaved }) {
  const q = useQuery({ queryKey: ['site', 'dpr-photo', p.fileId], queryFn: () => fetchFileUrl(p.fileId), staleTime: 240_000, retry: false });
  const [open, setOpen] = useState(false); const [caption, setCaption] = useState(p.caption ?? ''); const [marks, setMarks] = useState(p.markup ?? []); const [error, setError] = useState(null);
  const save = async () => { setError(null); try { await st.dprPhoto(dprId, p.fileId, { caption: caption.trim() || null, markup: marks }); onSaved(); } catch (e) { setError(errorInfo(e)); } };
  const addMark = (e) => { if (!canEdit) return; const r = e.currentTarget.getBoundingClientRect(); const text = window.prompt(t('dpr.markText')); if (text && text.trim()) setMarks((m) => [...m, { x: Math.round(((e.clientX - r.left) / r.width) * 100), y: Math.round(((e.clientY - r.top) / r.height) * 100), text: text.trim() }]); };
  return (
    <li className="mdm-panel" style={{ margin: 0 }} data-testid="dpr-photo">
      <button type="button" className="btn" style={{ padding: 0, border: 0 }} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${t('dpr.photo')} ${p.name}`}>{q.data?.url ? <img src={q.data.url} alt={p.caption ?? p.name} width="160" height="120" style={{ objectFit: 'cover', maxWidth: '100%' }} /> : <span className="thumb thumb-empty">{p.name}</span>}</button>
      <div className="muted">{p.caption ?? p.name}<br />{String(p.takenAt ?? '').slice(0, 16).replace('T', ' ')}{p.lat != null ? ` · ${p.lat}, ${p.lng}` : ''}</div>
      {open && (
        <div data-testid="dpr-photo-open">
          <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }} onClick={addMark} role="presentation">
            {q.data?.url && <img src={q.data.url} alt={p.caption ?? p.name} style={{ maxWidth: '100%', display: 'block' }} />}
            {marks.map((m, i) => <span key={i} data-testid="dpr-mark" style={{ position: 'absolute', left: `${m.x}%`, top: `${m.y}%`, background: 'var(--erp-color-status-warning-bg)', color: 'var(--erp-color-status-warning-fg)', padding: '0 4px', borderRadius: 4, fontSize: 12 }}>{m.text}</span>)}
          </div>
          {canEdit && <><p className="muted">{t('dpr.markHelp')}</p><input aria-label={t('dpr.caption')} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder={t('dpr.caption')} /> <button type="button" className="btn" onClick={() => setMarks([])}>{t('dpr.clearMarks')}</button> <button type="button" className="btn btn-primary" onClick={save} data-testid="dpr-photo-save">{t('act.save')}</button>{error?.form && <p className="field-error" role="alert">{error.form}</p>}</>}
        </div>
      )}
    </li>
  );
}

const Section = ({ title, empty, children, testId }) => <div className="mdm-panel" data-testid={testId}><h2>{title}</h2>{empty ? <p className="muted">{empty}</p> : <div className="table-scroll">{children}</div>}</div>;

function Dpr({ t, id, onGone }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['site', 'dpr', id], queryFn: () => st.dpr(id), retry: false });
  const hq = useQuery({ queryKey: ['site', 'dpr-history', id], queryFn: () => st.dprHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [talk, setTalk] = useState(false); const [up, setUp] = useState(0); const [comment, setComment] = useState('');
  usePageTitle(q.data ? `${q.data.docNo} · ${t('dpr.title')}` : t('dpr.title'));
  if (q.error?.status === 403) return <NoPermission what={t('dpr.title')} permission="site.dpr.view" />;
  if (q.isPending) return <Skeleton label={t('dpr.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const can = d.can; const refresh = () => qc.invalidateQueries({ queryKey: ['site'] });
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('dpr.sayWhy') }); return; } run(() => st.decide(d.taskId, action, comment.trim() || null), t(`dpr.done.${action}`)); };
  const f = d.flags ?? {};
  return (
    <div data-testid="dpr-object" data-status={d.status}>
      <PageHeader id="dpr-h" title={<>{d.docNo} · {fmtDate(d.dprDate)} <StatusBadge status={DPR_TONE[d.status]} label={t(`dst.${d.status}`)} />{d.late && <> <StatusBadge status="OVERDUE" label={t('dpr.late', { m: d.lateMinutes })} /></>}</>} meta={<><Link to="/site/dprs">{t('dpr.back')}</Link>{d.revisionNo > 1 && <> · {t('dpr.amendmentOf', { n: d.previous?.docNo ?? '' })}</>}</>} />
      <dl className="kv" data-testid="dpr-figures">
        <div><dt>{t('f.site')}</dt><dd>{d.projectCode} · {d.siteCode} {d.siteName}</dd></div><div><dt>{t('dpr.scope')}</dt><dd>{t(`dpr.scope.${d.scope}`)} · {d.supervisor}</dd></div><div><dt>{t('dpr.weather')}</dt><dd>{d.weather ? t(`dpr.w.${d.weatherCode}`) : '—'}{d.rainMm != null ? ` · ${d.rainMm} mm` : ''}</dd></div>
        <div><dt>{t('dpr.sentAt')}</dt><dd>{d.submittedAt ? `${String(d.submittedAt).slice(0, 16).replace('T', ' ')} · ${t(`dpr.via.${d.submittedVia}`)}` : '—'}</dd></div><div><dt>{t('dpr.cutoffAt')}</dt><dd>{d.cutoffAt ? String(d.cutoffAt).slice(0, 16).replace('T', ' ') : '—'}</dd></div><div><dt>{t('wa.raisedBy')}</dt><dd>{d.requestedBy}</dd></div>
        {d.approvedAt && <div><dt>{t('wa.approvedBy')}</dt><dd>{d.approvedBy} · {fmtDate(d.approvedAt.slice(0, 10))}</dd></div>}
      </dl>
      {d.summary && <p>{d.summary}</p>}
      {(f.labourFlagged > 0 || f.overWa > 0 || f.labourUnreported > 0) && <p className="mdm-banner" role="status" data-testid="dpr-flags">{t('dpr.flags', { l: f.labourFlagged ?? 0, o: f.overWa ?? 0, u: f.labourUnreported ?? 0 })}</p>}
      {d.status === 'APPROVED' && <p className="muted" data-testid="dpr-locked">{t('dpr.locked')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="dpr-obj-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="dpr-obj-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <Link to={`/site/dpr-entry?id=${d.id}`}>{t('act.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => st.dprAct(d.id, 'submit'), t('act.sent'))} data-testid="dpr-submit-obj">{t('act.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => st.dprAct(d.id, 'withdraw', { reason: x }))}>{t('act.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why((x) => st.dprAct(d.id, 'cancel', { reason: x }))} data-testid="dpr-cancel">{t('act.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('dpr.deleteAsk')) && await run(() => st.removeDpr(d.id))) onGone(); }}>{t('act.delete')}</button>}
        {can.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => st.dprAct(d.id, 'amend', { reason: x })); if (n) navigateTo(`/site/dpr-entry?id=${n.id}`); } }} data-testid="dpr-amend">{t('dpr.amend')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => openPrint(`/dprs/${d.id}/print`).catch(() => null)} data-testid="dpr-print">{t('act.print')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/dprs/${d.id}/pdf`, `${d.docNo.replace(/\W+/g, '-')}.pdf`).catch(() => setError({ form: t('bl.fileFailed') }))} data-testid="dpr-pdf">PDF</button>}
        <button type="button" className="btn" onClick={() => setTalk(!talk)} aria-expanded={talk}>{t('act.discussion')}</button>
        {d.workflowInstanceId && <Link to={`/workflow/instance?id=${d.workflowInstanceId}`}>{t('act.approval')}</Link>}
      </div>
      {d.taskId && (
        <div className="mdm-panel no-print" data-testid="dpr-decide"><h2>{t('dpr.decide')}</h2>
          <label>{t('mb.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="dpr-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="dpr-approve">{t('mb.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')} data-testid="dpr-return">{t('mb.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')} data-testid="dpr-reject">{t('mb.reject')}</button></div>
        </div>
      )}
      {talk && <div className="mdm-panel"><DiscussionTab entity="site_dpr" id={d.id} /></div>}

      <Section title={t('dpr.s.work')} empty={d.work.length === 0 ? t('dpr.noWork') : null} testId="dpr-sec-work">
        <table className="data-table"><caption className="sr-only">{t('dpr.s.work')}</caption><thead><tr><th>{t('wa.title')}</th><th>{t('wa.activity')}</th><th>{t('wa.location')}</th><th className="num">{t('wa.qtyShort')}</th><th className="num">{t('dpr.pctWa')}</th><th>{t('dpr.reason')}</th></tr></thead>
          <tbody>{d.work.map((w) => <tr key={w.id} data-testid="dpr-work-row" data-over={w.overWa ? '1' : undefined}><td><Link to={`/site/work-authorisations?id=${w.waId}`}>{w.waNo}</Link></td><td>{w.activity}</td><td>{w.location ?? '—'}</td><td className="num">{fmtQty(w.qty)} {w.uom ?? ''}</td><td className="num">{w.pctOfWa ?? '—'} %{w.overWa ? ` · ${t('dpr.overWa')}` : ''}</td><td>{w.reason ?? w.remarks ?? ''}</td></tr>)}</tbody></table>
      </Section>
      <Section title={t('dpr.s.labour')} empty={d.labour.length === 0 && d.unreported.length === 0 ? t('dpr.noLabour') : null} testId="dpr-sec-labour">
        <table className="data-table"><caption className="sr-only">{t('dpr.s.labour')}</caption><thead><tr><th>{t('dpr.category')}</th><th>{t('dpr.contractor')}</th><th>{t('dpr.trade')}</th><th className="num">{t('dpr.headcount')}</th><th className="num">{t('dpr.manDays')}</th><th className="num">{t('dpr.attendance')}</th><th className="num">{t('wa.variance')}</th><th>{t('dpr.reason')}</th></tr></thead>
          <tbody>{d.labour.map((l) => <tr key={l.id} data-testid="dpr-labour-row" data-flagged={l.flagged ? '1' : undefined}><td>{l.categoryLabel}</td><td>{l.contractor ?? '—'}</td><td>{l.trade}</td><td className="num">{l.headcount}</td><td className="num">{fmtQty(l.manDays)}</td><td className="num">{fmtQty(l.attManDays)}</td><td className="num">{l.variancePct == null ? '—' : `${l.variancePct} %`}{l.flagged ? ` · ${t('dpr.flagged')}` : ''}</td><td>{l.reason ?? ''}</td></tr>)}
            {d.unreported.map((l, i) => <tr key={`u${i}`} data-testid="dpr-unreported"><td>{l.categoryLabel}</td><td>{l.contractor ?? '—'}</td><td>{l.trade}</td><td className="num">—</td><td className="num">—</td><td className="num">{fmtQty(l.manDays)}</td><td colSpan={2}>{t('dpr.unreported')}</td></tr>)}</tbody></table>
      </Section>
      <Section title={t('dpr.s.materials')} empty={d.materials.length === 0 ? t('dpr.noMaterials') : null} testId="dpr-sec-materials">
        <table className="data-table"><caption className="sr-only">{t('dpr.s.materials')}</caption><thead><tr><th>{t('dpr.item')}</th><th className="num">{t('wa.qtyShort')}</th><th>{t('wa.title')}</th><th>{t('dpr.issueRef')}</th><th>{t('dpr.reason')}</th></tr></thead><tbody>{d.materials.map((m) => <tr key={m.id}><td>{m.item}</td><td className="num">{fmtQty(m.qty)} {m.uom ?? ''}</td><td>{m.waNo ?? '—'}</td><td>{m.issueRef ?? ''}</td><td>{m.reason ?? ''}</td></tr>)}</tbody></table>
      </Section>
      <Section title={t('dpr.s.equipment')} empty={d.equipment.length === 0 ? t('dpr.noEquipment') : null} testId="dpr-sec-equipment">
        <table className="data-table"><caption className="sr-only">{t('dpr.s.equipment')}</caption><thead><tr><th>{t('dpr.equipment')}</th><th className="num">{t('dpr.hWorked')}</th><th className="num">{t('dpr.hIdle')}</th><th className="num">{t('dpr.hBreakdown')}</th><th>{t('dpr.logRef')}</th></tr></thead><tbody>{d.equipment.map((e) => <tr key={e.id}><td>{e.label}</td><td className="num">{fmtQty(e.hoursWorked)}</td><td className="num">{fmtQty(e.hoursIdle)}</td><td className="num">{fmtQty(e.hoursBreakdown)}</td><td>{e.logRef ?? ''}</td></tr>)}</tbody></table>
      </Section>
      <Section title={t('dpr.s.notes')} empty={d.notes.length === 0 ? t('dpr.noNotes') : null} testId="dpr-sec-notes">
        <ul>{d.notes.map((n) => <li key={n.id} data-testid="dpr-note-row"><strong>{t(`dpr.n.${n.type}`)}</strong>: {n.text}</li>)}</ul>
      </Section>
      <div className="mdm-panel" data-testid="dpr-gallery"><h2>{t('dpr.s.photos')} ({d.photos.length})</h2>
        {d.photos.length === 0 ? <p className="muted">{t('dpr.noPhotos')}</p> : <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>{d.photos.map((p) => <Photo key={p.fileId} t={t} dprId={d.id} p={p} canEdit={can.edit} onSaved={refresh} />)}</ul>}
        {can.edit && <FileUploader entity="site_dpr" entityId={d.id} onDone={() => { setUp((n) => n + 1); refresh(); }} />}
        <AttachmentList key={up} entity="site_dpr" entityId={d.id} canEdit={can.edit} />
      </div>
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="dpr-history"><caption>{t('wa.history')}</caption><thead><tr><th>{t('wa.when')}</th><th>{t('wa.who')}</th><th>{t('wa.what')}</th><th>{t('wa.note')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function DprsPage() {
  const t = useT('site'); usePageTitle(t('dpr.register'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  const mq = useQuery({ queryKey: ['site', 'dpr-missing'], queryFn: () => st.dprMissing(), retry: false, enabled: perms.includes('site.dpr.report') });
  if (id) return <section aria-labelledby="dpr-h" data-testid="site-dprs"><Dpr key={id} t={t} id={id} onGone={() => navigateTo('/site/dprs')} /></section>;
  const miss = mq.data?.rows ?? [];
  return (
    <section aria-labelledby="dpr-h" data-testid="site-dprs">
      <PageHeader id="dpr-h" srOnly title={t('dpr.register')} />
      <div className="actions-row no-print">
        {perms.includes('site.dpr.create') && <Link to="/site/dpr-entry">{t('dpr.new')}</Link>}
        {perms.includes('site.dpr.report') && <><Link to="/site/dpr-report">{t('dpr.reports')}</Link> <Link to="/site/dpr-compliance">{t('dpr.compliance')}</Link></>}
      </div>
      {miss.length > 0 && (
        <div className="mdm-panel" role="status" data-testid="dpr-missing"><h2>{t('dpr.missing', { n: miss.length })}</h2>
          <ul>{miss.slice(0, 12).map((m) => <li key={`${m.siteId}-${m.date}`} data-testid="dpr-missing-row"><StatusBadge status="OVERDUE" label={t('dpr.missingShort')} /> {m.project} · {m.site} · {fmtDate(m.date)}{m.draft ? ` · ${t('dpr.draftWaiting')}` : ''} {perms.includes('site.dpr.create') && <Link to={m.draft ? `/site/dpr-entry?id=${m.dprId}` : `/site/dpr-entry?siteId=${m.siteId}&date=${m.date}`}>{t(m.draft ? 'dpr.open' : 'dpr.start')}</Link>}</li>)}</ul>
        </div>
      )}
      <ListReport listCode="site.dprs" endpoint="/site/dprs" title={t('dpr.register')} session={session.data} rowHref={(r) => `/site/dprs?id=${r.id}`} onOpen={(r) => navigateTo(`/site/dprs?id=${r.id}`)}
        cardFields={['dprDate', 'site', 'supervisor', 'late']} statusKey="status"
        empty={{ title: t('dpr.emptyTitle'), text: t('dpr.emptyBody') }} />
    </section>
  );
}
