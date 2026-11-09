import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { DIAS, bendPreview, mto, qty } from './api.js';
import { DrawingViewer, useSearch } from './parts.jsx';
import { TONE } from './TakeoffPage.jsx';

// BBS Editor (part 09.02, FR-02, BR-01): the bar marks of a member: diameter, IS 2502 shape code from the library, the lengths of its legs, the members and bars, and at once the cut length (hooks added, bends deducted, both
// configurable), the total length and the weight (d x d / 162 kg/m); the summary by diameter below. The server works every figure out again on save; the checker releases a revision; a new drawing revision is a new revision.
const fromLine = (l) => ({ member: l.member, barMark: l.barMark, dia: l.dia, shapeCode: l.shapeCode, a: l.a ?? '', b: l.b ?? '', c: l.c ?? '', d: l.d ?? '', membersCount: l.membersCount, barsEach: l.barsEach });
const blank = (member) => ({ member, barMark: '', dia: 12, shapeCode: '00', a: '', b: '', c: '', d: '', membersCount: 1, barsEach: 1 });
const s = (v) => (v === '' || v == null ? null : String(v));
export default function BbsSheetPage() {
  const t = useT('est');
  const qc = useQueryClient();
  const sp = useSearch(); const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['est', 'bbs', id], queryFn: () => mto.bbs(id), enabled: Boolean(id), retry: false });
  const x = q.data;
  usePageTitle(x ? x.ref : t('bbs.new'));
  const [h, setH] = useState({ title: '', projectId: sp.get('projectId') ? Number(sp.get('projectId')) : null, drawingRef: '', drawingRev: '', member: '' });
  const [lines, setLines] = useState([]); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  useEffect(() => { if (x) setLines(x.lines.map(fromLine)); }, [x?.id, x?.rowVersion]);
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['est'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const go = (r) => { if (r?.id) navigateTo(`/est/bbs/sheet?id=${r.id}`, { force: true }); };
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="bbs-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 8).join('; ')}` : ''}</p>;
  if (!id) {
    return (
      <section aria-labelledby="bbs-new-h" data-testid="bbs-new">
        <h1 id="bbs-new-h">{t('bbs.new')}</h1>{errBox}
        <form className="mdm-panel mdm-fields" onSubmit={async (e) => { e.preventDefault(); go(await run(() => mto.createBbs({ title: h.title.trim(), projectId: h.projectId, drawingRef: h.drawingRef.trim(), drawingRev: h.drawingRev.trim() || null, member: h.member.trim() }))); }} aria-label={t('bbs.new')}>
          <Field label={t('head.title')} name="title" error={error}><input value={h.title} onChange={(e) => setH({ ...h, title: e.target.value })} required data-testid="bbs-title" /></Field>
          <LookupField id="bbs-project" label={t('new.project')} lookup="iam/projects" value={h.projectId} onChange={(v) => setH({ ...h, projectId: v })} required error={error?.fields?.projectId} />
          <Field label={t('bbs.member')} name="member" error={error}><input value={h.member} onChange={(e) => setH({ ...h, member: e.target.value })} required data-testid="bbs-member" /></Field>
          <Field label={t('to.drawingRef')} name="drawingRef" error={error}><input value={h.drawingRef} onChange={(e) => setH({ ...h, drawingRef: e.target.value })} required data-testid="bbs-drawing" /></Field>
          <Field label={t('to.drawingRev')} name="drawingRev" error={error}><input value={h.drawingRev} onChange={(e) => setH({ ...h, drawingRev: e.target.value })} data-testid="bbs-drawing-rev" /></Field>
          <div className="actions"><button type="button" className="btn" onClick={() => navigateTo('/est/bbs')}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="bbs-create">{t('to.create')}</button></div>
        </form>
      </section>
    );
  }
  if (q.error?.status === 403) return <NoPermission what={t('bbs.list')} permission="est.bb.view" />;
  if (q.isPending) return <Skeleton label={t('bbs.list')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const edit = x.can.edit; const shapeOf = (c) => x.shapes.find((sh) => sh.code === c);
  const set = (i, patch) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const prev = lines.map((l) => bendPreview(shapeOf(l.shapeCode), x.deductions, l));
  const live = new Map(); prev.forEach((p, i) => { if (p) live.set(lines[i].dia, (live.get(lines[i].dia) ?? 0) + p.weight); });
  const liveTotal = [...live.values()].reduce((a, b) => a + b, 0);
  return (
    <section aria-labelledby="bbs-h" data-testid="bbs" data-status={x.status}>
      <header>
        <h1 id="bbs-h">{t('bbs.title')} {x.ref} <StatusBadge status={TONE[x.status]} label={x.statusLabel} /></h1>
        <p className="muted">{x.title} · {x.member} · {x.project?.name} · {t('to.drawingIs', { ref: x.drawingRef, rev: x.drawingRev ?? '–' })}</p>
        <dl className="op-figures"><div><dt>{t('bbs.weight')}</dt><dd data-testid="bbs-weight">{qty(x.weightKg)} kg</dd></div><div><dt>{t('bbs.marks')}</dt><dd>{x.lines.length}</dd></div></dl>
        {errBox}{note && <p className="mdm-banner" role="status" data-testid="bbs-note">{note}</p>}
        <div className="actions-row no-print" data-testid="bbs-actions">
          {x.can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => mto.bbsAct(id, 'submit'), t('to.sent'))} data-testid="bbs-submit">{t('to.send')}</button>}
          {x.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => mto.bbsAct(id, 'withdraw', { reason: r }), t('obj.withdrawn'))}>{t('act.withdraw')}</button>}
          {x.can.revise && <button type="button" className="btn" onClick={() => { const rev = window.prompt(t('to.newDrawingRev')); if (rev === null) return; const body = { drawingRev: rev.trim() || null }; if (x.status === 'APPROVED') { const r = window.prompt(t('act.why')); if (!r) return; run(() => mto.bbsAct(id, 'amend', { ...body, reason: r }), t('to.revised')).then(go); } else run(() => mto.bbsAct(id, 'revisions', body), t('to.revised')).then(go); }} data-testid="bbs-revise">{t('to.revise')}</button>}
          <button type="button" className="btn" onClick={() => navigateTo(`/est/mto-delta?kind=bbs&id=${id}`)} data-testid="bbs-delta">{t('to.delta')}</button>
          <button type="button" className="btn" onClick={() => navigateTo(`/est/bbs-summary?bbsId=${id}`)} data-testid="bbs-summary-link">{t('bbs.summary')}</button>
          {x.can.cancel && <button type="button" className="btn" onClick={() => why((r) => mto.bbsAct(id, 'cancel', { reason: r }), t('obj.cancelled'))}>{t('act.cancel')}</button>}
          {x.can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('act.confirmDelete'))) { const r = await run(() => mto.removeBbs(id)); if (r) navigateTo('/est/bbs', { force: true }); } }}>{t('act.delete')}</button>}
          {x.can.print && <a className="btn" href={`/api/v1/est/bbs/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
        </div>
      </header>
      <details className="mdm-panel" data-testid="bbs-shapes"><summary>{t('bbs.library')}</summary>
        <p className="small muted">{t('bbs.deductions', { d45: x.deductions.d45, d90: x.deductions.d90, d135: x.deductions.d135 })}</p>
        <ul className="mdm-list">{x.shapes.map((sh) => <li key={sh.code}><strong>{sh.code}</strong> · {sh.name} · {t('bbs.legs', { legs: Object.entries(sh.legs ?? {}).map(([k, c]) => (Number(c) === 1 ? k : `${c}${k}`)).join(' + ') })}{sh.hooks ? ` · ${t('bbs.hooks', { n: sh.hooks, d: sh.hookD })}` : ''}</li>)}</ul>
      </details>
      <form onSubmit={(e) => { e.preventDefault(); run(() => mto.bbsLines(id, { lines: lines.map((l) => ({ member: s(l.member), barMark: String(l.barMark).trim(), dia: Number(l.dia), shapeCode: l.shapeCode, a: s(l.a), b: s(l.b), c: s(l.c), d: s(l.d), membersCount: Number(l.membersCount) || 1, barsEach: Number(l.barsEach) || 1 })), version: x.rowVersion }), t('bbs.saved')); }} aria-label={t('bbs.lines')} data-testid="bbs-lines">
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th scope="col">{t('bbs.member')}</th><th scope="col">{t('bbs.mark')}</th><th scope="col">{t('bbs.dia')}</th><th scope="col">{t('bbs.shape')}</th><th scope="col">a</th><th scope="col">b</th><th scope="col">c</th><th scope="col">d</th><th scope="col">{t('bbs.membersCount')}</th><th scope="col">{t('bbs.barsEach')}</th><th scope="col">{t('bbs.nos')}</th><th scope="col">{t('bbs.cut')}</th><th scope="col">{t('bbs.total')}</th><th scope="col">{t('bbs.weightKg')}</th>{edit && <th scope="col"><span className="sr-only">{t('act.remove')}</span></th>}</tr></thead>
          <tbody>{lines.map((l, i) => { const sh = shapeOf(l.shapeCode); const p = prev[i]; return (
            <tr key={i} data-testid={`bbs-row-${i}`}>
              <td data-label={t('bbs.member')}><input value={l.member} onChange={(e) => set(i, { member: e.target.value })} disabled={!edit} size={4} aria-label={t('bbs.member')} /></td>
              <td data-label={t('bbs.mark')}><input value={l.barMark} onChange={(e) => set(i, { barMark: e.target.value })} disabled={!edit} size={4} aria-label={t('bbs.mark')} data-testid={`bbs-mark-${i}`} /></td>
              <td data-label={t('bbs.dia')}><select value={l.dia} onChange={(e) => set(i, { dia: Number(e.target.value) })} disabled={!edit} aria-label={t('bbs.dia')} data-testid={`bbs-dia-${i}`}>{DIAS.map((d) => <option key={d} value={d}>{d}</option>)}</select></td>
              <td data-label={t('bbs.shape')}><select value={l.shapeCode} onChange={(e) => set(i, { shapeCode: e.target.value })} disabled={!edit} aria-label={t('bbs.shape')} data-testid={`bbs-shape-${i}`}>{x.shapes.map((sh2) => <option key={sh2.code} value={sh2.code}>{sh2.code} · {sh2.name}</option>)}</select></td>
              {['a', 'b', 'c', 'd'].map((k) => <td key={k} data-label={k}><input type="number" min="0" step="0.001" value={l[k]} onChange={(e) => set(i, { [k]: e.target.value })} disabled={!edit || !(sh?.legs ?? {})[k]} size={4} aria-label={t('bbs.dim', { k })} data-testid={`bbs-${k}-${i}`} /></td>)}
              <td data-label={t('bbs.membersCount')}><input type="number" min="1" step="1" value={l.membersCount} onChange={(e) => set(i, { membersCount: e.target.value })} disabled={!edit} size={3} aria-label={t('bbs.membersCount')} data-testid={`bbs-members-${i}`} /></td>
              <td data-label={t('bbs.barsEach')}><input type="number" min="1" step="1" value={l.barsEach} onChange={(e) => set(i, { barsEach: e.target.value })} disabled={!edit} size={3} aria-label={t('bbs.barsEach')} data-testid={`bbs-bars-${i}`} /></td>
              <td data-label={t('bbs.nos')}>{p?.nos ?? '—'}</td><td data-label={t('bbs.cut')} data-testid={`bbs-cut-${i}`}>{p ? qty(p.cut) : '—'}</td><td data-label={t('bbs.total')}>{p ? qty(p.total) : '—'}</td><td data-label={t('bbs.weightKg')} data-testid={`bbs-w-${i}`}>{p ? qty(p.weight) : '—'}</td>
              {edit && <td><button type="button" className="btn btn-small" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label={t('items.removeRow', { no: l.barMark || i + 1 })}>✕</button></td>}
            </tr>); })}</tbody>
        </table></div>
        {lines.length === 0 && <p className="muted">{t('bbs.noLines')}</p>}
        {edit && <div className="actions"><button type="button" className="btn" onClick={() => setLines([...lines, blank(x.member)])} data-testid="bbs-add">{t('bbs.addMark')}</button><button type="submit" className="btn btn-primary" data-testid="bbs-save">{t('to.saveLines')}</button></div>}
        {edit && <p className="small" data-testid="bbs-live">{t('bbs.live', { kg: qty(Math.round(liveTotal * 1000) / 1000) })}</p>}
        {error?.fields && <ul className="field-error small">{Object.entries(error.fields).slice(0, 20).map(([k, m]) => <li key={k}>{k}: {m}</li>)}</ul>}
      </form>
      <h2>{t('bbs.byDia')}</h2>
      <div className="table-wrap"><table className="data-table" data-testid="bbs-by-dia"><thead><tr><th scope="col">{t('bbs.dia')}</th><th scope="col">{t('bbs.marks')}</th><th scope="col">{t('bbs.nos')}</th><th scope="col">{t('bbs.total')}</th><th scope="col">{t('bbs.weightKg')}</th><th scope="col">MT</th></tr></thead>
        <tbody>{x.byDia.map((d) => <tr key={d.dia} data-testid={`bbs-dia-row-${d.dia}`}><th scope="row" data-label={t('bbs.dia')}>{d.dia} mm</th><td data-label={t('bbs.marks')}>{d.marks}</td><td data-label={t('bbs.nos')}>{d.bars}</td><td data-label={t('bbs.total')}>{qty(d.totalLength)}</td><td data-label={t('bbs.weightKg')}>{qty(d.weightKg)}</td><td data-label="MT">{d.weightMt}</td></tr>)}</tbody></table></div>
      <DrawingViewer entity="mto_bbs" entityId={id} canEdit={edit} />
      <h2>{t('tab.versions')}</h2>
      <ul className="mdm-list" data-testid="bbs-revisions">{x.revisions.map((r) => <li key={r.id}>{r.id === id ? <strong>R{r.revisionNo}</strong> : <Link to={`/est/bbs/sheet?id=${r.id}`}>R{r.revisionNo}</Link>} · {r.drawingRev ?? '–'} · {r.statusLabel} · {r.createdBy}</li>)}</ul>
      <p className="small"><Link to="/est/bbs">{t('bbs.list')}</Link></p>
    </section>
  );
}
