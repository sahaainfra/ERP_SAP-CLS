import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { DEPS, fmtDate, pl } from './api.js';
import { useSearch } from './parts.jsx';

// Time Impact Analysis (part 13.05, FR-03, BR-01): a fragnet (the activities the event adds and how they tie into the schedule) put into a copy of the schedule as at a date. Step 1 the delay and the date;
// step 2 the fragnet; step 3 the result worked out by the server: completion before and after, the shift, the activities that moved. Saving keeps the result with the delay; the schedule is never written.
const blankAct = (n) => ({ code: `F${n * 10}`, name: '', duration: '1' });
const blankLink = () => ({ pred: '', succ: '', type: 'FS', lag: '0' });

export default function TiaPage() {
  const t = useT('plan');
  usePageTitle(t('tia.title'));
  const sp = useSearch(); const qc = useQueryClient(); const delayId = Number(sp.get('delayId')) || null;
  const [projectId, setProjectId] = useState(null); const [pick, setPick] = useState(delayId);
  const [dataDate, setDataDate] = useState(''); const [acts, setActs] = useState([blankAct(1)]); const [links, setLinks] = useState([blankLink(), blankLink()]); const [noteText, setNoteText] = useState('');
  const [result, setResult] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const pq = useQuery({ queryKey: ['plan', 'projects'], queryFn: pl.projects, retry: false, enabled: !delayId });
  const lq = useQuery({ queryKey: ['plan', 'delays-open', projectId], queryFn: () => pl.delays(`filter[projectId]=${projectId}&filter[status]=DRAFT,RETURNED&pageSize=100`), enabled: Boolean(projectId) && !delayId, retry: false });
  const dq = useQuery({ queryKey: ['plan', 'delay', pick], queryFn: () => pl.delay(pick), enabled: Boolean(pick), retry: false });
  const d = dq.data;
  const oq = useQuery({ queryKey: ['plan', 'delay-options', d?.projectId], queryFn: () => pl.delayOptions(d.projectId), enabled: Boolean(d), retry: false });
  if (dq.error?.status === 403) return <NoPermission what={t('tia.title')} permission="plan.delay.analyse" />;
  const date = dataDate || d?.startDate || '';
  const fragnet = () => ({ activities: acts.map((a) => ({ code: a.code.trim(), name: a.name.trim(), duration: Number(a.duration || 0) })), links: links.filter((l) => l.pred && l.succ).map((l) => ({ pred: l.pred.trim(), succ: l.succ.trim(), type: l.type, lag: Number(l.lag || 0) })) });
  const run = async (fn) => { setError(null); setBusy(true); try { return await fn(); } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const preview = async () => { const r = await run(() => pl.tiaPreview(d.id, { dataDate: date, fragnet: fragnet() })); if (r) setResult(r); };
  const save = async () => { const r = await run(() => pl.tiaSave(d.id, { dataDate: date, fragnet: fragnet(), note: noteText.trim() || null })); if (r) { qc.invalidateQueries({ queryKey: ['plan'] }); navigateTo(`/plan/delays?id=${d.id}`); } };
  const setA = (i, p) => { setActs(acts.map((x, k) => (k === i ? { ...x, ...p } : x))); setResult(null); }; const setL = (i, p) => { setLinks(links.map((x, k) => (k === i ? { ...x, ...p } : x))); setResult(null); };
  const codes = [...acts.map((a) => a.code), ...(oq.data?.activities ?? []).map((a) => a.code)];
  const span = result ? Math.max(1, (Date.parse(result.completionAfter) - Date.parse(oq.data?.schedule?.start ?? result.completionBefore)) / 86_400_000) : 1; const W = 520;
  const bar = (iso) => Math.max(4, (W * (Date.parse(iso) - Date.parse(oq.data?.schedule?.start ?? result.completionBefore))) / 86_400_000 / span);
  return (
    <section aria-labelledby="tia-h" data-testid="plan-tia">
      <h1 id="tia-h">{t('tia.title')}</h1>
      <p className="muted">{t('tia.intro')}</p>
      <form className="mdm-panel" onSubmit={(e) => e.preventDefault()} aria-label={t('tia.step1')} data-testid="tia-step1">
        <h2>{t('tia.step1')}</h2>
        {!delayId && (
          <div className="form-grid">
            <Field label={t('f.project')} name="projectId"><select value={projectId ?? ''} onChange={(e) => { setProjectId(e.target.value ? Number(e.target.value) : null); setPick(null); setResult(null); }} data-testid="tia-project"><option value="">{t('f.chooseProject')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label={t('tia.delay')} name="delayId"><select value={pick ?? ''} onChange={(e) => { setPick(e.target.value ? Number(e.target.value) : null); setResult(null); }} disabled={!projectId} data-testid="tia-delay"><option value="">—</option>{(lq.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.docNo} · {x.title}</option>)}</select></Field>
          </div>
        )}
        {lq.data && lq.data.length === 0 && <p className="muted">{t('tia.noDelays')} <Link to="/plan/delays">{t('dl.title')}</Link></p>}
        {pick && dq.isPending && <Skeleton label={t('tia.title')} rows={2} />}
        {dq.isError && dq.error?.status !== 403 && <ErrorState error={dq.error} onRetry={dq.refetch} />}
        {d && (
          <>
            <p data-testid="tia-delay-line"><Link to={`/plan/delays?id=${d.id}`}>{d.docNo}</Link> · {d.title} · {fmtDate(d.startDate)} – {fmtDate(d.endDate)} · {t(`dr.${d.responsibility}`)}</p>
            {!d.can.analyse && <p className="field-error" role="alert" data-testid="tia-locked">{t('tia.locked')}</p>}
            <div className="form-grid">
              <Field label={t('tia.dataDate')} name="dataDate"><input type="date" value={date} onChange={(e) => { setDataDate(e.target.value); setResult(null); }} required data-testid="tia-date" /></Field>
              <Field label={t('f.schedule')} name="schedule"><input value={oq.data?.schedule ? `${oq.data.schedule.docNo} v${oq.data.schedule.versionNo} · ${fmtDate(oq.data.schedule.finish)}` : '—'} readOnly /></Field>
            </div>
          </>
        )}
      </form>
      {d?.can.analyse && (
        <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); preview(); }} aria-label={t('tia.step2')} data-testid="tia-step2">
          <h2>{t('tia.step2')}</h2>
          <datalist id="tia-codes">{codes.map((c) => <option key={c} value={c} />)}</datalist>
          <div className="table-scroll"><table className="data-table"><caption>{t('tia.fragActs')}</caption><thead><tr><th>{t('f.code')}</th><th>{t('f.name')}</th><th className="num">{t('f.duration')}</th><th><span className="sr-only">{t('act.remove')}</span></th></tr></thead>
            <tbody>{acts.map((a, i) => <tr key={i} data-testid="tia-act"><td><input aria-label={t('f.code')} value={a.code} onChange={(e) => setA(i, { code: e.target.value })} required maxLength={30} size={8} data-testid="tia-act-code" /></td><td><input aria-label={t('f.name')} value={a.name} onChange={(e) => setA(i, { name: e.target.value })} required minLength={2} maxLength={200} data-testid="tia-act-name" /></td><td className="num"><input type="number" min="0" step="1" aria-label={t('f.duration')} value={a.duration} onChange={(e) => setA(i, { duration: e.target.value })} required data-testid="tia-act-dur" /></td><td>{acts.length > 1 && <button type="button" className="btn" onClick={() => setActs(acts.filter((_, k) => k !== i))}>{t('act.remove')}</button>}</td></tr>)}</tbody></table></div>
          <div className="actions"><button type="button" className="btn" onClick={() => setActs([...acts, blankAct(acts.length + 1)])} data-testid="tia-add-act">{t('tia.addAct')}</button></div>
          <div className="table-scroll"><table className="data-table"><caption>{t('tia.fragLinks')}</caption><thead><tr><th>{t('act.pred')}</th><th>{t('tia.succ')}</th><th>{t('act.linkType')}</th><th className="num">{t('act.lag')}</th><th><span className="sr-only">{t('act.remove')}</span></th></tr></thead>
            <tbody>{links.map((l, i) => <tr key={i} data-testid="tia-link"><td><input aria-label={t('act.pred')} list="tia-codes" value={l.pred} onChange={(e) => setL(i, { pred: e.target.value })} maxLength={30} size={8} data-testid="tia-link-pred" /></td><td><input aria-label={t('tia.succ')} list="tia-codes" value={l.succ} onChange={(e) => setL(i, { succ: e.target.value })} maxLength={30} size={8} data-testid="tia-link-succ" /></td><td><select aria-label={t('act.linkType')} value={l.type} onChange={(e) => setL(i, { type: e.target.value })}>{DEPS.map((x) => <option key={x} value={x}>{x}</option>)}</select></td><td className="num"><input type="number" step="1" aria-label={t('act.lag')} value={l.lag} onChange={(e) => setL(i, { lag: e.target.value })} size={4} /></td><td>{links.length > 1 && <button type="button" className="btn" onClick={() => setLinks(links.filter((_, k) => k !== i))}>{t('act.remove')}</button>}</td></tr>)}</tbody></table></div>
          <div className="actions"><button type="button" className="btn" onClick={() => setLinks([...links, blankLink()])} data-testid="tia-add-link">{t('tia.addLink')}</button><button type="submit" className="btn btn-primary" disabled={busy || !date} data-testid="tia-preview">{t('tia.run')}</button></div>
        </form>
      )}
      {error?.form && <p className="field-error" role="alert" data-testid="tia-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
      {result && (
        <div className="mdm-panel" data-testid="tia-result">
          <h2>{t('tia.step3')}</h2>
          <dl className="kv"><div><dt>{t('tia.before')}</dt><dd data-testid="tia-before">{fmtDate(result.completionBefore)}</dd></div><div><dt>{t('tia.after')}</dt><dd data-testid="tia-after">{fmtDate(result.completionAfter)}</dd></div><div><dt>{t('dl.impact')}</dt><dd data-testid="tia-impact">{t('tia.shift', { n: result.impactDays, w: result.impactWorkingDays })}</dd></div><div><dt>{t('tia.criticalHit')}</dt><dd>{result.affectedCritical.join(', ') || '—'}</dd></div></dl>
          <figure style={{ margin: 0 }}><figcaption className="muted">{t('tia.chart')}</figcaption>
            <svg width={W + 120} height={56} role="img" aria-label={t('tia.chartLabel', { b: fmtDate(result.completionBefore), a: fmtDate(result.completionAfter) })} style={{ maxWidth: '100%' }} data-testid="tia-chart">
              <text x={0} y={16} fontSize="12" fill="var(--erp-color-text-secondary)">{t('tia.before')}</text><rect x={90} y={6} width={bar(result.completionBefore)} height={12} rx="3" fill="var(--erp-color-text-muted)" />
              <text x={0} y={44} fontSize="12" fill="var(--erp-color-text-secondary)">{t('tia.after')}</text><rect x={90} y={34} width={bar(result.completionAfter)} height={12} rx="3" fill="var(--erp-chart-1)" /><text x={96 + bar(result.completionAfter)} y={44} fontSize="11" fill="var(--erp-color-text-primary)">+{result.impactDays}</text>
            </svg></figure>
          <div className="table-scroll"><table className="data-table" data-testid="tia-frag"><caption>{t('tia.fragActs')}</caption><thead><tr><th>{t('f.code')}</th><th>{t('f.name')}</th><th>{t('f.es')}</th><th>{t('f.ef')}</th><th>{t('f.critical')}</th></tr></thead>
            <tbody>{result.fragnet.map((a) => <tr key={a.code}><td>{a.code}</td><td>{a.name}</td><td>{fmtDate(a.es)}</td><td>{fmtDate(a.ef)}</td><td>{a.critical ? t('var.yes') : ''}</td></tr>)}</tbody></table></div>
          {result.moved.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="tia-moved"><caption>{t('tia.moved', { n: result.moved.length })}</caption><thead><tr><th>{t('f.code')}</th><th>{t('f.activity')}</th><th>{t('tia.before')}</th><th>{t('tia.after')}</th><th className="num">{t('tia.days')}</th></tr></thead>
            <tbody>{result.moved.slice(0, 50).map((m) => <tr key={m.code} data-testid="tia-moved-row"><td>{m.code}</td><td>{m.name}</td><td>{fmtDate(m.efBefore)}</td><td>{fmtDate(m.efAfter)}</td><td className="num">+{m.shift}</td></tr>)}</tbody></table></div>}
          <Field label={t('wp.note')} name="note"><input value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={1000} data-testid="tia-note" /></Field>
          <p className="muted">{t('tia.copyNote')}</p>
          <div className="actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={save} data-testid="tia-save">{t('tia.save')}</button></div>
        </div>
      )}
    </section>
  );
}
