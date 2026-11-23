import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { bd, inr } from './api.js';
import { ProjectSelect, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';

// Generate Budget from Baseline (part 12.01, FR-01): the preview shows what the signed-off baseline pack and the BOQ norms give, what is missing and how the totals compare with the baseline cost; only then is the budget generated.
export default function GeneratePage() {
  const t = useT('bud');
  usePageTitle(t('gen.title'));
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState(Number(useSearch().get('projectId')) || '');
  const [rates, setRates] = useState({}); const [applied, setApplied] = useState([]); const [name, setName] = useState(''); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['bud', 'preview', projectId, applied], queryFn: () => (applied.length ? bd.previewWith({ projectId: Number(projectId), rates: applied }) : bd.preview(projectId)), enabled: Boolean(projectId), retry: false });
  const p = q.data;
  const apply = () => setApplied(Object.entries(rates).filter(([, v]) => v !== '' && Number(v) >= 0).map(([k, v]) => { const [type, ...d] = k.split('|'); return { type, description: d.join('|'), rate: Number(v) }; }));
  const generate = async (e) => {
    e.preventDefault(); setError(null); setBusy(true);
    try { const b = await bd.generate({ projectId: Number(projectId), name: name.trim() || null, rates: applied }); qc.invalidateQueries({ queryKey: ['bud'] }); navigateTo(`/bud/budget?id=${b.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="gen-h" data-testid="bd-generate">
      <PageHeader id="gen-h" title={t('gen.title')} subtitle={t('gen.intro')} />
      {q.isLoading && <Skeleton label={'Loading the budget preview'} rows={2} />}{q.isError && q.error?.status !== 403 && <ErrorState error={q.error} onRetry={q.refetch} />}
      <form className="mdm-panel" onSubmit={generate} data-testid="gen-form">
        <div className="form-grid">
          <ProjectSelect value={projectId} onChange={(v) => { setProjectId(v ? Number(v) : ''); setApplied([]); setRates({}); }} required testId="gen-project" error={error} />
          <Field label={t('gen.name')} name="name" error={error}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="gen-name" /></Field>
        </div>
        {q.isError && <p className="field-error" role="alert" data-testid="gen-load-error">{q.error?.message}</p>}
        {p && (
          <div data-testid="gen-preview" data-can={p.canGenerate ? '1' : '0'}>
            <p className="muted" data-testid="gen-sources">{t('gen.pack')}: {p.pack ? `${p.pack.docNo} (${t('gen.packNo', { n: p.pack.packNo })})` : '—'} · {t('gen.boq')}: {p.boqVersion ? `${p.boqVersion.docNo} v${p.boqVersion.versionNo}` : '—'} · {t('gen.contract')}: ₹ {inr(p.contractValue)}</p>
            {p.issues.length > 0 && <ul className="field-error" role="alert" data-testid="gen-issues">{p.issues.map((i) => <li key={i.code + i.text}>{i.text}</li>)}</ul>}
            <table className="data-table" data-testid="gen-totals"><caption className="sr-only">{t('gen.totals')}</caption><tbody>
              {[['direct', p.totals.direct], ['overhead', p.totals.overhead], ['contingency', p.totals.contingency], ['reserve', p.totals.reserve], ['total', p.totals.total], ['baselineCost', p.totals.baselineCost], ['difference', p.totals.differenceToBaseline]].map(([k, v]) => <tr key={k}><th scope="row">{t(`gen.t.${k}`)}</th><td className="num" data-testid={`gen-t-${k}`}>₹ {inr(v)}</td></tr>)}
            </tbody></table>
            {p.unrated.length > 0 && (
              <div className="mdm-panel" data-testid="gen-unrated">
                <h2>{t('gen.unrated', { n: p.unratedCount })}</h2>
                {p.unrated.map((u) => { const k = `${u.type}|${u.description}`; return <Field key={k} label={`${t(`type.${u.type}`)}: ${u.description}${u.uom ? ` (${u.uom})` : ''}`} name={k}><input type="number" min="0" step="0.01" value={rates[k] ?? ''} onChange={(e) => setRates({ ...rates, [k]: e.target.value })} data-testid="gen-rate" /></Field>; })}
                <div className="actions"><button type="button" className="btn" onClick={apply} data-testid="gen-apply">{t('gen.apply')}</button></div>
              </div>
            )}
            <div className="table-scroll"><table className="data-table" data-testid="gen-lines"><caption>{t('gen.lines', { n: p.linesCount })}</caption>
              <thead><tr><th>{t('f.kind')}</th><th>{t('f.wbs')}</th><th>{t('f.costCode')}</th><th>{t('f.resource')}</th><th>{t('f.uom')}</th><th className="num">{t('f.qty')}</th><th className="num">{t('f.rate')}</th><th className="num">{t('f.amount')}</th></tr></thead>
              <tbody>{p.lines.map((l, i) => <tr key={i} data-unrated={l.unrated ? '1' : '0'}><td>{t(`kind.${l.lineKind}`)}</td><td>{l.wbs ?? '—'}</td><td>{l.costCode ?? '—'}</td><td>{l.resourceName}</td><td>{l.uom ?? ''}</td><td className="num">{l.qty}</td><td className="num">{inr(l.rate)}</td><td className="num">{inr(l.amount)}</td></tr>)}</tbody></table></div>
          </div>
        )}
        {error?.form && <p className="field-error" role="alert" data-testid="gen-error">{error.form}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !p || p.issues.length > 0 || !p.linesCount} data-testid="gen-go">{t('gen.go')}</button></div>
      </form>
    </section>
  );
}
