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
import { COLOUR, Pager, ParamPanel, PillTabs, download, go, post, qs, read, useNarrow } from './common.jsx';

// Part 30.10: Go-Live Readiness (board) with the UAT status, the cut-over runbook, the go/no-go decision and the hypercare daily report.
// The board has a column per state of a criterion (open, not met, met, waived); on a phone one column at a time with pills to switch, and a
// criterion is moved through its menu, not by dragging. Every figure comes from the API; the automatic criteria are evaluated from the records
// of the earlier parts, the manual ones confirmed by their owners with evidence.
const BASE = '/admin/go-live';
const COLUMNS = ['OPEN', 'NOT_MET', 'MET', 'WAIVED'];
const TONE = { OPEN: 'DRAFT', NOT_MET: 'REJECTED', MET: 'APPROVED', WAIVED: 'CANCELLED', NOT_RUN: 'DRAFT', PASS: 'APPROVED', FAIL: 'REJECTED', BLOCKED: 'AT_RISK', TRIAGED: 'SUBMITTED', FIXED: 'AT_RISK', CLOSED: 'APPROVED', DEFERRED: 'CANCELLED', SUBMITTED: 'SUBMITTED', SIGNED: 'APPROVED', REJECTED: 'REJECTED', SUPERSEDED: 'CANCELLED', PLANNED: 'DRAFT', RUNNING: 'SUBMITTED', COMPLETED: 'APPROVED', FAILED: 'REJECTED', ROLLED_BACK: 'AT_RISK', PENDING: 'DRAFT', DONE: 'APPROVED', SKIPPED: 'CANCELLED', APPROVED: 'APPROVED', RETURNED: 'AT_RISK', ACTIVE: 'SUBMITTED', HANDOVER_REQUESTED: 'SUBMITTED', HANDED_OVER: 'APPROVED', DRAFT: 'DRAFT', PUBLISHED: 'APPROVED' };
const TABS = ['readiness', 'uat', 'cutover', 'decision', 'hypercare'];

export function GoLive() {
  const t = useT('tst');
  const { number } = useFormat();
  const search = useSearch();
  const cache = useQueryClient();
  usePageTitle(t('gl.title'));
  const tab = TABS.includes(search.get('tab')) ? search.get('tab') : 'readiness';
  const params = { module: search.get('module') ?? '', status: search.get('status') ?? '', mine: search.get('mine') ?? '', page: search.get('page') ?? '' };
  const q = useQuery({ queryKey: ['tst', 'golive', params], queryFn: () => read(`/tst/golive${qs(params)}`), retry: false, placeholderData: (p) => p });
  const refresh = () => cache.invalidateQueries({ queryKey: ['tst', 'golive'] });
  const evaluate = useMutation({ mutationFn: () => post('/tst/golive/evaluate'), onSuccess: refresh });
  const exp = useMutation({ mutationFn: ([kind, f]) => download('/tst/golive/export', { kind, format: f }, `go-live-${kind}.${f}`) });
  const n = (v) => (v == null ? '—' : number(String(v), { decimals: 0 }));
  if (q.error?.status === 403) return <NoPermission what={t('gl.title')} permission="golive.view" />;
  if (q.isPending) return <section><PageHeader title={t('gl.title')} /><Skeleton label={t('gl.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('gl.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data; const C = d.checklist;
  const met = C.items.filter((i) => i.status === 'MET').length; const mandatory = C.items.filter((i) => i.mandatory).length;
  const kind = { readiness: 'checklist', uat: 'uat', hypercare: 'hypercare' }[tab] ?? 'checklist';
  const menu = d.can.export ? ['xlsx', 'csv', 'pdf'].map((f) => ({ label: t('exportAs', { f: f.toUpperCase() }), testid: `gl-export-${f}`, onClick: () => exp.mutate([kind, f]) })) : [];
  const actions = <button type="button" className="btn btn-primary" onClick={() => evaluate.mutate()} disabled={evaluate.isPending} data-testid="gl-evaluate">{evaluate.isPending ? t('running') : t('gl.evaluate')}</button>;
  const signed = d.uat.modules.filter((m) => m.signoff?.status === 'SIGNED').length;
  return <section aria-labelledby="gl-h" data-testid="tst-golive" data-tab={tab} data-ready={C.ready ? 'yes' : 'no'}>
    <PageHeader id="gl-h" title={t('gl.title')} subtitle={t('gl.subtitle')} actions={actions} menu={menu}
      status={<StatusBadge status={C.ready ? 'APPROVED' : 'REJECTED'} label={C.ready ? t('gl.ready') : t('gl.notReady', { n: n(C.mandatoryOpen.length) })} variant="solid" />} />
    {(evaluate.error || exp.error) && <ErrorState error={evaluate.error ?? exp.error} />}
    <KpiRow testid="gl-tiles" label={t('gl.title')}>
      <KpiTile testid="gl-k-criteria" label={t('gl.kCriteria')} kind="quality" value={`${n(met)} / ${n(C.items.length)}`} tone={C.ready ? 'success' : 'error'} to={`${BASE}?tab=readiness`}>{t('gl.kMandatory', { open: n(C.mandatoryOpen.length), all: n(mandatory) })}</KpiTile>
      <KpiTile testid="gl-k-uat" label={t('gl.kUat')} kind="quality" value={`${n(signed)} / ${n(d.uat.modules.length)}`} tone={d.uat.modules.length && signed === d.uat.modules.length ? 'success' : 'warning'} to={`${BASE}?tab=uat`}>{t('gl.kDefects', { s1: n(d.uat.openBySeverity.S1), s2: n(d.uat.openBySeverity.S2) })}</KpiTile>
      <KpiTile testid="gl-k-cutover" label={t('gl.kCutover')} kind="count" value={d.cutover.current ? t(`gl.st.${d.cutover.current.status}`) : '—'} tone={d.cutover.current?.withinWindow ? 'success' : 'warning'} to={`${BASE}?tab=cutover`}>{d.cutover.current ? `${d.cutover.current.runNo} · ${d.cutover.current.elapsedMinutes ?? '—'} / ${d.cutover.current.windowMinutes} min` : t('gl.noRun')}</KpiTile>
      <KpiTile testid="gl-k-hypercare" label={t('gl.kHypercare')} kind="count" value={d.hypercare ? t(`gl.st.${d.hypercare.status}`) : '—'} to={`${BASE}?tab=hypercare`}>{d.hypercare ? `${d.hypercare.startDate} → ${d.hypercare.endDate}` : t('gl.noHypercare')}</KpiTile>
    </KpiRow>
    <PillTabs label={t('gl.title')} tabs={TABS.map((k) => [k, t(`gl.tab.${k}`)])} value={tab} onChange={(k) => go(BASE, { tab: k === 'readiness' ? '' : k })} testid="gl-tabs" />
    {tab === 'readiness' && <Board t={t} d={d} refresh={refresh} />}
    {tab === 'uat' && <Uat t={t} d={d} params={params} n={n} refresh={refresh} />}
    {tab === 'cutover' && <Cutover t={t} d={d} refresh={refresh} />}
    {tab === 'decision' && <Decision t={t} d={d} refresh={refresh} />}
    {tab === 'hypercare' && <Hypercare t={t} d={d} n={n} refresh={refresh} />}
  </section>;
}

function Board({ t, d, refresh }) {
  const narrow = useNarrow();
  const [col, setCol] = useState('NOT_MET');
  const [edit, setEdit] = useState(null); const [v, setV] = useState({ evidence: '', note: '' });
  const set = useMutation({ mutationFn: ([id, body]) => post(`/tst/golive/checklist/${id}`, body), onSuccess: () => { setEdit(null); setV({ evidence: '', note: '' }); refresh(); } });
  const items = d.checklist.items;
  const shown = narrow ? [col] : COLUMNS;
  return <>
    {narrow && <PillTabs label={t('gl.columns')} tabs={COLUMNS.map((c) => [c, `${t(`gl.st.${c}`)} (${items.filter((i) => i.status === c).length})`])} value={col} onChange={setCol} testid="gl-columns" />}
    {set.error && <ErrorState error={set.error} />}
    <div className="board" data-testid="gl-board" style={{ display: 'grid', gap: 'var(--erp-space-3, 12px)', gridTemplateColumns: narrow ? '1fr' : 'repeat(4, minmax(0, 1fr))' }}>
      {shown.map((c) => <div key={c} data-testid="gl-column" data-status={c} role="list" aria-label={t(`gl.st.${c}`)}>
        <h2 className="small">{t(`gl.st.${c}`)} · {items.filter((i) => i.status === c).length}</h2>
        {items.filter((i) => i.status === c).map((i) => <Card key={i.id} title={i.title} level={3} testid="gl-item" role="listitem">
          <div data-criterion={i.criterion} data-testid={`gl-item-${i.criterion}`}>
            <StatusBadge status={TONE[i.status]} label={t(`gl.st.${i.status}`)} size="sm" /> <span className="small muted">{t(`gl.cat.${i.category}`)} · {i.mandatory ? t('gl.mandatory') : t('gl.optional')} · {i.ownerRole}{i.evaluation === 'AUTO' ? ` · ${t('gl.auto')}` : ''}</span>
            {i.detail && <p className="small">{i.detail}</p>}
            {i.evidence.length > 0 && <ul className="small">{i.evidence.map((e) => <li key={e}>{e}</li>)}</ul>}
            {i.waiverReason && <p className="small">{t('gl.waived', { why: i.waiverReason })}</p>}
            {i.evaluation === 'MANUAL' && <details data-testid={`gl-move-${i.criterion}`} open={edit === i.id} onToggle={(e) => setEdit(e.currentTarget.open ? i.id : null)}>
              <summary className="btn btn-small">{t('gl.move')}</summary>
              <form className="form-grid" onSubmit={(e) => e.preventDefault()}>
                <Field name={`ev-${i.id}`} label={t('gl.evidence')}><input value={v.evidence} onChange={(e) => setV({ ...v, evidence: e.target.value })} data-testid={`gl-ev-${i.criterion}`} /></Field>
                <Field name={`nt-${i.id}`} label={t('gl.note')}><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} data-testid={`gl-note-${i.criterion}`} /></Field>
                <div className="actions-row">
                  {['MET', 'NOT_MET', ...(i.mandatory ? [] : ['WAIVED'])].filter((s) => s !== i.status).map((s) => <button key={s} type="button" className={`btn btn-small${s === 'MET' ? ' btn-primary' : ''}`} disabled={set.isPending} data-testid={`gl-to-${s}-${i.criterion}`}
                    onClick={() => set.mutate([i.id, { status: s, evidence: v.evidence.trim() ? [v.evidence.trim()] : [], ...(v.note.trim() ? { note: v.note.trim() } : {}), version: i.version }])}>{t('gl.moveTo', { s: t(`gl.st.${s}`) })}</button>)}
                </div>
              </form>
            </details>}
          </div>
        </Card>)}
        {!items.some((i) => i.status === c) && <p className="muted small">{t('gl.emptyColumn')}</p>}
      </div>)}
    </div>
  </>;
}

function Uat({ t, d, params, n, refresh }) {
  const U = d.uat;
  const [run, setRun] = useState(null); const [def, setDef] = useState({ title: '', severity: 'S3' });
  const gen = useMutation({ mutationFn: () => post('/tst/golive/uat/scripts/generate'), onSuccess: refresh });
  const exec = useMutation({ mutationFn: ([id, result]) => post(`/tst/golive/uat/scripts/${id}/run`, { result, ...(result === 'FAIL' ? { defect: { title: def.title, severity: def.severity } } : {}) }), onSuccess: () => { setRun(null); setDef({ title: '', severity: 'S3' }); refresh(); } });
  const sign = useMutation({ mutationFn: (module) => post('/tst/golive/uat/signoffs', { module, reason: t('gl.signReason') }), onSuccess: refresh });
  const act = useMutation({ mutationFn: (rid) => post(`/tst/golive/requests/${rid}/act`, { action: 'approve' }), onSuccess: refresh });
  const tri = useMutation({ mutationFn: ([id, body]) => post(`/tst/golive/uat/defects/${id}/triage`, body), onSuccess: refresh });
  const chart = { categories: U.modules.map((m) => m.name), series: [
    { name: t('gl.st.PASS'), colour: COLOUR.PASS, values: U.modules.map((m) => m.passed), drill: U.modules.map((m) => `${BASE}?tab=uat&module=${m.module}&status=PASS`) },
    { name: t('gl.st.FAIL'), colour: COLOUR.FAIL, values: U.modules.map((m) => m.failed + m.blocked), drill: U.modules.map((m) => `${BASE}?tab=uat&module=${m.module}&status=FAIL`) },
    { name: t('gl.st.NOT_RUN'), colour: COLOUR.OTHER, values: U.modules.map((m) => m.notRun), drill: U.modules.map((m) => `${BASE}?tab=uat&module=${m.module}&status=NOT_RUN`) },
  ] };
  const set = (patch) => go(BASE, { tab: 'uat', ...params, ...patch });
  const err = gen.error ?? exec.error ?? sign.error ?? act.error ?? tri.error;
  return <>
    {err && <ErrorState error={err} />}
    {!U.modules.length ? <EmptyState title={t('gl.noScripts')} message={t('gl.noScriptsBody')} action={d.can.manage ? <button type="button" className="btn btn-primary" onClick={() => gen.mutate()} data-testid="gl-generate">{t('gl.generate')}</button> : null} /> : <>
      <Card title={t('gl.uatByModule')} subtitle={t('gl.uatNote')} testid="gl-uat-chart"><Chart type="stacked" data={chart} title={t('gl.uatByModule')} onDrill={(to) => navigateTo(to)} exportName="uat-status" /></Card>
      <Card title={t('gl.modules')} testid="gl-modules">
        <div className="table-scroll"><table className="data-table" data-testid="gl-module-table">
          <thead><tr><th>{t('gl.module')}</th><th className="num">{t('gl.passed')}</th><th className="num">{t('gl.openDefects')}</th><th>{t('gl.owner')}</th><th>{t('gl.signoff')}</th></tr></thead>
          <tbody>{U.modules.map((m) => { const rid = d.signoffsAwaitingMe[String(m.signoff?.id)]; return <tr key={m.module} data-testid="gl-module" data-module={m.module} data-signoff={m.signoff?.status ?? 'NONE'}>
            <td data-label={t('gl.module')}>{m.name}</td><td data-label={t('gl.passed')} className="num">{n(m.passed)} / {n(m.total)}</td>
            <td data-label={t('gl.openDefects')} className="num">{n(m.openDefects)}{m.blocking ? <span className="small"> · {t('gl.blocking', { n: n(m.blocking) })}</span> : null}</td><td data-label={t('gl.owner')}>{m.owner}</td>
            <td data-label={t('gl.signoff')}>{m.signoff ? <StatusBadge status={TONE[m.signoff.status]} label={t(`gl.st.${m.signoff.status}`)} size="sm" /> : <span className="muted small">{t('gl.notRequested')}</span>}
              {rid && <> <button type="button" className="btn btn-small btn-primary" onClick={() => act.mutate(rid)} data-testid={`gl-sign-${m.module}`}>{t('gl.sign')}</button></>}
              {d.can.manage && !m.signoff?.status?.match(/SUBMITTED|SIGNED/) && m.passed === m.total && !m.blocking && <> <button type="button" className="btn btn-small" onClick={() => sign.mutate(m.module)} data-testid={`gl-request-${m.module}`}>{t('gl.requestSign')}</button></>}</td>
          </tr>; })}</tbody>
          <tfoot className="sticky-total"><tr><th scope="row">{t('gl.modulesTotal', { n: n(U.modules.length) })}</th><td className="num">{n(U.modules.reduce((a, m) => a + m.passed, 0))} / {n(U.modules.reduce((a, m) => a + m.total, 0))}</td><td className="num">{n(U.modules.reduce((a, m) => a + m.openDefects, 0))}</td><td colSpan={2} /></tr></tfoot>
        </table></div>
      </Card>
      <Card title={t('gl.scripts')} testid="gl-scripts">
        <ParamPanel label={t('params')} done={t('done')} count={[params.module, params.status, params.mine].filter(Boolean).length} testid="gl-params">
          <Field name="gl-mod" label={t('gl.module')}><select value={params.module} onChange={(e) => set({ module: e.target.value })} data-testid="gl-f-module"><option value="">{t('all')}</option>{U.modules.map((m) => <option key={m.module} value={m.module}>{m.name}</option>)}</select></Field>
          <Field name="gl-st" label={t('status')}><select value={params.status} onChange={(e) => set({ status: e.target.value })} data-testid="gl-f-status"><option value="">{t('all')}</option>{['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED'].map((s) => <option key={s} value={s}>{t(`gl.st.${s}`)}</option>)}</select></Field>
          <Field name="gl-mine" label={t('gl.mine')}><select value={params.mine} onChange={(e) => set({ mine: e.target.value })} data-testid="gl-f-mine"><option value="">{t('all')}</option><option value="1">{t('gl.myRoles')}</option></select></Field>
        </ParamPanel>
        {!U.scripts.rows.length ? <EmptyState compact title={t('gl.noMatch')} message={t('gl.noMatchBody')} /> : <ul className="lp-list" data-testid="gl-script-list">{U.scripts.rows.map((s) => <li key={s.id} data-testid="gl-script" data-status={s.status}>
          <StatusBadge status={TONE[s.status]} label={t(`gl.st.${s.status}`)} size="sm" /> <strong>{s.title}</strong> <span className="muted small">{s.role} · {s.code}</span>
          <details><summary className="small">{t('gl.steps')}</summary><ol className="small">{s.steps.map((x) => <li key={x}>{x}</li>)}</ol><p className="small">{t('gl.expected', { e: s.expected })}</p></details>
          {d.can.execute && <div className="actions-row">
            <button type="button" className="btn btn-small btn-primary" onClick={() => exec.mutate([s.id, 'PASS'])} data-testid={`gl-pass-${s.id}`}>{t('gl.st.PASS')}</button>
            <button type="button" className="btn btn-small" onClick={() => setRun(run === s.id ? null : s.id)} data-testid={`gl-fail-${s.id}`}>{t('gl.st.FAIL')}</button>
            <button type="button" className="btn btn-small" onClick={() => exec.mutate([s.id, 'BLOCKED'])}>{t('gl.st.BLOCKED')}</button>
          </div>}
          {run === s.id && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); exec.mutate([s.id, 'FAIL']); }} data-testid="gl-defect-form">
            <Field name={`df-${s.id}`} label={t('gl.defectTitle')}><input value={def.title} onChange={(e) => setDef({ ...def, title: e.target.value })} minLength={5} required data-testid="gl-defect-title" /></Field>
            <Field name={`ds-${s.id}`} label={t('gl.severity')}><select value={def.severity} onChange={(e) => setDef({ ...def, severity: e.target.value })} data-testid="gl-defect-sev">{['S1', 'S2', 'S3', 'S4'].map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
            <div className="actions-row"><button type="submit" className="btn btn-primary" data-testid="gl-defect-save">{t('gl.raise')}</button></div>
          </form>}
        </li>)}</ul>}
        <Pager page={U.scripts.page} pageSize={U.scripts.pageSize} total={U.scripts.total} onPage={(p) => set({ page: p })} t={t} testid="gl-pager" />
      </Card>
      <Card title={t('gl.defects')} subtitle={t('gl.defectsNote')} testid="gl-defects">
        {!U.defects.length ? <EmptyState compact title={t('gl.noDefects')} message={t('gl.noDefectsBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="gl-defect-table">
          <thead><tr><th>{t('gl.defect')}</th><th>{t('gl.severity')}</th><th>{t('status')}</th><th>{t('gl.triage')}</th></tr></thead>
          <tbody>{U.defects.map((x) => <tr key={x.id} data-testid="gl-defect" data-status={x.status} data-severity={x.severity}>
            <td data-label={t('gl.defect')}>{x.defectNo} · {x.title}<br /><span className="muted small">{x.module} · {x.reportedBy}{x.ownerId ? ` → ${x.ownerId}` : ''}{x.fixedIn ? ` · ${x.fixedIn}` : ''}</span></td>
            <td data-label={t('gl.severity')}>{x.severity}</td><td data-label={t('status')}><StatusBadge status={TONE[x.status]} label={t(`gl.st.${x.status}`)} size="sm" /></td>
            <td data-label={t('gl.triage')}>{d.can.triage && ['OPEN'].includes(x.status) && <button type="button" className="btn btn-small" onClick={() => tri.mutate([x.id, { action: 'triage' }])} data-testid={`gl-triage-${x.id}`}>{t('gl.doTriage')}</button>}</td>
          </tr>)}</tbody>
        </table></div>}
      </Card>
    </>}
  </>;
}

function Cutover({ t, d, refresh }) {
  const { dateTime } = useFormat();
  const R = d.cutover.current; const [detail, setDetail] = useState('');
  const plan = useMutation({ mutationFn: (kind) => post('/tst/golive/cutover/runs', { kind }), onSuccess: refresh });
  const start = useMutation({ mutationFn: (id) => post(`/tst/golive/cutover/runs/${id}/start`), onSuccess: refresh });
  const done = useMutation({ mutationFn: ([id, result]) => post(`/tst/golive/cutover/steps/${id}/complete`, { result, detail }), onSuccess: () => { setDetail(''); refresh(); } });
  const err = plan.error ?? start.error ?? done.error;
  return <>
    {err && <ErrorState error={err} />}
    {d.can.manage && (!R || !['PLANNED', 'RUNNING'].includes(R.status)) && <div className="actions-row"><button type="button" className="btn btn-primary" onClick={() => plan.mutate('DRY_RUN')} data-testid="gl-plan-dry">{t('gl.planDry')}</button><button type="button" className="btn" onClick={() => plan.mutate('PRODUCTION')} data-testid="gl-plan-prod">{t('gl.planProd')}</button></div>}
    {!R ? <EmptyState title={t('gl.noRun')} message={t('gl.noRunBody')} /> : <Card title={`${R.runNo} · ${t(`gl.kind.${R.kind}`)}`} subtitle={t('gl.window', { m: R.windowMinutes, e: R.elapsedMinutes ?? '—' })} testid="gl-run" menu={<StatusBadge status={TONE[R.status]} label={t(`gl.st.${R.status}`)} />}>
      {R.status === 'PLANNED' && d.can.manage && <button type="button" className="btn btn-primary" onClick={() => start.mutate(R.id)} data-testid="gl-start">{t('gl.start')}</button>}
      {R.rollbackPoint && <p className="small">{t('gl.rollbackPoint', { p: R.rollbackPoint })}</p>}
      <ol className="lp-list" data-testid="gl-steps">{R.steps.map((s) => <li key={s.id} data-testid="gl-step" data-code={s.code} data-status={s.status}>
        <StatusBadge status={TONE[s.status]} label={t(`gl.st.${s.status}`)} size="sm" /> <strong>{s.seq}. {s.title}</strong> <span className="muted small">{s.ownerRole} · {s.plannedMinutes} min · {s.mode === 'AUTO' ? t('gl.auto') : t('gl.manual')}</span>
        {s.detail && <><br /><span className="small">{s.detail}{s.finishedAt ? ` · ${dateTime(s.finishedAt)}` : ''}</span></>}
        {s.status === 'RUNNING' && s.mode === 'MANUAL' && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); done.mutate([s.id, 'DONE']); }}>
          <Field name={`st-${s.id}`} label={t('gl.stepNote')}><input value={detail} onChange={(e) => setDetail(e.target.value)} minLength={5} required data-testid={`gl-step-note-${s.code}`} /></Field>
          <div className="actions-row"><button type="submit" className="btn btn-primary" data-testid={`gl-done-${s.code}`}>{t('gl.stepDone')}</button><button type="button" className="btn" disabled={detail.trim().length < 5} onClick={() => done.mutate([s.id, 'FAILED'])}>{t('gl.stepFailed')}</button></div>
        </form>}
      </li>)}</ol>
    </Card>}
    {d.cutover.runs.length > 1 && <Card title={t('gl.runs')} testid="gl-runs"><ul className="lp-list">{d.cutover.runs.map((r) => <li key={r.id}>{r.runNo} · {t(`gl.kind.${r.kind}`)} · <StatusBadge status={TONE[r.status]} label={t(`gl.st.${r.status}`)} size="sm" />{r.elapsedMinutes != null ? ` · ${r.elapsedMinutes} / ${r.windowMinutes} min` : ''}</li>)}</ul></Card>}
  </>;
}

function Decision({ t, d, refresh }) {
  const { dateTime } = useFormat();
  const D = d.decision;
  const [v, setV] = useState({ attendees: '', recommendation: 'NO_GO', goLiveAt: '', minutes: '' });
  const submit = useMutation({ mutationFn: () => post('/tst/golive/decisions', { meetingAt: new Date().toISOString(), attendees: v.attendees.split(',').map((s) => s.trim()).filter(Boolean), recommendation: v.recommendation, ...(v.goLiveAt ? { goLiveAt: new Date(v.goLiveAt).toISOString() } : {}), minutes: v.minutes }), onSuccess: refresh });
  const act = useMutation({ mutationFn: (action) => post(`/tst/golive/requests/${D.awaitingMe}/act`, { action, ...(action !== 'approve' ? { comment: t('gl.returnComment') } : {}) }), onSuccess: refresh });
  return <CardGrid>
    {D && <Card title={`${D.decisionNo} · ${t(`gl.rec.${D.recommendation}`)}`} subtitle={t('gl.chain', { chain: D.chain.join(' → ') })} testid="gl-decision" menu={<StatusBadge status={TONE[D.status]} label={t(`gl.st.${D.status}`)} />}>
      <p className="small">{dateTime(D.meetingAt)} · {D.attendees.join(', ')}</p><p>{D.minutes}</p>
      {D.goLiveAt && <p className="small">{t('gl.goLiveAt', { at: dateTime(D.goLiveAt) })}</p>}
      {act.error && <ErrorState error={act.error} />}
      {D.awaitingMe && <div className="actions-row"><button type="button" className="btn btn-primary" onClick={() => act.mutate('approve')} data-testid="gl-approve">{t('approve')}</button><button type="button" className="btn" onClick={() => act.mutate('return')}>{t('gl.return')}</button></div>}
    </Card>}
    {d.can.manage && D?.status !== 'SUBMITTED' && <Card title={t('gl.meeting')} subtitle={t('gl.meetingNote')} testid="gl-meeting">
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
        <Field name="gl-att" label={t('gl.attendees')}><input value={v.attendees} onChange={(e) => setV({ ...v, attendees: e.target.value })} required data-testid="gl-attendees" /></Field>
        <Field name="gl-rec" label={t('gl.recommendation')}><select value={v.recommendation} onChange={(e) => setV({ ...v, recommendation: e.target.value })} data-testid="gl-recommendation"><option value="NO_GO">{t('gl.rec.NO_GO')}</option><option value="GO" disabled={!d.checklist.ready}>{t('gl.rec.GO')}</option></select></Field>
        {v.recommendation === 'GO' && <Field name="gl-date" label={t('gl.goLiveDate')}><input type="datetime-local" value={v.goLiveAt} onChange={(e) => setV({ ...v, goLiveAt: e.target.value })} required /></Field>}
        <Field name="gl-min" label={t('gl.minutes')}><textarea value={v.minutes} onChange={(e) => setV({ ...v, minutes: e.target.value })} minLength={20} required rows={4} data-testid="gl-minutes" /></Field>
        {submit.error && <ErrorState error={submit.error} />}
        <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={submit.isPending} data-testid="gl-submit-decision">{t('gl.submitDecision')}</button></div>
      </form>
    </Card>}
    {!D && !d.can.manage && <EmptyState title={t('gl.noDecision')} message={t('gl.noDecisionBody')} />}
  </CardGrid>;
}

function Hypercare({ t, d, n, refresh }) {
  const H = d.hypercare; const [notes, setNotes] = useState('');
  const publish = useMutation({ mutationFn: (date) => post(`/tst/golive/hypercare/days/${date}/publish`, { triageNotes: notes }), onSuccess: () => { setNotes(''); refresh(); } });
  if (!H) return <EmptyState title={t('gl.noHypercare')} message={t('gl.noHypercareBody')} />;
  const today = H.days[0];
  return <>
    <Card title={t('gl.hypercareOf', { from: H.startDate, to: H.endDate })} subtitle={t('gl.warRoom', { list: H.warRoom.join(', ') })} testid="gl-hypercare" menu={<StatusBadge status={TONE[H.status]} label={t(`gl.st.${H.status}`)} />}>
      {publish.error && <ErrorState error={publish.error} />}
      {today && today.status === 'DRAFT' && d.can.triage && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); publish.mutate(today.date); }}>
        <Field name="hc-notes" label={t('gl.triageNotes', { date: today.date })}><textarea value={notes} onChange={(e) => setNotes(e.target.value)} minLength={10} required rows={3} data-testid="gl-triage-notes" /></Field>
        <div className="actions-row"><button type="submit" className="btn btn-primary" data-testid="gl-publish">{t('gl.publish')}</button></div>
      </form>}
    </Card>
    <Card title={t('gl.daily')} testid="gl-days">
      {!H.days.length ? <EmptyState compact title={t('gl.noDays')} message={t('gl.noDaysBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="gl-day-table">
        <thead><tr><th>{t('gl.date')}</th><th className="num">{t('gl.opened')}</th><th className="num">{t('gl.closed')}</th><th className="num">S1 / S2</th><th className="num">{t('gl.alerts')}</th><th className="num">{t('gl.tickets')}</th><th>{t('status')}</th></tr></thead>
        <tbody>{H.days.map((x) => <tr key={x.id} data-testid="gl-day" data-status={x.status}>
          <td data-label={t('gl.date')}>{x.date}{x.triageNotes ? <><br /><span className="small">{x.triageNotes}</span></> : null}</td><td data-label={t('gl.opened')} className="num">{n(x.opened)}</td><td data-label={t('gl.closed')} className="num">{n(x.closed)}</td>
          <td data-label="S1 / S2" className="num">{n(x.openBy.S1)} / {n(x.openBy.S2)}</td><td data-label={t('gl.alerts')} className="num">{n(x.kpis.alerts)}</td><td data-label={t('gl.tickets')} className="num">{n(x.kpis.ticketsOpened)}</td>
          <td data-label={t('status')}><StatusBadge status={TONE[x.status]} label={t(`gl.st.${x.status}`)} size="sm" /></td>
        </tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row">{t('gl.daysTotal', { n: n(H.days.length) })}</th><td className="num">{n(H.days.reduce((a, x) => a + x.opened, 0))}</td><td className="num">{n(H.days.reduce((a, x) => a + x.closed, 0))}</td><td colSpan={4} /></tr></tfoot>
      </table></div>}
    </Card>
  </>;
}
