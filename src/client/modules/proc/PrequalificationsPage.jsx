import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { RESULT_TONE, XPD_TONE, download, fmtDate, pc, pct, pv8, today } from './api.js';
import { History, useRunner } from './XpdParts.jsx';
import { useSearch } from '../site/parts.jsx';

// Vendor prequalification (part 15.08, FR-01, FR-02): the questionnaire is scored per section, a visit report is recorded, and the approval (procurement manager, quality manager, the direction for a strategic category) puts the vendor on the approved vendor list.
function Preq({ t, id }) {
  const q = useQuery({ queryKey: ['proc', 'preq', id], queryFn: () => pv8.preq(id), retry: false }); const hq = useQuery({ queryKey: ['proc', 'preq-history', id, q.data?.status], queryFn: () => pv8.preqHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState('');
  usePageTitle(t('v.preqTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('v.preqTitle')} permission="proc.prequalification.view" />;
  if (q.isPending) return <Skeleton label={t('v.preqTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can;
  const why = (action, msg) => { const x = window.prompt(t('x.why')); if (x) run(() => pv8.preqAct(r.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/prequalifications?new=1&edit=${d.id}`); }); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('x.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`x.done.${action}`)); };
  return (
    <div data-testid="pq-object" data-status={r.status} data-result={r.result}>
      <h1 id="pq-h">{r.docNo} <StatusBadge status={XPD_TONE[r.status]} label={t(`x.s.${r.status}`)} /><StatusBadge status={RESULT_TONE[r.result]} label={t(`v.res.${r.result}`)} />{r.strategic && <StatusBadge status="RETURNED" label={t('v.strategic')} />}</h1>
      <p><Link to="/proc/prequalifications">{t('x.back')}</Link> · <Link to={`/proc/vendor-scorecards?partner=${r.partnerId}`}>{r.vendor}</Link> ({r.vendorCode})</p>
      <dl className="kv" data-testid="pq-figures"><div><dt>{t('v.score')}</dt><dd data-testid="pq-score">{pct(r.score)}</dd></div><div><dt>{t('v.categories')}</dt><dd>{r.categories.map((c) => c.name).join(', ')}</dd></div><div><dt>{t('v.regions')}</dt><dd>{r.regions.length ? r.regions.join(', ') : t('v.allRegions')}</dd></div><div><dt>{t('v.validUntil')}</dt><dd>{fmtDate(r.validUntil)}</dd></div>
        <div><dt>{t('v.visit')}</dt><dd>{r.visitDate ? `${fmtDate(r.visitDate)} · ${r.visitNotes ?? ''}` : '—'}</dd></div>{r.conditions && <div><dt>{t('v.conditions')}</dt><dd>{r.conditions}</dd></div>}</dl>
      {error?.form && <p className="field-error" role="alert" data-testid="pq-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="pq-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="pq-answers"><caption>{t('v.questionnaire')}</caption><thead><tr><th>{t('v.section')}</th><th className="num">{t('v.weight')}</th><th className="num">{t('v.sectionScore')}</th><th>{t('x.note')}</th></tr></thead>
        <tbody>{r.answers.map((a) => <tr key={a.section}><td>{a.label}</td><td className="num">{a.weight}%</td><td className="num">{a.score ?? '—'}</td><td>{a.note ?? ''}</td></tr>)}</tbody></table></div>
      {(r.avl ?? []).length > 0 && <div className="table-scroll"><table className="data-table" data-testid="pq-avl"><caption>{t('v.onList')}</caption><thead><tr><th>{t('v.category')}</th><th>{t('v.region')}</th><th>{t('x.status')}</th><th>{t('v.validUntil')}</th></tr></thead><tbody>{r.avl.map((e) => <tr key={e.id}><td>{e.category}</td><td>{e.region}</td><td>{e.statusLabel}</td><td>{fmtDate(e.validUntil)}</td></tr>)}</tbody></table></div>}
      <div className="actions-row no-print">
        {can.edit && <Link to={`/proc/prequalifications?new=1&edit=${r.id}`}>{t('x.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pv8.preqAct(r.id, 'submit'), t('x.submitted'))} data-testid="pq-submit">{t('x.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('x.withdrawn'))}>{t('x.withdraw')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend')} data-testid="pq-amend">{t('v.reevaluate')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('x.cancelled'))} data-testid="pq-cancel">{t('x.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('x.deleteAsk')) && await run(() => pv8.preqDelete(r.id))) navigateTo('/proc/prequalifications'); }}>{t('x.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/prequalifications/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('x.fileFailed') }))} data-testid="pq-print">{t('x.print')}</button>}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('x.approval')}</Link>}
      </div>
      {r.taskId && <div className="mdm-panel no-print" data-testid="pq-decide"><h2>{t('x.decide')}</h2><label>{t('x.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="pq-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="pq-approve">{t('x.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('x.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('x.reject')}</button></div></div>}
      <History t={t} data={hq.data} testId="pq-history" />
    </div>
  );
}

function PreqForm({ t, editId }) {
  const oq = useQuery({ queryKey: ['proc', 'preq-options'], queryFn: pv8.options, retry: false }); const eq = useQuery({ queryKey: ['proc', 'preq', editId], queryFn: () => pv8.preq(editId), enabled: Boolean(editId), retry: false }); const e = eq.data;
  const [f, setF] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  usePageTitle(t('v.newPreq'));
  if (oq.error?.status === 403) return <NoPermission what={t('v.newPreq')} permission="proc.prequalification.create" />;
  if (oq.isPending || (editId && eq.isPending)) return <Skeleton label={t('v.newPreq')} rows={4} />;
  const o = oq.data; const form = f ?? { partnerId: e ? String(e.partnerId) : '', categoryIds: e ? e.categories.map((c) => c.id) : [], regions: e ? e.regions.join(', ') : '', strategic: e?.strategic ?? false, validUntil: e?.validUntil ?? '', visitDate: e?.visitDate ?? '', visitNotes: e?.visitNotes ?? '', conditions: e?.conditions ?? '', scores: e ? Object.fromEntries(e.answers.map((a) => [a.section, a.score == null ? '' : String(a.score)])) : {}, notes: e ? Object.fromEntries(e.answers.map((a) => [a.section, a.note ?? ''])) : {} };
  const set = (k, v) => setF({ ...form, [k]: v }); const toggle = (id) => set('categoryIds', form.categoryIds.includes(id) ? form.categoryIds.filter((x) => x !== id) : [...form.categoryIds, id]);
  const body = () => ({ categoryIds: form.categoryIds, regions: form.regions.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean), strategic: form.strategic, validUntil: form.validUntil || null, visitDate: form.visitDate || null, visitNotes: form.visitNotes || null, conditions: form.conditions || null,
    answers: o.sections.filter((s) => form.scores[s.code] !== '' && form.scores[s.code] != null).map((s) => ({ section: s.code, score: Number(form.scores[s.code]), note: form.notes[s.code] || null })) });
  const save = async (send) => { setError(null); setBusy(true); try { let d = editId ? await pv8.preqUpdate(editId, { ...body(), rowVersion: e.rowVersion }) : await pv8.preqCreate({ partnerId: Number(form.partnerId), ...body() }); if (send) d = await pv8.preqAct(d.id, 'submit'); navigateTo(`/proc/prequalifications?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="pqn-h" data-testid="proc-pq-form"><h1 id="pqn-h">{editId ? t('x.edit') : t('v.newPreq')}</h1><p className="muted">{t('v.newPreqHelp', { q: o.thresholds.qualify, c: o.thresholds.conditional })}</p><p><Link to="/proc/prequalifications">{t('x.back')}</Link></p>
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate>
        <div className="form-grid">
          {editId ? <p>{e.vendor}</p> : <Field label={t('x.vendor')} name="partnerId" error={error}><select value={form.partnerId} onChange={(ev) => set('partnerId', ev.target.value)} style={{ minHeight: 44 }} data-testid="pqn-vendor"><option value="">{t('x.choose')}</option>{o.vendors.map((v) => <option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}</select></Field>}
          <Field label={t('v.validUntil')} name="validUntil" error={error}><input type="date" value={form.validUntil} min={today()} onChange={(ev) => set('validUntil', ev.target.value)} style={{ minHeight: 44 }} data-testid="pqn-valid" /></Field>
          <Field label={t('v.regions')} name="regions" error={error}><input value={form.regions} maxLength={200} placeholder={t('v.regionsHelp')} onChange={(ev) => set('regions', ev.target.value)} style={{ minHeight: 44 }} data-testid="pqn-regions" /></Field></div>
        <fieldset><legend>{t('v.categories')}</legend><div className="actions-row">{o.categories.map((c) => <label key={c.id}><input type="checkbox" checked={form.categoryIds.includes(c.id)} onChange={() => toggle(c.id)} data-testid={`pqn-cat-${c.code}`} /> {c.name}</label>)}</div></fieldset>
        <label><input type="checkbox" checked={form.strategic} onChange={(ev) => set('strategic', ev.target.checked)} data-testid="pqn-strategic" /> {t('v.strategicHelp')}</label>
        <div className="table-scroll"><table className="data-table" data-testid="pqn-sections"><caption>{t('v.questionnaire')}</caption><thead><tr><th>{t('v.section')}</th><th className="num">{t('v.weight')}</th><th>{t('v.sectionScore')}</th><th>{t('x.note')}</th></tr></thead>
          <tbody>{o.sections.map((s) => <tr key={s.code} data-testid="pqn-section"><td>{s.label}</td><td className="num">{s.weight}%</td><td><input type="number" min="0" max="100" value={form.scores[s.code] ?? ''} onChange={(ev) => set('scores', { ...form.scores, [s.code]: ev.target.value })} style={{ minHeight: 44, width: 90 }} aria-label={`${s.label} ${t('v.sectionScore')}`} data-testid={`pqn-score-${s.code}`} /></td>
            <td><input value={form.notes[s.code] ?? ''} maxLength={500} onChange={(ev) => set('notes', { ...form.notes, [s.code]: ev.target.value })} style={{ minHeight: 44 }} aria-label={`${s.label} ${t('x.note')}`} /></td></tr>)}</tbody></table></div>
        <div className="form-grid"><Field label={t('v.visitDate')} name="visitDate" error={error}><input type="date" max={today()} value={form.visitDate} onChange={(ev) => set('visitDate', ev.target.value)} style={{ minHeight: 44 }} data-testid="pqn-visit-date" /></Field>
          <Field label={t('v.visitNotes')} name="visitNotes" error={error}><input value={form.visitNotes} maxLength={2000} onChange={(ev) => set('visitNotes', ev.target.value)} style={{ minHeight: 44 }} data-testid="pqn-visit-notes" /></Field>
          <Field label={t('v.conditions')} name="conditions" error={error}><input value={form.conditions} maxLength={1000} onChange={(ev) => set('conditions', ev.target.value)} style={{ minHeight: 44 }} /></Field></div>
        {error?.form && <p className="field-error" role="alert" data-testid="pqn-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy || (!editId && !form.partnerId)} data-testid="pqn-save">{t('x.saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || (!editId && !form.partnerId)} onClick={() => save(true)} data-testid="pqn-send">{t('x.sendForApproval')}</button></div></form></section>
  );
}

export default function PrequalificationsPage() {
  const t = useT('proc'); usePageTitle(t('v.preqTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <PreqForm key={sp.get('edit') ?? 'new'} t={t} editId={Number(sp.get('edit')) || null} />;
  if (id) return <section aria-labelledby="pq-h" data-testid="proc-pq"><Preq key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="pqs-h" data-testid="proc-pq"><h1 id="pqs-h">{t('v.preqTitle')}</h1><p className="muted">{t('v.preqIntro')}</p>
      <div className="actions-row no-print">{perms.includes('proc.prequalification.create') && <Link to="/proc/prequalifications?new=1">{t('v.newPreq')}</Link>} <Link to="/proc/avl">{t('v.avlTitle')}</Link> <Link to="/proc/vendor-ranking">{t('v.rankTitle')}</Link></div>
      <ListReport listCode="proc.prequalifications" endpoint="/proc/prequalifications" title={t('v.preqTitle')} session={session.data} rowHref={(r) => `/proc/prequalifications?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/prequalifications?id=${r.id}`)}
        cardFields={['docNo', 'vendor', 'score', 'result', 'validUntil']} statusKey="status" empty={{ title: t('v.preqEmptyTitle'), text: t('v.preqEmptyBody') }} /></section>
  );
}
