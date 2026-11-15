import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { PROJECT_TYPES, SECTORS, bl, inr } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Create Project from Award (part 10.02, FR-01): choose an awarded tender, see what will be copied (client, place, contract value, period, the BOQ of the approved estimate with its rates, indirects, assumptions) and add only what the
// award cannot hold (code, type, start date, team, a first site, key clauses). The project, its BOQ and its draft baseline pack are made in one transaction; nothing already held by the tender or the estimate is typed again.
const blank = { code: '', name: '', type: 'ROAD', sector: '', location: '', startDate: '', dlpMonths: '12', retentionPct: '5', mobAdvancePct: '10', ldSummary: '', pmUser: '', directorUser: '', siteCode: '', siteName: '', lat: '', lng: '', radius: '300' };
export default function FromAwardPage() {
  const t = useT('proj');
  usePageTitle(t('fa.title'));
  const qc = useQueryClient();
  const search = useSearch(); const tenderId = Number(search.get('tenderId')) || null;
  const cq = useQuery({ queryKey: ['proj', 'candidates'], queryFn: bl.candidates, retry: false });
  const pq = useQuery({ queryKey: ['proj', 'preview', tenderId], queryFn: () => bl.preview(tenderId), enabled: Boolean(tenderId), retry: false });
  const [f, setF] = useState(blank); const [clauses, setClauses] = useState([]); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [seeded, setSeeded] = useState(null);
  const p = pq.data;
  if (p && seeded !== tenderId) { setSeeded(tenderId); setF((x) => ({ ...x, code: p.suggested.code, name: p.suggested.name, location: p.suggested.location ?? '' })); }
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const choose = (v) => { setError(null); navigateTo(v ? `/proj/from-award?tenderId=${v}` : '/proj/from-award'); };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = {
        tenderId, basics: { code: f.code.trim(), name: f.name.trim(), type: f.type, sector: f.sector || null, location: f.location.trim() || undefined },
        contract: { startDate: f.startDate || null, dlpMonths: Number(f.dlpMonths || 0), retentionPct: String(f.retentionPct || '0'), mobAdvancePct: String(f.mobAdvancePct || '0'), ldSummary: f.ldSummary.trim() || null },
        sites: f.siteCode.trim() ? [{ code: f.siteCode.trim(), name: f.siteName.trim() || f.siteCode.trim(), siteType: 'SITE', latitude: f.lat === '' ? null : Number(f.lat), longitude: f.lng === '' ? null : Number(f.lng), geofenceType: f.lat !== '' && f.lng !== '' ? 'CIRCLE' : 'NONE', geofenceRadiusM: f.lat !== '' && f.lng !== '' ? Number(f.radius || 300) : null }] : [],
        team: { pmUser: f.pmUser || null, directorUser: f.directorUser || null }, setup: {}, milestones: [], clauses: clauses.filter((c) => c.title.trim() && c.summary.trim()).map((c) => ({ title: c.title.trim(), summary: c.summary.trim(), ref: c.ref?.trim() || null })),
      };
      const r = await bl.createFromAward(body); qc.invalidateQueries({ queryKey: ['proj'] });
      navigateTo(`/proj/baseline-pack?id=${r.pack.id}&created=1`, { force: true });
    } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  if (cq.isPending) return <Skeleton label={t('fa.title')} rows={4} />;
  if (cq.isError) return <ErrorState error={cq.error} onRetry={cq.refetch} />;
  return (
    <section aria-labelledby="fa-h" data-testid="from-award">
      <PageHeader id="fa-h" title={t('fa.title')} subtitle={t('fa.intro')} />
      {cq.data.length === 0 ? (
        <div className="mdm-banner" data-testid="fa-empty"><strong>{t('fa.emptyTitle')}</strong> {t('fa.emptyText')} <Link to="/proj/wizard">{t('fa.orWizard')}</Link></div>
      ) : (
        <Field label={t('fa.tender')} name="tenderId">
          <select value={tenderId ?? ''} onChange={(e) => choose(e.target.value)} data-testid="fa-tender">
            <option value="">{t('fa.choose')}</option>
            {cq.data.map((c) => <option key={c.tenderId} value={c.tenderId}>{c.tenderNo} · {c.nameOfWork} · {c.client ?? '—'} · {inr(c.contractValue)}{c.ready ? '' : ` · ${t('fa.noEstimate')}`}</option>)}
          </select>
        </Field>
      )}
      {tenderId && pq.isPending && <Skeleton label={t('fa.preview')} rows={3} />}
      {tenderId && pq.isError && <ErrorState error={pq.error} onRetry={pq.refetch} />}
      {p && (
        <>
          <section className="mdm-panel" aria-labelledby="fa-prev" data-testid="fa-preview">
            <h2 id="fa-prev">{t('fa.preview')}</h2>
            <dl className="op-figures">
              <div><dt>{t('fa.tender')}</dt><dd>{p.tender.docNo} · {p.tender.nameOfWork}</dd></div>
              <div><dt>{t('f.client')}</dt><dd>{p.tender.client ?? '—'}</dd></div>
              <div><dt>{t('f.location')}</dt><dd>{p.tender.location ?? '—'}</dd></div>
              <div><dt>{t('fa.award')}</dt><dd>{p.award ? `${p.award.loaNo ?? p.award.docNo} · ${p.award.loaDate ?? ''}` : '—'}</dd></div>
              <div><dt>{t('f.contractValue')}</dt><dd data-testid="fa-value">{inr(p.suggested.contractValue)}</dd></div>
              <div><dt>{t('fa.period')}</dt><dd>{t('fa.months', { n: p.tender.periodMonths })}</dd></div>
              <div><dt>{t('fa.estimate')}</dt><dd>{p.estimate ? `${p.estimate.ref} · ${inr(p.estimate.bidValue)}` : '—'}</dd></div>
              {p.estimate?.totalCost != null && <div><dt>{t('fa.margin')}</dt><dd>{inr(p.estimate.margin)} ({p.estimate.marginPct}%)</dd></div>}
            </dl>
            {p.willCopy && <ul className="mdm-list" data-testid="fa-copy">{p.willCopy.map((w) => <li key={w.code}>{w.label}: <strong>{w.count}</strong></li>)}</ul>}
            {p.differences?.map((d) => <p key={d.code} className="mdm-banner" role="status">{d.text}</p>)}
            {p.issues.map((i) => <p key={i.code} className="field-error" role="alert" data-testid={`fa-issue-${i.code}`}>{i.text}</p>)}
          </section>
          {p.ready && (
            <form className="mdm-panel" onSubmit={submit} aria-label={t('fa.title')} data-testid="fa-form">
              <h2>{t('fa.add')}</h2>
              <div className="form-grid">
                <Field label={t('f.code')} name="basics.code" error={error}><input value={f.code} onChange={(e) => set('code', e.target.value)} required maxLength={30} data-testid="fa-code" /></Field>
                <Field label={t('f.name')} name="basics.name" error={error}><input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={160} data-testid="fa-name" /></Field>
                <Field label={t('f.type')} name="basics.type" error={error}><select value={f.type} onChange={(e) => set('type', e.target.value)} data-testid="fa-type">{PROJECT_TYPES.map((k) => <option key={k} value={k}>{t(`ptype.${k}`)}</option>)}</select></Field>
                <Field label={t('f.sector')} name="basics.sector" error={error}><select value={f.sector} onChange={(e) => set('sector', e.target.value)}><option value="">—</option>{SECTORS.map((k) => <option key={k} value={k}>{t(`sector.${k}`)}</option>)}</select></Field>
                <Field label={t('f.startDate')} name="contract.startDate" error={error} hint={t('fa.endHint', { n: p.tender.periodMonths })}><input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} data-testid="fa-start" /></Field>
                <Field label={t('f.dlpMonths')} name="contract.dlpMonths" error={error}><input type="number" min="0" max="120" value={f.dlpMonths} onChange={(e) => set('dlpMonths', e.target.value)} /></Field>
                <Field label={t('f.retention')} name="contract.retentionPct" error={error}><input inputMode="decimal" value={f.retentionPct} onChange={(e) => set('retentionPct', e.target.value)} /></Field>
                <Field label={t('f.mobAdvance')} name="contract.mobAdvancePct" error={error}><input inputMode="decimal" value={f.mobAdvancePct} onChange={(e) => set('mobAdvancePct', e.target.value)} /></Field>
                <LookupField id="fa-pm" label={t('f.pm')} lookup="proj/people" valueKey="code" value={f.pmUser} onChange={(v) => set('pmUser', v)} />
                <LookupField id="fa-director" label={t('f.director')} lookup="proj/people" valueKey="code" value={f.directorUser} onChange={(v) => set('directorUser', v)} />
              </div>
              <Field label={t('f.ld')} name="contract.ldSummary" error={error}><textarea rows={2} value={f.ldSummary} onChange={(e) => set('ldSummary', e.target.value)} maxLength={2000} /></Field>
              <h3>{t('fa.site')}</h3>
              <div className="form-grid">
                <Field label={t('fa.siteCode')} name="sites.0.code" error={error}><input value={f.siteCode} onChange={(e) => set('siteCode', e.target.value)} maxLength={30} data-testid="fa-site-code" /></Field>
                <Field label={t('fa.siteName')} name="sites.0.name" error={error}><input value={f.siteName} onChange={(e) => set('siteName', e.target.value)} maxLength={160} /></Field>
                <Field label={t('fa.lat')} name="sites.0.latitude" error={error}><input inputMode="decimal" value={f.lat} onChange={(e) => set('lat', e.target.value)} /></Field>
                <Field label={t('fa.lng')} name="sites.0.longitude" error={error}><input inputMode="decimal" value={f.lng} onChange={(e) => set('lng', e.target.value)} /></Field>
                <Field label={t('fa.radius')} name="sites.0.geofenceRadiusM" error={error}><input inputMode="numeric" value={f.radius} onChange={(e) => set('radius', e.target.value)} /></Field>
              </div>
              <h3>{t('bl.clauses')}</h3>
              <Clauses value={clauses} onChange={setClauses} />
              {error?.form && <p className="field-error" role="alert" data-testid="fa-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>}
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !f.code.trim() || !f.name.trim()} data-testid="fa-create">{busy ? t('fa.creating') : t('fa.create')}</button></div>
            </form>
          )}
        </>
      )}
      <p className="small"><Link to="/proj/projects">{t('list.title')}</Link></p>
    </section>
  );
}

/** The rows of key contract clauses (title, summary, reference). */
export function Clauses({ value, onChange }) {
  const t = useT('proj');
  const upd = (i, k, v) => onChange(value.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  return (
    <div data-testid="bl-clause-rows">
      {value.map((c, i) => (
        <div key={i} className="form-grid">
          <Field label={t('bl.clauseTitle')} name={`clauses.${i}.title`}><input value={c.title} onChange={(e) => upd(i, 'title', e.target.value)} maxLength={160} data-testid={`bl-clause-title-${i}`} /></Field>
          <Field label={t('bl.clauseRef')} name={`clauses.${i}.ref`}><input value={c.ref ?? ''} onChange={(e) => upd(i, 'ref', e.target.value)} maxLength={60} /></Field>
          <Field label={t('bl.clauseSummary')} name={`clauses.${i}.summary`}><textarea rows={2} value={c.summary} onChange={(e) => upd(i, 'summary', e.target.value)} maxLength={2000} data-testid={`bl-clause-summary-${i}`} /></Field>
          <button type="button" className="btn" onClick={() => onChange(value.filter((_, j) => j !== i))}>{t('bl.removeRow')}</button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => onChange([...value, { title: '', summary: '', ref: '' }])} data-testid="bl-add-clause">{t('bl.addClause')}</button>
    </div>
  );
}
