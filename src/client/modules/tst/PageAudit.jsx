import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authHeaders } from '../../platform/api/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { COLOUR, Pager, ParamPanel, TONE, download, go, post, qs, read } from './common.jsx';

// Part 30.03: Page Completion Audit (technical console, analytical report §3.5). The go-live verdict (BR-01), the pages by module, the key
// figures, the parameters, then every page of the inventory with its crawl, static scan and manual audit; a page opens its panel: the audits,
// their defects (mark fixed with the commit and test, or reschedule with the owner's approval) and the manual audit by role with evidence.
const BASE = '/admin/page-audit';
const transport = browserTransport(authHeaders);

export function PageAudit() {
  const t = useT('tst');
  const { number } = useFormat();
  const search = useSearch();
  const cache = useQueryClient();
  usePageTitle(t('pa.title'));
  const params = { module: search.get('module') ?? '', status: search.get('status') ?? '', q: search.get('q') ?? '', nav: search.get('nav') ?? '', page: search.get('page') ?? '' };
  const code = search.get('code');
  const q = useQuery({ queryKey: ['tst', 'pages', params], queryFn: () => read(`/tst/page-audits${qs(params)}`), retry: false, placeholderData: (p) => p });
  const [text, setText] = useState(params.q);
  const scan = useMutation({ mutationFn: () => post('/tst/page-audits/static-scan'), onSuccess: () => cache.invalidateQueries({ queryKey: ['tst', 'pages'] }) });
  const exp = useMutation({ mutationFn: (f) => download('/tst/page-audits/export', { module: params.module, status: params.status, nav: params.nav, format: f }, `page-completion-audit.${f}`) });
  if (q.error?.status === 403) return <NoPermission what={t('pa.noPermission')} permission="tst.page_audit.view" />;
  if (q.isPending) return <section><PageHeader title={t('pa.title')} /><Skeleton label={t('pa.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('pa.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data; const T = d.totals;
  const n = (v) => number(String(v ?? 0), { decimals: 0 });
  const set = (patch) => go(BASE, patch);
  const chart = { categories: d.byModule.map((m) => m.module), series: [
    { name: t('st.PASS'), colour: COLOUR.PASS, values: d.byModule.map((m) => m.pass), drill: d.byModule.map((m) => `${BASE}?module=${m.module}&status=PASS`) },
    { name: t('st.FAIL'), colour: COLOUR.FAIL, values: d.byModule.map((m) => m.fail), drill: d.byModule.map((m) => `${BASE}?module=${m.module}&status=FAIL`) },
    { name: t('st.NOT_TESTED'), colour: COLOUR.OTHER, values: d.byModule.map((m) => m.notTested), drill: d.byModule.map((m) => `${BASE}?module=${m.module}&status=NOT_TESTED`) },
  ] };
  const menu = d.can.export ? ['xlsx', 'csv', 'pdf'].map((f) => ({ label: t('exportAs', { f: f.toUpperCase() }), testid: `pa-export-${f}`, onClick: () => exp.mutate(f) })) : [];
  return <section aria-labelledby="pa-h" data-testid="tst-page-audit" data-blocked={d.goLive.blocked ? 'yes' : 'no'}>
    <PageHeader id="pa-h" title={t('pa.title')} subtitle={t('pa.subtitle', { n: n(T.pages) })}
      status={<StatusBadge status={d.goLive.blocked ? 'REJECTED' : 'APPROVED'} label={d.goLive.blocked ? t('pa.blocked') : t('pa.clear')} variant="solid" />}
      actions={d.can.run ? <button type="button" className="btn btn-primary" onClick={() => scan.mutate()} disabled={scan.isPending} data-testid="pa-scan">{scan.isPending ? t('running') : t('pa.scan')}</button> : null} menu={menu} />
    {(scan.error || exp.error) && <ErrorState error={scan.error ?? exp.error} />}
    {scan.data && <p className="mdm-banner" role="status" data-testid="pa-scan-result">{t('pa.scanned', { n: n(scan.data.pages), f: n(scan.data.failed) })}</p>}
    <Card title={t('pa.byModule')} testid="pa-chart"><Chart type="stacked" data={chart} title={t('pa.byModule')} onDrill={(to) => navigateTo(to)} exportName="pages-by-module" /></Card>
    <KpiRow testid="pa-tiles" label={t('pa.title')}>
      <KpiTile testid="pa-blocking" label={t('pa.blocking')} kind="risk" value={`${n(T.businessNavBlocking)} / ${n(T.businessNav)}`} tone={T.businessNavBlocking ? 'error' : 'success'} to={`${BASE}?nav=1`}>{t('pa.blockingNote')}</KpiTile>
      <KpiTile testid="pa-pass" label={t('st.PASS')} kind="quality" value={n(T.passed)} tone="success" to={`${BASE}?status=PASS`} />
      <KpiTile testid="pa-fail" label={t('st.FAIL')} kind="quality" value={n(T.failed)} tone={T.failed ? 'error' : 'success'} to={`${BASE}?status=FAIL`} />
      <KpiTile label={t('st.NOT_TESTED')} kind="count" value={n(T.notTested)} tone={T.notTested ? 'warning' : 'success'} to={`${BASE}?status=NOT_TESTED`} />
      <KpiTile label={t('pa.openDefects')} kind="risk" value={n(T.openDefects)} tone={T.openDefects ? 'error' : 'success'} to={`${BASE}?status=FAIL`}>{t('pa.rescheduled', { n: n(T.rescheduled) })}</KpiTile>
      <KpiTile label={t('pa.manual')} kind="people" value={n(T.manual)} to={`${BASE}?status=PASS`} />
    </KpiRow>
    {code && <PagePanel code={code} t={t} n={n} roles={d.roles} checklist={d.checklist} canRecord={d.can.record} onClose={() => set({ code: '' })} />}
    <ParamPanel label={t('params')} done={t('done')} count={[params.module, params.status, params.q, params.nav].filter(Boolean).length} testid="pa-params">
      <Field name="pa-module" label={t('module')}><select value={params.module} onChange={(e) => set({ module: e.target.value })} data-testid="pa-f-module"><option value="">{t('all')}</option>{d.modules.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
      <Field name="pa-status" label={t('status')}><select value={params.status} onChange={(e) => set({ status: e.target.value })} data-testid="pa-f-status"><option value="">{t('all')}</option>{['PASS', 'FAIL', 'NOT_TESTED'].map((s) => <option key={s} value={s}>{t(`st.${s}`)}</option>)}</select></Field>
      <Field name="pa-q" label={t('search')}><input type="search" inputMode="search" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') set({ q: text.trim().length >= 2 ? text.trim() : '' }); }} data-testid="pa-f-q" /></Field>
      <label className="check"><input type="checkbox" checked={params.nav === '1'} onChange={(e) => set({ nav: e.target.checked ? '1' : '' })} data-testid="pa-f-nav" /> {t('pa.navOnly')}</label>
    </ParamPanel>
    {!d.rows.length ? <EmptyState title={t('pa.none')} message={t('pa.noneBody')} action={<button type="button" className="btn" onClick={() => set({ module: '', status: '', q: '', nav: '' })}>{t('clear')}</button>} /> : <>
      <div className="table-scroll"><table className="data-table" data-testid="pa-table">
        <thead><tr><th>{t('pa.page')}</th><th>{t('module')}</th><th>{t('pa.owner')}</th><th>{t('pa.crawl')}</th><th>{t('pa.static')}</th><th>{t('pa.manualCol')}</th><th className="num">{t('pa.defects')}</th><th>{t('status')}</th></tr></thead>
        <tbody>{d.rows.map((p) => <tr key={p.code} data-testid="pa-row" data-code={p.code} data-status={p.status}>
          <td data-label={t('pa.page')}><Link to={`${BASE}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)), code: p.code })}`}>{p.label}</Link><br /><span className="muted small">{p.route}{p.inNav ? ` · ${t('pa.inNav')}` : ''}</span></td>
          <td data-label={t('module')}>{p.module}</td><td data-label={t('pa.owner')}>{p.owner}</td>
          <td data-label={t('pa.crawl')} className="small">{p.crawl.length ? p.crawl.map((c) => `${t(`vp.${c.viewport}`)} ${t(`st.${c.status}`)}`).join(' · ') : '—'}</td>
          <td data-label={t('pa.static')}>{p.staticStatus ? t(`st.${p.staticStatus}`) : '—'}</td>
          <td data-label={t('pa.manualCol')}>{p.manualStatus ? `${t(`st.${p.manualStatus}`)} (${p.manualRole})` : '—'}</td>
          <td data-label={t('pa.defects')} className="num">{n(p.openDefects)}</td>
          <td data-label={t('status')}><StatusBadge status={TONE[p.status]} label={t(`st.${p.status}`)} size="sm" /></td>
        </tr>)}</tbody>
        <tfoot className="sticky-total"><tr><th scope="row" colSpan={7}>{t('pa.total', { n: n(d.total), pass: n(T.passed), fail: n(T.failed) })}</th><td data-label={t('status')}>{d.goLive.blocked ? t('pa.blocked') : t('pa.clear')}</td></tr></tfoot>
      </table></div>
      <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => set({ page: p })} t={t} testid="pa-pager" />
    </>}
    <Card title={t('pa.runs')} testid="pa-runs">{!d.runs.length ? <EmptyState compact title={t('pa.noRuns')} message={t('pa.noRunsBody')} /> : <ul className="lp-list">{d.runs.map((r) => <li key={r.id} data-testid="pa-run">{t('pa.runLine', { no: r.runNo, kind: t(`pa.kind.${r.kind}`), vp: r.viewport ? t(`vp.${r.viewport}`) : '', n: n(r.pages), f: n(r.failed), by: r.by })}</li>)}</ul>}</Card>
  </section>;
}

function PagePanel({ code, t, n, roles, checklist, canRecord, onClose }) {
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['tst', 'page', code], queryFn: () => read(`/tst/page-audits/pages/${encodeURIComponent(code)}`), retry: false });
  const [form, setForm] = useState(null);
  const [act, setAct] = useState(null);
  const refresh = () => { cache.invalidateQueries({ queryKey: ['tst', 'page', code] }); cache.invalidateQueries({ queryKey: ['tst', 'pages'] }); };
  const doAct = useMutation({ mutationFn: (fn) => fn(), onSuccess: () => { setAct(null); refresh(); } });
  if (q.isPending) return <Card title={code}><Skeleton label={code} rows={4} /></Card>;
  if (q.error) return <Card title={code}><ErrorState error={q.error} onRetry={q.refetch} /></Card>;
  const d = q.data; const p = d.page;
  return <Card title={`${p.label} · ${p.route}`} subtitle={t('pa.panelFacts', { module: p.module, owner: p.owner, pattern: p.pattern ?? '—', file: p.file ?? '—' })} testid="pa-panel"
    menu={<button type="button" className="btn btn-small" onClick={onClose} data-testid="pa-panel-close">{t('close')}</button>}>
    <p><StatusBadge status={TONE[p.status]} label={t(`st.${p.status}`)} /> <Link to={p.route}>{t('pa.openPage')}</Link></p>
    {canRecord && !form && <button type="button" className="btn btn-primary" onClick={() => setForm({ roleTested: roles[0] ?? 'PM', checklist: Object.fromEntries(checklist.map((c) => [c.code, { result: 'PASS', note: '' }])), defects: [], notes: '', shot: null })} data-testid="pa-record">{t('pa.record')}</button>}
    {form && <AuditForm form={form} setForm={setForm} t={t} roles={roles} checklist={checklist} code={code} onDone={() => { setForm(null); refresh(); }} />}
    {d.requests.length > 0 && <div data-testid="pa-requests"><h3>{t('pa.requests')}</h3><ul className="lp-list">{d.requests.map((r) => <li key={r.id} data-testid="pa-request" data-status={r.status}>
      {t('pa.requestLine', { defect: r.payload.defect, part: r.payload.targetPart, by: r.requestedBy, status: t(`rq.${r.status}`) })} — {r.reason}
      {r.canDecide && <span className="actions-row"><button type="button" className="btn btn-small btn-primary" onClick={() => doAct.mutate(() => post(`/tst/page-audits/reschedules/${r.id}/act`, { action: 'approve' }))} data-testid="pa-request-approve">{t('approve')}</button><button type="button" className="btn btn-small" onClick={() => { const c = window.prompt(t('pa.rejectWhy')); if (c) doAct.mutate(() => post(`/tst/page-audits/reschedules/${r.id}/act`, { action: 'reject', comment: c })); }} data-testid="pa-request-reject">{t('reject')}</button></span>}
    </li>)}</ul></div>}
    {doAct.error && <ErrorState error={doAct.error} />}
    {!d.audits.length ? <EmptyState compact title={t('pa.noAudits')} message={t('pa.noAuditsBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="pa-audits">
      <thead><tr><th>{t('pa.kindCol')}</th><th>{t('pa.role')}</th><th>{t('pa.defects')}</th><th>{t('status')}</th></tr></thead>
      <tbody>{d.audits.map((a) => <tr key={a.id} data-testid="pa-audit" data-kind={a.kind} data-status={a.status}>
        <td data-label={t('pa.kindCol')}>{t(`pa.kind.${a.kind}`)}{a.viewport ? ` · ${t(`vp.${a.viewport}`)}` : ''}<br /><span className="muted small">{a.testedBy} · {a.testedAt?.slice(0, 16).replace('T', ' ')}</span>{a.evidence.length ? <><br /><span className="small">{t('pa.evidenceN', { n: a.evidence.length })}</span></> : null}</td>
        <td data-label={t('pa.role')}>{a.roleTested}</td>
        <td data-label={t('pa.defects')} className="small">{!a.defects.length ? '—' : <ul className="lp-list">{a.defects.map((x) => <li key={x.no} data-testid="pa-defect" data-status={x.status}>
          <StatusBadge status={TONE[x.status ?? 'OPEN']} label={t(`ds.${x.status ?? 'OPEN'}`)} size="sm" /> {x.title}{x.targetPart ? ` → ${x.targetPart}` : ''}{x.fixRef ? ` · ${x.fixRef}` : ''}
          {canRecord && (x.status ?? 'OPEN') === 'OPEN' && <span className="actions-row">
            <button type="button" className="btn btn-small" onClick={() => setAct({ id: a.id, no: x.no, kind: 'fix', fixRef: '' })} data-testid="pa-defect-fix">{t('pa.fix')}</button>
            <button type="button" className="btn btn-small" onClick={() => setAct({ id: a.id, no: x.no, kind: 'reschedule', targetPart: '', reason: '' })} data-testid="pa-defect-reschedule">{t('pa.reschedule')}</button></span>}
          {act && act.id === a.id && act.no === x.no && <form className="actions-row" onSubmit={(e) => { e.preventDefault(); doAct.mutate(() => (act.kind === 'fix' ? post(`/tst/page-audits/${a.id}/defects/${x.no}/fix`, { fixRef: act.fixRef.trim() }) : post(`/tst/page-audits/${a.id}/defects/${x.no}/reschedule`, { targetPart: act.targetPart.trim(), reason: act.reason.trim() }))); }} data-testid="pa-defect-form">
            {act.kind === 'fix' ? <Field name={`fix-${a.id}-${x.no}`} label={t('pa.fixRef')}><input value={act.fixRef} onChange={(e) => setAct({ ...act, fixRef: e.target.value })} required minLength={5} maxLength={200} data-testid="pa-fix-ref" /></Field>
              : <><Field name={`part-${a.id}-${x.no}`} label={t('pa.targetPart')}><input value={act.targetPart} onChange={(e) => setAct({ ...act, targetPart: e.target.value })} required pattern="\d{2}\.\d{2}" inputMode="decimal" placeholder="30.08" data-testid="pa-target-part" /></Field>
                <Field name={`why-${a.id}-${x.no}`} label={t('pa.reason')}><input value={act.reason} onChange={(e) => setAct({ ...act, reason: e.target.value })} required minLength={5} maxLength={500} data-testid="pa-reason" /></Field></>}
            <button type="submit" className="btn btn-primary btn-small" disabled={doAct.isPending} data-testid="pa-defect-save">{t('save')}</button><button type="button" className="btn btn-small" onClick={() => setAct(null)}>{t('cancel')}</button>
          </form>}
        </li>)}</ul>}</td>
        <td data-label={t('status')}><StatusBadge status={TONE[a.status]} label={t(`st.${a.status}`)} size="sm" /></td>
      </tr>)}</tbody>
    </table></div>}
    {d.scan.available && <p className="small muted" data-testid="pa-scan-now">{d.scan.findings.length ? t('pa.scanNow', { n: n(d.scan.findings.length) }) : t('pa.scanClean')}</p>}
  </Card>;
}

function AuditForm({ form, setForm, t, roles, checklist, code, onDone }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const setPoint = (c, patch) => setForm({ ...form, checklist: { ...form.checklist, [c]: { ...form.checklist[c], ...patch } } });
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await post('/tst/page-audits', { pageCode: code, roleTested: form.roleTested, checklist: checklist.map((c) => ({ code: c.code, result: form.checklist[c.code].result, ...(form.checklist[c.code].note.trim() ? { note: form.checklist[c.code].note.trim() } : {}) })), defects: form.defects.filter((x) => x.title.trim()).map((x) => ({ title: x.title.trim(), severity: x.severity, ...(x.checklist ? { checklist: x.checklist } : {}) })), ...(form.notes.trim() ? { notes: form.notes.trim() } : {}) });
      if (form.shot) { const stored = await uploadFile(form.shot, { transport, entity: 'tst_page_audit', entityId: r.id, stripExif: true }); await post(`/tst/page-audits/${r.id}/evidence`, { fileId: stored.id }); }
      onDone();
    } catch (x) { setError(x); } finally { setBusy(false); }
  };
  return <form className="mdm-panel" onSubmit={save} aria-label={t('pa.record')} data-testid="pa-form">
    <h3>{t('pa.record')}</h3>
    {error && <ErrorState error={error} />}
    <Field name="pa-role" label={t('pa.role')}><select value={form.roleTested} onChange={(e) => setForm({ ...form, roleTested: e.target.value })} data-testid="pa-form-role">{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
    <fieldset><legend>{t('pa.checklist')}</legend>
      {checklist.map((c) => <div key={c.code} className="pa-point" data-testid="pa-point" data-code={c.code}>
        <p><strong>{c.code}</strong> {c.label}</p>
        <div className="actions-row" role="radiogroup" aria-label={c.label}>{['PASS', 'FAIL', 'NA'].map((v) => <label key={v} className="check"><input type="radio" name={`pt-${c.code}`} checked={form.checklist[c.code].result === v} onChange={() => setPoint(c.code, { result: v })} data-testid={`pa-point-${c.code}-${v}`} /> {t(`res.${v}`)}</label>)}</div>
        {form.checklist[c.code].result === 'FAIL' && <Field name={`note-${c.code}`} label={t('pa.whatFails')}><input value={form.checklist[c.code].note} onChange={(e) => setPoint(c.code, { note: e.target.value })} required maxLength={500} data-testid={`pa-note-${c.code}`} /></Field>}
      </div>)}
    </fieldset>
    <fieldset><legend>{t('pa.defectsLegend')}</legend>
      {form.defects.map((x, i) => <div key={i} className="form-grid" data-testid="pa-form-defect">
        <Field name={`dt-${i}`} label={t('pa.defectTitle')}><input value={x.title} onChange={(e) => setForm({ ...form, defects: form.defects.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)) })} minLength={5} maxLength={300} data-testid="pa-defect-title" /></Field>
        <Field name={`ds-${i}`} label={t('pa.severity')}><select value={x.severity} onChange={(e) => setForm({ ...form, defects: form.defects.map((y, j) => (j === i ? { ...y, severity: e.target.value } : y)) })} data-testid="pa-defect-severity">{['CRITICAL', 'MAJOR', 'MINOR'].map((s) => <option key={s} value={s}>{t(`sev.${s}`)}</option>)}</select></Field>
      </div>)}
      <button type="button" className="btn btn-small" onClick={() => setForm({ ...form, defects: [...form.defects, { title: '', severity: 'MAJOR' }] })} data-testid="pa-add-defect">{t('pa.addDefect')}</button>
    </fieldset>
    <Field name="pa-notes" label={t('pa.notes')}><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={2000} rows={2} data-testid="pa-form-notes" /></Field>
    <Field name="pa-shot" label={t('pa.evidence')}><input type="file" accept="image/*" capture="environment" onChange={(e) => setForm({ ...form, shot: e.target.files?.[0] ?? null })} data-testid="pa-form-shot" /></Field>
    <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={busy} data-testid="pa-form-save">{busy ? t('saving') : t('pa.save')}</button><button type="button" className="btn" onClick={() => setForm(null)}>{t('cancel')}</button></div>
  </form>;
}
