import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { PACK_TONE, bl, dayIST, inr, openDocument } from './api.js';
import { Clauses } from './FromAwardPage.jsx';
import { Tabs, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Commercial Baseline Pack (part 10.02, FR-02 to FR-04): the frozen commercial baseline of a project as an object page: summary with the sources and the sign-off chain, the priced BOQ, the basis (indirects, priced risks, assumptions,
// exclusions, escalation, quoted rates, productivity), the key clauses, the handover meetings with their actions, the approvals and the superseding versions. Costs and margins appear only for those who hold the right. A signed-off pack is immutable:
// "Correct this baseline" starts a superseding pack with a reason and the same sign-off.
export default function BaselinePackPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const sp = useSearch(); const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['proj', 'pack', id], queryFn: () => bl.get(id), enabled: Boolean(id), retry: false });
  const x = q.data;
  usePageTitle(x ? `${x.docNo} ${x.projectCode}` : t('bl.title'));
  const [tab, setTab] = useState('summary'); const [panel, setPanel] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(sp.get('created') ? t('bl.created') : null);
  if (!id) return <section aria-labelledby="bl-h" data-testid="pack-none"><PageHeader id="bl-h" title={t('bl.title')} subtitle={<>{t('bl.noId')} <Link to="/proj/baseline-packs">{t('bl.listTitle')}</Link></>} /></section>;
  if (q.error?.status === 403) return <NoPermission what={t('bl.listTitle')} permission="proj.baseline_pack.view" />;
  if (q.isPending) return <Skeleton label={t('bl.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const c = x.can; const s = x.snapshot; const cm = s.commercials ?? {};
  return (
    <section aria-labelledby="bl-h" data-testid="baseline-pack" data-status={x.status} data-pack={x.packNo}>
      <header>
        <PageHeader id="bl-h" title={<>{x.docNo} · {x.projectCode} {x.projectName} <StatusBadge status={PACK_TONE[x.status]} label={x.statusLabel} /></>} subtitle={<>{t('bl.packNo', { n: x.packNo })}{x.tender ? ` · ${t('bl.tender')} ${x.tender.docNo}` : ''}{x.estimate ? ` · ${t('bl.estimate')} ${x.estimate.ref}` : ''}{x.frozen ? ` · ${t('bl.frozen')}` : ` · ${t('bl.notFrozen')}`}</>} />
        <dl className="op-figures" data-testid="pack-figures">
          <div><dt>{t('f.contractValue')}</dt><dd data-testid="pack-value">{inr(x.contractValue)}</dd></div>
          <div><dt>{t('bl.sellingValue')}</dt><dd>{inr(cm.totalSelling)}</dd></div>
          {x.costsVisible && <div><dt>{t('bl.totalCost')}</dt><dd data-testid="pack-cost">{inr(cm.totalCost)}</dd></div>}
          {x.costsVisible && <div><dt>{t('bl.margin')}</dt><dd data-testid="pack-margin">{inr(cm.margin)} ({cm.marginPct}%)</dd></div>}
          <div><dt>{t('bl.boqItems')}</dt><dd>{(s.boq ?? []).length}</dd></div>
          {x.signedOffAt && <div><dt>{t('bl.signedOff')}</dt><dd data-testid="pack-signed">{String(x.signedOffAt).slice(0, 10)} · {x.signedOffBy}</dd></div>}
        </dl>
        {error?.form && <p className="field-error" role="alert" data-testid="pack-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="pack-note">{note}</p>}
        {x.amendReason && <p className="mdm-banner" role="status">{t('bl.amendReason')}: {x.amendReason}</p>}
        <div className="actions-row no-print" data-testid="pack-actions">
          {c.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => bl.act(id, 'submit'), t('bl.sent'))} data-testid="pack-submit">{t('bl.send')}</button>}
          {c.edit && <button type="button" className="btn" onClick={() => run(() => bl.act(id, 'refresh'), t('bl.refreshed'))} data-testid="pack-refresh">{t('bl.refresh')}</button>}
          {c.edit && <button type="button" className="btn" onClick={() => { setTab('clauses'); setPanel('clauses'); }} data-testid="pack-edit">{t('act.edit')}</button>}
          {c.amend && <button type="button" className="btn" onClick={() => why((r) => bl.act(id, 'amend', { reason: r }).then((n) => navigateTo(`/proj/baseline-pack?id=${n.id}`, { force: true })), t('bl.correcting'))} data-testid="pack-amend">{t('bl.amend')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((r) => bl.act(id, 'withdraw', { reason: r }), t('bl.withdrawn'))} data-testid="pack-withdraw">{t('act.withdraw')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((r) => bl.act(id, 'cancel', { reason: r }), t('bl.cancelled'))} data-testid="pack-cancel">{t('bl.cancel')}</button>}
          {c.remove && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('bl.confirmDelete'))) { const r = await run(() => bl.remove(id)); if (r) navigateTo('/proj/baseline-packs', { force: true }); } }} data-testid="pack-delete">{t('act.delete')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => openDocument(id, 'html')} data-testid="pack-print">{t('act.print')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => openDocument(id, 'pdf')} data-testid="pack-pdf">{t('bl.pdf')}</button>}
          {c.export && <button type="button" className="btn" onClick={() => openDocument(id, 'xlsx')} data-testid="pack-xlsx">{t('bl.xlsx')}</button>}
        </div>
      </header>
      <Tabs tabs={['summary', 'boq', 'basis', 'clauses', 'handover', 'approvals', 'related']} active={tab} onChange={setTab} label={t('bl.title')} />
      {tab === 'summary' && <Summary x={x} />}
      {tab === 'boq' && <Boq x={x} />}
      {tab === 'basis' && <Basis x={x} />}
      {tab === 'clauses' && <ClausesTab x={x} run={run} editing={panel === 'clauses' && c.edit} done={() => setPanel(null)} error={error} />}
      {tab === 'handover' && <Handover x={x} run={run} error={error} />}
      {tab === 'approvals' && <Approvals x={x} />}
      {tab === 'related' && <Related x={x} />}
      <p className="small"><Link to="/proj/baseline-packs">{t('bl.listTitle')}</Link></p>
    </section>
  );
}

function Summary({ x }) {
  const t = useT('proj'); const s = x.snapshot; const src = s.source ?? {}; const cm = s.commercials ?? {};
  return (
    <div data-testid="pack-summary">
      <h2>{t('bl.chain')}</h2>
      <ol className="mdm-list" data-testid="pack-chain">{x.chain.map((r) => <li key={r}>{t(`bl.step.${r}`)}</li>)}</ol>
      <p className="small muted">{x.directorRequired ? t('bl.directorYes') : t('bl.directorNo')}</p>
      <h2>{t('bl.sources')}</h2>
      <dl className="op-figures">
        <div><dt>{t('bl.tender')}</dt><dd>{src.tender ? `${src.tender.docNo} · ${src.tender.nameOfWork}` : '—'}</dd></div>
        <div><dt>{t('fa.award')}</dt><dd>{src.award ? `${src.award.docNo} · ${src.award.loaNo ?? ''} · ${inr(src.award.awardedValue)}` : '—'}</dd></div>
        <div><dt>{t('bl.estimate')}</dt><dd>{src.estimate ? `${src.estimate.docNo}/v${src.estimate.versionNo} · ${src.estimate.basisDate}` : '—'}</dd></div>
        {s.contract && <div><dt>{t('f.contractType')}</dt><dd>{s.contract.typeLabel} · {s.contract.no ?? '—'}</dd></div>}
        {s.contract && <div><dt>{t('wiz.period')}</dt><dd>{s.contract.startDate ?? '–'} → {s.contract.scheduledCompletion ?? '–'}</dd></div>}
      </dl>
      <h2>{t('bl.commercials')}</h2>
      <table className="data-table" data-testid="pack-commercials"><tbody>
        {[['totalSelling', 'bl.sellingValue'], ['discount', 'bl.discount'], ['netPrice', 'bl.netPrice'], ['gst', 'bl.gst'], ['bidPrice', 'bl.bidPrice'], ...(x.costsVisible ? [['directCost', 'bl.directCost'], ['indirectCost', 'bl.indirectCost'], ['overhead', 'bl.overhead'], ['risk', 'bl.risk'], ['contingency', 'bl.contingency'], ['escalation', 'bl.escalation'], ['totalCost', 'bl.totalCost'], ['margin', 'bl.margin']] : [])].map(([k, l]) => <tr key={k}><th scope="row">{t(l)}</th><td className="num">{inr(cm[k])}</td></tr>)}
      </tbody></table>
      {x.status === 'APPROVED' && <Integrity id={x.id} />}
    </div>
  );
}
function Integrity({ id }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'verify', id], queryFn: () => bl.verify(id), retry: false });
  if (!q.data) return null;
  return <p className={q.data.intact ? 'muted' : 'field-error'} role={q.data.intact ? 'status' : 'alert'} data-testid="pack-integrity">{q.data.intact ? t('bl.intact') : t('bl.tampered')}</p>;
}
function Boq({ x }) {
  const t = useT('proj'); const rows = x.snapshot.boq ?? []; let sec = null;
  if (!rows.length) return <p className="muted">{t('bl.noBoq')}</p>;
  return (
    <div data-testid="pack-boq" className="table-wrap">
      <table className="data-table"><caption className="sr-only">{t('bl.boq')}</caption>
        <thead><tr><th scope="col">{t('bl.item')}</th><th scope="col">{t('bl.description')}</th><th scope="col">{t('bl.uom')}</th><th scope="col" className="num">{t('bl.qty')}</th><th scope="col" className="num">{t('bl.rate')}</th><th scope="col" className="num">{t('bl.amount')}</th>{x.costsVisible && <th scope="col" className="num">{t('bl.costRate')}</th>}{x.costsVisible && <th scope="col" className="num">{t('bl.costAmount')}</th>}</tr></thead>
        <tbody>{rows.map((r) => { const head = r.sectionCode !== sec ? (sec = r.sectionCode, <tr key={`s${r.sectionCode}`}><th colSpan={x.costsVisible ? 8 : 6} scope="colgroup">{r.sectionCode} {r.sectionName}</th></tr>) : null; return [head, <tr key={r.itemId} data-testid="pack-boq-row"><td>{r.itemNo}</td><td>{r.description}</td><td>{r.uom}</td><td className="num">{r.qty}</td><td className="num">{r.sellingRate}</td><td className="num">{inr(r.amount)}</td>{x.costsVisible && <td className="num">{r.costRate}</td>}{x.costsVisible && <td className="num">{inr(r.costAmount)}</td>}</tr>]; })}</tbody>
        <tfoot><tr><th scope="row" colSpan={5}>{t('bl.boqTotal')}</th><td className="num">{inr(x.snapshot.boqTotal)}</td>{x.costsVisible && <td />}{x.costsVisible && <td className="num">{inr(x.snapshot.boqCost)}</td>}</tr></tfoot>
      </table>
    </div>
  );
}
function Basis({ x }) {
  const t = useT('proj'); const s = x.snapshot; const a = s.assumptions ?? {};
  const list = (k) => (a[k]?.length ? <ul className="mdm-list">{a[k].map((v, i) => <li key={i}>{v}</li>)}</ul> : <p className="muted">—</p>);
  return (
    <div data-testid="pack-basis">
      <h2>{t('bl.escalationBasis')}</h2><p data-testid="pack-escalation">{s.escalation?.note}</p>
      {x.costsVisible ? (
        <>
          <h2>{t('bl.indirects')}</h2>
          <ul className="mdm-list">{(s.indirects ?? []).map((i, k) => <li key={k}>{i.description} · {inr(i.amount)}</li>)}</ul>
          <h2>{t('bl.risks')}</h2>
          <ul className="mdm-list" data-testid="pack-risks">{(s.risks ?? []).map((r, k) => <li key={k}>{r.description} · {t('bl.exposure')} {inr(r.exposure)} ({r.probabilityPct}% × {inr(r.impact)})</li>)}</ul>
          <h2>{t('bl.quoted')}</h2>
          <ul className="mdm-list" data-testid="pack-quoted">{(s.quotedRates ?? []).map((r, k) => <li key={k}>{r.typeLabel} · {r.description} · {inr(r.rate)} / {r.uom}{r.quoted ? ` · ${t('bl.quotedFlag')}` : ''}</li>)}</ul>
          <h2>{t('bl.productivity')}</h2>
          <ul className="mdm-list" data-testid="pack-productivity">{(s.productivity ?? []).map((p, k) => <li key={k}>{p.itemNo} {p.description} ({p.basis}): {p.outputs.map((o) => `${o.description} ${o.qtyPer} ${o.uom}`).join('; ')}</li>)}</ul>
        </>
      ) : <p className="muted" data-testid="pack-masked">{t('bl.masked')}</p>}
      <h2>{t('bl.assumptions')}</h2>{list('ASSUMPTION')}<h2>{t('bl.inclusions')}</h2>{list('INCLUSION')}<h2>{t('bl.exclusions')}</h2>{list('EXCLUSION')}<h2>{t('bl.qualifications')}</h2>{list('QUALIFICATION')}
    </div>
  );
}
function ClausesTab({ x, run, editing, done, error }) {
  const t = useT('proj'); const [rows, setRows] = useState(x.clauses ?? []);
  if (!editing) return <div data-testid="pack-clauses"><h2>{t('bl.clauses')}</h2>{(x.clauses ?? []).length === 0 ? <p className="muted">{t('bl.noClauses')}</p> : <ul className="mdm-list">{x.clauses.map((k, i) => <li key={i}><strong>{k.title}</strong>{k.ref ? ` (${k.ref})` : ''}: {k.summary}</li>)}</ul>}</div>;
  return (
    <form className="mdm-panel" data-testid="pack-clauses-form" onSubmit={async (e) => { e.preventDefault(); const ok = await run(() => bl.update(x.id, { clauses: rows.filter((r) => r.title.trim() && r.summary.trim()).map((r) => ({ title: r.title.trim(), summary: r.summary.trim(), ref: r.ref?.trim() || null })), version: x.rowVersion }), t('bl.saved')); if (ok) done(); }}>
      <h2>{t('bl.clauses')}</h2><Clauses value={rows} onChange={setRows} />
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="pack-clauses-save">{t('bl.save')}</button></div>
    </form>
  );
}
const blankMeeting = () => ({ meetingDate: dayIST(), venue: '', minutes: '', attendees: [{ name: '', user: '', role: '', team: 'ESTIMATION' }, { name: '', user: '', role: '', team: 'EXECUTION' }], questions: [], actions: [] });
function Handover({ x, run, error }) {
  const t = useT('proj'); const [m, setM] = useState(null);
  const rows = x.meetings ?? [];
  return (
    <div data-testid="pack-handover">
      <h2>{t('bl.handover')}</h2>
      {rows.length === 0 && <p className="muted" data-testid="pack-no-meetings">{t('bl.noMeetings')}</p>}
      {rows.map((r) => (
        <article key={r.id} className="mdm-panel" data-testid="pack-meeting">
          <h3>{r.meetingDate}{r.venue ? ` · ${r.venue}` : ''}</h3>
          <p className="small">{t('bl.attendees')}: {r.attendees.map((a) => `${a.name}${a.role ? ` (${a.role})` : ''}`).join(', ')}</p>
          {r.questions.length > 0 && <ul className="mdm-list">{r.questions.map((q, i) => <li key={i}>{q.text}{q.answer ? ` — ${q.answer}` : ''}</li>)}</ul>}
          {r.minutes && <p>{r.minutes}</p>}
          {r.actions.length > 0 && <ul className="mdm-list" data-testid="pack-actions-list">{r.actions.map((a, i) => <li key={i}>{a.title} · {a.owner} · {a.dueDate} · {a.priority}{a.taskStatus ? ` · ${a.taskStatus}` : ''}</li>)}</ul>}
          {x.can.meetings && <button type="button" className="btn" onClick={() => { if (window.confirm(t('bl.confirmMeeting'))) run(() => bl.removeMeeting(r.id)); }}>{t('act.delete')}</button>}
        </article>
      ))}
      {x.can.meetings && !m && <button type="button" className="btn btn-primary" onClick={() => setM(blankMeeting())} data-testid="pack-add-meeting">{t('bl.addMeeting')}</button>}
      {m && <MeetingForm m={m} setM={setM} x={x} run={run} error={error} />}
    </div>
  );
}
function MeetingForm({ m, setM, x, run, error }) {
  const t = useT('proj'); const set = (k, v) => setM((y) => ({ ...y, [k]: v }));
  const upd = (list, i, k, v) => setM((y) => ({ ...y, [list]: y[list].map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const add = (list, row) => setM((y) => ({ ...y, [list]: [...y[list], row] })); const del = (list, i) => setM((y) => ({ ...y, [list]: y[list].filter((_, j) => j !== i) }));
  return (
    <form className="mdm-panel" aria-label={t('bl.addMeeting')} data-testid="meeting-form" onSubmit={async (e) => {
      e.preventDefault();
      const body = { meetingDate: m.meetingDate, venue: m.venue.trim() || null, minutes: m.minutes.trim() || null, attendees: m.attendees.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), user: a.user || null, role: a.role.trim() || null, team: a.team })), questions: m.questions.filter((q) => q.text.trim()).map((q) => ({ text: q.text.trim(), askedBy: q.askedBy?.trim() || null, answer: q.answer?.trim() || null })), actions: m.actions.filter((a) => a.title.trim() && a.owner && a.dueDate).map((a) => ({ title: a.title.trim(), owner: a.owner, dueDate: a.dueDate, priority: a.priority })) };
      if (await run(() => bl.addMeeting(x.id, body), t('bl.meetingSaved'))) setM(null);
    }}>
      <h3>{t('bl.addMeeting')}</h3>
      <div className="form-grid">
        <Field label={t('bl.meetingDate')} name="meetingDate" error={error}><input type="date" max={dayIST()} value={m.meetingDate} onChange={(e) => set('meetingDate', e.target.value)} required data-testid="meeting-date" /></Field>
        <Field label={t('bl.venue')} name="venue" error={error}><input value={m.venue} onChange={(e) => set('venue', e.target.value)} maxLength={200} /></Field>
      </div>
      <h4>{t('bl.attendees')}</h4>
      {m.attendees.map((a, i) => (
        <div key={i} className="form-grid">
          <Field label={t('bl.attName')} name={`attendees.${i}.name`} error={error}><input value={a.name} onChange={(e) => upd('attendees', i, 'name', e.target.value)} maxLength={120} data-testid={`att-name-${i}`} /></Field>
          <Field label={t('bl.attRole')} name={`attendees.${i}.role`} error={error}><input value={a.role} onChange={(e) => upd('attendees', i, 'role', e.target.value)} maxLength={80} /></Field>
          <Field label={t('bl.attTeam')} name={`attendees.${i}.team`} error={error}><select value={a.team} onChange={(e) => upd('attendees', i, 'team', e.target.value)}>{['ESTIMATION', 'EXECUTION', 'COMMERCIAL', 'OTHER'].map((k) => <option key={k} value={k}>{t(`bl.team.${k}`)}</option>)}</select></Field>
          <button type="button" className="btn" onClick={() => del('attendees', i)}>{t('bl.removeRow')}</button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => add('attendees', { name: '', user: '', role: '', team: 'OTHER' })}>{t('bl.addAttendee')}</button>
      <h4>{t('bl.questions')}</h4>
      {m.questions.map((q, i) => (
        <div key={i} className="form-grid">
          <Field label={t('bl.question')} name={`questions.${i}.text`} error={error}><input value={q.text} onChange={(e) => upd('questions', i, 'text', e.target.value)} maxLength={1000} data-testid={`q-text-${i}`} /></Field>
          <Field label={t('bl.answer')} name={`questions.${i}.answer`} error={error}><input value={q.answer ?? ''} onChange={(e) => upd('questions', i, 'answer', e.target.value)} maxLength={2000} /></Field>
          <button type="button" className="btn" onClick={() => del('questions', i)}>{t('bl.removeRow')}</button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => add('questions', { text: '', askedBy: '', answer: '' })} data-testid="add-question">{t('bl.addQuestion')}</button>
      <Field label={t('bl.minutes')} name="minutes" error={error}><textarea rows={3} value={m.minutes} onChange={(e) => set('minutes', e.target.value)} maxLength={10000} data-testid="meeting-minutes" /></Field>
      <h4>{t('bl.actions')}</h4>
      {m.actions.map((a, i) => (
        <div key={i} className="form-grid">
          <Field label={t('bl.actionTitle')} name={`actions.${i}.title`} error={error}><input value={a.title} onChange={(e) => upd('actions', i, 'title', e.target.value)} maxLength={200} data-testid={`act-title-${i}`} /></Field>
          <LookupField id={`act-owner-${i}`} label={t('bl.owner')} lookup="proj/people" valueKey="code" value={a.owner} onChange={(v) => upd('actions', i, 'owner', v)} />
          <Field label={t('bl.due')} name={`actions.${i}.dueDate`} error={error}><input type="date" value={a.dueDate} onChange={(e) => upd('actions', i, 'dueDate', e.target.value)} data-testid={`act-due-${i}`} /></Field>
          <Field label={t('bl.priority')} name={`actions.${i}.priority`} error={error}><select value={a.priority} onChange={(e) => upd('actions', i, 'priority', e.target.value)}>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
          <button type="button" className="btn" onClick={() => del('actions', i)}>{t('bl.removeRow')}</button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => add('actions', { title: '', owner: '', dueDate: dayIST(7), priority: 'MEDIUM' })} data-testid="add-action">{t('bl.addAction')}</button>
      {error?.form && <p className="field-error" role="alert" data-testid="meeting-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>}
      <div className="actions"><button type="button" className="btn" onClick={() => setM(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="meeting-save">{t('bl.save')}</button></div>
    </form>
  );
}
function Approvals({ x }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'pack-history', x.id, x.rowVersion], queryFn: () => bl.history(x.id), retry: false });
  const cq = useQuery({ queryKey: ['proj', 'pack-compare', x.id, x.rowVersion], queryFn: () => bl.compare(x.id), enabled: Boolean(x.supersedesId), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.approvals')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div data-testid="pack-approvals">
      <h2>{t('tab.approvals')}</h2>
      {q.data.approvals.length === 0 ? <p className="muted">{t('obj.noApprovals')}</p> : <ul className="mdm-list">{q.data.approvals.map((a, i) => <li key={i}><strong>{a.event}</strong> · {a.actor}{a.step_code ? ` · ${a.step_code}` : ''} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.comment ? ` · ${a.comment}` : ''}</li>)}</ul>}
      <h2>{t('bl.versions')}</h2>
      <ul className="mdm-list" data-testid="pack-versions">{q.data.versions.map((v) => <li key={v.id}><Link to={`/proj/baseline-pack?id=${v.id}`}>{v.docNo}</Link> · {t('bl.packNo', { n: v.packNo })} · {v.statusLabel}{v.reason ? ` · ${v.reason}` : ''}</li>)}</ul>
      {cq.data && (
        <>
          <h2>{t('bl.compare', { a: cq.data.previous.docNo })}</h2>
          <table className="data-table" data-testid="pack-compare"><tbody>{cq.data.totals.filter((r) => r.changed).map((r) => <tr key={r.key}><th scope="row">{r.key}</th><td className="num">{inr(r.before)}</td><td className="num">{inr(r.after)}</td></tr>)}{cq.data.lines.map((l) => <tr key={l.key}><th scope="row">{l.key}</th><td>{l.change}</td><td>{l.after?.amount ?? l.after ?? ''}</td></tr>)}</tbody></table>
        </>
      )}
      <h2>{t('obj.changes')}</h2>
      <ul className="mdm-list">{q.data.audit.map((a, i) => <li key={i}>{a.action} · {a.actor} · <span className="muted small">{String(a.at).slice(0, 16).replace('T', ' ')}</span>{a.reason ? ` · ${a.reason}` : ''}</li>)}</ul>
    </div>
  );
}
function Related({ x }) {
  const t = useT('proj');
  return (
    <div data-testid="pack-related">
      <h2>{t('bl.related')}</h2>
      <ul className="mdm-list">
        <li><Link to={`/proj/projects`}>{x.projectCode} {x.projectName}</Link>{x.projectState ? ` · ${x.projectState}` : ''}</li>
        {x.tender && <li>{t('bl.tender')}: <Link to={`/bd/tender?id=${x.tender.id}`}>{x.tender.docNo}</Link></li>}
        {x.award && <li>{t('fa.award')}: {x.award.docNo}{x.award.loaNo ? ` · ${x.award.loaNo}` : ''}</li>}
        {x.estimate && <li>{t('bl.estimate')}: <Link to={`/est/estimate?id=${x.estimate.id}`}>{x.estimate.ref}</Link> · {x.estimate.status}</li>}
        <li><Link to={`/proj/baseline-compare?projectId=${x.projectId}`}>{t('cmp.title')}</Link></li>
      </ul>
      <h2>{t('tab.files')}</h2>
      <AttachmentList entity="proj_project" entityId={x.projectId} canEdit={x.can.edit} />{x.can.edit && <FileUploader entity="proj_project" entityId={x.projectId} />}
    </div>
  );
}
