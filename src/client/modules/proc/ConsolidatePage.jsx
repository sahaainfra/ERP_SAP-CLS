import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtQty, fmtRs, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Consolidate MRs into PR (part 15.01, FR-03, T-03): the approved material requests of a project that still have something to buy; the chosen ones are grouped by item, unit, delivery site, WBS node and cost code into one draft
// requisition, and every line keeps the request lines it came from. Nothing is created until the preview is accepted.
export default function ConsolidatePage() {
  const t = useT('proc'); usePageTitle(t('p.consolidate')); const sp = useSearch();
  const pq = useQuery({ queryKey: ['proc', 'projects'], queryFn: pc.projects, retry: false });
  const [projectId, setProjectId] = useState(''); const [sel, setSel] = useState(() => new Set(sp.get('mr') ? [Number(sp.get('mr'))] : [])); const [prev, setPrev] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const projects = (pq.data ?? []).filter((p) => p.canRaisePr); const pid = projectId || (projects[0] ? String(projects[0].id) : '');
  const mq = useQuery({ queryKey: ['proc', 'approved-mrs', pid], queryFn: () => pc.approvedMrs(pid), enabled: Boolean(pid), retry: false });
  if (pq.error?.status === 403) return <NoPermission what={t('p.consolidate')} permission="proc.requisition.create" />;
  if (pq.isPending) return <Skeleton label={t('p.consolidate')} rows={4} />;
  const mrs = (mq.data ?? []).filter((m) => m.fulfilment !== 'COVERED'); const toggle = (id) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); setPrev(null); };
  const preview = async () => { setError(null); setBusy(true); try { setPrev(await pc.preview({ mrIds: [...sel] })); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } };
  const create = async () => { setError(null); setBusy(true); try { const d = await pc.consolidate({ mrIds: [...sel] }); navigateTo(`/proc/requisitions?id=${d.id}`); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="con-h" data-testid="proc-consolidate">
      <PageHeader id="con-h" title={t('p.consolidate')} subtitle={t('p.consolidateHelp')} />
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('p.params')}>
        <Field label={t('p.project')} name="projectId"><select value={pid} onChange={(e) => { setProjectId(e.target.value); setSel(new Set()); setPrev(null); }} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="con-project">{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
      </form>
      {projects.length === 0 && <div className="mdm-panel"><h2>{t('p.noProject')}</h2><p className="muted">{t('p.noProjectBody')}</p></div>}
      {mq.isPending && pid && <Skeleton label={t('p.mrTitle')} rows={3} />}
      {mq.data && (mrs.length === 0 ? <div className="mdm-panel" data-testid="con-empty"><h2>{t('p.conEmptyTitle')}</h2><p className="muted">{t('p.conEmptyBody')}</p><Link to="/proc/material-requests">{t('p.mrTitle')}</Link></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="con-list"><caption>{t('p.approvedMrs')}</caption><thead><tr><th><span className="sr-only">{t('p.choose')}</span></th><th>{t('p.docNo')}</th><th>{t('p.site')}</th><th>{t('p.requiredBy')}</th><th>{t('p.priority')}</th><th>{t('p.fulfilment')}</th></tr></thead>
          <tbody>{mrs.map((m) => <tr key={m.id} data-testid="con-mr"><td><input type="checkbox" checked={sel.has(m.id)} onChange={() => toggle(m.id)} aria-label={m.docNo} style={{ minHeight: 24, minWidth: 24 }} data-testid="con-check" /></td><td><Link to={`/proc/material-requests?id=${m.id}`}>{m.docNo}</Link></td><td>{m.site}</td><td>{fmtDate(m.requiredBy)}</td><td>{t(`p.pri.${m.priority}`)}</td><td>{m.fulfilment ? t(`p.f.${m.fulfilment}`) : ''}</td></tr>)}</tbody></table></div>
      ))}
      {error?.form && <p className="field-error" role="alert" data-testid="con-error">{error.form}</p>}
      <div className="actions-row no-print"><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || sel.size === 0} onClick={preview} data-testid="con-preview">{t('p.preview', { n: sel.size })}</button></div>
      {prev && (
        <div className="mdm-panel" data-testid="con-preview-panel"><h2>{t('p.willMake', { n: prev.lineCount, k: prev.sourceCount })}</h2>
          {prev.skipped.length > 0 && <p className="muted" data-testid="con-skipped">{t('p.skipped')}: {prev.skipped.map((s) => `${s.docNo ?? s.mrId} (${s.reason})`).join('; ')}</p>}
          <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('p.lines')}</caption><thead><tr><th>{t('p.item')}</th><th className="num">{t('p.qty')}</th><th>{t('p.site')}</th><th>{t('p.requiredBy')}</th>{prev.canCost && <th className="num">{t('p.estAmount')}</th>}<th>{t('p.freeStock')}</th><th>{t('p.fromRequests')}</th></tr></thead>
            <tbody>{prev.groups.map((g) => <tr key={g.key} data-testid="con-group"><td>{g.itemCode} · {g.itemName}</td><td className="num">{fmtQty(g.qty)} {g.uom}</td><td>{g.site}</td><td>{fmtDate(g.requiredBy)}</td>{prev.canCost && <td className="num">{fmtRs(g.estAmount)}</td>}<td>{fmtQty(g.freeStock)} {g.stockCovers && <StatusBadge status="AT_RISK" label={t('p.covers')} />}</td><td>{g.sources.map((s) => <div key={s.mrLineId}>{s.mrNo} ({fmtQty(s.qty)})</div>)}</td></tr>)}</tbody></table></div>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={create} data-testid="con-create">{t('p.createPr')}</button></div>
        </div>
      )}
    </section>
  );
}
