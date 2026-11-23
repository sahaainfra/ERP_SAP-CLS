import { useT } from '../../platform/i18n/index.js';
import { useFlagOn } from '../../platform/shell/api.js';
import { useSession } from '../core/api/index.js';
import { Link, can } from '../core/pages/ui.jsx';

// Part 27.08 (FR-02): the drill-down breadcrumb, Company → Project → Site / WBS → Activity → BOQ → Transaction → Document → Audit.
// The server builds the trail (GET /bi/explain/drill) so nothing outside the person's scope is named; this component only draws it, and any
// dashboard can show it for a node it has (`drillHref` builds the link of a node).

/** The explainer link of one drill node. */
export function drillHref(n, extra = {}) {
  const p = new URLSearchParams({ tab: 'drill', level: n.level });
  if (n.id != null && n.level !== 'company') p.set('id', String(n.id));
  if (n.projectId) p.set('projectId', String(n.projectId));
  if (n.entity) p.set('entity', n.entity);
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') p.set(k, String(v));
  return `/bi/explain?${p}`;
}

export default function DrillBreadcrumb({ trail, txnId, testid = 'drill-breadcrumb' }) {
  const t = useT('why');
  if (!trail?.length) return null;
  return <nav aria-label={t('d.breadcrumb')} className="drill-crumbs" data-testid={testid}>
    <ol>
      {trail.map((n, i) => {
        const last = i === trail.length - 1;
        const label = <><span className="drill-crumb-level">{t(`lvl.${n.level}`)}</span> <span className="drill-crumb-label">{n.label}</span></>;
        return <li key={`${n.level}-${n.id ?? i}`} data-level={n.level} aria-current={last ? 'page' : undefined}>
          {last ? <span>{label}</span> : <Link to={drillHref(n, ['document', 'audit'].includes(n.level) ? { txnId } : {})}>{label}</Link>}
        </li>;
      })}
    </ol>
  </nav>;
}

/** The "Why?" entry points of a project for a dashboard (AC-01): cost, schedule and margin, and the drill-down. Hidden when the explainer is off
 *  or the person does not hold bi.explain.view (the server still checks every figure). */
export function WhyLinks({ projectId, testid = 'why-links' }) {
  const t = useT('why');
  const session = useSession();
  const on = useFlagOn('ff.bi.p2708', Boolean(projectId));
  if (!projectId || !on || !can(session.data, 'bi.explain.view')) return null;
  return <span className="actions-row" data-testid={testid}>
    <strong>{t('whyLink')}</strong>
    {['cost', 'schedule', 'margin'].map((k) => <Link key={k} to={`/bi/explain?projectId=${projectId}${k === 'cost' ? '' : `&kpi=${k}`}`}>{t(`kpi.${k}`)}</Link>)}
    <Link to={`/bi/explain?tab=drill&level=project&id=${projectId}&projectId=${projectId}`}>{t('tab.drill')}</Link>
  </span>;
}
