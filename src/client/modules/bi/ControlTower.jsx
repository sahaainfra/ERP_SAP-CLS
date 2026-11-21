import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { Card, CardGrid, Section } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from './api.js';

// Part 27.04: the enterprise control tower (overview page, UI v3 §3.4). One page with four pill tabs: the executive dashboard (certified KPI tiles,
// health by dimension, alerts, my pending actions, cash outlook), the health matrix (RAG per project with the drill to the project, its WBS and the
// source records), the executive alerts worklist and the early-warning settings (maker-checker). Every figure comes from GET /bi/control-tower.

const TABS = ['overview', 'matrix', 'alerts', 'settings'];
const RAG_STATUS = { RED: 'CRITICAL', AMBER: 'AT_RISK', GREEN: 'APPROVED', NONE: 'CANCELLED' };
const DIMENSIONS = ['time', 'cost', 'quality', 'safety', 'cash'];
const RAG_COLOUR = { RED: 'var(--erp-color-status-error-solid)', AMBER: 'var(--erp-color-status-warning-solid)', GREEN: 'var(--erp-color-status-success-solid)', NONE: 'var(--erp-color-border-strong)' };
const read = async (path) => (await api.get(path)).data;
const write = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null && v !== false)); const s = p.toString(); return s ? `?${s}` : ''; };
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/bi/control-tower${p.toString() ? `?${p}` : ''}`);
};

function Rag({ state, label }) {
  const t = useT('ct');
  return <StatusBadge status={RAG_STATUS[state] ?? 'CANCELLED'} label={label ? `${label}: ${t(`rag.${state}`)}` : t(`rag.${state}`)} variant="dot" size="sm" />;
}

function useFigure() {
  const { money, number } = useFormat();
  return (value, unit) => {
    if (value == null) return '—';
    if (unit === 'INR') return money(String(value));
    if (unit === '%') return `${number(String(value), { decimals: 2 })}%`;
    if (unit === 'days') return number(String(value), { decimals: 1 });
    return number(String(value), { decimals: 2 });
  };
}

function Filters({ data, search }) {
  const t = useT('ct');
  const o = data.options;
  const set = (k) => (e) => go({ [k]: e.target.value, page: '' });
  return <div className="actions-row" data-testid="ct-filters">
    <Field name="ct-region" label={t('f.region')}><select value={search.get('regionId') ?? ''} onChange={set('regionId')}><option value="">{t('f.all')}</option>{o.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
    <Field name="ct-sector" label={t('f.sector')}><select value={search.get('sector') ?? ''} onChange={set('sector')}><option value="">{t('f.all')}</option>{o.sectors.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
    <Field name="ct-pm" label={t('f.pm')}><select value={search.get('pm') ?? ''} onChange={set('pm')}><option value="">{t('f.all')}</option>{o.pms.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
    {['regionId', 'sector', 'pm', 'rag', 'dimension'].some((k) => search.get(k)) && <button type="button" className="btn" onClick={() => go({ regionId: '', sector: '', pm: '', rag: '', dimension: '', dimensionRag: '', page: '' })}>{t('f.clear')}</button>}
  </div>;
}

function Tiles({ tiles }) {
  const t = useT('ct');
  const figure = useFigure();
  const { number } = useFormat();
  return <KpiRow testid="ct-tiles" label={t('tab.overview')}>
    {[...tiles].sort((a, b) => Number(b.hero) - Number(a.hero)).map((tile) => {
      const note = tile.state === 'OK' ? t('state.certified', { n: tile.projects }) : t(`state.${tile.state}`);
      return <KpiTile key={tile.key} testid={`ct-tile-${tile.key}`} valueTestid={`ct-tile-${tile.key}-value`} label={t(`tile.${tile.key}`)} kind={tile.unit === 'INR' ? 'money' : tile.kind === 'money' ? 'percent' : tile.kind}
        amount={tile.value ?? undefined} value={tile.value == null ? '—' : figure(tile.value, tile.unit)}
        unit={tile.unit && tile.unit !== 'INR' && tile.unit !== '%' ? tile.unit : undefined} tone={tile.tone ?? 'neutral'}
        trend={tile.value != null && tile.previous != null ? { previous: tile.previous, better: tile.better, label: t('trend') } : undefined}
        to={tile.state === 'UNCERTIFIED' ? '/bi/metrics' : tile.drill} data-state={tile.state}>
        {note}{tile.target != null ? ` · ${t('state.target', { v: number(String(tile.target), { decimals: 2 }) })}` : ''}
      </KpiTile>;
    })}
  </KpiRow>;
}

function AlertRows({ rows, compact = false, onChanged }) {
  const t = useT('ct');
  const { dateTime } = useFormat();
  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState('');
  const act = useMutation({ mutationFn: ({ id, action, version }) => write(`/bi/exec-alerts/${id}/act`, { action, version, ...(action === 'resolve' ? { note } : {}) }),
    onSuccess: () => { setResolving(null); setNote(''); onChanged?.(); } });
  if (!rows.length) return <EmptyState compact title={compact ? t('card.noAlerts') : t('a.empty')} message={compact ? undefined : t('a.emptyBody')} />;
  return <div className="table-scroll">
    {act.error && <ErrorState error={act.error} />}
    <table className="data-table" data-testid="ct-alerts">
      <thead><tr><th>{t('a.no')}</th><th>{t('m.project')}</th><th>{t('a.message')}</th><th>{t('f.severity')}</th>{!compact && <><th>{t('a.owner')}</th><th>{t('a.raised')}</th><th>{t('a.status')}</th><th>{t('a.actions')}</th></>}</tr></thead>
      <tbody>{rows.map((a) => <tr key={a.id} data-testid="ct-alert-row" data-rule={a.ruleCode} data-status={a.status}>
        <td data-label={t('a.no')}><strong>{a.alertNo}</strong><br /><span className="muted small">{a.rule}</span></td>
        <td data-label={t('m.project')}>{a.projectId ? <Link to={`/bi/control-tower?tab=matrix&projectId=${a.projectId}`}>{a.project}</Link> : '—'}</td>
        <td data-label={t('a.message')}>{a.message}</td>
        <td data-label={t('f.severity')}><StatusBadge status={a.severity} label={t(`sev.${a.severity}`)} size="sm" /></td>
        {!compact && <>
          <td data-label={t('a.owner')}>{a.owner ?? '—'}</td>
          <td data-label={t('a.raised')}>{dateTime(a.raisedAt)}</td>
          <td data-label={t('a.status')}><StatusBadge status={a.status} label={t(`a.status.${a.status}`)} size="sm" />{a.resolution ? <><br /><span className="muted small">{a.resolution}</span></> : null}</td>
          <td data-label={t('a.actions')}>
            <div className="actions-row">
              {a.route && <Link to={a.route}>{t('a.sourceLink')}</Link>}
              {a.taskRoute && <Link to={a.taskRoute}>{t('a.task')}</Link>}
              {a.status === 'OPEN' && <button type="button" className="btn" disabled={act.isPending} data-testid="ct-ack" onClick={() => act.mutate({ id: a.id, action: 'acknowledge', version: a.version })}>{t('a.ack')}</button>}
              {a.status !== 'RESOLVED' && resolving !== a.id && <button type="button" className="btn" data-testid="ct-resolve" onClick={() => { setResolving(a.id); setNote(''); }}>{t('a.resolve')}</button>}
            </div>
            {resolving === a.id && <form onSubmit={(e) => { e.preventDefault(); act.mutate({ id: a.id, action: 'resolve', version: a.version }); }}>
              <Field name={`ct-note-${a.id}`} label={t('a.note')} hint={t('a.noteHint')}><textarea required minLength={5} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={act.isPending || note.trim().length < 5}>{t('a.confirm')}</button><button type="button" className="btn" onClick={() => setResolving(null)}>{t('a.cancel')}</button></div>
            </form>}
          </td>
        </>}
      </tr>)}</tbody>
    </table>
  </div>;
}

function Overview({ data }) {
  const t = useT('ct');
  const figure = useFigure();
  const { date } = useFormat();
  const health = { categories: DIMENSIONS.map((d) => t(`dim.${d}`)),
    series: ['RED', 'AMBER', 'GREEN', 'NONE'].map((state) => ({ name: t(`rag.${state}`), colour: RAG_COLOUR[state], values: DIMENSIONS.map((d) => data.dimensions[d][state]),
      drill: DIMENSIONS.map((d) => `/bi/control-tower?tab=matrix&dimension=${d}&dimensionRag=${state}`) })) };
  return <>
    <Tiles tiles={data.tiles} />
    <CardGrid testid="ct-cards">
      <Card title={t('card.health')} subtitle={t('card.healthSub')} viewAll="/bi/control-tower?tab=matrix" viewAllLabel={t('viewAll')} testid="ct-card-health">
        <Chart type="stacked" data={health} title={t('card.health')} onDrill={(to) => navigateTo(to)} exportName="portfolio-health" />
      </Card>
      <Card title={t('card.alerts')} subtitle={t('card.alertsSub', { open: data.alerts.open, critical: data.alerts.critical })} count={{ shown: data.alerts.top.length, total: data.alerts.open }}
        viewAll="/bi/control-tower?tab=alerts" viewAllLabel={t('viewAll')} testid="ct-card-alerts">
        <AlertRows rows={data.alerts.top} compact />
      </Card>
      <Card title={t('card.pending')} viewAll="/bi/control-tower?tab=alerts&mine=1" viewAllLabel={t('viewAll')} testid="ct-card-pending">
        {data.pending.alerts.length + data.pending.approvals.length === 0 ? <EmptyState compact title={t('card.noPending')} />
          : <ul className="wd-todo">
            {data.pending.alerts.map((a) => <li key={`a${a.id}`}><Link to={`/bi/control-tower?tab=alerts&alert=${a.id}`}>{a.alertNo}</Link> <StatusBadge status={a.severity} label={t(`sev.${a.severity}`)} size="sm" /><span className="muted small">{a.message}</span></li>)}
            {data.pending.approvals.map((r) => <li key={`r${r.id}`}><Link to="/bi/control-tower?tab=settings">{t('card.pendingApproval', { title: r.title })}</Link></li>)}
          </ul>}
      </Card>
      <Card title={t('card.cash')} viewAll={data.cash?.route ?? '/finance/treasury'} viewAllLabel={t('viewAll')} testid="ct-card-cash">
        {data.cashMasked ? <p className="muted">{t('card.cashMasked')}</p> : !data.cash ? <EmptyState compact title={t('card.cashNone')} />
          : <KpiRow><KpiTile label={t('card.cashLowest')} kind="money" amount={data.cash.lowest} value={figure(data.cash.lowest, 'INR')} tone={data.cash.lowest < 0 ? 'error' : 'success'} to={data.cash.route}>
            {t('card.cashWeek', { week: date(data.cash.lowestWeek) })} · {data.cash.docNo}
          </KpiTile></KpiRow>}
      </Card>
      {data.uncertified.length > 0 && <Card title={t('card.uncertified')} viewAll="/bi/metrics" viewAllLabel={t('card.openCatalogue')} testid="ct-card-uncertified">
        <p className="muted">{t('card.uncertifiedBody')}</p>
        <ul>{data.uncertified.map((m) => <li key={m.code}>{m.name}</li>)}</ul>
      </Card>}
    </CardGrid>
  </>;
}

function ProjectDrill({ projectId }) {
  const t = useT('ct');
  const figure = useFigure();
  const q = useQuery({ queryKey: ['bi', 'tower-project', projectId], queryFn: () => read(`/bi/control-tower/projects/${projectId}`), retry: false });
  if (q.isPending) return <Skeleton label={t('d.metrics')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return <Section title={t('d.title', { code: d.code, name: d.name })} testid="ct-drill"
    actions={<><Link to={d.project360}>{t('d.p360')}</Link> <button type="button" className="btn" onClick={() => go({ projectId: '' })}>{t('d.close')}</button></>}>
    <div className="actions-row">{['overall', ...DIMENSIONS].map((k) => <Rag key={k} state={d.health[k]} label={t(`dim.${k}`)} />)}</div>
    <h3>{t('d.metrics')}</h3>
    <ul className="wd-topn" data-testid="ct-drill-metrics">{d.metrics.map((m) => <li key={m.code} className="wd-topn-row" data-code={m.code}>
      <span className="wd-topn-label">{m.name}{m.previous ? <><br /><span className="muted small">{t('d.previous', { v: figure(m.previous.value, m.unit), p: m.previous.sourcePeriod })}</span></> : null}</span>
      <span className="wd-topn-value">{!m.certified ? t('d.notCertified') : m.masked ? t('d.masked') : m.sourceRoute ? <Link to={m.sourceRoute}>{figure(m.value, m.unit)}</Link> : figure(m.value, m.unit)}</span>
    </li>)}</ul>
    <h3>{d.wbs ? t('d.wbs', { doc: d.wbs.docNo }) : t('d.wbsNone')}</h3>
    {d.wbs && d.wbs.rows.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="ct-wbs">
      <thead><tr><th>WBS</th><th className="num">{t('d.planned')}</th><th className="num">{t('d.physical')}</th><th className="num">{t('m.spi')}</th></tr></thead>
      <tbody>{d.wbs.rows.map((w) => <tr key={w.code}><td data-label="WBS"><Link to={w.route}>{w.code} {w.name}</Link></td><td data-label={t('d.planned')} className="num">{w.planned ?? '—'}</td><td data-label={t('d.physical')} className="num">{w.physical ?? '—'}</td><td data-label={t('m.spi')} className="num">{w.spi ?? '—'}</td></tr>)}</tbody>
    </table></div>}
    {d.wbs && <p><Link to={d.wbs.route}>{t('d.source')}: {d.wbs.docNo}</Link></p>}
    <h3>{t('d.alerts')}</h3>
    <AlertRows rows={d.alerts} compact />
  </Section>;
}

function Matrix({ data, search }) {
  const t = useT('ct');
  const figure = useFigure();
  const { number } = useFormat();
  const m = data.matrix;
  const pages = Math.max(1, Math.ceil(m.total / m.pageSize));
  const projectId = search.get('projectId');
  return <>
    {projectId && <ProjectDrill projectId={projectId} />}
    <div className="actions-row" role="group" aria-label={t('f.rag')} data-testid="ct-rag-filter">
      {['RED', 'AMBER', 'GREEN', 'NONE'].map((state) => <button key={state} type="button" className={`btn${search.get('rag') === state ? ' btn-primary' : ''}`} aria-pressed={search.get('rag') === state}
        onClick={() => go({ rag: search.get('rag') === state ? '' : state, page: '' })}>{t(`rag.${state}`)} ({data.distribution[state]})</button>)}
      <Field name="ct-sort" label={t('f.sort')}><select value={search.get('sort') ?? 'overall'} onChange={(e) => go({ sort: e.target.value })}>
        {['overall', 'spi', 'cpi', 'eac', 'margin', 'dso', 'ltifr'].map((k) => <option key={k} value={k}>{k === 'overall' ? t('m.overall') : t(`m.${k}`)}</option>)}
      </select></Field>
    </div>
    {m.total === 0 ? <EmptyState title={t('m.empty')} message={t('m.emptyBody')} action={<button type="button" className="btn" onClick={() => go({ regionId: '', sector: '', pm: '', rag: '', dimension: '', dimensionRag: '' })}>{t('f.clear')}</button>} />
      : <div className="table-scroll"><table className="data-table" data-testid="ct-matrix">
        <thead><tr><th>{t('m.project')}</th><th>{t('m.overall')}</th>{DIMENSIONS.map((d) => <th key={d}>{t(`dim.${d}`)}</th>)}<th className="num">{t('m.spi')}</th><th className="num">{t('m.cpi')}</th><th className="num">{t('m.eac')}</th><th className="num">{t('m.growth')}</th><th className="num">{t('m.margin')}</th><th className="num">{t('m.dso')}</th><th className="num">{t('m.alerts')}</th></tr></thead>
        <tbody>{m.rows.map((r) => {
          const cell = (k, unit) => (r.metrics[k]?.value == null ? '—' : r.metrics[k].sourceRoute ? <Link to={r.metrics[k].sourceRoute}>{figure(r.metrics[k].value, unit)}</Link> : figure(r.metrics[k].value, unit));
          return <tr key={r.projectId} data-testid="ct-matrix-row" data-code={r.code} data-overall={r.health.overall}>
            <td data-label={t('m.project')}><button type="button" className="btn" aria-label={t('m.open', { code: r.code })} onClick={() => go({ projectId: r.projectId })}>{r.code}</button><br /><span className="muted small">{r.name}</span></td>
            <td data-label={t('m.overall')}><Rag state={r.health.overall} /></td>
            {DIMENSIONS.map((d) => <td key={d} data-label={t(`dim.${d}`)}><Rag state={r.health[d]} /></td>)}
            <td data-label={t('m.spi')} className="num">{cell('spi')}</td>
            <td data-label={t('m.cpi')} className="num">{cell('cpi')}</td>
            <td data-label={t('m.eac')} className="num">{cell('eac', 'INR')}</td>
            <td data-label={t('m.growth')} className="num">{r.health.eacGrowth == null ? '—' : `${number(String(r.health.eacGrowth), { decimals: 2 })}%`}</td>
            <td data-label={t('m.margin')} className="num">{cell('margin', '%')}</td>
            <td data-label={t('m.dso')} className="num">{cell('dso', 'days')}</td>
            <td data-label={t('m.alerts')} className="num">{r.alerts ? <Link to={`/bi/control-tower?tab=alerts&projectId=${r.projectId}`}>{r.alerts}</Link> : 0}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    {m.total > m.pageSize && <div className="pager"><span>{t('m.page', { page: m.page, pages, total: m.total })}</span>
      <button type="button" className="btn" disabled={m.page <= 1} onClick={() => go({ page: m.page - 1 })}>{t('prev')}</button>
      <button type="button" className="btn" disabled={m.page >= pages} onClick={() => go({ page: m.page + 1 })}>{t('next')}</button></div>}
  </>;
}

function Alerts({ search }) {
  const t = useT('ct');
  const cache = useQueryClient();
  const filters = { status: search.get('status') ?? 'ACTIVE', severity: search.get('severity') ?? '', ruleCode: search.get('ruleCode') ?? '', projectId: search.get('projectId') ?? '', mine: search.get('mine') ?? '', page: search.get('page') ?? '' };
  const q = useQuery({ queryKey: ['bi', 'exec-alerts', filters], queryFn: () => read(`/bi/exec-alerts${qs(filters)}`), retry: false, placeholderData: (p) => p });
  const set = (k) => (e) => go({ [k]: e.target.value, page: '' });
  const refresh = () => Promise.all([cache.invalidateQueries({ queryKey: ['bi', 'exec-alerts'] }), cache.invalidateQueries({ queryKey: ['bi', 'tower'] })]);
  return <>
    <div className="actions-row" data-testid="ct-alert-filters">
      <Field name="ct-a-status" label={t('f.status')}><select value={filters.status} onChange={set('status')}>{['ACTIVE', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'].map((s) => <option key={s} value={s}>{t(`a.status.${s}`)}</option>)}</select></Field>
      <Field name="ct-a-severity" label={t('f.severity')}><select value={filters.severity} onChange={set('severity')}><option value="">{t('f.all')}</option>{['CRITICAL', 'WARNING', 'INFO'].map((s) => <option key={s} value={s}>{t(`sev.${s}`)}</option>)}</select></Field>
      <label className="actions-row"><input type="checkbox" checked={Boolean(filters.mine)} onChange={(e) => go({ mine: e.target.checked ? '1' : '', page: '' })} /> {t('f.mine')}</label>
    </div>
    {q.isPending && <Skeleton label={t('tab.alerts')} rows={4} />}
    {q.error && <ErrorState error={q.error} onRetry={q.refetch} />}
    {q.data && <>
      <AlertRows rows={q.data.rows} onChanged={refresh} />
      {q.data.total > q.data.pageSize && <div className="pager"><span>{t('m.page', { page: q.data.page, pages: Math.ceil(q.data.total / q.data.pageSize), total: q.data.total })}</span>
        <button type="button" className="btn" disabled={q.data.page <= 1} onClick={() => go({ page: q.data.page - 1 })}>{t('prev')}</button>
        <button type="button" className="btn" disabled={q.data.page * q.data.pageSize >= q.data.total} onClick={() => go({ page: q.data.page + 1 })}>{t('next')}</button></div>}
    </>}
  </>;
}

function Settings({ session }) {
  const t = useT('ct');
  const { number, dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['bi', 'exec-settings'], queryFn: () => read('/bi/exec-alert-settings'), retry: false });
  const [form, setForm] = useState(null);
  const [comment, setComment] = useState('');
  const refresh = () => cache.invalidateQueries({ queryKey: ['bi'] });
  const submit = useMutation({ mutationFn: (body) => write('/bi/exec-alert-settings/requests', body), onSuccess: () => { setForm(null); return refresh(); } });
  const decide = useMutation({ mutationFn: ({ id, action, version }) => write(`/bi/exec-alert-settings/requests/${id}/act`, { action, version, ...(comment ? { comment } : {}) }), onSuccess: () => { setComment(''); return refresh(); } });
  if (q.isPending) return <Skeleton label={t('tab.settings')} rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { rules, requests, can } = q.data;
  const pending = requests.filter((r) => r.status === 'SUBMITTED');
  const mayDecide = (r) => session?.user !== r.requestedBy && (r.chain[r.currentStep - 1] ?? '').split('|').some((role) => session?.roles?.includes(role));
  return <>
    <p className="muted">{t('s.makerChecker')}</p>
    <div className="table-scroll"><table className="data-table" data-testid="ct-settings">
      <thead><tr><th>{t('s.rule')}</th><th>{t('s.enabled')}</th><th className="num">{t('s.threshold')}</th><th className="num">{t('s.periods')}</th><th>{t('s.severity')}</th><th>{t('s.version')}</th>{can.configure && <th />}</tr></thead>
      <tbody>{rules.map((r) => <tr key={r.code} data-code={r.code}>
        <td data-label={t('s.rule')}>{r.name}</td>
        <td data-label={t('s.enabled')}>{r.enabled ? t('s.yes') : t('s.no')}</td>
        <td data-label={t('s.threshold')} className="num">{number(String(r.threshold), { decimals: r.unit === 'ratio' ? 2 : 0 })} {r.unit === 'ratio' ? '' : r.unit}</td>
        <td data-label={t('s.periods')} className="num">{r.periods}</td>
        <td data-label={t('s.severity')}><StatusBadge status={r.severity} label={t(`sev.${r.severity}`)} size="sm" /></td>
        <td data-label={t('s.version')}>{r.version ? `${r.version} · ${r.approvedBy}` : t('s.default')}</td>
        {can.configure && <td><button type="button" className="btn" onClick={() => setForm({ ruleCode: r.code, enabled: r.enabled, threshold: String(r.threshold), periods: r.periods, severity: r.severity, reason: '', usesPeriods: r.usesPeriods, name: r.name })}>{t('s.change')}</button></td>}
      </tr>)}</tbody>
    </table></div>
    {form && <Section title={`${t('s.change')}: ${form.name}`} testid="ct-settings-form">
      <form onSubmit={(e) => { e.preventDefault(); submit.mutate({ ruleCode: form.ruleCode, enabled: form.enabled, threshold: Number(form.threshold), periods: Number(form.periods), severity: form.severity, reason: form.reason }); }}>
        <Field name="ct-s-enabled" label={t('s.enabled')}><select value={form.enabled ? '1' : '0'} onChange={(e) => setForm({ ...form, enabled: e.target.value === '1' })}><option value="1">{t('s.yes')}</option><option value="0">{t('s.no')}</option></select></Field>
        <Field name="ct-s-threshold" label={t('s.threshold')}><input type="number" inputMode="decimal" step="any" required value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></Field>
        {form.usesPeriods && <Field name="ct-s-periods" label={t('s.periods')}><input type="number" inputMode="numeric" min={1} max={6} required value={form.periods} onChange={(e) => setForm({ ...form, periods: e.target.value })} /></Field>}
        <Field name="ct-s-severity" label={t('s.severity')}><select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>{['CRITICAL', 'WARNING', 'INFO'].map((s) => <option key={s} value={s}>{t(`sev.${s}`)}</option>)}</select></Field>
        <Field name="ct-s-reason" label={t('s.reason')}><textarea required minLength={5} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={submit.isPending}>{t('s.submit')}</button><button type="button" className="btn" onClick={() => setForm(null)}>{t('a.cancel')}</button></div>
        {submit.error && <ErrorState error={submit.error} />}
      </form>
    </Section>}
    {submit.isSuccess && <p role="status">{t('s.submitted')}</p>}
    {can.configure && <Section title={t('s.pending')} testid="ct-settings-pending">
      {!pending.length ? <p className="muted">{t('s.noPending')}</p> : pending.map((r) => <Card key={r.id} title={r.title} subtitle={`${r.requestedBy} · ${dateTime(r.requestedAt)}`}>
        <p>{t('s.from')}: {r.payload.from.threshold} · {r.payload.from.severity} → {t('s.to')}: {r.payload.threshold} · {r.payload.severity}{r.payload.enabled ? '' : ` · ${t('s.no')}`}</p>
        <p>{r.reason}</p>
        {mayDecide(r) && <>
          <Field name={`ct-s-comment-${r.id}`} label={t('s.comment')}><textarea maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <div className="actions-row">{['approve', 'reject', 'return'].map((action) => <button key={action} type="button" className={`btn${action === 'approve' ? ' btn-primary' : ''}`}
            disabled={decide.isPending || (action !== 'approve' && comment.trim().length < 5)} onClick={() => decide.mutate({ id: r.id, action, version: r.version })}>{t(`s.${action}`)}</button>)}</div>
        </>}
      </Card>)}
      {decide.error && <ErrorState error={decide.error} />}
      {requests.some((r) => r.status !== 'SUBMITTED') && <details><summary>{t('s.history')}</summary>
        <ul>{requests.filter((r) => r.status !== 'SUBMITTED').map((r) => <li key={r.id}>{r.title} · {r.status} · {r.requestedBy}{r.steps.map((s) => ` · ${s.decision} ${s.decidedBy}`).join('')}</li>)}</ul>
      </details>}
    </Section>}
  </>;
}

export function ControlTower({ session, initialTab = 'overview' }) {
  const t = useT('ct');
  usePageTitle(t('title'));
  const { dateTime, date } = useFormat();
  const search = useSearch();
  const cache = useQueryClient();
  const tab = TABS.includes(search.get('tab')) ? search.get('tab') : initialTab;
  const filters = Object.fromEntries(['regionId', 'sector', 'pm', 'rag', 'sort', 'dimension', 'dimensionRag', 'page'].map((k) => [k, search.get(k) ?? '']));
  const q = useQuery({ queryKey: ['bi', 'tower', filters], queryFn: () => read(`/bi/control-tower${qs(filters)}`), retry: false, placeholderData: (p) => p });
  const run = useMutation({ mutationFn: () => write('/bi/exec-alerts/evaluations', {}), onSuccess: () => setTimeout(() => cache.invalidateQueries({ queryKey: ['bi'] }), 3000) });
  const [format, setFormat] = useState('xlsx');
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/bi/control-tower/export${qs({ ...filters, page: '', format })}`, `control-tower.${format}`) });
  if (q.error?.status === 403) return <NoPermission what={t('noPermission')} permission="bi.control_tower.view" />;
  if (q.isPending) return <section><PageHeader title={t('title')} /><Skeleton label={t('title')} rows={6} /></section>;
  if (q.error) return <section><PageHeader title={t('title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data;
  const actions = <>
    {d.can.run && <button type="button" className="btn" disabled={run.isPending} onClick={() => run.mutate()} data-testid="ct-run">{t('run')}</button>}
    {d.can.export && <>
      <label className="sr-only" htmlFor="ct-format">{t('format')}</label>
      <select id="ct-format" value={format} onChange={(e) => setFormat(e.target.value)}>{['xlsx', 'csv', 'pdf'].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select>
      <button type="button" className="btn" disabled={download.isPending} onClick={() => download.mutate()} data-testid="ct-export">{t('export')}</button>
    </>}
  </>;
  return <section aria-labelledby="ct-h" data-testid="bi-control-tower">
    <PageHeader id="ct-h" title={t('title')} subtitle={`${t('asOf', { date: date(d.asOf), time: dateTime(d.evaluatedAt) })} · ${d.lastCapturedAt ? t('lastCapture', { time: dateTime(d.lastCapturedAt) }) : t('noCapture')}`} actions={actions} />
    {run.isSuccess && <p role="status">{t('runQueued')}</p>}
    {(run.error || download.error) && <ErrorState error={run.error ?? download.error} />}
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="ct-tabs">
      {TABS.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} data-tab={k}
        onClick={() => go({ tab: k, page: '', ...(k !== 'matrix' ? { projectId: '' } : {}) })}>{t(`tab.${k}`)}{k === 'alerts' && d.alerts.open ? ` (${d.alerts.open})` : ''}</button>)}
    </div>
    {tab !== 'settings' && tab !== 'alerts' && <Filters data={d} search={search} />}
    {tab === 'overview' && <Overview data={d} />}
    {tab === 'matrix' && <Matrix data={d} search={search} />}
    {tab === 'alerts' && <Alerts search={search} />}
    {tab === 'settings' && <Settings session={session} />}
  </section>;
}

/** The worklist entry of the menu: the same page opened on the alerts. */
export function ExecutiveAlerts({ session }) {
  return <ControlTower session={session} initialTab="alerts" />;
}
