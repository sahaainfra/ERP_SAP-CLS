import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, rmc } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './RmcParts.jsx';

// Mix Designs (part 20.01, FR-03 and FR-04): the quantities of each material for 1 m3 of a grade, checked live against the same arithmetic the server applies (absolute volumes plus air within the tolerance, water-binder ratio, target mean strength),
// the trial results, the effective dates and the versions. The plant quality engineer and the quality control manager approve; only an approved mix inside its dates can be produced.
const COMPS = ['CEMENT', 'FLY_ASH', 'GGBS', 'SAND', 'AGG_10', 'AGG_20', 'WATER', 'ADMIXTURE'];
const blank = (sg) => ({ plantId: '', grade: 'M25', slumpMm: '100', effectiveFrom: '', effectiveTo: '', lines: Object.fromEntries(COMPS.map((c) => [c, { qty: '', itemId: '', sg: String(sg[c] ?? '') }])), trials: [{ date: '', slumpMm: '', cube7: '', cube28: '' }] });
const toInitial = (x, sg) => ({ id: x.id, plantId: String(x.plantId), grade: x.grade, slumpMm: String(x.slumpMm), effectiveFrom: x.effectiveFrom ?? '', effectiveTo: x.effectiveTo ?? '', lines: Object.fromEntries(COMPS.map((c) => { const l = x.components.find((q) => q.component === c); return [c, { qty: l ? String(l.qty) : '', itemId: l?.itemId ? String(l.itemId) : '', sg: String(l?.sg ?? sg[c] ?? '') }]; })), trials: x.trials.length ? x.trials.map((r) => ({ date: r.date, slumpMm: r.slumpMm ?? '', cube7: r.cube7 ?? '', cube28: r.cube28 ?? '' })) : [{ date: '', slumpMm: '', cube7: '', cube28: '' }] });
const props = (v) => COMPS.filter((c) => Number(v.lines[c].qty) > 0).map((c) => ({ component: c, itemId: v.lines[c].itemId ? Number(v.lines[c].itemId) : null, qty: Number(v.lines[c].qty), ...(v.lines[c].sg ? { sg: Number(v.lines[c].sg) } : {}) }));
const trials = (v) => v.trials.filter((r) => r.date).map((r) => ({ date: r.date, ...(r.slumpMm !== '' ? { slumpMm: Number(r.slumpMm) } : {}), ...(r.cube7 !== '' ? { cube7: Number(r.cube7) } : {}), ...(r.cube28 !== '' ? { cube28: Number(r.cube28) } : {}), note: '' }));
function MixForm({ initial, onSave, busy, error }) {
  const t = useT('rmc'); const o = useQuery({ queryKey: ['rmc', 'mix-options'], queryFn: () => rmc.get('/mix-designs/options'), retry: false }); const [v, setV] = useState(initial); const list = props(v);
  const ck = useQuery({ queryKey: ['rmc', 'mix-check', JSON.stringify(list), v.grade], queryFn: () => rmc.post('/mix-designs/check', { grade: v.grade, proportions: list }), enabled: list.length > 0, retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('mx.title')} permission="rmc.mix_design.create" />; if (o.isPending) return <Skeleton label={t('mx.title')} rows={3} />; const d = o.data; const fe = error?.fields ?? {}; const c = ck.data;
  const setL = (k, f, val) => setV({ ...v, lines: { ...v.lines, [k]: { ...v.lines[k], [f]: val } } }); const setT = (i, k, val) => setV({ ...v, trials: v.trials.map((r, j) => (j === i ? { ...r, [k]: val } : r)) });
  return (
    <div className="mdm-panel" data-testid="rmc-mix-form"><div className="form-grid">
      {!initial.id && <Field label={t('mx.plant')} name="plantId" error={fe.plantId}><select value={v.plantId} onChange={(e) => setV({ ...v, plantId: e.target.value })} style={big} data-testid="rmc-mix-plant"><option value="">—</option>{d.plants.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>}
      <Field label={t('mx.grade')} name="grade" error={fe.grade}><select value={v.grade} onChange={(e) => setV({ ...v, grade: e.target.value })} style={big} data-testid="rmc-mix-grade">{d.grades.map((g) => <option key={g.id} value={g.id}>{g.id} (fck {g.fck})</option>)}</select></Field>
      <Field label={t('mx.slump')} name="slumpMm" error={fe.slumpMm}><input type="number" min="0" max="250" value={v.slumpMm} onChange={(e) => setV({ ...v, slumpMm: e.target.value })} style={big} data-testid="rmc-mix-slump" /></Field>
      <Field label={t('mx.effectiveFrom')} name="effectiveFrom" error={fe.effectiveFrom}><input type="date" value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} style={big} data-testid="rmc-mix-from" /></Field>
      <Field label={t('mx.effectiveTo')} name="effectiveTo" error={fe.effectiveTo}><input type="date" value={v.effectiveTo} onChange={(e) => setV({ ...v, effectiveTo: e.target.value })} style={big} /></Field></div>
      <div className="table-scroll"><table className="data-table" data-testid="rmc-mix-lines"><caption>{t('mx.proportions')}</caption><thead><tr><th>{t('mx.material')}</th><th>{t('mx.item')}</th><th className="num">{t('mx.qty')}</th><th className="num">{t('mx.sg')}</th><th className="num">{t('mx.volume')}</th></tr></thead>
        <tbody>{COMPS.map((k) => <tr key={k}><td>{t(`mx.c.${k}`)}</td>
          <td><select aria-label={`${t(`mx.c.${k}`)} ${t('mx.item')}`} value={v.lines[k].itemId} onChange={(e) => setL(k, 'itemId', e.target.value)} style={{ minHeight: 44 }} data-testid={`rmc-mix-item-${k}`}><option value="">—</option>{d.items.map((q) => <option key={q.id} value={q.id}>{q.code} {q.name}</option>)}</select></td>
          <td><input aria-label={`${t(`mx.c.${k}`)} ${t('mx.qty')}`} type="number" min="0" step="any" inputMode="decimal" value={v.lines[k].qty} onChange={(e) => setL(k, 'qty', e.target.value)} style={{ minHeight: 44, width: 110 }} data-testid={`rmc-mix-qty-${k}`} /></td>
          <td><input aria-label={`${t(`mx.c.${k}`)} ${t('mx.sg')}`} type="number" min="0.5" max="8" step="0.01" value={v.lines[k].sg} onChange={(e) => setL(k, 'sg', e.target.value)} style={{ minHeight: 44, width: 80 }} /></td>
          <td className="num">{c?.lines.find((l) => l.component === k)?.volume?.toFixed(4) ?? '—'}</td></tr>)}</tbody></table></div>
      {c && <div className="mdm-panel" data-testid="rmc-mix-check" data-ok={c.withinTolerance}><p>{t('mx.total', { n: c.totalVolume.toFixed(3), air: c.airVolume.toFixed(3) })}</p><p>{t('mx.wc')}: <strong data-testid="rmc-mix-wc">{c.wcRatio}</strong> · {t('mx.binder')}: {c.binder} · {t('mx.target', { n: c.targetMean ?? '—' })}</p>
        <p role="status" data-testid="rmc-mix-verdict">{c.withinTolerance ? t('mx.volumeOk', { n: c.deviationPct }) : t('mx.volumeBad', { n: c.deviationPct, t: c.tolerancePct })}</p></div>}
      <h2>{t('mx.trials')}</h2>
      {v.trials.map((r, i) => (
        <div className="form-grid" key={i} data-testid="rmc-mix-trial"><Field label={t('mx.trialDate')} name={`t${i}d`} error={null}><input type="date" value={r.date} onChange={(e) => setT(i, 'date', e.target.value)} style={big} /></Field><Field label={t('mx.slump')} name={`t${i}s`} error={null}><input type="number" value={r.slumpMm} onChange={(e) => setT(i, 'slumpMm', e.target.value)} style={big} /></Field><Field label={t('mx.cube7')} name={`t${i}7`} error={null}><input type="number" step="any" value={r.cube7} onChange={(e) => setT(i, 'cube7', e.target.value)} style={big} /></Field><Field label={t('mx.cube28')} name={`t${i}28`} error={fe.trials}><input type="number" step="any" value={r.cube28} onChange={(e) => setT(i, 'cube28', e.target.value)} style={big} data-testid={`rmc-mix-cube28-${i}`} /></Field>
          <button type="button" className="btn" onClick={() => setV({ ...v, trials: v.trials.filter((_, j) => j !== i) })}>{t('pl.remove')}</button></div>))}
      <div className="actions-row"><button type="button" className="btn" onClick={() => setV({ ...v, trials: [...v.trials, { date: '', slumpMm: '', cube7: '', cube28: '' }] })} data-testid="rmc-mix-add-trial">{t('mx.addTrial')}</button>
        <button type="button" className="btn btn-primary" style={big} disabled={busy || (!initial.id && !v.plantId) || list.length === 0} onClick={() => onSave({ plantId: Number(v.plantId), grade: v.grade, slumpMm: Number(v.slumpMm || 0), proportions: list, trials: trials(v), effectiveFrom: v.effectiveFrom || null, effectiveTo: v.effectiveTo || null })} data-testid="rmc-mix-save">{t('save')}</button></div>
    </div>
  );
}
function Mix({ id }) {
  const t = useT('rmc'); const { q, guard } = useRecord('/mix-designs', id, t('mx.title'), 'rmc.mix_design.view'); const { error, run, busy, note } = useRunner(); const [editing, setEditing] = useState(false); const o = useQuery({ queryKey: ['rmc', 'mix-options'], queryFn: () => rmc.get('/mix-designs/options'), retry: false, enabled: Boolean(q.data?.can?.edit) }); usePageTitle(t('mx.title')); if (guard) return guard; const x = q.data;
  const sg = Object.fromEntries((o.data?.components ?? []).map((c) => [c.id, c.sg]));
  return (
    <div data-testid="rmc-mix-object" data-status={x.status}><h1 id="mx-h">{x.code} <Status x={x} /></h1>
      <p><Link to="/rmc/mix-designs">{t('mx.title')}</Link> · {x.docNo} · {t('pl.version', { n: x.versionNo })} · {x.plant} · {x.grade} · {x.usable ? t('mx.usable') : t('mx.notUsable')}</p>
      <ErrorLine error={error} id="rmc-error" />{note && <p className="mdm-banner" role="status" data-testid="rmc-note">{note}</p>}
      {x.problems?.length > 0 && <div className="mdm-panel" data-testid="rmc-mix-problems"><h2>{t('mx.before')}</h2><ul>{x.problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul></div>}
      {x.can.edit && <div className="actions-row no-print"><button type="button" className="btn" onClick={() => setEditing(!editing)} data-testid="rmc-mix-edit">{t('edit')}</button></div>}
      {editing && x.can.edit && o.data ? <MixForm initial={toInitial(x, sg)} busy={busy} error={error} onSave={async (v) => { const { plantId, ...rest } = v; void plantId; const r = await run(() => rmc.edit('/mix-designs', x.id, { ...rest, rowVersion: x.version }), t('mx.saved')); if (r) setEditing(false); }} /> : (
        <div className="mdm-panel" data-testid="rmc-mix-view">
          <div className="table-scroll"><table className="data-table"><caption>{t('mx.proportions')}</caption><thead><tr><th>{t('mx.material')}</th><th>{t('mx.item')}</th><th className="num">{t('mx.qty')}</th><th className="num">{t('mx.volume')}</th></tr></thead><tbody>{x.components.map((c) => <tr key={c.component} data-testid="rmc-mix-comp"><td>{t(`mx.c.${c.component}`)}</td><td>{c.item ? `${c.item.code} ${c.item.name}` : '—'}</td><td className="num">{c.qty}</td><td className="num">{c.volume.toFixed(4)}</td></tr>)}</tbody></table></div>
          <p>{t('mx.wc')}: <strong data-testid="rmc-mix-wc">{x.wcRatio}</strong> · {t('mx.binder')}: {x.binder} · {t('mx.slump')}: {x.slumpMm} · {t('mx.total', { n: x.totalVolume.toFixed(3), air: x.airVolume.toFixed(3) })} · {t('mx.target', { n: x.targetMean })}</p>
          <p>{t('mx.effective')}: {x.effectiveFrom ? fmtDate(x.effectiveFrom) : '—'} {x.effectiveTo ? `→ ${fmtDate(x.effectiveTo)}` : ''}</p>
          <div className="table-scroll"><table className="data-table"><caption>{t('mx.trials')}</caption><thead><tr><th>{t('mx.trialDate')}</th><th className="num">{t('mx.slump')}</th><th className="num">{t('mx.cube7')}</th><th className="num">{t('mx.cube28')}</th></tr></thead><tbody>{x.trials.map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td className="num">{r.slumpMm ?? '—'}</td><td className="num">{r.cube7 ?? '—'}</td><td className="num">{r.cube28 ?? '—'}</td></tr>)}</tbody></table></div></div>)}
      <DocBar kind="/mix-designs" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
function MixNew() {
  const t = useT('rmc'); const { error, run, busy } = useRunner(); usePageTitle(t('mx.new')); const o = useQuery({ queryKey: ['rmc', 'mix-options'], queryFn: () => rmc.get('/mix-designs/options'), retry: false });
  if (o.isPending) return <Skeleton label={t('mx.new')} rows={3} />; const sg = Object.fromEntries((o.data?.components ?? []).map((c) => [c.id, c.sg]));
  return <section aria-labelledby="mxn-h"><h1 id="mxn-h">{t('mx.new')}</h1><p><Link to="/rmc/mix-designs">{t('mx.title')}</Link></p><ErrorLine error={error} id="rmc-error" /><MixForm initial={blank(sg)} busy={busy} error={error} onSave={async (v) => { const r = await run(() => rmc.make('/mix-designs', v)); if (r) navigateTo(`/rmc/mix-designs?id=${r.id}`); }} /></section>;
}
export default function MixDesignsPage() {
  const t = useT('rmc'); usePageTitle(t('mx.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="mx-h"><Mix id={id} /></section>; if (sp.get('new')) return <MixNew />;
  return (
    <section aria-labelledby="mxs-h" data-testid="rmc-mixes"><h1 id="mxs-h">{t('mx.title')}</h1><p className="muted">{t('mx.intro')}</p>
      <div className="actions-row no-print"><Link to="/rmc/mix-designs?new=1" data-testid="rmc-mix-new">{t('mx.new')}</Link></div>
      <ListReport listCode="rmc.mix_designs" endpoint="/rmc/mix-designs" title={t('mx.title')} session={session.data} rowHref={(r) => `/rmc/mix-designs?id=${r.id}`} onOpen={(r) => navigateTo(`/rmc/mix-designs?id=${r.id}`)} cardFields={['code', 'plant', 'grade', 'status']} statusKey="status" empty={{ title: t('mx.emptyTitle'), text: t('mx.emptyBody') }} />
    </section>
  );
}
