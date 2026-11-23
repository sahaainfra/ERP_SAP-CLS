import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from './api.js';

// Part 27.11: the Scenario Builder (form / wizard, UI v3 §3.3) and the Scenario Comparison (report). The impact is computed by the server on copies
// of the approved forecast, the schedule and the cash forecast (POST /bi/scenarios/preview) — live as the drivers change — and nothing live changes.

const read = async (path) => (await api.get(path)).data;
const write = (method, path, body) => api[method](path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/bi/scenarios${p.toString() ? `?${p}` : ''}`);
};
const EMPTY = { name: '', projectId: '', overheadPerDay: '0', drivers: [{ type: 'MATERIAL_PRICE', match: 'steel', pct: '10' }] };
function useDebounced(value, ms = 400) { const [v, setV] = useState(value); useEffect(() => { const h = setTimeout(() => setV(value), ms); return () => clearTimeout(h); }, [value, ms]); return v; }
const numberish = (defs, d) => { const def = defs.find((x) => x.type === d.type); const out = { type: d.type }; for (const f of def?.fields ?? []) { const v = d[f.key]; if (v === '' || v == null) continue; out[f.key] = f.kind === 'number' ? Number(v) : v; } return out; };

function Impact({ r, compact = false }) {
  const t = useT('scn');
  const { money, number, date } = useFormat();
  const inr = (v) => (v == null ? '—' : money(String(v)));
  const sign = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${money(String(v))}`);
  if (!r) return null;
  return <KpiRow testid="scn-impact" label={t('impact')}>
    <KpiTile testid="scn-eac" valueTestid="scn-eac-value" label={t('t.eac')} kind="money" amount={r.cost?.eac} value={inr(r.cost?.eac)} tone={r.cost?.eacDelta > 0 ? 'error' : 'neutral'}>{r.cost ? `${sign(r.cost.eacDelta)} ${t('vsBase')}` : t('noForecast')}</KpiTile>
    <KpiTile label={t('t.margin')} kind="money" amount={r.cost?.margin} value={inr(r.cost?.margin)} tone={r.cost?.marginDelta < 0 ? 'warning' : 'neutral'}>{r.cost ? sign(r.cost.marginDelta) : null}</KpiTile>
    <KpiTile testid="scn-finish" label={t('t.finish')} kind="time" value={r.schedule?.finish ? date(r.schedule.finish) : '—'} tone={r.schedule?.shiftDays > 0 ? 'warning' : 'neutral'}>{r.schedule?.finish ? t('later', { n: number(String(r.schedule.shiftDays), { decimals: 0 }) }) : t('noSchedule')}</KpiTile>
    {!compact && <KpiTile testid="scn-cash" label={t('t.cash')} kind="money" amount={r.cash?.lowest} value={inr(r.cash?.lowest)} tone={r.cash?.weeksBelowFloor?.length ? 'error' : 'neutral'}>{r.cash ? `${sign(r.cash.lowestDelta)} · ${r.cash.weeksBelowFloor.length ? t('belowFloor', { n: r.cash.weeksBelowFloor.length }) : t('aboveFloor')}` : t('noCash')}</KpiTile>}
  </KpiRow>;
}

function Builder({ projects, defs, can }) {
  const t = useT('scn');
  const { money } = useFormat();
  const cache = useQueryClient();
  const search = useSearch();
  const editId = search.get('id');
  const existing = useQuery({ queryKey: ['bi', 'scenario', editId], queryFn: () => read(`/bi/scenarios/${editId}`), enabled: Boolean(editId), retry: false });
  const [form, setForm] = useState(EMPTY);
  const [step, setStep] = useState(1);
  useEffect(() => { if (existing.data) setForm({ name: existing.data.name, projectId: String(existing.data.projectId), overheadPerDay: String(existing.data.overheadPerDay ?? 0), drivers: existing.data.drivers.map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v)]))) }); }, [existing.data]);
  const body = { projectId: Number(form.projectId), overheadPerDay: Number(form.overheadPerDay || 0), drivers: form.drivers.map((d) => numberish(defs, d)) };
  // the same rules as the server (inline validation): a driver is complete when every required field is filled and every number is in range
  const invalid = form.drivers.flatMap((d, i) => (defs.find((x) => x.type === d.type)?.fields ?? []).filter((f) => {
    const v = d[f.key]; if (v === '' || v == null) return f.required;
    return f.kind === 'number' && (Number.isNaN(Number(v)) || Number(v) < f.min || Number(v) > f.max);
  }).map((f) => `drivers.${i}.${f.key}`));
  const live = useDebounced(JSON.stringify(body));
  const preview = useQuery({ queryKey: ['bi', 'scn-preview', live], queryFn: () => api.post('/bi/scenarios/preview', JSON.parse(live)).then((r) => r.data), enabled: JSON.parse(live).projectId > 0 && live === JSON.stringify(body) && form.drivers.length > 0 && !invalid.length, retry: false, placeholderData: (p) => p });
  const save = useMutation({
    mutationFn: (saved) => (editId && existing.data ? write('patch', `/bi/scenarios/${editId}`, { name: form.name, drivers: body.drivers, overheadPerDay: body.overheadPerDay, save: saved, rowVersion: existing.data.rowVersion })
      : write('post', '/bi/scenarios', { name: form.name, ...body, save: saved })),
    onSuccess: (res) => { cache.invalidateQueries({ queryKey: ['bi'] }); go({ tab: 'saved', id: res.data.id }); },
  });
  const setDriver = (i, patch) => setForm({ ...form, drivers: form.drivers.map((d, k) => (k === i ? { ...d, ...patch } : d)) });
  const fieldErrors = { ...Object.fromEntries(invalid.map((k) => [k, t('invalid')])), ...Object.fromEntries((preview.error?.details ?? save.error?.details ?? []).map((d) => [d.field, d.message])) };
  if (editId && existing.isPending) return <Skeleton label={t('tab.builder')} rows={6} />;
  return <form data-testid="scn-builder" onSubmit={(e) => { e.preventDefault(); save.mutate(true); }}>
    <ol className="tabs scn-steps" aria-label={t('steps')} data-testid="scn-steps">
      {[1, 2, 3].map((n) => <li key={n}><button type="button" className={`btn${step === n ? ' btn-primary' : ''}`} aria-current={step === n ? 'step' : undefined} onClick={() => setStep(n)}>{n}. {t(`step.${n}`)}</button></li>)}
    </ol>
    {step === 1 && <Card title={t('step.1')} testid="scn-scope">
      <Field name="scn-name" label={`${t('f.name')} *`} error={fieldErrors.name}><input required minLength={3} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field name="scn-project" label={`${t('f.project')} *`}><select required value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}><option value="">{t('f.choose')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
      <Field name="scn-overhead" label={t('f.overhead')} hint={t('f.overheadHint')}><input type="number" inputMode="decimal" min={0} step="any" value={form.overheadPerDay} onChange={(e) => setForm({ ...form, overheadPerDay: e.target.value })} /></Field>
      <button type="button" className="btn btn-primary" onClick={() => setStep(2)} disabled={!form.projectId}>{t('next')}</button>
    </Card>}
    {step === 2 && <Card title={t('step.2')} subtitle={t('driversHint')} testid="scn-drivers">
      {form.drivers.map((d, i) => { const def = defs.find((x) => x.type === d.type); return <fieldset key={i} className="scn-driver" data-testid="scn-driver">
        <legend className="sr-only">{t('driver', { n: i + 1 })}</legend>
        <Field name={`scn-d${i}-type`} label={t('f.driver')}><select value={d.type} onChange={(e) => setDriver(i, { type: e.target.value })}>{defs.map((x) => <option key={x.type} value={x.type}>{t(`d.${x.type}`)}</option>)}</select></Field>
        {(def?.fields ?? []).map((f) => <Field key={f.key} name={`scn-d${i}-${f.key}`} label={`${t(`k.${f.key}`)}${f.required ? ' *' : ''}`} error={fieldErrors[`drivers.${i}.${f.key}`]} hint={f.kind === 'number' ? `${f.min} – ${f.max}` : undefined}>
          {f.kind === 'number' ? <input type="number" inputMode="decimal" step="any" min={f.min} max={f.max} required={f.required} value={d[f.key] ?? ''} onChange={(e) => setDriver(i, { [f.key]: e.target.value })} />
            : <input type="text" maxLength={60} required={f.required} value={d[f.key] ?? ''} onChange={(e) => setDriver(i, { [f.key]: e.target.value })} />}
        </Field>)}
        {form.drivers.length > 1 && <button type="button" className="btn" onClick={() => setForm({ ...form, drivers: form.drivers.filter((_, k) => k !== i) })}>{t('remove')}</button>}
      </fieldset>; })}
      <div className="actions-row"><button type="button" className="btn" onClick={() => setForm({ ...form, drivers: [...form.drivers, { type: 'SCHEDULE_DELAY', days: '5' }] })} data-testid="scn-add">{t('add')}</button>
        <button type="button" className="btn btn-primary" onClick={() => setStep(3)}>{t('next')}</button></div>
    </Card>}
    {step === 3 && <Card title={t('step.3')} subtitle={preview.data?.method} testid="scn-results">
      {preview.isPending && form.projectId ? <Skeleton label={t('impact')} rows={4} /> : preview.data && <>
        {preview.data.cost && <><h3>{t('r.cost')}</h3><p className="muted small">{t('source')}: {preview.data.cost.source}</p>
          <div className="table-scroll"><table className="data-table" data-testid="scn-lines"><thead><tr><th>{t('r.line')}</th><th className="num">{t('r.base')}</th><th className="num">{t('r.change')}</th><th className="num">{t('r.scenario')}</th></tr></thead>
            <tbody>{preview.data.cost.lines.map((l) => <tr key={l.label}><td data-label={t('r.line')}>{l.label}</td><td data-label={t('r.base')} className="num">{money(String(l.baseEac))}</td><td data-label={t('r.change')} className="num">{money(String(l.delta))}</td><td data-label={t('r.scenario')} className="num">{money(String(l.eac))}</td></tr>)}</tbody></table></div></>}
        <ul className="wd-todo" data-testid="scn-effects">{preview.data.effects.map((e, k) => <li key={k}>{t(`d.${e.driver}`)}: {e.why}{e.amount ? ` → ${money(String(e.amount))}` : ''}</li>)}</ul>
        {preview.data.cash && <Chart type="line" title={t('r.cash')} exportName="scenario-cash" data={{ categories: preview.data.cash.series.map((s) => s.week.slice(5)), unit: '₹', series: [{ name: t('r.base'), values: preview.data.cash.series.map((s) => s.base) }, { name: t('r.scenario'), values: preview.data.cash.series.map((s) => s.scenario) }] }} />}
      </>}
    </Card>}
    {preview.error && !Object.keys(fieldErrors).length && <ErrorState error={preview.error} />}
    {save.error && <ErrorState error={save.error} />}
    <div className="scn-sticky" data-testid="scn-sticky">
      <Impact r={preview.data} compact />
      <div className="actions-row">
        <button type="button" className="btn" onClick={() => save.mutate(false)} disabled={!can.create || save.isPending || !form.name || !form.projectId || invalid.length > 0} data-testid="scn-draft">{t('saveDraft')}</button>
        <button type="submit" className="btn btn-primary" disabled={!can.create || save.isPending || !form.name || !form.projectId || invalid.length > 0} data-testid="scn-save">{t('save')}</button>
        <button type="button" className="btn" onClick={() => { if (window.confirm(t('confirmCancel'))) { setForm(EMPTY); setStep(1); go({ id: '' }); } }}>{t('cancel')}</button>
      </div>
    </div>
  </form>;
}

function Saved() {
  const t = useT('scn');
  const { money, dateTime } = useFormat();
  const cache = useQueryClient();
  const search = useSearch();
  const id = search.get('id');
  const q = useQuery({ queryKey: ['bi', 'scenarios'], queryFn: () => read('/bi/scenarios'), retry: false });
  const one = useQuery({ queryKey: ['bi', 'scenario', id], queryFn: () => read(`/bi/scenarios/${id}`), enabled: Boolean(id), retry: false });
  const [pick, setPick] = useState([]);
  const [action, setAction] = useState({ kind: 'TASK', assignee: '', note: '' });
  const [shareTo, setShareTo] = useState('');
  const convert = useMutation({ mutationFn: () => write('post', `/bi/scenarios/${id}/actions`, action), onSuccess: () => { setAction({ kind: 'TASK', assignee: '', note: '' }); cache.invalidateQueries({ queryKey: ['bi'] }); } });
  const share = useMutation({ mutationFn: () => write('put', `/bi/scenarios/${id}/share`, { users: shareTo.split(',').map((s) => s.trim()).filter(Boolean) }), onSuccess: () => cache.invalidateQueries({ queryKey: ['bi'] }) });
  if (q.isPending) return <Skeleton label={t('tab.saved')} rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const sign = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${money(String(v))}`);
  return <>
    {id && one.data && <Card title={`${one.data.docNo} · ${one.data.name}`} subtitle={one.data.project} testid="scn-record" menu={<button type="button" className="btn" onClick={() => go({ id: '' })}>{t('back')}</button>}>
      <Impact r={one.data.results} />
      <p className="muted small">{one.data.results?.method} {t('computedAt', { at: dateTime(one.data.computedAt) })}</p>
      <div className="actions-row">{one.data.can.edit && <Link to={`/bi/scenarios?tab=builder&id=${one.data.id}`}>{t('edit')}</Link>}</div>
      {one.data.can.share && <div className="actions-row"><Field name="scn-share" label={t('shareWith')} hint={t('shareHint')}><input value={shareTo} onChange={(e) => setShareTo(e.target.value)} /></Field>
        <button type="button" className="btn" onClick={() => share.mutate()} disabled={share.isPending} data-testid="scn-share">{t('share')}</button></div>}
      {share.error && <ErrorState error={share.error} />}
      {one.data.can.convert && <form data-testid="scn-convert" onSubmit={(e) => { e.preventDefault(); convert.mutate(); }}>
        <Field name="scn-kind" label={t('a.kind')}><select value={action.kind} onChange={(e) => setAction({ ...action, kind: e.target.value })}><option value="TASK">{t('a.TASK')}</option><option value="ASSUMPTION">{t('a.ASSUMPTION')}</option></select></Field>
        <Field name="scn-assignee" label={t('a.assignee')}><input required value={action.assignee} onChange={(e) => setAction({ ...action, assignee: e.target.value })} /></Field>
        <Field name="scn-note" label={t('a.note')}><textarea required minLength={5} maxLength={1000} value={action.note} onChange={(e) => setAction({ ...action, note: e.target.value })} /></Field>
        <button type="submit" className="btn btn-primary" disabled={convert.isPending} data-testid="scn-convert-submit">{t('a.submit')}</button>
        {convert.error && <ErrorState error={convert.error} />}
      </form>}
      {one.data.actions.length > 0 && <ul className="wd-todo" data-testid="scn-actions">{one.data.actions.map((a, k) => <li key={k}>{t(`a.${a.kind}`)} · {a.assignee} · <Link to={`/tasks?open=${a.taskId}`}>{t('a.task')}</Link></li>)}</ul>}
    </Card>}
    {!q.data.rows.length ? <EmptyState title={t('empty')} message={t('emptyBody')} action={<button type="button" className="btn btn-primary" onClick={() => go({ tab: 'builder' })}>{t('tab.builder')}</button>} /> : <>
      <div className="actions-row"><button type="button" className="btn" disabled={pick.length < 2} onClick={() => go({ tab: 'compare', ids: pick.join(',') })} data-testid="scn-compare">{t('compareN', { n: pick.length })}</button></div>
      <div className="table-scroll"><table className="data-table" data-testid="scn-list">
        <thead><tr><th><span className="sr-only">{t('pick')}</span></th><th>{t('r.scenario')}</th><th>{t('f.project')}</th><th className="num">{t('t.eac')}</th><th className="num">{t('t.finish')}</th><th>{t('status')}</th></tr></thead>
        <tbody>{q.data.rows.map((s) => <tr key={s.id} data-testid="scn-row">
          <td data-label={t('pick')}><input type="checkbox" aria-label={t('pickOne', { name: s.name })} checked={pick.includes(s.id)} onChange={(e) => setPick(e.target.checked ? [...pick, s.id].slice(-6) : pick.filter((x) => x !== s.id))} /></td>
          <td data-label={t('r.scenario')}><Link to={`/bi/scenarios?tab=saved&id=${s.id}`}>{s.docNo}</Link> {s.name}</td><td data-label={t('f.project')}>{s.project}</td>
          <td data-label={t('t.eac')} className="num">{sign(s.summary.eacDelta)}</td><td data-label={t('t.finish')} className="num">{s.summary.finishDeltaDays == null ? '—' : t('later', { n: s.summary.finishDeltaDays })}</td>
          <td data-label={t('status')}><StatusBadge status={s.status === 'SAVED' ? 'APPROVED' : s.status === 'DRAFT' ? 'DRAFT' : 'CANCELLED'} label={t(`st.${s.status}`)} size="sm" /></td>
        </tr>)}</tbody>
      </table></div></>}
  </>;
}

function Compare() {
  const t = useT('scn');
  const { money, date } = useFormat();
  const ids = useSearch().get('ids') ?? '';
  const q = useQuery({ queryKey: ['bi', 'scn-compare', ids], queryFn: () => read(`/bi/scenarios/compare?ids=${ids}`), enabled: /^\d+(,\d+)+$/.test(ids), retry: false });
  const [format, setFormat] = useState('xlsx');
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/bi/scenarios/compare/export?ids=${ids}&format=${format}`, `scenario-comparison.${format}`) });
  if (!/^\d+(,\d+)+$/.test(ids)) return <EmptyState title={t('pickTwo')} message={t('pickTwoBody')} action={<button type="button" className="btn" onClick={() => go({ tab: 'saved' })}>{t('tab.saved')}</button>} />;
  if (q.isPending) return <Skeleton label={t('tab.compare')} rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const c = q.data; const inr = (v) => (v == null ? '—' : money(String(v)));
  const chart = { categories: c.scenarios.map((s) => s.docNo), unit: '₹', series: [{ name: t('r.change'), values: c.scenarios.map((s) => s.cost?.eacDelta ?? 0) }] };
  const rows = [['t.eac', (s) => inr(s.cost?.eac), inr(c.base?.eac)], ['t.margin', (s) => inr(s.cost?.margin), inr(c.base?.margin)], ['t.finish', (s) => (s.schedule?.finish ? date(s.schedule.finish) : '—'), c.base?.finish ? date(c.base.finish) : '—'],
    ['t.cash', (s) => inr(s.cash?.lowest), inr(c.base?.lowest)]];
  return <>
    <div className="actions-row"><label className="sr-only" htmlFor="scn-format">{t('format')}</label><select id="scn-format" value={format} onChange={(e) => setFormat(e.target.value)}>{['xlsx', 'csv', 'pdf'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
      <button type="button" className="btn" onClick={() => download.mutate()} disabled={download.isPending} data-testid="scn-export">{t('export')}</button></div>
    {!c.sameProject && <p className="muted">{t('differentProjects')}</p>}
    <Card title={t('c.eacChange')} testid="scn-compare-chart"><Chart type="bar" data={chart} title={t('c.eacChange')} exportName="scenario-eac-change" /></Card>
    <div className="table-scroll"><table className="data-table" data-testid="scn-compare-table">
      <thead><tr><th>{t('c.figure')}</th><th className="num">{t('r.base')}</th>{c.scenarios.map((s) => <th key={s.id} className="num">{s.docNo}<br /><span className="muted small">{s.name}</span></th>)}</tr></thead>
      <tbody>{rows.map(([k, fn, base]) => <tr key={k}><th scope="row">{t(k)}</th><td data-label={t('r.base')} className="num">{base}</td>{c.scenarios.map((s) => <td key={s.id} data-label={s.docNo} className="num">{fn(s)}</td>)}</tr>)}
        <tr><th scope="row">{t('c.drivers')}</th><td />{c.scenarios.map((s) => <td key={s.id} data-label={s.docNo} className="small">{s.drivers.map((d) => t(`d.${d.type}`)).join(', ')}</td>)}</tr></tbody>
    </table></div>
  </>;
}

export function ScenarioBuilder() {
  const t = useT('scn');
  const search = useSearch();
  const tab = ['saved', 'compare'].includes(search.get('tab')) ? search.get('tab') : 'builder';
  usePageTitle(t('title'));
  const defs = useQuery({ queryKey: ['bi', 'scn-drivers'], queryFn: () => read('/bi/scenarios/drivers'), retry: false });
  if (defs.error?.status === 403) return <NoPermission what={t('noPermission')} permission="bi.scenario.view" />;
  if (defs.isPending) return <section><PageHeader title={t('title')} /><Skeleton label={t('title')} rows={6} /></section>;
  if (defs.error) return <section><PageHeader title={t('title')} /><ErrorState error={defs.error} onRetry={defs.refetch} /></section>;
  return <section aria-labelledby="scn-h" data-testid="bi-scenarios">
    <PageHeader id="scn-h" title={tab === 'compare' ? t('compareTitle') : t('title')} subtitle={t('subtitle')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="scn-tabs">
      {['builder', 'saved', 'compare'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'builder' ? '' : k, id: '' })}>{t(`tab.${k}`)}</button>)}
    </div>
    {tab === 'builder' && <Builder projects={defs.data.projects} defs={defs.data.drivers} can={defs.data.can} />}
    {tab === 'saved' && <Saved />}
    {tab === 'compare' && <Compare />}
  </section>;
}
