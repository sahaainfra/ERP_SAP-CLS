import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { bq, inr } from './api.js';
import { Tabs, useSearch } from './parts.jsx';
import { useState } from 'react';

// BOQ Reports (part 10.04, FR-01, BR-01): the abstract of a version (bills and sections with their amounts and shares), the comparison of two versions (items added, removed and changed, and the change of the total) and the unmapped items.
export default function BoqReportsPage() {
  const t = useT('proj');
  usePageTitle(t('rep.title'));
  const sp = useSearch(); const versionId = Number(sp.get('versionId')) || null; const other = Number(sp.get('compare')) || null;
  const [tab, setTab] = useState(sp.get('compare') ? 'compare' : 'abstract');
  const vq = useQuery({ queryKey: ['proj', 'boq-all'], queryFn: () => bq.versions(), retry: false });
  const go = (v, o) => navigateTo(`/proj/boq-reports?${v ? `versionId=${v}` : ''}${o ? `&compare=${o}` : ''}`);
  const all = vq.data ?? []; const cur = all.find((x) => x.id === versionId);
  return (
    <section aria-labelledby="rep-h" data-testid="boq-reports">
      <h1 id="rep-h">{t('rep.title')}</h1>
      <div className="form-grid">
        <Field label={t('rep.version')} name="versionId"><select value={versionId ?? ''} onChange={(e) => go(e.target.value, other)} data-testid="rep-version"><option value="">{t('rep.choose')}</option>{all.map((v) => <option key={v.id} value={v.id}>{v.docNo} · {v.project} · {v.typeLabel} v{v.versionNo}</option>)}</select></Field>
        {tab === 'compare' && <Field label={t('rep.against')} name="compare"><select value={other ?? ''} onChange={(e) => go(versionId, e.target.value)} data-testid="rep-against"><option value="">{t('rep.choose')}</option>{all.filter((v) => !cur || v.projectId === cur.projectId).map((v) => <option key={v.id} value={v.id}>{v.docNo} · {v.typeLabel} v{v.versionNo}</option>)}</select></Field>}
      </div>
      <Tabs tabs={['abstract', 'compare', 'unmapped']} active={tab} onChange={setTab} label={t('rep.title')} />
      {vq.error?.status === 403 && <NoPermission what={t('rep.title')} permission="proj.version.view" />}
      {!versionId && !vq.isPending && <div className="mdm-banner" data-testid="rep-empty"><strong>{t('rep.emptyTitle')}</strong> {t('rep.emptyText')} <Link to="/proj/versions">{t('bq.listTitle')}</Link></div>}
      {versionId && tab === 'abstract' && <Abstract id={versionId} />}
      {versionId && tab === 'compare' && (other ? <Compare a={versionId} b={other} /> : <p className="muted" data-testid="rep-pick">{t('rep.pickCompare')}</p>)}
      {versionId && tab === 'unmapped' && <Unmapped id={versionId} />}
    </section>
  );
}
function Abstract({ id }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'boq-abstract', id], queryFn: () => bq.abstract(id), retry: false });
  if (q.isPending) return <Skeleton label={t('rep.abstract')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const max = Math.max(1, ...d.chart.map((c) => Number(c.amount ?? 0)));
  return (
    <div data-testid="rep-abstract"><h2>{d.version.docNo} · {d.version.name}</h2>
      {d.ratesVisible ? <p>{t('bq.total')}: <strong data-testid="rep-total">{inr(d.version.total)}</strong> · {t('bq.items')}: {d.version.items}</p> : <p className="muted">{t('bq.masked')}</p>}
      {d.ratesVisible && <ul className="bar-list" data-testid="rep-chart">{d.chart.map((c) => <li key={c.code}><span>{c.code} {c.name}</span><span className="bar" role="img" aria-label={`${c.code} ${inr(c.amount)}`} style={{ display: 'inline-block', height: 10, width: `${Math.max(2, (Number(c.amount) / max) * 50)}%`, background: 'var(--erp-color-brand-primary)', marginInline: 8 }} /> {inr(c.amount)}</li>)}</ul>}
      <div className="table-wrap"><table className="data-table"><caption className="sr-only">{t('rep.abstract')}</caption><thead><tr><th scope="col">{t('bq.code')}</th><th scope="col">{t('bl.description')}</th>{d.ratesVisible && <th scope="col" className="num">{t('bl.amount')}</th>}{d.ratesVisible && <th scope="col" className="num">%</th>}</tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.id} data-testid="rep-abstract-row"><td><span style={{ paddingInlineStart: `${r.depth * 16}px` }}>{r.code}</span></td><td>{r.description}</td>{d.ratesVisible && <td className="num">{inr(r.amount)}</td>}{d.ratesVisible && <td className="num">{r.share}</td>}</tr>)}</tbody></table></div>
    </div>
  );
}
function Compare({ a, b }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'boq-compare', a, b], queryFn: () => bq.compare(a, b), retry: false });
  if (q.isPending) return <Skeleton label={t('rep.compare')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <div data-testid="rep-compare"><h2>{d.a.docNo} → {d.b.docNo}</h2>
      <dl className="op-figures"><div><dt>{t('rep.added')}</dt><dd data-testid="cmp-added">{d.counts.added}</dd></div><div><dt>{t('rep.removed')}</dt><dd data-testid="cmp-removed">{d.counts.removed}</dd></div><div><dt>{t('rep.changed')}</dt><dd data-testid="cmp-changed">{d.counts.changed}</dd></div>{d.ratesVisible && <div><dt>{t('rep.delta')}</dt><dd data-testid="cmp-delta">{inr(d.delta)}</dd></div>}</dl>
      {d.rows.length === 0 ? <p className="muted">{t('rep.same')}</p> : <div className="table-wrap"><table className="data-table"><caption className="sr-only">{t('rep.compare')}</caption><thead><tr><th scope="col">{t('bq.code')}</th><th scope="col">{t('bl.description')}</th><th scope="col">{t('rep.change')}</th><th scope="col" className="num">{t('rep.before')}</th><th scope="col" className="num">{t('rep.after')}</th>{d.ratesVisible && <th scope="col" className="num">{t('rep.delta')}</th>}</tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.code} data-testid="rep-compare-row" data-change={r.change}><td>{r.code}</td><td>{r.description}</td><td>{t(`wbs.diff.${r.change === 'REMOVED' ? 'REMOVED' : r.change === 'ADDED' ? 'ADDED' : 'CHANGED'}`)}</td><td className="num">{r.before ? `${r.before.qty} × ${r.before.rate ?? '—'}` : '—'}</td><td className="num">{r.after ? `${r.after.qty} × ${r.after.rate ?? '—'}` : '—'}</td>{d.ratesVisible && <td className="num">{inr(r.delta)}</td>}</tr>)}</tbody></table></div>}
    </div>
  );
}
function Unmapped({ id }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'boq-unmapped', id], queryFn: () => bq.unmapped(id), retry: false });
  if (q.isPending) return <Skeleton label={t('rep.unmapped')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return (
    <div data-testid="rep-unmapped"><h2>{t('rep.unmappedCount', { n: d.count })}</h2>
      {d.count === 0 ? <p className="muted" data-testid="rep-unmapped-none">{t('rep.allMapped')}</p> : <div className="table-wrap"><table className="data-table"><caption className="sr-only">{t('rep.unmapped')}</caption><thead><tr><th scope="col">{t('bq.code')}</th><th scope="col">{t('bl.description')}</th><th scope="col" className="num">{t('bl.qty')}</th><th scope="col" className="num">{t('rep.mappedQty')}</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.id} data-testid="rep-unmapped-row"><td>{r.code}</td><td>{r.description}</td><td className="num">{r.qty} {r.uom}</td><td className="num">{r.mappedQty}</td></tr>)}</tbody></table></div>}
      <p><Link to={`/proj/boq-mapping?versionId=${id}`}>{t('bq.mapTool')}</Link></p>
    </div>
  );
}
