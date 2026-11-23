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
import { COLOUR, Pager, ParamPanel, TONE, download, go, post, qs, read } from './common.jsx';

// Part 30.07: Accessibility & Device Validation Results (analytical report). The verdict (BR-01: no serious or critical finding on a business
// page) and the sign-off head the page; the chart of pages with findings by width comes first, then the key figures, the device matrix with each
// device's last journeys, the rules found most, screen-reader sessions, and the issues as a list (cards on a phone, parameters in a bottom
// sheet, a sticky total). An issue opens its panel: violations, the history of its page, fixed with a commit; the next passing run re-tests it.
const BASE = '/admin/accessibility-validation';
const ISSUE_TONE = { OPEN: 'REJECTED', FIXED: 'SUBMITTED', RETESTED: 'APPROVED', NONE: 'DRAFT' };

export function A11yValidation() {
  const t = useT('tst');
  const { number, dateTime } = useFormat();
  const search = useSearch();
  const cache = useQueryClient();
  usePageTitle(t('ax.title'));
  const params = { kind: search.get('kind') ?? '', width: search.get('width') ?? '', issue: search.get('issue') ?? '', q: search.get('q') ?? '', page: search.get('page') ?? '' };
  const open = search.get('result');
  const q = useQuery({ queryKey: ['tst', 'a11y', params], queryFn: () => read(`/tst/a11y${qs(params)}`), retry: false, placeholderData: (p) => p });
  const [text, setText] = useState(params.q);
  const [form, setForm] = useState(false);
  const refresh = () => cache.invalidateQueries({ queryKey: ['tst', 'a11y'] });
  const sign = useMutation({ mutationFn: () => post('/tst/a11y/signoff', { reason: t('ax.signReason') }), onSuccess: refresh });
  const decide = useMutation({ mutationFn: ([id, action]) => post(`/tst/a11y/signoff/${id}/act`, { action }), onSuccess: refresh });
  const exp = useMutation({ mutationFn: (f) => download('/tst/a11y/export', { kind: params.kind, width: params.width, issue: params.issue, format: f }, `accessibility-validation.${f}`) });
  const n = (v) => (v == null ? '—' : number(String(v), { decimals: 0 }));
  const set = (patch) => go(BASE, { ...patch, page: patch.page ?? '' });

  if (q.error?.status === 403) return <NoPermission what={t('ax.noPermission')} permission="tst.a11y.view" />;
  if (q.isPending) return <section><PageHeader title={t('ax.title')} /><Skeleton label={t('ax.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('ax.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data; const V = d.verdict;
  const verdict = !V.swept ? 'NOT_TESTED' : V.blocked ? 'FAIL' : 'PASS';
  const actions = <>{d.can.record && <button type="button" className="btn" onClick={() => setForm(true)} data-testid="ax-record">{t('ax.record')}</button>}{d.can.signoff && !V.blocked && V.swept && d.signoff?.status !== 'SUBMITTED' && <button type="button" className="btn btn-primary" onClick={() => sign.mutate()} disabled={sign.isPending} data-testid="ax-signoff">{t('ax.askSignoff')}</button>}</>;
  const menu = d.can.export ? ['xlsx', 'csv', 'pdf'].map((f) => ({ label: t('exportAs', { f: f.toUpperCase() }), testid: `ax-export-${f}`, onClick: () => exp.mutate(f) })) : [];
  const chart = { categories: d.byWidth.map((w) => `${w.width} px`), series: [
    { name: t('ax.seriousPages'), colour: COLOUR.FAIL, values: d.byWidth.map((w) => w.serious), drill: d.byWidth.map((w) => `${BASE}?kind=AXE&width=${w.width}`) },
    { name: t('ax.minorPages'), colour: 'var(--erp-color-status-warning-solid)', values: d.byWidth.map((w) => w.moderate), drill: d.byWidth.map((w) => `${BASE}?kind=AXE&width=${w.width}&issue=ALL`) },
    { name: t('ax.overflowPages'), colour: COLOUR.OTHER, values: d.byWidth.map((w) => w.overflow), drill: d.byWidth.map((w) => `${BASE}?width=${w.width}`) },
  ] };
  const devOk = d.devices.filter((x) => x.last?.result === 'PASS').length;
  const swept = Math.max(0, ...d.byWidth.map((w) => w.swept));
  return <section aria-labelledby="ax-h" data-testid="tst-a11y" data-verdict={verdict}>
    <PageHeader id="ax-h" title={t('ax.title')} subtitle={t('ax.subtitle')} actions={actions} menu={menu}
      status={<StatusBadge status={TONE[verdict]} label={t(`ax.verdict.${verdict}`, { n: n(V.blockerCount) })} variant="solid" />} />
    {(sign.error || decide.error || exp.error) && <ErrorState error={sign.error ?? decide.error ?? exp.error} />}
    {d.signoff && <p role="status" className="small" data-testid="ax-signoff-state" data-status={d.signoff.status}>{t(`ax.signoff.${d.signoff.status}`, { who: d.signoff.requestedBy, at: dateTime(d.signoff.at) })}
      {d.signoff.awaitingMe && <> <button type="button" className="btn btn-small btn-primary" onClick={() => decide.mutate([d.signoff.id, 'approve'])} data-testid="ax-approve">{t('approve')}</button> <button type="button" className="btn btn-small" onClick={() => decide.mutate([d.signoff.id, 'reject'])} data-testid="ax-reject">{t('sx.reject')}</button></>}</p>}
    {form && <ManualForm t={t} devices={d.devices} onClose={() => setForm(false)} onDone={() => { setForm(false); refresh(); }} />}
    {!V.swept ? <EmptyState title={t('ax.none')} message={t('ax.noneBody')} /> : <Card title={t('ax.byWidth')} testid="ax-chart"><Chart type="stacked" data={chart} title={t('ax.byWidth')} onDrill={(to) => navigateTo(to)} exportName="accessibility-by-width" /></Card>}
    <KpiRow testid="ax-tiles" label={t('ax.title')}>
      <KpiTile testid="ax-blockers" label={t('ax.blockers')} kind="risk" value={n(V.blockerCount)} tone={V.blockerCount ? 'error' : 'success'} to={`${BASE}?kind=AXE&issue=OPEN`}>{t('ax.blockersNote')}</KpiTile>
      <KpiTile testid="ax-swept" label={t('ax.swept')} kind="count" value={n(swept)} to={`${BASE}#sweeps`}>{t('ax.sweptOf', { widths: n(d.byWidth.filter((w) => w.swept).length) })}</KpiTile>
      <KpiTile testid="ax-devices" label={t('ax.devices')} kind="quality" value={`${n(devOk)} / ${n(d.devices.length)}`} tone={devOk === d.devices.filter((x) => x.automation === 'EMULATED').length ? 'success' : 'warning'} to={`${BASE}#devices`}>{t('ax.devicesNote')}</KpiTile>
      <KpiTile testid="ax-issues" label={t('ax.issues')} kind="count" value={n(d.issues.open)} tone={d.issues.open ? 'warning' : 'success'} to={`${BASE}?issue=OPEN`}>{t('ax.issuesOf', { fixed: n(d.issues.fixed), retested: n(d.issues.retested) })}</KpiTile>
    </KpiRow>
    <CardGrid>
      <Card title={t('ax.sweeps')} testid="ax-sweeps"><span id="sweeps" />
        <ul className="lp-list">{d.sweeps.map((s) => <li key={s.width} data-testid="ax-sweep" data-width={s.width}><strong>{s.width} px</strong> · {s.axe ? t('ax.sweepFacts', { run: s.axe.runNo, items: n(s.axe.items), serious: n(s.axe.serious) }) : t('ax.noAxe')}{s.responsive ? ` · ${t('ax.respFacts', { run: s.responsive.runNo, failed: n(s.responsive.failed) })}` : ''}</li>)}</ul>
      </Card>
      <Card title={t('ax.rules')} testid="ax-rules">
        {!d.rules.length ? <EmptyState compact title={t('ax.noRules')} message={t('ax.noRulesBody')} /> : <ul className="lp-list small">{d.rules.map((r) => <li key={r.rule}><StatusBadge status={r.impact === 'serious' || r.impact === 'critical' ? 'REJECTED' : 'AT_RISK'} label={r.impact} size="sm" /> <code>{r.rule}</code> {r.help} · {t('ax.rulePages', { n: n(r.pages) })}</li>)}</ul>}
      </Card>
    </CardGrid>
    <Card title={t('ax.matrix')} subtitle={t('ax.matrixNote')} testid="ax-devices-card"><span id="devices" />
      <div className="table-scroll"><table className="data-table" data-testid="ax-device-table">
        <thead><tr><th>{t('ax.device')}</th><th>{t('ax.browser')}</th><th>{t('ax.size')}</th><th>{t('ax.network')}</th><th>{t('ax.how')}</th><th>{t('ax.lastRun')}</th></tr></thead>
        <tbody>{d.devices.map((x) => <tr key={x.code} data-testid="ax-device" data-code={x.code} data-result={x.last?.result ?? 'NONE'}>
          <td data-label={t('ax.device')}><strong>{x.label}</strong><br /><span className="muted small">{x.os}{x.ramGb ? ` · ${x.ramGb} GB` : ''}{x.cpuSlowdown > 1 ? ` · CPU ÷${x.cpuSlowdown}` : ''}</span></td>
          <td data-label={t('ax.browser')}>{x.browser}</td><td data-label={t('ax.size')}>{x.width} × {x.height}</td><td data-label={t('ax.network')}>{t(`ax.net.${x.network}`)}</td>
          <td data-label={t('ax.how')}>{t(`ax.auto.${x.automation}`)}</td>
          <td data-label={t('ax.lastRun')}>{x.last ? <><StatusBadge status={TONE[x.last.result]} label={t(`st.${x.last.result}`)} size="sm" /> <span className="small">{x.last.runNo} · {t('ax.journeysOf', { n: n(x.last.items), failed: n(x.last.failed) })}</span></> : <span className="muted small">{t('ax.notRun')}</span>}</td>
        </tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row" colSpan={5}>{t('ax.devicesTotal', { n: n(d.devices.length), ok: n(devOk) })}</th><td /></tr></tfoot>
      </table></div>
    </Card>
    <Card title={t('ax.sr')} subtitle={t('ax.srNote')} testid="ax-sr">
      {!d.screenReader.length ? <EmptyState compact title={t('ax.noSr')} message={t('ax.noSrBody')} /> : <ul className="lp-list">{d.screenReader.map((s) => <li key={s.id} data-testid="ax-sr-row"><StatusBadge status={TONE[s.result]} label={t(`st.${s.result}`)} size="sm" /> {s.assistiveTech} · {s.journey} <span className="muted small">{s.requestedBy}, {dateTime(s.finishedAt)}</span></li>)}</ul>}
    </Card>
    {open && <ResultPanel t={t} id={open} can={d.can} onClose={() => go(BASE, { result: '' })} onChange={refresh} />}
    <Card title={t('ax.issuesTitle')} testid="ax-results">
      <ParamPanel label={t('params')} done={t('done')} count={[params.kind, params.width, params.issue, params.q].filter(Boolean).length} testid="ax-params">
        <Field name="ax-kind" label={t('ax.check')}><select value={params.kind} onChange={(e) => set({ kind: e.target.value })} data-testid="ax-f-kind"><option value="">{t('all')}</option>{['AXE', 'RESPONSIVE', 'DEVICE', 'SCREEN_READER'].map((k) => <option key={k} value={k}>{t(`ax.kind.${k}`)}</option>)}</select></Field>
        <Field name="ax-width" label={t('ax.width')}><select value={params.width} onChange={(e) => set({ width: e.target.value })} data-testid="ax-f-width"><option value="">{t('all')}</option>{[360, 768, 1280, 1920].map((w) => <option key={w} value={w}>{w} px</option>)}</select></Field>
        <Field name="ax-issue" label={t('ax.issue')}><select value={params.issue} onChange={(e) => set({ issue: e.target.value })} data-testid="ax-f-issue"><option value="">{t('ax.active')}</option>{['OPEN', 'FIXED', 'RETESTED', 'ALL'].map((k) => <option key={k} value={k}>{t(`ax.is.${k}`)}</option>)}</select></Field>
        <Field name="ax-q" label={t('search')}><input type="search" inputMode="search" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ q: text.trim().length >= 2 ? text.trim() : '' }); }} data-testid="ax-f-q" /></Field>
      </ParamPanel>
      {!d.results.rows.length ? <EmptyState compact title={t('ax.noIssues')} message={t('ax.noIssuesBody')} /> : <>
        <div className="table-scroll"><table className="data-table" data-testid="ax-table">
          <thead><tr><th>{t('ax.pageOrJourney')}</th><th>{t('ax.check')}</th><th className="num">{t('ax.serious')}</th><th className="num">{t('ax.overflow')}</th><th>{t('ax.issue')}</th></tr></thead>
          <tbody>{d.results.rows.map((x) => <tr key={x.id} data-testid="ax-row" data-issue={x.issue} data-status={x.status}>
            <td data-label={t('ax.pageOrJourney')}><a href={`${BASE}?result=${x.id}`} onClick={(e) => { e.preventDefault(); go(BASE, { result: x.id }); }}>{x.route ?? x.journey}</a>{x.violations.length ? <><br /><span className="muted small">{x.violations.slice(0, 3).map((v) => v.rule).join(', ')}</span></> : null}</td>
            <td data-label={t('ax.check')}>{t(`ax.kind.${x.kind}`)}{x.width ? ` · ${x.width} px` : ''}</td>
            <td data-label={t('ax.serious')} className="num">{n(x.counts.critical + x.counts.serious)}</td>
            <td data-label={t('ax.overflow')} className="num">{x.overflowPx ? `${n(x.overflowPx)} px` : '—'}</td>
            <td data-label={t('ax.issue')}><StatusBadge status={ISSUE_TONE[x.issue]} label={t(`ax.is.${x.issue}`)} size="sm" /></td>
          </tr>)}</tbody>
          <tfoot className="sticky-total"><tr><th scope="row" colSpan={4}>{t('ax.total', { n: n(d.results.total) })}</th><td data-label={t('ax.issue')}>{t('ax.openN', { n: n(d.issues.open) })}</td></tr></tfoot>
        </table></div>
        <Pager page={d.results.page} pageSize={d.results.pageSize} total={d.results.total} onPage={(p) => set({ page: p })} t={t} testid="ax-pager" />
      </>}
    </Card>
  </section>;
}

function ManualForm({ t, devices, onClose, onDone }) {
  const [v, setV] = useState({ kind: 'SCREEN_READER', assistiveTech: 'NVDA', deviceCode: devices.find((x) => x.automation === 'MANUAL')?.code ?? '', journey: '', result: 'PASS', notes: '', language: 'en' });
  const m = useMutation({ mutationFn: () => post('/tst/a11y/manual', { kind: v.kind, journey: v.journey, result: v.result, language: v.language, ...(v.kind === 'SCREEN_READER' ? { assistiveTech: v.assistiveTech } : { deviceCode: v.deviceCode }), ...(v.notes ? { notes: v.notes } : {}) }), onSuccess: onDone });
  return <Card title={t('ax.record')} testid="ax-form">
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field name="mf-kind" label={t('ax.check')}><select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} data-testid="mf-kind">{['SCREEN_READER', 'DEVICE'].map((k) => <option key={k} value={k}>{t(`ax.kind.${k}`)}</option>)}</select></Field>
      {v.kind === 'SCREEN_READER'
        ? <Field name="mf-at" label={t('ax.reader')}><select value={v.assistiveTech} onChange={(e) => setV({ ...v, assistiveTech: e.target.value })} data-testid="mf-at">{['NVDA', 'JAWS', 'VoiceOver', 'TalkBack', 'Narrator'].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
        : <Field name="mf-dev" label={t('ax.device')}><select value={v.deviceCode} onChange={(e) => setV({ ...v, deviceCode: e.target.value })} data-testid="mf-device">{devices.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select></Field>}
      <Field name="mf-j" label={t('ax.journey')}><input value={v.journey} onChange={(e) => setV({ ...v, journey: e.target.value })} required minLength={3} maxLength={120} data-testid="mf-journey" /></Field>
      <Field name="mf-lang" label={t('ax.language')}><select value={v.language} onChange={(e) => setV({ ...v, language: e.target.value })}>{['en', 'hi', 'te'].map((k) => <option key={k} value={k}>{t(`ax.lang.${k}`)}</option>)}</select></Field>
      <Field name="mf-r" label={t('ax.result')}><select value={v.result} onChange={(e) => setV({ ...v, result: e.target.value })} data-testid="mf-result">{['PASS', 'FAIL'].map((k) => <option key={k} value={k}>{t(`st.${k}`)}</option>)}</select></Field>
      <Field name="mf-n" label={t('ax.notes')}><textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} rows={3} maxLength={1000} data-testid="mf-notes" /></Field>
      {m.error && <ErrorState error={m.error} />}
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={m.isPending} data-testid="mf-save">{t('sx.save')}</button><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button></div>
    </form>
  </Card>;
}

function ResultPanel({ t, id, can, onClose, onChange }) {
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['tst', 'a11y', 'result', id], queryFn: () => read(`/tst/a11y/results/${id}`), retry: false });
  const [commit, setCommit] = useState('');
  const fix = useMutation({ mutationFn: () => post(`/tst/a11y/results/${id}/fix`, { fixedIn: commit }), onSuccess: () => { cache.invalidateQueries({ queryKey: ['tst', 'a11y'] }); onChange(); } });
  if (q.isPending) return <Card title={t('ax.result')}><Skeleton label={t('ax.result')} rows={4} /></Card>;
  if (q.error) return <Card title={t('ax.result')}><ErrorState error={q.error} onRetry={q.refetch} /></Card>;
  const x = q.data;
  return <Card title={x.route ?? x.journey} subtitle={`${t(`ax.kind.${x.kind}`)}${x.width ? ` · ${x.width} px` : ''} · ${x.runNo}`} testid="ax-panel" menu={<button type="button" className="btn btn-small" onClick={onClose} data-testid="ax-panel-close">{t('close')}</button>}>
    <p data-testid="ax-panel-issue" data-issue={x.issue}><StatusBadge status={ISSUE_TONE[x.issue]} label={t(`ax.is.${x.issue}`)} size="sm" /> {x.fixedIn ? t('ax.fixedIn', { commit: x.fixedIn, who: x.fixedBy }) : ''}{x.retestedAt ? ` · ${t('ax.retestedAt', { at: dateTime(x.retestedAt) })}` : ''}</p>
    {x.violations.length > 0 && <ul className="lp-list small">{x.violations.map((v) => <li key={v.rule}><StatusBadge status={v.impact === 'serious' || v.impact === 'critical' ? 'REJECTED' : 'AT_RISK'} label={v.impact} size="sm" /> <code>{v.rule}</code> {v.help} ({v.nodes}){v.targets?.[0] ? <><br /><code className="muted">{v.targets[0]}</code></> : null}</li>)}</ul>}
    {x.overflowPx > 0 && <p>{t('ax.overflowBy', { px: x.overflowPx })}</p>}
    {x.steps && <ul className="lp-list small">{x.steps.map((s, i) => <li key={i}><StatusBadge status={TONE[s.result] ?? 'DRAFT'} label={t(`st.${s.result}`)} size="sm" /> {s.step}{s.note ? ` — ${s.note}` : ''}</li>)}</ul>}
    {x.notes && <p className="small">{x.notes}</p>}
    {x.issue === 'OPEN' && can.record && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); fix.mutate(); }} data-testid="ax-fix-form">
      <Field name="ax-commit" label={t('sx.commit')}><input value={commit} onChange={(e) => setCommit(e.target.value.trim())} pattern="[0-9a-f]{7,40}" required data-testid="ax-commit" /></Field>
      {fix.error && <ErrorState error={fix.error} />}
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={fix.isPending} data-testid="ax-fix">{t('sx.markFixed')}</button></div>
    </form>}
    <h3 className="small">{t('ax.history')}</h3>
    <ul className="lp-list small" data-testid="ax-history">{x.history.map((h, i) => <li key={i}>{h.runNo}{h.width ? ` · ${h.width} px` : ''}: {t(`st.${h.status}`)}{h.serious ? ` · ${t('ax.seriousN', { n: h.serious })}` : ''}{h.overflowPx ? ` · ${h.overflowPx} px` : ''} <span className="muted">{dateTime(h.at)}</span></li>)}</ul>
  </Card>;
}
