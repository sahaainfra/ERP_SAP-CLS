import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { ri, today } from './api.js';
import { useRunner } from './XpdParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Market survey entry and index upload (part 15.09, FR-01): a market rate for an item, region and date goes into the rate history; external price indices (cement, steel, bitumen, fuel) are entered by month or pasted as lines `group, region, month, value`.
export default function RateSurveyPage() {
  const t = useT('proc'); usePageTitle(t('i.surveyTitle')); const [q, setQ] = useState(''); const iq = useQuery({ queryKey: ['proc', 'rate-items', q], queryFn: () => ri.items(q), retry: false });
  const [f, setF] = useState({ itemId: '', uom: '', region: '', spec: '', date: today(), rate: '', note: '' }); const [x, setX] = useState({ group: '', region: '', period: today().slice(0, 7), value: '', paste: '' }); const [error, setError] = useState(null); const run = useRunner();
  if (iq.error?.status === 403) return <NoPermission what={t('i.surveyTitle')} permission="proc.rate_intel.survey" />;
  if (iq.isPending) return <Skeleton label={t('i.surveyTitle')} rows={3} />;
  if (iq.isError) return <ErrorState error={iq.error} onRetry={iq.refetch} />;
  const item = iq.data.find((i) => String(i.id) === String(f.itemId)); const set = (k, v) => setF({ ...f, [k]: v });
  const save = async () => { setError(null); try { const o = await ri.survey({ itemId: Number(f.itemId), uom: f.uom || item?.base_uom, region: f.region || undefined, spec: f.spec || null, date: f.date, rate: Number(f.rate), note: f.note || null }); navigateTo(`/proc/rate-intelligence?obs=${o.id}`); } catch (e) { setError(errorInfo(e)); } };
  const index = () => run.run(() => ri.indexSet({ group: x.group, region: x.region || undefined, period: x.period, value: Number(x.value) }), t('i.indexSaved')).then(() => setX({ ...x, value: '' }));
  const paste = () => { const rows = x.paste.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [group, region, period, value] = l.split(',').map((s) => s.trim()); return { group, region: region || undefined, period, value: Number(value) }; }); run.run(() => ri.indexImport(rows), t('i.indexImported')).then((r) => r && setX({ ...x, paste: '' })); };
  return (
    <section aria-labelledby="rs-h" data-testid="proc-rs"><PageHeader id="rs-h" title={t('i.surveyTitle')} subtitle={t('i.surveyIntro')} meta={<Link to="/proc/rate-intelligence">{t('i.title')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(); }} noValidate data-testid="rs-survey"><h2>{t('i.surveyEntry')}</h2>
        <div className="form-grid">
          <Field label={t('i.findItem')} name="q" error={error}><input value={q} maxLength={60} onChange={(ev) => setQ(ev.target.value)} style={{ minHeight: 44 }} data-testid="rs-find" /></Field>
          <Field label={t('i.item')} name="itemId" error={error}><select value={f.itemId} onChange={(ev) => { const it = iq.data.find((i) => String(i.id) === ev.target.value); setF({ ...f, itemId: ev.target.value, uom: it?.base_uom ?? '' }); }} style={{ minHeight: 44 }} data-testid="rs-item"><option value="">{t('x.choose')}</option>{iq.data.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}</select></Field>
          <Field label={t('i.unit')} name="uom" error={error}><input value={f.uom} maxLength={20} onChange={(ev) => set('uom', ev.target.value)} style={{ minHeight: 44 }} data-testid="rs-uom" /></Field>
          <Field label={t('i.rateRs')} name="rate" error={error}><input type="number" min="0" step="0.01" value={f.rate} onChange={(ev) => set('rate', ev.target.value)} style={{ minHeight: 44 }} data-testid="rs-rate" /></Field>
          <Field label={t('i.date')} name="date" error={error}><input type="date" max={today()} value={f.date} onChange={(ev) => set('date', ev.target.value)} style={{ minHeight: 44 }} data-testid="rs-date" /></Field>
          <Field label={t('i.region')} name="region" error={error}><input value={f.region} maxLength={30} placeholder={t('i.regionHelp')} onChange={(ev) => set('region', ev.target.value)} style={{ minHeight: 44 }} data-testid="rs-region" /></Field>
          <Field label={t('i.spec')} name="spec" error={error}><input value={f.spec} maxLength={80} onChange={(ev) => set('spec', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <Field label={t('x.note')} name="note" error={error}><input value={f.note} maxLength={500} onChange={(ev) => set('note', ev.target.value)} style={{ minHeight: 44 }} /></Field></div>
        {error?.form && <p className="field-error" role="alert" data-testid="rs-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={!f.itemId || !f.rate} data-testid="rs-save">{t('x.save')}</button></div></form>
      <div className="mdm-panel" data-testid="rs-index"><h2>{t('i.indexEntry')}</h2>
        {run.error?.form && <p className="field-error" role="alert" data-testid="rs-index-error">{run.error.form}</p>}{run.note && <p className="mdm-banner" role="status" data-testid="rs-index-note">{run.note}</p>}
        <div className="form-grid"><Field label={t('i.group')} name="group" error={run.error}><input value={x.group} maxLength={40} placeholder="CEMENT" onChange={(ev) => setX({ ...x, group: ev.target.value })} style={{ minHeight: 44 }} data-testid="rs-group" /></Field>
          <Field label={t('i.region')} name="region" error={run.error}><input value={x.region} maxLength={30} onChange={(ev) => setX({ ...x, region: ev.target.value })} style={{ minHeight: 44 }} /></Field>
          <Field label={t('i.month')} name="period" error={run.error}><input value={x.period} maxLength={7} placeholder="2026-09" onChange={(ev) => setX({ ...x, period: ev.target.value })} style={{ minHeight: 44 }} data-testid="rs-period" /></Field>
          <Field label={t('i.value')} name="value" error={run.error}><input type="number" min="0" step="0.01" value={x.value} onChange={(ev) => setX({ ...x, value: ev.target.value })} style={{ minHeight: 44 }} data-testid="rs-value" /></Field></div>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={run.busy || !x.group || !x.value} onClick={index} data-testid="rs-index-save">{t('x.save')}</button></div>
        <label>{t('i.pasteLines')}<textarea rows={4} value={x.paste} onChange={(ev) => setX({ ...x, paste: ev.target.value })} placeholder="STEEL, WEST, 2026-09, 103.5" style={{ width: '100%', boxSizing: 'border-box' }} data-testid="rs-paste" /></label>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={run.busy || !x.paste.trim()} onClick={paste} data-testid="rs-paste-go">{t('i.upload')}</button></div></div>
    </section>
  );
}
