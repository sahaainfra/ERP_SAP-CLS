import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, est } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';

// New Estimate (part 09.01, FR-01): the header of the first version: for a registered tender or for a project, the basis date of the rates, the region (the state whose resource rates apply), and the percentages of HO overhead,
// contingency, escalation and GST on works contract. The items, indirects and risks follow on the estimate.
export default function NewEstimatePage() {
  const t = useT('est');
  usePageTitle(t('new.title'));
  const params = new URLSearchParams(window.location.search);
  const [v, setV] = useState({ for: params.get('projectId') ? 'PROJECT' : 'TENDER', tenderId: params.get('tenderId') ?? '', projectId: params.get('projectId') ? Number(params.get('projectId')) : null, title: '', basisDate: dayIST(0), region: '', hoOverheadPct: '0', contingencyPct: '0', escalationPct: '0', gstPct: '18' });
  const [error, setError] = useState(null);
  const tq = useQuery({ queryKey: ['est', 'tenders'], queryFn: est.tenders, retry: false });
  const set = (k, x) => setV({ ...v, [k]: x });
  const save = async (e) => {
    e.preventDefault(); setError(null);
    try { const r = await est.create({ ...(v.for === 'TENDER' ? { tenderId: v.tenderId ? Number(v.tenderId) : null } : { projectId: v.projectId }), title: v.title.trim() || undefined, basisDate: v.basisDate, region: v.region.trim().toUpperCase() || null, hoOverheadPct: v.hoOverheadPct || '0', contingencyPct: v.contingencyPct || '0', escalationPct: v.escalationPct || '0', gstPct: v.gstPct || '0' }); navigateTo(`/est/estimate?id=${r.id}`, { force: true }); } catch (x) { setError(errorInfo(x)); }
  };
  const tenders = tq.data?.data ?? [];
  return (
    <section aria-labelledby="est-new-h" data-testid="estimate-new">
      <PageHeader id="est-new-h" title={t('new.title')} />
      {tq.isLoading && <Skeleton label={'Loading the tenders'} rows={2} />}{tq.isError && tq.error?.status !== 403 && <ErrorState error={tq.error} onRetry={tq.refetch} />}
      {error?.form && <p className="field-error" role="alert" data-testid="est-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <form className="mdm-panel mdm-fields" onSubmit={save} aria-label={t('new.title')}>
        <fieldset><legend>{t('new.for')}</legend>
          <label><input type="radio" name="for" checked={v.for === 'TENDER'} onChange={() => set('for', 'TENDER')} data-testid="est-for-tender" /> {t('new.tender')}</label>{' '}
          <label><input type="radio" name="for" checked={v.for === 'PROJECT'} onChange={() => set('for', 'PROJECT')} data-testid="est-for-project" /> {t('new.project')}</label>
        </fieldset>
        {v.for === 'TENDER'
          ? <Field label={t('new.tender')} name="tenderId" error={error} hint={t('new.tenderHint')}><select value={v.tenderId} onChange={(e) => set('tenderId', e.target.value)} required data-testid="est-tender"><option value="">–</option>{tenders.map((x) => <option key={x.id} value={x.id}>{x.docNo} · {x.nameOfWork}</option>)}</select></Field>
          : <LookupField id="est-project" label={t('new.project')} lookup="iam/projects" value={v.projectId} onChange={(x) => set('projectId', x)} required error={error?.fields?.projectId} />}
        <Field label={t('head.title')} name="title" error={error} hint={t('new.titleHint')}><input value={v.title} maxLength={200} onChange={(e) => set('title', e.target.value)} data-testid="est-title" /></Field>
        <Field label={t('head.basisDate')} name="basisDate" error={error}><input type="date" value={v.basisDate} max={dayIST(0)} onChange={(e) => set('basisDate', e.target.value)} required data-testid="est-basis" /></Field>
        <Field label={t('head.region')} name="region" error={error} hint={t('head.regionHint')}><input value={v.region} maxLength={10} onChange={(e) => set('region', e.target.value)} data-testid="est-region" /></Field>
        {[['hoOverheadPct', 'head.overhead'], ['contingencyPct', 'head.contingency'], ['escalationPct', 'head.escalation'], ['gstPct', 'head.gst']].map(([k, l]) => <Field key={k} label={t(l)} name={k} error={error}><input type="number" min="0" max="100" step="0.01" value={v[k]} onChange={(e) => set(k, e.target.value)} data-testid={`est-${k}`} /></Field>)}
        <div className="actions"><button type="button" className="btn" onClick={() => navigateTo('/est/estimates')}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="est-create">{t('new.create')}</button></div>
      </form>
      <p className="small"><Link to="/est/estimates">{t('list.title')}</Link></p>
    </section>
  );
}
