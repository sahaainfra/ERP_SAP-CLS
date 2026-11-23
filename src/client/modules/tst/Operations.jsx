import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Chart from '../../platform/charts/Chart.jsx';
import { Card, CardGrid } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { COLOUR, Pager, ParamPanel, PillTabs, download, go, post, qs, read } from './common.jsx';

// Part 30.08: Operations Runbooks & Environment Inventory (analytical report). The chart of deployments by environment and outcome comes first,
// then the key figures (parity, the last production deploy, the zero-downtime rehearsal, runbooks approved, open pages), and three tabs:
// environments and deployments (cards on a phone, parameters in a bottom sheet, sticky total), runbooks (synced from the repository, submitted
// by DevOps, approved by the system administrator, readable here), and on call (who is on shift now, the rota, the pages with acknowledgement).
const BASE = '/admin/operations-runbooks';
const ENVS = ['production', 'staging', 'test', 'sandbox', 'dev'];
const DEP_TONE = { SUCCEEDED: 'APPROVED', FAILED: 'REJECTED', ROLLED_BACK: 'AT_RISK' };
const RB_TONE = { APPROVED: 'APPROVED', SUBMITTED: 'SUBMITTED', DRAFT: 'DRAFT', REJECTED: 'REJECTED', SUPERSEDED: 'CANCELLED', NOT_SYNCED: 'DRAFT' };
const PG_TONE = { SENT: 'SUBMITTED', ACKNOWLEDGED: 'APPROVED', ESCALATED: 'AT_RISK', UNCOVERED: 'REJECTED' };

export function Operations() {
  const t = useT('tst');
  const { number, dateTime } = useFormat();
  const search = useSearch();
  const cache = useQueryClient();
  usePageTitle(t('op.title'));
  const tab = ['runbooks', 'oncall'].includes(search.get('tab')) ? search.get('tab') : 'environments';
  const params = { environment: search.get('environment') ?? '', kind: search.get('kind') ?? '', status: search.get('status') ?? '', page: search.get('page') ?? '' };
  const q = useQuery({ queryKey: ['tst', 'ops', params], queryFn: () => read(`/tst/ops${qs(params)}`), retry: false, placeholderData: (p) => p });
  const refresh = () => cache.invalidateQueries({ queryKey: ['tst', 'ops'] });
  const sync = useMutation({ mutationFn: () => post('/tst/ops/runbooks/sync'), onSuccess: refresh });
  const exp = useMutation({ mutationFn: (f) => download('/tst/ops/export', { environment: params.environment, kind: params.kind, status: params.status, format: f }, `deployments.${f}`) });
  const n = (v) => (v == null ? '—' : number(String(v), { decimals: 0 }));
  const set = (patch) => go(BASE, { tab: tab === 'environments' ? '' : tab, ...params, ...patch, page: patch.page ?? '' });

  if (q.error?.status === 403) return <NoPermission what={t('op.noPermission')} permission="ops.runbook.view" />;
  if (q.isPending) return <section><PageHeader title={t('op.title')} /><Skeleton label={t('op.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('op.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data; const prod = d.environments.find((e) => e.code === 'production'); const R = d.lastRehearsal;
  const actions = d.can.manage ? <button type="button" className="btn" onClick={() => sync.mutate()} disabled={sync.isPending} data-testid="op-sync">{sync.isPending ? t('running') : t('op.sync')}</button> : null;
  const menu = d.can.export ? ['xlsx', 'csv', 'pdf'].map((f) => ({ label: t('exportAs', { f: f.toUpperCase() }), testid: `op-export-${f}`, onClick: () => exp.mutate(f) })) : [];
  const chart = { categories: d.byEnv.map((e) => t(`op.env.${e.code}`)), series: [
    { name: t('op.st.SUCCEEDED'), colour: COLOUR.PASS, values: d.byEnv.map((e) => e.succeeded), drill: d.byEnv.map((e) => `${BASE}?environment=${e.code}&status=SUCCEEDED`) },
    { name: t('op.st.ROLLED_BACK'), colour: 'var(--erp-color-status-warning-solid)', values: d.byEnv.map((e) => e.rolledBack), drill: d.byEnv.map((e) => `${BASE}?environment=${e.code}&status=ROLLED_BACK`) },
    { name: t('op.st.FAILED'), colour: COLOUR.FAIL, values: d.byEnv.map((e) => e.failed), drill: d.byEnv.map((e) => `${BASE}?environment=${e.code}&status=FAILED`) },
  ] };
  const tabs = [['environments', t('op.tabEnv')], ['runbooks', t('op.tabRunbooks')], ['oncall', t('op.tabOncall')]];
  return <section aria-labelledby="op-h" data-testid="tst-ops" data-tab={tab}>
    <PageHeader id="op-h" title={t('op.title')} subtitle={t('op.subtitle')} actions={actions} menu={menu}
      status={<StatusBadge status={d.parity.ok ? 'APPROVED' : 'REJECTED'} label={d.parity.ok ? t('op.parityOk') : t('op.parityDrift', { n: n(d.parity.problems.length) })} variant="solid" />} />
    {(sync.error || exp.error) && <ErrorState error={sync.error ?? exp.error} />}
    {sync.data && <p role="status" className="small" data-testid="op-synced">{t('op.synced', { files: n(sync.data.files), drafts: n(sync.data.drafts) })}</p>}
    <Card title={t('op.byEnv')} subtitle={t('op.byEnvNote')} testid="op-chart"><Chart type="stacked" data={chart} title={t('op.byEnv')} onDrill={(to) => navigateTo(to)} exportName="deployments-by-environment" /></Card>
    <KpiRow testid="op-tiles" label={t('op.title')}>
      <KpiTile testid="op-prod" label={t('op.prodBuild')} kind="count" value={prod?.activeBuild ?? '—'} to={`${BASE}?environment=production`}>{prod?.lastDeployAt ? t('op.deployedAt', { at: dateTime(prod.lastDeployAt), slot: prod.activeSlot ?? '—' }) : t('op.notDeployed')}</KpiTile>
      <KpiTile testid="op-rehearsal" label={t('op.rehearsal')} kind="quality" value={R ? t(`op.st.${R.status}`) : '—'} tone={R?.status === 'SUCCEEDED' ? 'success' : R ? 'error' : 'warning'} to={`${BASE}?kind=REHEARSAL`}>{R ? t('op.rehearsalOf', { requests: n(R.requests), failed: n(R.failedRequests) }) : t('op.noRehearsal')}</KpiTile>
      <KpiTile testid="op-runbooks" label={t('op.runbooksApproved')} kind="quality" value={`${n(d.runbooksApproved)} / ${n(d.runbooks.length)}`} tone={d.runbooksApproved === d.runbooks.length ? 'success' : 'warning'} to={`${BASE}?tab=runbooks`} />
      <KpiTile testid="op-pages" label={t('op.openPages')} kind="risk" value={n(d.oncall.openPages)} tone={d.oncall.openPages ? 'error' : 'success'} to={`${BASE}?tab=oncall`}>{t('op.onNow', { l2: d.oncall.now.L2 ?? t('op.nobody') })}</KpiTile>
    </KpiRow>
    <PillTabs label={t('op.title')} tabs={tabs} value={tab} onChange={(k) => go(BASE, { tab: k === 'environments' ? '' : k })} testid="op-tabs" />
    {tab === 'environments' && <EnvTab t={t} d={d} params={params} set={set} n={n} />}
    {tab === 'runbooks' && <RunbooksTab t={t} d={d} refresh={refresh} />}
    {tab === 'oncall' && <OncallTab t={t} d={d} refresh={refresh} />}
  </section>;
}

function EnvTab({ t, d, params, set, n }) {
  const { dateTime } = useFormat();
  return <>
    <Card title={t('op.inventory')} subtitle={t('op.inventoryNote')} testid="op-envs">
      <div className="table-scroll"><table className="data-table" data-testid="op-env-table">
        <thead><tr><th>{t('op.environment')}</th><th>{t('op.activeBuild')}</th><th>{t('op.parity')}</th><th>{t('op.lastDeploy')}</th></tr></thead>
        <tbody>{d.environments.map((e) => <tr key={e.code} data-testid="op-env" data-code={e.code} data-parity={e.parity}>
          <td data-label={t('op.environment')}><strong>{t(`op.env.${e.code}`)}</strong>{e.url ? <><br /><span className="muted small">{e.url}</span></> : null}</td>
          <td data-label={t('op.activeBuild')}>{e.activeBuild ?? '—'}{e.activeSlot ? <span className="muted small"> · {e.activeSlot}</span> : null}</td>
          <td data-label={t('op.parity')}><StatusBadge status={e.parity === 'OK' ? 'APPROVED' : 'REJECTED'} label={t(`op.par.${e.parity}`)} size="sm" />{e.parityProblems.length ? <><br /><span className="small">{e.parityProblems[0]}</span></> : null}</td>
          <td data-label={t('op.lastDeploy')}>{e.last ? <><StatusBadge status={DEP_TONE[e.last.status]} label={t(`op.st.${e.last.status}`)} size="sm" /> <span className="small">{e.last.deployNo} · {dateTime(e.last.finishedAt)}</span></> : <span className="muted small">{t('op.notDeployed')}</span>}</td>
        </tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row" colSpan={3}>{t('op.envTotal', { n: n(d.environments.length), keys: n(d.parity.keys) })}</th><td>{d.parity.ok ? t('op.parityOk') : t('op.parityDrift', { n: n(d.parity.problems.length) })}</td></tr></tfoot>
      </table></div>
    </Card>
    <Card title={t('op.deployments')} testid="op-deployments">
      <ParamPanel label={t('params')} done={t('done')} count={[params.environment, params.kind, params.status].filter(Boolean).length} testid="op-params">
        <Field name="op-env" label={t('op.environment')}><select value={params.environment} onChange={(e) => set({ environment: e.target.value })} data-testid="op-f-env"><option value="">{t('all')}</option>{ENVS.map((e) => <option key={e} value={e}>{t(`op.env.${e}`)}</option>)}</select></Field>
        <Field name="op-kind" label={t('op.kind')}><select value={params.kind} onChange={(e) => set({ kind: e.target.value })} data-testid="op-f-kind"><option value="">{t('all')}</option>{['DEPLOY', 'ROLLBACK', 'REHEARSAL'].map((k) => <option key={k} value={k}>{t(`op.kd.${k}`)}</option>)}</select></Field>
        <Field name="op-status" label={t('status')}><select value={params.status} onChange={(e) => set({ status: e.target.value })} data-testid="op-f-status"><option value="">{t('all')}</option>{['SUCCEEDED', 'FAILED', 'ROLLED_BACK'].map((k) => <option key={k} value={k}>{t(`op.st.${k}`)}</option>)}</select></Field>
      </ParamPanel>
      {!d.deployments.rows.length ? <EmptyState compact title={t('op.noDeployments')} message={t('op.noDeploymentsBody')} /> : <>
        <div className="table-scroll"><table className="data-table" data-testid="op-dep-table">
          <thead><tr><th>{t('op.deployment')}</th><th>{t('op.environment')}</th><th>{t('op.build')}</th><th className="num">{t('op.duration')}</th><th>{t('status')}</th></tr></thead>
          <tbody>{d.deployments.rows.map((x) => <tr key={x.id} data-testid="op-dep" data-kind={x.kind} data-status={x.status}>
            <td data-label={t('op.deployment')}>{x.deployNo} · {t(`op.kd.${x.kind}`)}<br /><span className="muted small">{x.requestedBy}{x.pipelineRun ? ` · ${x.pipelineRun}` : ''}{x.requests != null ? ` · ${t('op.rehearsalOf', { requests: n(x.requests), failed: n(x.failedRequests) })}` : ''}</span></td>
            <td data-label={t('op.environment')}>{t(`op.env.${x.environment}`)}</td><td data-label={t('op.build')}>{x.buildId ?? '—'}</td>
            <td data-label={t('op.duration')} className="num">{n(Math.round(x.durationMs / 1000))} s</td>
            <td data-label={t('status')}><StatusBadge status={DEP_TONE[x.status]} label={t(`op.st.${x.status}`)} size="sm" /></td>
          </tr>)}</tbody>
          <tfoot className="sticky-total"><tr><th scope="row" colSpan={4}>{t('op.depTotal', { n: n(d.deployments.total) })}</th><td /></tr></tfoot>
        </table></div>
        <Pager page={d.deployments.page} pageSize={d.deployments.pageSize} total={d.deployments.total} onPage={(p) => set({ page: p })} t={t} testid="op-pager" />
      </>}
    </Card>
  </>;
}

function RunbooksTab({ t, d, refresh }) {
  const { dateTime } = useFormat();
  const [open, setOpen] = useState(null);
  const rb = useQuery({ queryKey: ['tst', 'ops', 'runbook', open], queryFn: () => read(`/tst/ops/runbooks/${open}`), enabled: Boolean(open), retry: false });
  const submit = useMutation({ mutationFn: (code) => post(`/tst/ops/runbooks/${code}/submit`, { reason: t('op.submitReason') }), onSuccess: () => { refresh(); rb.refetch(); } });
  const act = useMutation({ mutationFn: ([id, action]) => post(`/tst/ops/runbook-requests/${id}/act`, { action }), onSuccess: () => { refresh(); rb.refetch(); } });
  return <CardGrid>
    <Card title={t('op.runbooks')} subtitle={t('op.runbooksNote')} testid="op-runbooks-card">
      {(submit.error || act.error) && <ErrorState error={submit.error ?? act.error} />}
      <ul className="lp-list">{d.runbooks.map((r) => <li key={r.code} data-testid="op-runbook" data-code={r.code} data-status={r.status}>
        <button type="button" className="btn btn-small" onClick={() => setOpen(r.code)} data-testid={`op-open-${r.code}`}>{r.title}</button>{' '}
        <StatusBadge status={RB_TONE[r.status]} label={t(`op.rb.${r.status}`)} size="sm" />{r.changed && r.status !== 'NOT_SYNCED' ? <span className="small"> · {t('op.changed')}</span> : null}
        {r.approvedVersion ? <span className="muted small"> · {t('op.approvedV', { v: r.approvedVersion, by: r.approvedBy, at: dateTime(r.approvedAt) })}</span> : null}
        {d.can.manage && ['DRAFT', 'REJECTED'].includes(r.status) && !r.changed && <> <button type="button" className="btn btn-small" onClick={() => submit.mutate(r.code)} data-testid={`op-submit-${r.code}`}>{t('op.submit')}</button></>}
        {r.awaitingMe && <> <button type="button" className="btn btn-small btn-primary" onClick={() => act.mutate([r.requestId, 'approve'])} data-testid={`op-approve-${r.code}`}>{t('approve')}</button></>}
      </li>)}</ul>
    </Card>
    {open && <Card title={rb.data?.title ?? open} subtitle={rb.data ? `${rb.data.path} · v${rb.data.versionNo}` : ''} testid="op-runbook-view" menu={<button type="button" className="btn btn-small" onClick={() => setOpen(null)}>{t('close')}</button>}>
      {rb.isPending ? <Skeleton label={open} rows={6} /> : rb.error ? <ErrorState error={rb.error} onRetry={rb.refetch} /> : <pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} data-testid="op-runbook-text">{rb.data.text}</pre>}
    </Card>}
  </CardGrid>;
}

function OncallTab({ t, d, refresh }) {
  const { dateTime } = useFormat();
  const [v, setV] = useState({ username: '', level: 'L2', fromAt: '', toAt: '' });
  const add = useMutation({ mutationFn: () => post('/tst/ops/oncall', { username: v.username, level: v.level, fromAt: new Date(v.fromAt).toISOString(), toAt: new Date(v.toAt).toISOString() }), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (id) => post(`/tst/ops/oncall/${id}/cancel`), onSuccess: refresh });
  const ack = useMutation({ mutationFn: (id) => post(`/tst/ops/pages/${id}/acknowledge`), onSuccess: refresh });
  const O = d.oncall;
  return <>
    <CardGrid>
      <Card title={t('op.onShift')} subtitle={t('op.ackWithin', { m: O.ackMinutes })} testid="op-now">
        <ul className="lp-list">{['L1', 'L2', 'L3'].map((l) => <li key={l} data-testid="op-level" data-level={l}><strong>{l}</strong> · {O.now[l] ?? <span className="muted">{t('op.nobody')}</span>}</li>)}</ul>
      </Card>
      <Card title={t('op.pages')} testid="op-pages-card">
        {ack.error && <ErrorState error={ack.error} />}
        {!O.pages.length ? <EmptyState compact title={t('op.noPages')} message={t('op.noPagesBody')} /> : <ul className="lp-list">{O.pages.map((p) => <li key={p.id} data-testid="op-page" data-status={p.status}>
          <StatusBadge status={PG_TONE[p.status]} label={t(`op.pg.${p.status}`)} size="sm" /> {p.level} · {p.username ?? t('op.nobody')} · <strong>{p.rule}</strong> {p.message} <span className="muted small">{dateTime(p.pagedAt)}</span>
          {d.can.ack && ['SENT', 'UNCOVERED'].includes(p.status) && <> <button type="button" className="btn btn-small btn-primary" onClick={() => ack.mutate(p.id)} data-testid={`op-ack-${p.id}`}>{t('op.ack')}</button></>}
        </li>)}</ul>}
      </Card>
    </CardGrid>
    <Card title={t('op.rota')} testid="op-rota">
      {!O.rota.length ? <EmptyState compact title={t('op.noRota')} message={t('op.noRotaBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="op-rota-table">
        <thead><tr><th>{t('op.person')}</th><th>{t('op.level')}</th><th>{t('op.from')}</th><th>{t('op.to')}</th>{d.can.oncall && <th />}</tr></thead>
        <tbody>{O.rota.map((s) => <tr key={s.id} data-testid="op-shift"><td data-label={t('op.person')}>{s.username}{s.onNow ? <> <StatusBadge status="APPROVED" label={t('op.now')} size="sm" /></> : null}</td><td data-label={t('op.level')}>{s.level}</td><td data-label={t('op.from')}>{dateTime(s.fromAt)}</td><td data-label={t('op.to')}>{dateTime(s.toAt)}</td>{d.can.oncall && <td><button type="button" className="btn btn-small" onClick={() => cancel.mutate(s.id)}>{t('cancel')}</button></td>}</tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row" colSpan={d.can.oncall ? 5 : 4}>{t('op.shifts', { n: O.rota.length })}</th></tr></tfoot>
      </table></div>}
      {d.can.oncall && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(); }} data-testid="op-shift-form">
        <Field name="os-user" label={t('op.person')}><input value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} required data-testid="os-user" /></Field>
        <Field name="os-level" label={t('op.level')}><select value={v.level} onChange={(e) => setV({ ...v, level: e.target.value })} data-testid="os-level">{['L1', 'L2', 'L3'].map((l) => <option key={l} value={l}>{l}</option>)}</select></Field>
        <Field name="os-from" label={t('op.from')}><input type="datetime-local" value={v.fromAt} onChange={(e) => setV({ ...v, fromAt: e.target.value })} required data-testid="os-from" /></Field>
        <Field name="os-to" label={t('op.to')}><input type="datetime-local" value={v.toAt} onChange={(e) => setV({ ...v, toAt: e.target.value })} required data-testid="os-to" /></Field>
        {add.error && <ErrorState error={add.error} />}
        <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={add.isPending} data-testid="os-save">{t('op.addShift')}</button></div>
      </form>}
    </Card>
  </>;
}
