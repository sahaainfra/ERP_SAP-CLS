import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { DISCIPLINES, est, measurePreview, mto, qty } from './api.js';
import { DrawingViewer, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Take-off Sheet (part 09.02, FR-01, FR-03, FR-05, FR-06): the measurement lines of a drawing revision, each by a formula template (concrete volume, plaster area, excavation and so on: number x length x breadth x height
// less deductions), beside the drawing; an engineering MTO lists line items with specs and quantities as given (typed or pasted from the design tool). The checker releases a revision; a new drawing revision is a new revision
// of the sheet with its delta; a released take-off explodes into materials and feeds the quantities of a draft estimate.
export const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
const fromLine = (l) => ({ boqItemRef: l.boqItemRef ?? '', description: l.description, location: l.location ?? '', template: l.template, workItemId: l.workItemId, materialItemId: l.materialItemId, spec: l.spec ?? '', nos: l.nos ?? '1', length: l.length ?? '', breadth: l.breadth ?? '', height: l.height ?? '', deduction: l.deduction ?? '0', quantity: l.template === 'DIRECT' ? l.quantity : '', uom: l.uom, saved: l.quantity });
const blank = (template) => ({ boqItemRef: '', description: '', location: '', template, workItemId: null, materialItemId: null, spec: '', nos: '1', length: '', breadth: '', height: '', deduction: '0', quantity: '', uom: '', saved: null });
const s = (v) => (v === '' || v == null ? null : String(v));
const toBody = (l) => ({ boqItemRef: s(l.boqItemRef), description: l.description.trim(), location: s(l.location), template: l.template, workItemId: l.workItemId || null, materialItemId: l.materialItemId || null, spec: s(l.spec), nos: s(l.nos) ?? '1', length: s(l.length), breadth: s(l.breadth), height: s(l.height), deduction: s(l.deduction) ?? '0', quantity: l.template === 'DIRECT' ? s(l.quantity) : null, uom: s(l.uom) });
/** Rows pasted from a design tool: tag, description, spec, quantity, unit (tab-separated). */
const pasted = (text) => String(text).split(/\r?\n/).filter((x) => x.trim()).map((x) => x.split('\t')).filter((c) => !/^tag|^ref/i.test(c[0] ?? '')).map((c) => ({ ...blank('DIRECT'), boqItemRef: (c[0] ?? '').trim(), description: (c[1] ?? '').trim(), spec: (c[2] ?? '').trim(), quantity: (c[3] ?? '').trim().replace(/,/g, ''), uom: (c[4] ?? '').trim() }));

export default function TakeoffPage() {
  const t = useT('est');
  const qc = useQueryClient();
  const sp = useSearch(); const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['est', 'takeoff', id], queryFn: () => mto.takeoff(id), enabled: Boolean(id), retry: false });
  const tq = useQuery({ queryKey: ['est', 'templates'], queryFn: mto.templates, retry: false });
  const dq = useQuery({ queryKey: ['est', 'drafts'], queryFn: () => est.list({ 'filter[status]': 'DRAFT', pageSize: 100 }), enabled: q.data?.status === 'APPROVED', retry: false });
  const x = q.data; const tpls = x?.templates ?? tq.data ?? [];
  usePageTitle(x ? x.ref : t('to.new'));
  const [h, setH] = useState({ kind: 'TAKEOFF', discipline: 'CIVIL', title: '', projectId: sp.get('projectId') ? Number(sp.get('projectId')) : null, drawingRef: '', drawingRev: '' });
  const [lines, setLines] = useState([]); const [paste, setPaste] = useState(''); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [estimateId, setEstimateId] = useState('');
  useEffect(() => { if (x) { setLines(x.lines.map(fromLine)); setEstimateId(x.estimateId ?? ''); } }, [x?.id, x?.rowVersion]);
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['est'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const go = (r) => { if (r?.id) navigateTo(`/est/takeoff?id=${r.id}`, { force: true }); };
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="to-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 8).join('; ')}` : ''}</p>;
  if (!id) {
    return (
      <section aria-labelledby="to-new-h" data-testid="takeoff-new">
        <PageHeader id="to-new-h" title={t('to.new')} />{errBox}
        <form className="mdm-panel mdm-fields" onSubmit={async (e) => { e.preventDefault(); go(await run(() => mto.createTakeoff({ ...h, title: h.title.trim(), drawingRef: h.drawingRef.trim(), drawingRev: h.drawingRev.trim() || null }))); }} aria-label={t('to.new')}>
          <Field label={t('to.kind')} name="kind" error={error}><select value={h.kind} onChange={(e) => setH({ ...h, kind: e.target.value })} data-testid="to-kind"><option value="TAKEOFF">{t('kind.TAKEOFF')}</option><option value="ENGINEERING">{t('kind.ENGINEERING')}</option></select></Field>
          <Field label={t('to.discipline')} name="discipline" error={error}><select value={h.discipline} onChange={(e) => setH({ ...h, discipline: e.target.value })} data-testid="to-discipline">{DISCIPLINES.map((d) => <option key={d} value={d}>{t(`disc.${d}`)}</option>)}</select></Field>
          <Field label={t('head.title')} name="title" error={error}><input value={h.title} onChange={(e) => setH({ ...h, title: e.target.value })} required data-testid="to-title" /></Field>
          <LookupField id="to-project" label={t('new.project')} lookup="iam/projects" value={h.projectId} onChange={(v) => setH({ ...h, projectId: v })} required error={error?.fields?.projectId} />
          <Field label={t('to.drawingRef')} name="drawingRef" error={error}><input value={h.drawingRef} onChange={(e) => setH({ ...h, drawingRef: e.target.value })} required data-testid="to-drawing" /></Field>
          <Field label={t('to.drawingRev')} name="drawingRev" error={error}><input value={h.drawingRev} onChange={(e) => setH({ ...h, drawingRev: e.target.value })} data-testid="to-drawing-rev" /></Field>
          <div className="actions"><button type="button" className="btn" onClick={() => navigateTo('/est/takeoffs')}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="to-create">{t('to.create')}</button></div>
        </form>
      </section>
    );
  }
  if (q.error?.status === 403) return <NoPermission what={t('to.list')} permission="est.takeoff.view" />;
  if (q.isPending) return <Skeleton label={t('to.list')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const edit = x.can.edit; const eng = x.kind === 'ENGINEERING';
  const set = (i, patch) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const tplOf = (code) => tpls.find((p) => p.code === code);
  return (
    <section aria-labelledby="to-h" data-testid="takeoff" data-status={x.status}>
      <header>
        <PageHeader id="to-h" title={<>{t(`kind.${x.kind}`)} {x.ref} <StatusBadge status={TONE[x.status]} label={x.statusLabel} /></>} subtitle={<>{x.title} · {x.project?.name ?? x.tender?.docNo} · {t('to.drawingIs', { ref: x.drawingRef, rev: x.drawingRev ?? '–' })} · {x.disciplineLabel}</>} />
        {errBox}{note && <p className="mdm-banner" role="status" data-testid="to-note">{note}</p>}
        <div className="actions-row no-print" data-testid="to-actions">
          {x.can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => mto.takeoffAct(id, 'submit'), t('to.sent'))} data-testid="to-submit">{t('to.send')}</button>}
          {x.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => mto.takeoffAct(id, 'withdraw', { reason: r }), t('obj.withdrawn'))}>{t('act.withdraw')}</button>}
          {x.can.revise && <button type="button" className="btn" onClick={() => { const rev = window.prompt(t('to.newDrawingRev')); if (rev === null) return; const body = { drawingRev: rev.trim() || null }; if (x.status === 'APPROVED') { const r = window.prompt(t('act.why')); if (!r) return; run(() => mto.takeoffAct(id, 'amend', { ...body, reason: r }), t('to.revised')).then(go); } else run(() => mto.takeoffAct(id, 'revisions', body), t('to.revised')).then(go); }} data-testid="to-revise">{t('to.revise')}</button>}
          <button type="button" className="btn" onClick={() => navigateTo(`/est/mto-delta?kind=takeoff&id=${id}`)} data-testid="to-delta">{t('to.delta')}</button>
          <button type="button" className="btn" onClick={() => navigateTo(`/est/mto-explosion?kind=takeoff&id=${id}`)} data-testid="to-explosion">{t('to.explosion')}</button>
          {x.can.cancel && <button type="button" className="btn" onClick={() => why((r) => mto.takeoffAct(id, 'cancel', { reason: r }), t('obj.cancelled'))}>{t('act.cancel')}</button>}
          {x.can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('act.confirmDelete'))) { const r = await run(() => mto.removeTakeoff(id)); if (r) navigateTo('/est/takeoffs', { force: true }); } }}>{t('act.delete')}</button>}
          {x.can.print && <a className="btn" href={`/api/v1/est/takeoffs/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
        </div>
      </header>
      <div className="split-view" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
        <form onSubmit={(e) => { e.preventDefault(); run(() => mto.takeoffLines(id, { lines: lines.map(toBody), version: x.rowVersion }), t('to.saved')); }} aria-label={t('to.lines')} data-testid="to-lines">
          <h2>{t('to.lines')}</h2>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th scope="col">{t('to.boqRef')}</th><th scope="col">{t('items.description')}</th><th scope="col">{t('to.template')}</th>{eng ? <th scope="col">{t('to.spec')}</th> : <><th scope="col">{t('to.nos')}</th><th scope="col">L</th><th scope="col">B</th><th scope="col">{t('to.hd')}</th><th scope="col">{t('to.deduct')}</th></>}<th scope="col">{t('items.qty')}</th><th scope="col">{t('items.uom')}</th>{edit && <th scope="col"><span className="sr-only">{t('act.remove')}</span></th>}</tr></thead>
            <tbody>{lines.map((l, i) => {
              const tpl = tplOf(l.template); const v = measurePreview(tpl, l); const dis = (d) => !edit || !tpl?.dims.includes(d);
              return (
                <tr key={i} data-testid={`to-row-${i}`}>
                  <td data-label={t('to.boqRef')}><input value={l.boqItemRef} onChange={(e) => set(i, { boqItemRef: e.target.value })} disabled={!edit} size={6} aria-label={t('to.boqRef')} data-testid={`to-ref-${i}`} /></td>
                  <td data-label={t('items.description')}><input value={l.description} onChange={(e) => set(i, { description: e.target.value })} disabled={!edit} aria-label={t('items.description')} data-testid={`to-desc-${i}`} />{!eng && edit && <LookupField id={`to-work-${i}`} label={t('to.workItem')} lookup="mdm/items" value={l.workItemId} onChange={(w) => set(i, { workItemId: w })} compact />}</td>
                  <td data-label={t('to.template')}><select value={l.template} onChange={(e) => set(i, { template: e.target.value, uom: '' })} disabled={!edit} aria-label={t('to.template')} data-testid={`to-tpl-${i}`}>{tpls.filter((p) => (eng ? p.code === 'DIRECT' : true)).map((p) => <option key={p.code} value={p.code}>{t(`tpl.${p.code}`)}</option>)}</select></td>
                  {eng ? <td data-label={t('to.spec')}><input value={l.spec} onChange={(e) => set(i, { spec: e.target.value })} disabled={!edit} aria-label={t('to.spec')} data-testid={`to-spec-${i}`} /></td> : <>
                    <td data-label={t('to.nos')}><input type="number" min="0" step="0.001" value={l.nos} onChange={(e) => set(i, { nos: e.target.value })} disabled={!edit || l.template === 'DIRECT'} size={4} aria-label={t('to.nos')} data-testid={`to-nos-${i}`} /></td>
                    {['length', 'breadth', 'height'].map((d) => <td key={d} data-label={t(`dim.${d}`)}><input type="number" min="0" step="0.001" value={l[d]} onChange={(e) => set(i, { [d]: e.target.value })} disabled={dis(d)} size={5} aria-label={t(`dim.${d}`)} data-testid={`to-${d}-${i}`} /></td>)}
                    <td data-label={t('to.deduct')}><input type="number" min="0" step="0.001" value={l.deduction} onChange={(e) => set(i, { deduction: e.target.value })} disabled={!edit || l.template === 'DIRECT'} size={5} aria-label={t('to.deduct')} data-testid={`to-ded-${i}`} /></td></>}
                  <td data-label={t('items.qty')} data-testid={`to-qty-${i}`}>{l.template === 'DIRECT' ? <input type="number" min="0" step="0.001" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} disabled={!edit} size={6} aria-label={t('items.qty')} data-testid={`to-direct-${i}`} /> : v == null ? '—' : qty(v)}</td>
                  <td data-label={t('items.uom')}><input value={l.uom || tpl?.uom || ''} onChange={(e) => set(i, { uom: e.target.value })} disabled={!edit} size={4} aria-label={t('items.uom')} data-testid={`to-uom-${i}`} /></td>
                  {edit && <td><button type="button" className="btn btn-small" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label={t('items.removeRow', { no: l.boqItemRef || i + 1 })}>✕</button></td>}
                </tr>);
            })}</tbody>
          </table></div>
          {lines.length === 0 && <p className="muted">{t('to.noLines')}</p>}
          {edit && <div className="actions"><button type="button" className="btn" onClick={() => setLines([...lines, blank(eng ? 'DIRECT' : 'CONCRETE_VOLUME')])} data-testid="to-add">{t('to.addLine')}</button><button type="submit" className="btn btn-primary" data-testid="to-save">{t('to.saveLines')}</button></div>}
          {edit && eng && (<div className="mdm-fields"><Field label={t('to.paste')} name="paste" hint={t('to.pasteHint')}><textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} data-testid="to-paste" /></Field><button type="button" className="btn" onClick={() => { setLines([...lines, ...pasted(paste)]); setPaste(''); }} data-testid="to-paste-add">{t('to.pasteAdd')}</button> <Link to="/import">{t('imp.center')}</Link></div>)}
          {error?.fields && <ul className="field-error small" data-testid="to-problems">{Object.entries(error.fields).slice(0, 20).map(([k, m]) => <li key={k}>{k}: {m}</li>)}</ul>}
          <h2>{t('to.byItem')}</h2>
          <ul className="mdm-list" data-testid="to-items">{x.items.map((it) => <li key={`${it.ref}|${it.uom}`}>{it.ref ?? it.description}: <strong>{qty(it.qty)}</strong> {it.uom} <span className="muted small">({t('to.lineCount', { n: it.lines })})</span></li>)}</ul>
          {x.status === 'APPROVED' && (
            <div className="mdm-panel mdm-fields" data-testid="to-apply">
              <h2>{t('to.applyTitle')}</h2>
              <Field label={t('to.estimateId')} name="estimateId" hint={t('to.applyHint')}><select value={estimateId} onChange={(e) => setEstimateId(e.target.value)} data-testid="to-estimate"><option value="">–</option>{(dq.data?.data ?? []).filter((r) => !x.projectId || r.projectId === x.projectId).map((r) => <option key={r.id} value={r.id}>{r.ref} · {r.title}</option>)}</select></Field>
              <button type="button" className="btn btn-primary" onClick={async () => { const r = await run(() => mto.takeoffAct(id, 'apply', { estimateId: Number(estimateId) || null })); if (r) setNote(t('to.applied', { n: r.matched.length, m: r.unmatched.length })); }} data-testid="to-apply-go">{t('to.apply')}</button>
            </div>)}
        </form>
        <DrawingViewer entity="mto_takeoff" entityId={id} canEdit={edit} />
      </div>
      <h2>{t('tab.versions')}</h2>
      <ul className="mdm-list" data-testid="to-revisions">{x.revisions.map((r) => <li key={r.id}>{r.id === id ? <strong>R{r.revisionNo}</strong> : <Link to={`/est/takeoff?id=${r.id}`}>R{r.revisionNo}</Link>} · {r.drawingRev ?? '–'} · {r.statusLabel} · {r.createdBy}</li>)}</ul>
      <p className="small"><Link to="/est/takeoffs">{t('to.list')}</Link></p>
    </section>
  );
}
