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
import { Pager, ParamPanel, download, go, post, qs, read } from './common.jsx';

// Part 30.05: Security Findings & Remediation (restricted; technical console, report pattern). The go-live verdict (BR-01) heads the page;
// the chart of findings by severity comes first, then the key figures, what blocks go-live, the latest scan of each kind, the DPDP and
// sensitive-path reviews, and the findings as a list (cards on a phone, parameters in a bottom sheet, a sticky total). A finding opens its
// panel: fix with the commit, the independent re-test, the risk decision through the director, its history.
const BASE = '/admin/security-findings';
const SEV = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const STATUS = ['OPEN', 'FIXED', 'CLOSED', 'RISK_PENDING', 'ACCEPTED', 'FALSE_POSITIVE'];
const SOURCES = ['AUTHZ', 'SAST', 'SECRETS', 'DEPENDENCIES', 'DAST', 'PENTEST', 'MOBILE', 'REVIEW'];
const SEV_TONE = { CRITICAL: 'REJECTED', HIGH: 'REJECTED', MEDIUM: 'AT_RISK', LOW: 'SUBMITTED', INFO: 'DRAFT' };
const ST_TONE = { OPEN: 'REJECTED', FIXED: 'SUBMITTED', CLOSED: 'APPROVED', RISK_PENDING: 'SUBMITTED', ACCEPTED: 'AT_RISK', FALSE_POSITIVE: 'CANCELLED', PASS: 'APPROVED', GAP: 'REJECTED', NA: 'CANCELLED' };

export function SecurityFindings() {
  const t = useT('tst');
  const { number, dateTime } = useFormat();
  const search = useSearch();
  const cache = useQueryClient();
  usePageTitle(t('sx.title'));
  const params = { severity: search.get('severity') ?? '', status: search.get('status') ?? 'ACTIVE', source: search.get('source') ?? '', q: search.get('q') ?? '', page: search.get('page') ?? '' };
  const open = search.get('finding');
  const q = useQuery({ queryKey: ['tst', 'security', params], queryFn: () => read(`/tst/security${qs(params)}`), retry: false, placeholderData: (p) => p });
  const [text, setText] = useState(params.q);
  const [form, setForm] = useState(null);
  const refresh = () => cache.invalidateQueries({ queryKey: ['tst', 'security'] });
  const scan = useMutation({ mutationFn: (kind) => post('/tst/security/scans', { kind }), onSuccess: refresh });
  const exp = useMutation({ mutationFn: (f) => download('/tst/security/export', { severity: params.severity, status: params.status, source: params.source, format: f }, `security-findings.${f}`) });
  const n = (v) => (v == null ? '—' : number(String(v), { decimals: 0 }));
  const set = (patch) => go(BASE, { ...patch, page: patch.page ?? '' });

  if (q.error?.status === 403) return <NoPermission what={t('sx.noPermission')} permission="sct.finding.view" />;
  if (q.isPending) return <section><PageHeader title={t('sx.title')} /><Skeleton label={t('sx.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('sx.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data; const G = d.goLive;
  const actions = <>{d.can.record && <button type="button" className="btn" onClick={() => setForm('finding')} data-testid="sx-record">{t('sx.record')}</button>}</>;
  const menu = [
    ...(d.can.scan ? ['AUTHZ', 'SAST', 'SECRETS'].map((k) => ({ label: t('sx.runScan', { kind: t(`sx.src.${k}`) }), testid: `sx-scan-${k}`, onClick: () => scan.mutate(k) })) : []),
    ...(d.can.export ? ['xlsx', 'csv', 'pdf'].map((f) => ({ label: t('exportAs', { f: f.toUpperCase() }), testid: `sx-export-${f}`, onClick: () => exp.mutate(f) })) : []),
  ];
  const chart = { categories: d.bySeverity.map((s) => t(`sx.sev.${s.severity}`)), series: [
    { name: t('sx.open'), values: d.bySeverity.map((s) => s.open), colour: 'var(--erp-color-status-error-solid)', drill: d.bySeverity.map((s) => `${BASE}?severity=${s.severity}&status=ACTIVE`) },
    { name: t('sx.closed'), values: d.bySeverity.map((s) => s.closed), colour: 'var(--erp-color-status-success-solid)', drill: d.bySeverity.map((s) => `${BASE}?severity=${s.severity}&status=CLOSED`) },
  ] };
  const totalFindings = d.bySeverity.reduce((a, s) => a + s.total, 0);
  return <section aria-labelledby="sx-h" data-testid="tst-security" data-golive={G.blocked ? 'blocked' : 'clear'}>
    <PageHeader id="sx-h" title={t('sx.title')} subtitle={t('sx.subtitle')} actions={actions} menu={menu}
      status={<StatusBadge status={G.blocked ? 'REJECTED' : 'APPROVED'} label={G.blocked ? t('sx.blocked', { c: n(G.critical), h: n(G.high) }) : t('sx.clear')} variant="solid" />} />
    <p className="muted small" data-testid="sx-restricted">{t('sx.restricted')}</p>
    {(scan.error || exp.error) && <ErrorState error={scan.error ?? exp.error} />}
    {scan.data && <p role="status" className="small" data-testid="sx-scanned">{t('sx.scanned', { run: scan.data.runNo, kind: t(`sx.src.${scan.data.kind}`), checked: n(scan.data.checked), raised: n(scan.data.summary?.raised), reopened: n(scan.data.summary?.reopened) })}</p>}
    {form === 'finding' && <RecordFinding t={t} onClose={() => setForm(null)} onDone={() => { setForm(null); refresh(); }} />}
    {!totalFindings && !d.scans.length ? <EmptyState title={t('sx.none')} message={t('sx.noneBody')} /> : <Card title={t('sx.bySeverity')} testid="sx-chart"><Chart type="stacked" data={chart} title={t('sx.bySeverity')} onDrill={(to) => navigateTo(to)} exportName="security-findings-by-severity" /></Card>}
    <KpiRow testid="sx-tiles" label={t('sx.title')}>
      <KpiTile testid="sx-critical" label={t('sx.criticalOpen')} kind="risk" value={n(G.critical)} tone={G.critical ? 'error' : 'success'} to={`${BASE}?severity=CRITICAL&status=BLOCKING`} />
      <KpiTile testid="sx-high" label={t('sx.highOpen')} kind="risk" value={n(G.high)} tone={G.high ? 'error' : 'success'} to={`${BASE}?severity=HIGH&status=BLOCKING`} />
      <KpiTile testid="sx-authz" label={t('sx.authz')} kind="quality" value={d.authzCoverage ? `${d.authzCoverage.pct}` : '—'} unit="%" tone={d.authzCoverage?.pct === 100 ? 'success' : 'warning'} to={`${BASE}?source=AUTHZ`}>{d.authzCoverage ? t('sx.authzOf', { routes: n(d.authzCoverage.routes), cases: n(d.authzCoverage.cases) }) : t('sx.notScanned')}</KpiTile>
      <KpiTile testid="sx-controls" label={t('sx.controls')} kind="count" value={`${n(d.controls.length - d.reviews.unreviewed)} / ${n(d.controls.length)}`} tone={d.reviews.gaps || d.reviews.unreviewed ? 'warning' : 'success'} to={`${BASE}#controls`}>{t('sx.controlsOf', { gaps: n(d.reviews.gaps) })}</KpiTile>
    </KpiRow>
    <CardGrid>
      <Card title={t('sx.blocking')} testid="sx-blocking">
        {!d.blocking.length ? <EmptyState compact title={t('sx.nothingBlocking')} message={t('sx.nothingBlockingBody')} /> : <ul className="lp-list">{d.blocking.map((f) => <li key={f.id} data-testid="sx-blocker"><a href={`${BASE}?finding=${f.id}`} onClick={(e) => { e.preventDefault(); go(BASE, { finding: f.id }); }}><StatusBadge status={SEV_TONE[f.severity]} label={t(`sx.sev.${f.severity}`)} size="sm" /> {f.findingNo} {f.title}</a> <span className="muted small">{t(`sx.st.${f.status}`)}</span></li>)}</ul>}
      </Card>
      <Card title={t('sx.scans')} testid="sx-scans">
        {!d.scans.length ? <EmptyState compact title={t('sx.noScans')} message={t('sx.noScansBody')} /> : <ul className="lp-list">{d.scans.map((s) => <li key={s.id} data-testid="sx-scan" data-kind={s.kind}><strong>{t(`sx.src.${s.kind}`)}</strong> {s.runNo} · {t('sx.scanFacts', { checked: n(s.checked), findings: n(s.findings) })} <span className="muted small">{dateTime(s.finishedAt)}</span></li>)}</ul>}
      </Card>
    </CardGrid>
    {open && <FindingPanel t={t} id={open} can={d.can} onClose={() => go(BASE, { finding: '' })} onChange={refresh} />}
    <Card title={t('sx.findings')} testid="sx-findings">
      <ParamPanel label={t('params')} done={t('done')} count={[params.severity, params.status !== 'ACTIVE' ? params.status : '', params.source, params.q].filter(Boolean).length} testid="sx-params">
        <Field name="sx-sev" label={t('sx.severity')}><select value={params.severity} onChange={(e) => set({ severity: e.target.value })} data-testid="sx-f-severity"><option value="">{t('all')}</option>{SEV.map((s) => <option key={s} value={s}>{t(`sx.sev.${s}`)}</option>)}</select></Field>
        <Field name="sx-status" label={t('status')}><select value={params.status} onChange={(e) => set({ status: e.target.value })} data-testid="sx-f-status"><option value="ACTIVE">{t('sx.active')}</option><option value="BLOCKING">{t('sx.blockingOnly')}</option>{STATUS.map((s) => <option key={s} value={s}>{t(`sx.st.${s}`)}</option>)}</select></Field>
        <Field name="sx-src" label={t('sx.source')}><select value={params.source} onChange={(e) => set({ source: e.target.value })} data-testid="sx-f-source"><option value="">{t('all')}</option>{SOURCES.map((s) => <option key={s} value={s}>{t(`sx.src.${s}`)}</option>)}</select></Field>
        <Field name="sx-q" label={t('search')}><input type="search" inputMode="search" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ q: text.trim().length >= 2 ? text.trim() : '' }); }} data-testid="sx-f-q" /></Field>
      </ParamPanel>
      {!d.findings.rows.length ? <EmptyState compact title={t('sx.noFindings')} message={t('sx.noFindingsBody')} /> : <>
        <div className="table-scroll"><table className="data-table" data-testid="sx-table">
          <thead><tr><th>{t('sx.finding')}</th><th>{t('sx.severity')}</th><th>{t('sx.source')}</th><th>{t('sx.endpoint')}</th><th>{t('status')}</th></tr></thead>
          <tbody>{d.findings.rows.map((f) => <tr key={f.id} data-testid="sx-row" data-severity={f.severity} data-status={f.status}>
            <td data-label={t('sx.finding')}><a href={`${BASE}?finding=${f.id}`} onClick={(e) => { e.preventDefault(); go(BASE, { finding: f.id }); }}>{f.findingNo}</a> {f.title}{f.awaitingMe && <><br /><StatusBadge status="SUBMITTED" label={t('sx.awaitingMe')} size="sm" /></>}</td>
            <td data-label={t('sx.severity')}><StatusBadge status={SEV_TONE[f.severity]} label={t(`sx.sev.${f.severity}`)} size="sm" /></td>
            <td data-label={t('sx.source')}>{t(`sx.src.${f.source}`)}</td>
            <td data-label={t('sx.endpoint')} className="small"><code>{f.endpoint ?? '—'}</code></td>
            <td data-label={t('status')}><StatusBadge status={ST_TONE[f.status]} label={t(`sx.st.${f.status}`)} size="sm" /></td>
          </tr>)}</tbody>
          <tfoot className="sticky-total"><tr><th scope="row" colSpan={4}>{t('sx.total', { n: n(d.findings.total) })}</th><td data-label={t('sx.blocking')}>{t('sx.blockingN', { n: n(G.critical + G.high) })}</td></tr></tfoot>
        </table></div>
        <Pager page={d.findings.page} pageSize={d.findings.pageSize} total={d.findings.total} onPage={(p) => set({ page: p })} t={t} testid="sx-pager" />
      </>}
    </Card>
    <Card title={t('sx.reviews')} subtitle={t('sx.reviewsNote')} testid="sx-controls-card"><span id="controls" />
      <div className="table-scroll"><table className="data-table" data-testid="sx-control-table">
        <thead><tr><th>{t('sx.control')}</th><th>{t('sx.how')}</th><th>{t('status')}</th>{d.can.review && <th>{t('sx.review')}</th>}</tr></thead>
        <tbody>{d.controls.map((c) => <tr key={c.code} data-testid="sx-control" data-code={c.code} data-status={c.status ?? 'NONE'}>
          <td data-label={t('sx.control')}><strong>{c.code}</strong> {c.label}</td>
          <td data-label={t('sx.how')} className="small">{c.how}{c.evidence ? <><br /><em>{c.evidence}</em> <span className="muted">— {c.reviewedBy}, {dateTime(c.reviewedAt)}</span></> : null}</td>
          <td data-label={t('status')}>{c.status ? <StatusBadge status={ST_TONE[c.status]} label={t(`sx.rv.${c.status}`)} size="sm" /> : <span className="muted small">{t('sx.unreviewed')}</span>}</td>
          {d.can.review && <td data-label={t('sx.review')}><button type="button" className="btn btn-small" onClick={() => setForm(c.code)} data-testid={`sx-review-${c.code}`}>{t('sx.review')}</button></td>}
        </tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row" colSpan={d.can.review ? 3 : 2}>{t('sx.controlsTotal', { n: n(d.controls.length), gaps: n(d.reviews.gaps), open: n(d.reviews.unreviewed) })}</th>{d.can.review ? <td /> : <td />}</tr></tfoot>
      </table></div>
      {form && form !== 'finding' && <ReviewForm t={t} control={d.controls.find((c) => c.code === form)} onClose={() => setForm(null)} onDone={() => { setForm(null); refresh(); }} />}
    </Card>
  </section>;
}

function RecordFinding({ t, onClose, onDone }) {
  const [v, setV] = useState({ source: 'PENTEST', severity: 'HIGH', title: '', endpoint: '', cwe: '', description: '' });
  const m = useMutation({ mutationFn: () => post('/tst/security/findings', Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''))), onSuccess: onDone });
  return <Card title={t('sx.record')} testid="sx-record-form">
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field name="rf-src" label={t('sx.source')}><select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} data-testid="rf-source">{['PENTEST', 'MOBILE', 'REVIEW'].map((s) => <option key={s} value={s}>{t(`sx.src.${s}`)}</option>)}</select></Field>
      <Field name="rf-sev" label={t('sx.severity')}><select value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })} data-testid="rf-severity">{SEV.map((s) => <option key={s} value={s}>{t(`sx.sev.${s}`)}</option>)}</select></Field>
      <Field name="rf-title" label={t('sx.titleField')}><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required minLength={5} maxLength={300} data-testid="rf-title" /></Field>
      <Field name="rf-ep" label={t('sx.endpoint')}><input value={v.endpoint} onChange={(e) => setV({ ...v, endpoint: e.target.value })} maxLength={300} data-testid="rf-endpoint" /></Field>
      <Field name="rf-cwe" label="CWE"><input value={v.cwe} onChange={(e) => setV({ ...v, cwe: e.target.value })} placeholder="CWE-639" pattern="CWE-\d{1,5}" data-testid="rf-cwe" /></Field>
      <Field name="rf-desc" label={t('sx.description')}><textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} rows={3} maxLength={4000} data-testid="rf-description" /></Field>
      {m.error && <ErrorState error={m.error} />}
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={m.isPending} data-testid="rf-save">{t('sx.save')}</button><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button></div>
    </form>
  </Card>;
}

function ReviewForm({ t, control, onClose, onDone }) {
  const [v, setV] = useState({ status: 'PASS', evidence: '', severity: 'MEDIUM' });
  const m = useMutation({ mutationFn: () => post('/tst/security/reviews', { controlCode: control.code, status: v.status, evidence: v.evidence, ...(v.status === 'GAP' ? { severity: v.severity } : {}) }), onSuccess: onDone });
  return <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} data-testid="sx-review-form">
    <p><strong>{control.code}</strong> {control.label}</p>
    <Field name="rv-status" label={t('status')}><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} data-testid="rv-status">{['PASS', 'GAP', 'NA'].map((s) => <option key={s} value={s}>{t(`sx.rv.${s}`)}</option>)}</select></Field>
    {v.status === 'GAP' && <Field name="rv-sev" label={t('sx.severity')}><select value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })}>{SEV.map((s) => <option key={s} value={s}>{t(`sx.sev.${s}`)}</option>)}</select></Field>}
    <Field name="rv-ev" label={t('sx.evidence')}><textarea value={v.evidence} onChange={(e) => setV({ ...v, evidence: e.target.value })} rows={3} required minLength={10} maxLength={2000} data-testid="rv-evidence" /></Field>
    {m.error && <ErrorState error={m.error} />}
    <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={m.isPending} data-testid="rv-save">{t('sx.save')}</button><button type="button" className="btn" onClick={onClose}>{t('cancel')}</button></div>
  </form>;
}

function FindingPanel({ t, id, can, onClose, onChange }) {
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['tst', 'security', 'finding', id], queryFn: () => read(`/tst/security/findings/${id}`), retry: false });
  const [v, setV] = useState({ fixedIn: '', note: '', decision: 'ACCEPT', reason: '', until: '' });
  const done = () => { cache.invalidateQueries({ queryKey: ['tst', 'security'] }); onChange(); };
  const act = useMutation({ mutationFn: ([path, body]) => post(`/tst/security/${path}`, body), onSuccess: done });
  if (q.isPending) return <Card title={t('sx.finding')}><Skeleton label={t('sx.finding')} rows={4} /></Card>;
  if (q.error) return <Card title={t('sx.finding')}><ErrorState error={q.error} onRetry={q.refetch} /></Card>;
  const f = q.data;
  return <Card title={`${f.findingNo} ${f.title}`} subtitle={`${t(`sx.sev.${f.severity}`)} · ${t(`sx.src.${f.source}`)} · ${t(`sx.st.${f.status}`)}`} testid="sx-panel" menu={<button type="button" className="btn btn-small" onClick={onClose} data-testid="sx-panel-close">{t('close')}</button>}>
    <div data-testid="sx-panel-status" data-status={f.status}>
      {f.description && <p>{f.description}</p>}
      <p className="small">{f.endpoint && <><code>{f.endpoint}</code> · </>}{f.cwe ?? ''} · {t('sx.reportedBy', { who: f.reportedBy, at: dateTime(f.reportedAt) })}</p>
      {f.fixedIn && <p className="small">{t('sx.fixedIn', { commit: f.fixedIn, who: f.fixedBy })}</p>}
      {f.retestedBy && <p className="small">{t('sx.retested', { who: f.retestedBy, at: dateTime(f.retestedAt) })}: {f.retestNote}</p>}
    </div>
    {act.error && <ErrorState error={act.error} />}
    {f.status === 'OPEN' && can.manage && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); act.mutate([`findings/${f.id}/fix`, { fixedIn: v.fixedIn, ...(v.note ? { note: v.note } : {}) }]); }} data-testid="sx-fix-form">
      <Field name="fx-commit" label={t('sx.commit')}><input value={v.fixedIn} onChange={(e) => setV({ ...v, fixedIn: e.target.value.trim() })} pattern="[0-9a-f]{7,40}" required data-testid="fx-commit" /></Field>
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={act.isPending} data-testid="fx-save">{t('sx.markFixed')}</button></div>
    </form>}
    {f.status === 'FIXED' && can.retest && <form className="form-grid" onSubmit={(e) => e.preventDefault()} data-testid="sx-retest-form">
      <Field name="rt-note" label={t('sx.retestNote')}><textarea value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} rows={2} minLength={5} data-testid="rt-note" /></Field>
      <div className="actions-row"><button type="button" className="btn btn-primary" disabled={act.isPending || v.note.trim().length < 5} onClick={() => act.mutate([`findings/${f.id}/retest`, { result: 'PASS', note: v.note }])} data-testid="rt-pass">{t('sx.retestPass')}</button><button type="button" className="btn btn-danger" disabled={act.isPending || v.note.trim().length < 5} onClick={() => act.mutate([`findings/${f.id}/retest`, { result: 'FAIL', note: v.note }])} data-testid="rt-fail">{t('sx.retestFail')}</button></div>
    </form>}
    {f.status === 'OPEN' && can.manage && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); act.mutate([`findings/${f.id}/risk`, { decision: v.decision, reason: v.reason, ...(v.until ? { until: v.until } : {}) }]); }} data-testid="sx-risk-form">
      <Field name="rk-d" label={t('sx.decision')}><select value={v.decision} onChange={(e) => setV({ ...v, decision: e.target.value })}>{f.severity !== 'CRITICAL' && <option value="ACCEPT">{t('sx.accept')}</option>}<option value="FALSE_POSITIVE">{t('sx.falsePositive')}</option></select></Field>
      {v.decision === 'ACCEPT' && f.severity !== 'CRITICAL' && <Field name="rk-u" label={t('sx.until')}><input type="date" value={v.until} onChange={(e) => setV({ ...v, until: e.target.value })} /></Field>}
      <Field name="rk-r" label={t('sx.reason')}><textarea value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} rows={2} minLength={5} required /></Field>
      <div className="actions-row"><button type="submit" className="btn" disabled={act.isPending}>{t('sx.askDirector')}</button></div>
    </form>}
    {f.request?.awaitingMe && <div className="actions-row" data-testid="sx-decide">
      <button type="button" className="btn btn-primary" onClick={() => act.mutate([`risk-requests/${f.request.id}/act`, { action: 'approve' }])} data-testid="sx-approve">{t('approve')}</button>
      <button type="button" className="btn btn-danger" onClick={() => act.mutate([`risk-requests/${f.request.id}/act`, { action: 'reject', comment: t('sx.rejected') }])} data-testid="sx-reject">{t('sx.reject')}</button>
    </div>}
    <h3 className="small">{t('sx.history')}</h3>
    <ul className="lp-list small" data-testid="sx-history">{f.history.map((h, i) => <li key={i}>{h.action} — {h.actor}, {dateTime(h.at)}</li>)}</ul>
  </Card>;
}
