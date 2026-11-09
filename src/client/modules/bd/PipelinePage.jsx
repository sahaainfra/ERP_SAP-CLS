import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { OPEN_STAGES, REGIONS, SECTORS, bd, inrShort } from './api.js';

// Opportunity Pipeline (business development, part 08.01, FR-05): the opportunities in a column for each stage with the value and the weighted value of the column. An opportunity moves by drag and drop or by the "Move to" list (a keyboard can reach it);
// the server decides: a stage that pursues a tender needs the go-ahead, a win does not come from here. The probability of the new stage applies.
export default function PipelinePage() {
  const t = useT('bd');
  usePageTitle(t('pipe.title'));
  const qc = useQueryClient();
  const [f, setF] = useState({ sector: '', region: '', owner: '' });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [over, setOver] = useState(null);
  const q = useQuery({ queryKey: ['bd', 'board', f], queryFn: () => bd.board(f), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('pipe.title')} permission="bd.opportunity.view" />;
  const move = async (item, stage) => {
    setError(null); setNote(null);
    try { await bd.oppAct(item.id, 'track', { stage, version: item.rowVersion }); setNote(t('pipe.moved', { name: item.name, stage: t(`stage.${stage}`) })); qc.invalidateQueries({ queryKey: ['bd'] }); } catch (e) { setError(errorInfo(e)); }
  };
  const d = q.data; const open = d ? d.columns.filter((c) => OPEN_STAGES.includes(c.stage)) : [];
  const total = open.reduce((a, c) => ({ count: a.count + c.count, value: a.value + c.value, weighted: a.weighted + c.weighted }), { count: 0, value: 0, weighted: 0 });
  return (
    <section aria-labelledby="pp-title" data-testid="pipeline">
      <h1 id="pp-title">{t('pipe.title')}</h1>
      <form className="srch-form mdm-fields no-print" aria-label={t('pipe.filters')} onSubmit={(e) => e.preventDefault()}>
        <Field label={t('lead.sector')} name="sector" error={null}><select value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} data-testid="pp-sector"><option value="">{t('filter.all')}</option>{SECTORS.map((k) => <option key={k} value={k}>{t(`sector.${k}`)}</option>)}</select></Field>
        <Field label={t('lead.region')} name="region" error={null}><select value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} data-testid="pp-region"><option value="">{t('filter.all')}</option>{REGIONS.map((k) => <option key={k} value={k}>{t(`region.${k}`)}</option>)}</select></Field>
        <LookupField id="pp-owner" label={t('lead.owner')} lookup="bd/owners" valueKey="code" value={f.owner} onChange={(x) => setF({ ...f, owner: x })} />
      </form>
      {error?.form && <p className="field-error" role="alert" data-testid="pp-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join("; ")}` : ""}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="pp-note">{note}</p>}
      {q.isPending ? <Skeleton label={t('pipe.title')} rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <dl className="op-figures" data-testid="pp-summary"><div><dt>{t('dash.open')}</dt><dd data-testid="pp-count">{total.count}</dd></div><div><dt>{t('dash.pipeline')}</dt><dd data-testid="pp-value">{inrShort(total.value)}</dd></div><div><dt>{t('dash.weighted')}</dt><dd data-testid="pp-weighted">{inrShort(total.weighted)}</dd></div></dl>
          <div className="bd-board" role="region" aria-label={t('pipe.board')} tabIndex={0} data-testid="pp-board">
            {d.columns.map((c) => (
              <div key={c.stage} className={`bd-col${over === c.stage ? ' is-over' : ''}`} data-testid="pp-col" data-stage={c.stage}
                onDragOver={(e) => { if (d.canMove && OPEN_STAGES.includes(c.stage)) { e.preventDefault(); setOver(c.stage); } }} onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); const raw = e.dataTransfer.getData('text/plain'); const item = d.columns.flatMap((x) => x.items).find((x) => String(x.id) === raw); if (item && item.id && OPEN_STAGES.includes(c.stage) && !d.columns.find((x) => x.stage === c.stage).items.includes(item)) move(item, c.stage); }}>
                <h2>{t(`stage.${c.stage}`)} <span className="muted small" data-testid="pp-col-count">{c.count}</span></h2>
                <p className="muted small">{inrShort(c.value)}{OPEN_STAGES.includes(c.stage) ? ` · ${t('dash.weighted')} ${inrShort(c.weighted)}` : ''}</p>
                {c.items.length === 0 ? <p className="muted small">{t('pipe.emptyColumn')}</p> : (
                  <ul>{c.items.map((i) => (
                    <li key={i.id} className="bd-card" data-testid="pp-card" data-id={i.id} draggable={d.canMove && OPEN_STAGES.includes(c.stage)} onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i.id))}>
                      <Link to={`/bd/opportunity?id=${i.id}`}><strong>{i.name}</strong></Link>
                      <div className="muted small">{i.docNo} · {i.client}</div>
                      <div>{inrShort(i.estValue)} · {i.probability}%{i.expectedAward ? ` · ${i.expectedAward}` : ''}</div>
                      <div className="muted small">{i.owner} {i.goAheadPending && <StatusBadge status="AT_RISK" label={t('pipe.goAheadPending')} />}</div>
                      {d.canMove && OPEN_STAGES.includes(c.stage) && <label className="small">{t('pipe.moveTo')} <select aria-label={`${t('pipe.moveTo')} ${i.name}`} value={c.stage} onChange={(e) => move(i, e.target.value)} data-testid="pp-move">{OPEN_STAGES.map((k) => <option key={k} value={k}>{t(`stage.${k}`)}</option>)}</select></label>}
                    </li>))}</ul>)}
                {c.more > 0 && <p className="muted small">{t('pipe.more', { n: c.more })}</p>}
              </div>))}
          </div>
        </>)}
      <p className="small"><Link to="/bd/opportunities">{t('opps.title')}</Link> · <Link to="/bd">{t('dash.title')}</Link></p>
    </section>
  );
}
