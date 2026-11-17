import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { pl } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Generate Activities from Template (part 13.01, FR-03): a template in force repeated per WBS node or per location (a floor cycle: shuttering, reinforcement, concreting, curing, deshuttering), with its links and the chain from one floor to the next,
// or one activity per WBS node that carries BOQ quantities, with its BOQ lines; the server shows what it will make before it makes it, and an activity already there is skipped.
export default function GeneratePage() {
  const t = useT('plan');
  usePageTitle(t('gen.title'));
  const qc = useQueryClient(); const sp = useSearch();
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(Number(sp.get('scheduleId')) || null);
  const [f, setF] = useState({ mode: 'TEMPLATE', templateId: '', wbsIds: [], locationIds: [], wbsId: '', chain: true, duration: '5', prefix: '' });
  const [preview, setPreview] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const sq = useQuery({ queryKey: ['plan', 'schedule', scheduleId], queryFn: () => pl.schedule(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const pid = projectId ?? sq.data?.projectId ?? null;
  const oq = useQuery({ queryKey: ['plan', 'options', pid], queryFn: () => pl.options(pid), enabled: Boolean(pid), retry: false });
  const tpl = oq.data?.templates.find((x) => x.id === Number(f.templateId));
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPreview(null); };
  const toggle = (k, id) => set(k, f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id]);
  const body = () => ({ mode: f.mode, templateId: f.templateId ? Number(f.templateId) : null, wbsIds: f.wbsIds, locationIds: f.locationIds, wbsId: f.wbsId ? Number(f.wbsId) : null, chain: f.chain, duration: Number(f.duration || 0), prefix: f.prefix.trim() });
  const show = async (e) => { e.preventDefault(); setError(null); setNote(null); setBusy(true); try { setPreview(await pl.preview(scheduleId, body())); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const make = async () => { setError(null); setBusy(true); try { const r = await pl.generate(scheduleId, body()); setNote(t('gen.done', { c: r.created, l: r.linked, s: r.skipped })); setPreview(null); qc.invalidateQueries({ queryKey: ['plan'] }); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const editable = sq.data && sq.data.can.edit;
  return (
    <section aria-labelledby="pg-h" data-testid="plan-generate">
      <PageHeader id="pg-h" title={t('gen.title')} />
      <form className="mdm-panel" onSubmit={(e) => e.preventDefault()} aria-label={t('f.schedule')}>
        <SchedulePicker projectId={pid} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); setPreview(null); }} onSchedule={(v) => { setScheduleId(v); setPreview(null); }} editableOnly testId="pg" />
      </form>
      {!scheduleId && <p className="muted" data-testid="pg-choose">{t('gen.choose')}</p>}
      {scheduleId && (sq.isPending || oq.isPending) && <Skeleton label={t('gen.title')} rows={4} />}
      {sq.isError && <ErrorState error={sq.error} onRetry={sq.refetch} />}
      {sq.data && !editable && <p className="field-error" role="alert" data-testid="pg-locked">{t('gen.locked')}</p>}
      {editable && oq.data && (
        <form className="mdm-panel" onSubmit={show} data-testid="pg-form" aria-label={t('gen.what')}>
          <fieldset><legend>{t('gen.mode')}</legend>
            {['TEMPLATE', 'BOQ'].map((m) => <label key={m} className="check"><input type="radio" name="mode" value={m} checked={f.mode === m} onChange={() => set('mode', m)} data-testid={`pg-mode-${m}`} /> {t(`gen.mode.${m}`)}</label>)}
          </fieldset>
          <div className="form-grid">
            {f.mode === 'TEMPLATE' && <Field label={t('gen.template')} name="templateId" error={error}><select value={f.templateId} onChange={(e) => set('templateId', e.target.value)} required data-testid="pg-template"><option value="">—</option>{oq.data.templates.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name} ({t(`gen.target.${x.target}`)})</option>)}</select></Field>}
            {f.mode === 'TEMPLATE' && tpl?.target === 'LOCATION' && <Field label={t('gen.underWbs')} name="wbsId" error={error}><select value={f.wbsId} onChange={(e) => set('wbsId', e.target.value)} data-testid="pg-wbs"><option value="">—</option>{oq.data.wbs.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>}
            {f.mode === 'BOQ' && <Field label={t('gen.duration')} name="duration" error={error}><input type="number" min="0" step="1" value={f.duration} onChange={(e) => set('duration', e.target.value)} data-testid="pg-duration" /></Field>}
            <Field label={t('gen.prefix')} name="prefix" error={error}><input value={f.prefix} onChange={(e) => set('prefix', e.target.value)} maxLength={10} pattern="[A-Za-z0-9._-]*" data-testid="pg-prefix" /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={f.chain} onChange={(e) => set('chain', e.target.checked)} data-testid="pg-chain" /> {f.mode === 'BOQ' ? t('gen.chainBoq') : t('gen.chain')}</label>
          {((f.mode === 'TEMPLATE' && tpl?.target === 'WBS') || f.mode === 'BOQ') && (
            <fieldset><legend>{f.mode === 'BOQ' ? t('gen.wbsBoq') : t('gen.wbsTargets')}</legend>
              {oq.data.wbs.length === 0 ? <p className="muted">{t('gen.noWbs')}</p> : oq.data.wbs.map((w) => <label key={w.id} className="check" style={{ paddingLeft: `${(w.level - 1) * 1.2}rem` }}><input type="checkbox" checked={f.wbsIds.includes(w.id)} onChange={() => toggle('wbsIds', w.id)} data-testid="pg-wbs-pick" /> {w.code} {w.name}</label>)}
            </fieldset>
          )}
          {f.mode === 'TEMPLATE' && tpl?.target === 'LOCATION' && (
            <fieldset><legend>{t('gen.locTargets')}</legend>
              {oq.data.locations.length === 0 ? <p className="muted">{t('gen.noLocations')}</p> : oq.data.locations.map((l) => <label key={l.id} className="check"><input type="checkbox" checked={f.locationIds.includes(l.id)} onChange={() => toggle('locationIds', l.id)} data-testid="pg-loc-pick" /> {l.code} {l.name} <span className="muted">({l.type})</span></label>)}
            </fieldset>
          )}
          {error?.form && <p className="field-error" role="alert" data-testid="pg-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
          <div className="actions"><button type="submit" className="btn" disabled={busy || (f.mode === 'TEMPLATE' && !f.templateId)} data-testid="pg-preview">{t('gen.preview')}</button></div>
        </form>
      )}
      {note && <p className="mdm-banner" role="status" data-testid="pg-note">{note} <button type="button" className="btn" onClick={() => navigateTo(`/plan/activities?scheduleId=${scheduleId}`)} data-testid="pg-open">{t('act.title')}</button></p>}
      {preview && (
        <div className="mdm-panel" data-testid="pg-result">
          <h2>{t('gen.willMake', { c: preview.create, s: preview.skip, l: preview.links.length })}</h2>
          <div className="table-scroll"><table className="data-table" data-testid="pg-rows"><caption className="sr-only">{t('gen.preview')}</caption><thead><tr><th>{t('f.code')}</th><th>{t('f.activity')}</th><th className="num">{t('f.dur')}</th><th>{t('gen.boq')}</th><th /></tr></thead>
            <tbody>{preview.rows.map((r) => <tr key={r.code} data-testid="pg-row" data-exists={r.exists ? '1' : '0'}><td>{r.code}</td><td>{r.name}</td><td className="num">{r.duration}</td><td>{(r.boq ?? []).map((b) => `${b.itemCode} ${b.qty}`).join(', ') || '—'}</td><td>{r.exists ? t('gen.exists') : ''}</td></tr>)}</tbody></table></div>
          <p className="muted" data-testid="pg-links">{t('gen.links')}: {preview.links.map((l) => `${l.pred} → ${l.succ}`).slice(0, 30).join(' · ')}{preview.links.length > 30 ? ' …' : ''}</p>
          <div className="actions"><button type="button" className="btn btn-primary" onClick={make} disabled={busy || preview.create === 0} data-testid="pg-run">{t('gen.run', { n: preview.create })}</button></div>
        </div>
      )}
    </section>
  );
}
