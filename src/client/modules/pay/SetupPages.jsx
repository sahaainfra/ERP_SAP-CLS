import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { money } from '../fin/api.js';
import { GlError, useGlRunner } from '../fin/JournalsPage.jsx';
import { Decide, Pills, Rows, big, guardOf, istToday } from '../fin/finparts.jsx';
import { TONE, file, setup } from './api.js';

// Part 24.01: payroll set-up — pay components and the formula builder, salary structures with the CTC preview, employee pay assignments and revisions (with the
// breakup, the previous assignment and the arrears of a retro revision, and the decision panel), statutory parameters by date and state, the payroll calendar.
const row = { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
const card = { padding: 12, margin: '6px 0' };
const TYPES = ['EARNING', 'DEDUCTION', 'EMPLOYER', 'REIMBURSEMENT'];
const METHODS = ['FIXED', 'PERCENT', 'FORMULA', 'BALANCE', 'STATUTORY', 'INPUT'];
const amt = (v, t) => (v == null ? t('ps.masked') : money(v));

function Breakup({ b, t, testid = 'ps-breakup' }) {
  return (<div data-testid={testid}><KpiRow label={t('ps.breakup')}><KpiTile label={t('ps.gross')} value={money(b.fullGross ?? b.gross)} amount={b.fullGross ?? b.gross} kind="money" valueTestid={`${testid}-gross`} /><KpiTile label={t('ps.employer')} value={money(b.employer)} amount={b.employer} kind="money" /><KpiTile label={t('ps.ctcMonthly')} value={money(b.ctcMonthly)} amount={b.ctcMonthly} kind="money" valueTestid={`${testid}-ctc`} /><KpiTile label={t('ps.net')} value={money(b.net)} amount={b.net} kind="money" /></KpiRow>
    {TYPES.map((ty) => { const ls = b.lines.filter((l) => l.type === ty && (l.amount || l.full)); return ls.length === 0 ? null : <div key={ty} className="mdm-panel" style={card}><h3 className="small" style={{ margin: '0 0 4px' }}>{t(`ps.type.${ty}`)}</h3><ul className="lp-list">{ls.map((l) => <li key={l.code} style={{ ...row, minHeight: 36 }}><span>{l.code} · {l.name}</span><span className="num">{money(l.full ?? l.amount)}</span></li>)}</ul></div>; })}
    {b.wages && <p className="muted small">{t('ps.wagesNote', { wages: money(b.wages.codeWages), added: money(b.wages.addedBack), pf: money(b.pfWage) })}</p>}</div>);
}

function ComponentForm({ c, t, run, busy, names }) {
  const [f, setF] = useState({ code: c?.code ?? '', name: c?.name ?? '', type: c?.type ?? 'EARNING', method: c?.method ?? 'FIXED', formula: c?.formula ?? '', percent: c?.percent ?? '', baseCodes: (c?.baseCodes ?? []).join(','), sequence: c?.sequence ?? 100, wageClass: c?.wageClass ?? 'WAGES', taxable: c?.taxable ?? true, pf: c?.pf ?? false, esi: c?.esi ?? true, pt: c?.pt ?? true });
  const [test, setTest] = useState(null); const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const body = () => ({ ...(c ? { id: c.id, version: c.version } : { code: f.code.trim().toUpperCase() }), name: f.name, type: f.type, method: f.method, sequence: Number(f.sequence), wageClass: f.wageClass, taxable: f.taxable, pf: f.pf, esi: f.esi, pt: f.pt, ...(f.method === 'FORMULA' ? { formula: f.formula } : {}), ...(f.method === 'PERCENT' ? { percent: Number(f.percent), baseCodes: f.baseCodes.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) } : {}) });
  return (<div className="mdm-panel" data-testid="ps-comp-form"><h2>{c ? `${c.code} · ${c.name}` : t('ps.newComponent')}</h2><div className="form-grid">
    {!c && <Field label={t('ps.code')} name="code" error={null}><input value={f.code} onChange={set('code')} style={big} data-testid="ps-comp-code" /></Field>}
    <Field label={t('ps.name')} name="name" error={null}><input value={f.name} onChange={set('name')} style={big} data-testid="ps-comp-name" /></Field>
    <Field label={t('ps.typeLabel')} name="type" error={null}><select value={f.type} onChange={set('type')} style={big}>{TYPES.map((x) => <option key={x} value={x}>{t(`ps.type.${x}`)}</option>)}</select></Field>
    <Field label={t('ps.method')} name="method" error={null}><select value={f.method} onChange={set('method')} style={big} data-testid="ps-comp-method">{METHODS.map((x) => <option key={x} value={x}>{t(`ps.m.${x}`)}</option>)}</select></Field>
    {f.method === 'FORMULA' && <Field label={t('ps.formula')} name="formula" error={null}><input value={f.formula} onChange={set('formula')} style={{ ...big, fontFamily: 'monospace' }} data-testid="ps-comp-formula" /></Field>}
    {f.method === 'PERCENT' && <><Field label={t('ps.percent')} name="percent" error={null}><input inputMode="decimal" value={f.percent} onChange={set('percent')} style={big} /></Field><Field label={t('ps.baseCodes')} name="bases" error={null}><input value={f.baseCodes} onChange={set('baseCodes')} style={big} /></Field></>}
    <Field label={t('ps.sequence')} name="seq" error={null}><input inputMode="numeric" value={f.sequence} onChange={set('sequence')} style={big} /></Field>
    <Field label={t('ps.wageClass')} name="wc" error={null}><select value={f.wageClass} onChange={set('wageClass')} style={big}>{['WAGES', 'EXCLUDED', 'NOT_REMUNERATION'].map((x) => <option key={x} value={x}>{t(`ps.wc.${x}`)}</option>)}</select></Field></div>
    <div className="actions-row">{[['taxable', t('ps.taxable')], ['pf', 'PF'], ['esi', 'ESI'], ['pt', 'PT']].map(([k, l]) => <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 'var(--erp-target-min)' }}><input type="checkbox" checked={f[k]} onChange={set(k)} />{l}</label>)}</div>
    {f.method === 'FORMULA' && <p className="muted small">{t('ps.formulaHelp', { names: names.join(', ') })}</p>}
    {test && <p className="small" data-testid="ps-formula-test" role="status">{test.ok ? t('ps.testResult', { amount: money(test.amount) }) : test.problems.join(' ')}</p>}
    <div className="actions-row ff-actionbar">
      {f.method === 'FORMULA' && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => setup.testFormula({ code: (c?.code ?? f.code).toUpperCase(), formula: f.formula, values: { BASIC: 30000, DA: 0 } })).then((r) => r && setTest(r))} data-testid="ps-formula-test-btn">{t('ps.testFormula')}</button>}
      <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => setup.saveComponent(body()), t('ps.saved'))} data-testid="ps-comp-save">{t('ps.save')}</button></div></div>);
}

function Structures({ t, run, busy, canConfigure, comps }) {
  const q = useQuery({ queryKey: ['gl', 'pay-structs'], queryFn: () => setup.structures(), retry: false }); const [sel, setSel] = useState(null); const [ctc, setCtc] = useState('900000'); const [pt, setPt] = useState('TS'); const [pv, setPv] = useState(null); const [nf, setNf] = useState(null);
  const g = guardOf(q, t('ps.structures'), 'pay.structure.view'); if (g) return g; const s = q.data.find((x) => x.id === sel);
  return (<div data-testid="ps-structures">
    {canConfigure && <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} onClick={() => setNf(nf ? null : { code: '', name: '', grade: '', senior: false, codes: ['BASIC', 'HRA', 'CONVEYANCE', 'SPECIAL', 'PF_EE', 'PT', 'PF_ER', 'EPS_ER', 'EDLI_ER', 'PF_ADMIN', 'GRATUITY'], values: { CONVEYANCE: 1600 } })} data-testid="ps-struct-new">{t('ps.newStructure')}</button>}
    {nf && <div className="mdm-panel" data-testid="ps-struct-form"><div className="form-grid"><Field label={t('ps.code')} name="sc" error={null}><input value={nf.code} onChange={(e) => setNf({ ...nf, code: e.target.value })} style={big} data-testid="ps-struct-code" /></Field><Field label={t('ps.name')} name="sn" error={null}><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} style={big} data-testid="ps-struct-name" /></Field><Field label={t('ps.grade')} name="sg" error={null}><input value={nf.grade} onChange={(e) => setNf({ ...nf, grade: e.target.value })} style={big} /></Field></div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 'var(--erp-target-min)' }}><input type="checkbox" checked={nf.senior} onChange={(e) => setNf({ ...nf, senior: e.target.checked })} />{t('ps.senior')}</label>
      <ul className="lp-list">{comps.filter((c) => c.status === 'ACTIVE' && c.method !== 'INPUT').map((c) => <li key={c.code} style={{ ...row, minHeight: 'var(--erp-target-min)', alignItems: 'center' }}><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={nf.codes.includes(c.code)} onChange={(e) => setNf({ ...nf, codes: e.target.checked ? [...nf.codes, c.code] : nf.codes.filter((x) => x !== c.code) })} />{c.code} · {c.name}</label>{c.method === 'FIXED' && nf.codes.includes(c.code) && <input inputMode="decimal" aria-label={`${c.code} ${t('ps.monthly')}`} value={nf.values[c.code] ?? ''} onChange={(e) => setNf({ ...nf, values: { ...nf.values, [c.code]: e.target.value } })} style={{ ...big, width: 120 }} />}</li>)}</ul>
      <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => setup.saveStructure({ code: nf.code.trim().toUpperCase(), name: nf.name, grade: nf.grade || null, senior: nf.senior, components: nf.codes.map((code) => ({ code, ...(nf.values[code] !== undefined && nf.values[code] !== '' && comps.find((c) => c.code === code)?.method === 'FIXED' ? { value: Number(nf.values[code]) } : {}) })) }), t('ps.saved')).then((r) => { if (r) { setNf(null); setSel(r.id); } })} data-testid="ps-struct-save">{t('ps.save')}</button></div></div>}
    {q.data.length === 0 ? <EmptyState compact title={t('ps.noStructures')} message={t('ps.noStructuresBody')} /> : <ul className="lp-list">{q.data.map((x) => <li key={x.id} className="mdm-panel" style={card}><button type="button" className="btn-link" style={{ ...row, width: '100%', minHeight: 'var(--erp-target-min)', alignItems: 'center', background: 'none', border: 0, color: 'inherit', textAlign: 'left' }} onClick={() => { setSel(x.id); setPv(null); }} data-testid={`ps-struct-${x.code}`}><strong>{x.code} · {x.name}</strong><span>{x.grade ?? '—'}{x.senior ? ` · ${t('ps.seniorShort')}` : ''} · v{x.versionNo} ›</span></button></li>)}</ul>}
    {s && <div className="mdm-panel" data-testid="ps-preview"><h2>{t('ps.previewOf', { code: s.code })}</h2><p className="small">{s.components.map((c) => `${c.code}${c.value != null ? ` ${money(c.value)}` : ''}`).join(' · ')}</p>
      <div className="form-grid"><Field label={t('ps.ctcAnnual')} name="ctc" error={null}><input inputMode="decimal" value={ctc} onChange={(e) => setCtc(e.target.value)} style={big} data-testid="ps-preview-ctc" /></Field><Field label={t('ps.ptState')} name="pt" error={null}><input value={pt} onChange={(e) => setPt(e.target.value.toUpperCase())} style={big} /></Field>
        <button type="button" className="btn btn-primary" style={big} disabled={busy || !(Number(ctc) > 0)} onClick={() => run(() => setup.preview({ structureId: s.id, ctcAnnual: Number(ctc), ptState: pt || null, pf: true })).then((r) => r && setPv(r))} data-testid="ps-preview-btn">{t('ps.preview')}</button></div>
      {pv && <Breakup b={pv} t={t} />}</div>}
  </div>);
}

export function ComponentsPage() {
  const t = useT('ps'); usePageTitle(t('ps.componentsTitle')); const [tab, setTab] = useState('components'); const [edit, setEdit] = useState(null); const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'pay-comps'], queryFn: setup.components, retry: false });
  const g = guardOf(q, t('ps.componentsTitle'), 'pay.component.view'); if (g) return g; const x = q.data;
  return (<section aria-labelledby="psc-h" data-testid="ps-components-page"><PageHeader id="psc-h" title={t('ps.componentsTitle')} subtitle={t('ps.componentsIntro')} meta={<Link to="/payroll/assignments">{t('ps.assignmentsTitle')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <Pills tabs={[['components', t('ps.components')], ['structures', t('ps.structures')]]} tab={tab} setTab={setTab} label={t('ps.componentsTitle')} prefix="ps-tab" />
    {tab === 'structures' ? <Structures t={t} run={run} busy={busy} canConfigure={x.canConfigure} comps={x.components} /> : <>
      {x.canConfigure && <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} onClick={() => setEdit(edit === 'new' ? null : 'new')} data-testid="ps-comp-new">{t('ps.newComponent')}</button>}
      {edit === 'new' && <ComponentForm t={t} run={run} busy={busy} names={[...x.names, ...x.components.filter((c) => c.type === 'EARNING').map((c) => c.code)]} />}
      {TYPES.map((ty) => <div key={ty}><h2 className="small" style={{ margin: '12px 0 4px' }}>{t(`ps.type.${ty}`)}</h2><ul className="lp-list" data-testid={`ps-list-${ty}`}>{x.components.filter((c) => c.type === ty).map((c) => <li key={c.id} className="mdm-panel" style={card}>
        <button type="button" className="btn-link" style={{ display: 'grid', gap: 2, width: '100%', minHeight: 'var(--erp-target-min)', background: 'none', border: 0, color: 'inherit', textAlign: 'left' }} disabled={!x.canConfigure} onClick={() => setEdit(edit === c.id ? null : c.id)}>
          <span style={row}><strong>{c.code} · {c.name}</strong><span className="small">{t(`ps.m.${c.method}`)} ›</span></span>
          <span className="muted small">{c.method === 'FORMULA' ? c.formula : c.method === 'PERCENT' ? `${c.percent} % × ${c.baseCodes.join(' + ')}` : c.statutoryCode ?? ''} · {t(`ps.wc.${c.wageClass}`)}{c.pf ? ' · PF' : ''}{c.esi ? ' · ESI' : ''}{c.taxable ? '' : ` · ${t('ps.notTaxable')}`}{c.status === 'INACTIVE' ? ` · ${t('ps.inactive')}` : ''}</span></button>
        {edit === c.id && <ComponentForm c={c} t={t} run={run} busy={busy} names={[...x.names, ...x.components.filter((y) => y.type === 'EARNING' && y.sequence < c.sequence).map((y) => y.code)]} />}</li>)}</ul></div>)}</>}
  </section>);
}

function Assignment({ id }) {
  const t = useT('ps'); const q = useQuery({ queryKey: ['gl', 'pay-asg', id], queryFn: () => setup.assignment(id), retry: false }); const { error, note, busy, run } = useGlRunner(); usePageTitle(t('ps.assignmentsTitle'));
  const g = guardOf(q, t('ps.assignmentsTitle'), 'pay.assignment.view'); if (g) return g; const x = q.data; const c = x.can;
  return (<section aria-labelledby="psa-h" data-testid="ps-assignment" data-status={x.status}><PageHeader id="psa-h" title={`${x.docNo} · ${x.employee}`} subtitle={`${t(`ps.kind.${x.kind}`)} · ${t('ps.fromDate', { date: x.effectiveFrom })}${x.effectiveTo ? ` – ${x.effectiveTo}` : ''}`} meta={<StatusBadge status={TONE[x.status] ?? 'CANCELLED'} label={t(`ps.st.${x.status}`)} />} />
    <p><Link to="/payroll/assignments">{t('ps.back')}</Link></p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <KpiRow label={t('ps.assignment')}><KpiTile label={t('ps.ctcAnnual')} value={amt(x.ctcAnnual, t)} amount={x.ctcAnnual ?? 0} kind="money" valueTestid="ps-asg-ctc" /><KpiTile label={t('ps.gross')} value={amt(x.grossMonthly, t)} amount={x.grossMonthly ?? 0} kind="money" /><KpiTile label={t('ps.increment')} value={x.incrementPct == null ? '—' : `${x.incrementPct} %`} /><KpiTile label={t('ps.arrears')} value={amt(x.arrears, t)} amount={x.arrears ?? 0} kind="money" valueTestid="ps-asg-arrears" /></KpiRow>
    <div className="mdm-panel"><Rows rows={[[t('ps.structure'), `${x.structure}${x.grade ? ` · ${x.grade}` : ''}${x.senior ? ` · ${t('ps.seniorShort')}` : ''}`], [t('ps.reason'), x.reason], [t('ps.rating'), x.rating], [t('ps.previous'), x.previous ? `${x.previous.docNo} · ${amt(x.previous.ctcAnnual, t)} ${t('ps.fromDate', { date: x.previous.effectiveFrom })}` : null]]} /></div>
    {x.masked && <p className="muted small">{t('ps.maskedNote')}</p>}
    {x.breakup && <Breakup b={x.breakup} t={t} />}
    {x.arrearLines?.length > 0 && <div className="mdm-panel" data-testid="ps-arrears"><h2>{t('ps.arrears')}</h2><ul className="lp-list">{x.arrearLines.map((a, i) => <li key={i} style={{ ...row, minHeight: 36 }}><span>{a.month} · {a.code}{a.factor < 1 ? ` (${Math.round(a.factor * 100)} %)` : ''}</span><span className="num">{money(a.amount)} · {t(`ps.as.${a.status}`)}</span></li>)}</ul></div>}
    <Decide x={x} run={run} busy={busy} t={t} p="ps" testid="ps-decide" />
    <div className="actions-row ff-actionbar">
      {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => setup.act(x.id, 'submit'), t('ps.sent'))} data-testid="ps-asg-submit">{t('ps.submit')}</button>}
      {c.delete && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => setup.removeAssignment(x.id), t('ps.deleted')).then((r) => r && navigateTo('/payroll/assignments'))}>{t('ps.delete')}</button>}
      {!x.masked && <button type="button" className="btn" style={big} onClick={() => file(`/assignments/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('ps.fileFailed')))}>{t('ps.print')}</button>}
    </div>
    {x.history?.approvals?.length > 0 && <div className="mdm-panel"><h2>{t('ps.history')}</h2><ul className="lp-list">{x.history.approvals.map((h, i) => <li key={i} style={{ minHeight: 'var(--erp-target-min)' }}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.event}{h.step_code ? ` (${h.step_code})` : ''} · {h.actor}</li>)}</ul></div>}
  </section>);
}

function NewAssignment({ t, run, busy, preset }) {
  const eq = useQuery({ queryKey: ['gl', 'pay-emps'], queryFn: () => setup.employees(), retry: false }); const sq = useQuery({ queryKey: ['gl', 'pay-structs'], queryFn: () => setup.structures(), retry: false });
  const [f, setF] = useState({ employeeId: preset ?? '', structureId: '', ctcAnnual: '', effectiveFrom: `${istToday().slice(0, 7)}-01`, reason: '' }); const [pv, setPv] = useState(null); const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPv(null); };
  const emp = (eq.data ?? []).find((e) => String(e.id) === String(f.employeeId));
  return (<div className="mdm-panel" data-testid="ps-asg-new"><h2>{t('ps.newAssignment')}</h2><div className="form-grid">
    <Field label={t('ps.employee')} name="emp" error={null}><select value={f.employeeId} onChange={set('employeeId')} style={big} data-testid="ps-asg-emp"><option value="">{t('ps.choose')}</option>{(eq.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.code} {e.name}{e.current ? ` · ${t('ps.hasPay')}` : ''}</option>)}</select></Field>
    <Field label={t('ps.structure')} name="st" error={null}><select value={f.structureId} onChange={set('structureId')} style={big} data-testid="ps-asg-struct"><option value="">{t('ps.choose')}</option>{(sq.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
    <Field label={t('ps.ctcAnnual')} name="ctc" error={null}><input inputMode="decimal" value={f.ctcAnnual} onChange={set('ctcAnnual')} style={big} data-testid="ps-asg-ctc-in" /></Field>
    <Field label={t('ps.effectiveFrom')} name="from" error={null}><input type="date" value={f.effectiveFrom} onChange={set('effectiveFrom')} style={big} data-testid="ps-asg-from" /></Field>
    <Field label={t('ps.reason')} name="reason" error={null}><input value={f.reason} onChange={set('reason')} style={big} data-testid="ps-asg-reason" /></Field></div>
    {emp?.current && <p className="muted small">{t('ps.currentPay', { doc: emp.current.docNo, ctc: amt(emp.current.ctcAnnual, t), from: emp.current.from })}</p>}
    {pv && <Breakup b={pv} t={t} testid="ps-asg-preview" />}
    <div className="actions-row ff-actionbar"><button type="button" className="btn" style={big} disabled={busy || !f.employeeId || !f.structureId || !(Number(f.ctcAnnual) > 0)} onClick={() => run(() => setup.preview({ structureId: Number(f.structureId), ctcAnnual: Number(f.ctcAnnual), employeeId: Number(f.employeeId), date: f.effectiveFrom })).then((r) => r && setPv(r))} data-testid="ps-asg-preview-btn">{t('ps.preview')}</button>
      <button type="button" className="btn btn-primary" style={big} disabled={busy || f.reason.trim().length < 3} onClick={() => run(() => setup.createAssignment({ employeeId: Number(f.employeeId), structureId: Number(f.structureId), ctcAnnual: Number(f.ctcAnnual), effectiveFrom: f.effectiveFrom, reason: f.reason.trim() }), t('ps.created')).then((r) => r && navigateTo(`/payroll/assignments?id=${r.id}`))} data-testid="ps-asg-save">{t('ps.saveDraft')}</button></div></div>);
}

export function AssignmentsPage() {
  const t = useT('ps'); usePageTitle(t('ps.assignmentsTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const [open, setOpen] = useState(Boolean(sp.get('employeeId'))); const [status, setStatus] = useState(''); const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'pay-asgs', status], queryFn: () => setup.assignments({ pageSize: 50, ...(status ? { 'filter[status]': status } : {}) }), retry: false, enabled: !id });
  if (id) return <Assignment id={id} />;
  const g = guardOf(q, t('ps.assignmentsTitle'), 'pay.assignment.view'); if (g) return g;
  return (<section aria-labelledby="psl-h" data-testid="ps-assignments-page"><PageHeader id="psl-h" title={t('ps.assignmentsTitle')} subtitle={t('ps.assignmentsIntro')} meta={<><Link to="/payroll/statutory">{t('ps.statutoryTitle')}</Link> · <Link to="/payroll/calendar">{t('ps.calendarTitle')}</Link></>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} onClick={() => setOpen(!open)} data-testid="ps-asg-new-btn">{t('ps.newAssignment')}</button>
    {open && <NewAssignment t={t} run={run} busy={busy} preset={sp.get('employeeId')} />}
    <Pills tabs={[['', t('ps.all')], ['SUBMITTED', t('ps.st.SUBMITTED')], ['APPROVED', t('ps.st.APPROVED')], ['DRAFT', t('ps.st.DRAFT')]]} tab={status} setTab={setStatus} label={t('ps.status')} prefix="ps-asg-filter" />
    {q.data.length === 0 ? <EmptyState compact title={t('ps.noAssignments')} message={t('ps.noAssignmentsBody')} /> : <ul className="lp-list" data-testid="ps-asg-list">{q.data.map((x) => <li key={x.id} className="mdm-panel" style={card}><Link to={`/payroll/assignments?id=${x.id}`} style={{ display: 'grid', gap: 4, minHeight: 'var(--erp-target-min)', textDecoration: 'none', color: 'inherit' }}>
      <span style={row}><strong>{x.docNo}</strong><span>{amt(x.ctcAnnual, t)} ›</span></span><span className="small">{x.employee} · {t(`ps.kind.${x.kind}`)} · {t('ps.fromDate', { date: x.effectiveFrom })}</span><span><StatusBadge status={TONE[x.status] ?? 'CANCELLED'} label={t(`ps.st.${x.status}`)} />{x.arrears ? ` · ${t('ps.arrears')} ${amt(x.arrears, t)}` : ''}</span></Link></li>)}</ul>}
    <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => file('/assignments/export', 'pay-assignments.csv').catch(() => globalThis.alert?.(t('ps.fileFailed')))}>{t('ps.export')}</button></div>
  </section>);
}

function ParamDetail({ id, t }) {
  const q = useQuery({ queryKey: ['gl', 'pay-param', id], queryFn: () => setup.param(id), retry: false }); const { error, note, busy, run } = useGlRunner();
  const g = guardOf(q, t('ps.statutoryTitle'), 'pay.statutory.view'); if (g) return g; const x = q.data; const c = x.can;
  return (<section aria-labelledby="psp-h" data-testid="ps-param" data-status={x.status}><PageHeader id="psp-h" title={`${x.code} · ${x.state}`} subtitle={`${x.docNo} · ${t('ps.fromDate', { date: x.effectiveFrom })}`} meta={<StatusBadge status={TONE[x.status] ?? 'CANCELLED'} label={t(`ps.st.${x.status}`)} />} />
    <p><Link to="/payroll/statutory">{t('ps.backParams')}</Link></p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <div className="mdm-panel"><Rows rows={[[t('ps.legalRef'), x.legalRef]]} /><pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(x.params, null, 1)}</pre></div>
    <Decide x={x} run={run} busy={busy} t={t} p="ps" testid="ps-param-decide" />
    {c.submit && <div className="actions-row ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => setup.paramAct(x.id, 'submit'), t('ps.sent'))} data-testid="ps-param-submit">{t('ps.submitCfo')}</button></div>}
  </section>);
}

export function StatutoryPage() {
  const t = useT('ps'); usePageTitle(t('ps.statutoryTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const [code, setCode] = useState(''); const [nf, setNf] = useState(null); const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'pay-params', code], queryFn: () => setup.params(code ? { code } : {}), retry: false, enabled: !id });
  if (id) return <ParamDetail id={id} t={t} />;
  const g = guardOf(q, t('ps.statutoryTitle'), 'pay.statutory.view'); if (g) return g; const x = q.data;
  return (<section aria-labelledby="pss-h" data-testid="ps-statutory-page"><PageHeader id="pss-h" title={t('ps.statutoryTitle')} subtitle={t('ps.statutoryIntro')} meta={<Link to="/payroll/assignments">{t('ps.assignmentsTitle')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    {x.canCreate && <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} onClick={() => setNf(nf ? null : { code: 'PT', state: 'TS', effectiveFrom: istToday(), params: '{\n "slabs": [{ "upTo": 15000, "amount": 0 }, { "upTo": null, "amount": 200 }]\n}', legalRef: '' })} data-testid="ps-param-new">{t('ps.proposeChange')}</button>}
    {nf && <div className="mdm-panel"><div className="form-grid"><Field label={t('ps.paramCode')} name="pc" error={null}><select value={nf.code} onChange={(e) => setNf({ ...nf, code: e.target.value })} style={big}>{x.codes.map((k) => <option key={k} value={k}>{k}</option>)}</select></Field><Field label={t('ps.state')} name="ps" error={null}><input value={nf.state} onChange={(e) => setNf({ ...nf, state: e.target.value.toUpperCase() })} style={big} /></Field><Field label={t('ps.effectiveFrom')} name="pf" error={null}><input type="date" value={nf.effectiveFrom} onChange={(e) => setNf({ ...nf, effectiveFrom: e.target.value })} style={big} /></Field><Field label={t('ps.legalRef')} name="pl" error={null}><input value={nf.legalRef} onChange={(e) => setNf({ ...nf, legalRef: e.target.value })} style={big} /></Field></div>
      <label>{t('ps.values')}<textarea value={nf.params} onChange={(e) => setNf({ ...nf, params: e.target.value })} rows={6} style={{ width: '100%', fontFamily: 'monospace', fontSize: '1rem' }} /></label>
      <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => { let p; try { p = JSON.parse(nf.params); } catch { globalThis.alert?.(t('ps.badJson')); return; } run(() => setup.createParam({ code: nf.code, state: nf.state || 'ALL', effectiveFrom: nf.effectiveFrom, params: p, legalRef: nf.legalRef }), t('ps.created')).then((r) => r && navigateTo(`/payroll/statutory?id=${r.id}`)); }}>{t('ps.saveDraft')}</button></div></div>}
    <Pills tabs={[['', t('ps.all')], ...['PF', 'ESI', 'PT', 'LWF', 'GRATUITY', 'TDS_NEW'].map((k) => [k, k])]} tab={code} setTab={setCode} label={t('ps.paramCode')} prefix="ps-param-filter" />
    <ul className="lp-list" data-testid="ps-param-list">{x.rows.map((r) => <li key={r.id} className="mdm-panel" style={card}><Link to={`/payroll/statutory?id=${r.id}`} style={{ display: 'grid', gap: 4, minHeight: 'var(--erp-target-min)', textDecoration: 'none', color: 'inherit' }}><span style={row}><strong>{r.code} · {r.state}</strong><span>{t('ps.fromDate', { date: r.effectiveFrom })} ›</span></span>
      <span className="small">{r.inForce ? <strong>{t('ps.inForce')}</strong> : null} {r.system ? t('ps.system') : t(`ps.st.${r.status}`)} · {r.legalRef}</span></Link></li>)}</ul>
  </section>);
}

export function CalendarPage() {
  const t = useT('ps'); usePageTitle(t('ps.calendarTitle')); const fyNow = (() => { const d = istToday(); return Number(d.slice(5, 7)) >= 4 ? d.slice(0, 4) : String(Number(d.slice(0, 4)) - 1); })(); const [fy, setFy] = useState(fyNow); const [payDay, setPayDay] = useState('1'); const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'pay-cal', fy], queryFn: () => setup.calendar({ fy }), retry: false });
  const g = guardOf(q, t('ps.calendarTitle'), 'pay.calendar.view'); if (g) return g; const x = q.data;
  return (<section aria-labelledby="psk-h" data-testid="ps-calendar-page"><PageHeader id="psk-h" title={t('ps.calendarTitle')} subtitle={t('ps.calendarIntro')} meta={<Link to="/payroll/assignments">{t('ps.assignmentsTitle')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <div className="form-grid"><Field label={t('ps.fy')} name="fy" error={null}><input inputMode="numeric" value={fy} onChange={(e) => setFy(e.target.value)} style={big} data-testid="ps-cal-fy" /></Field>
      {x.canConfigure && <><Field label={t('ps.payDay')} name="pd" error={null}><input inputMode="numeric" value={payDay} onChange={(e) => setPayDay(e.target.value)} style={big} /></Field><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => setup.generateCalendar({ fyStart: `${fy}-04-01`, payDay: Number(payDay) || 1 }), t('ps.generated'))} data-testid="ps-cal-generate">{t('ps.generate')}</button></>}</div>
    {x.rows.length === 0 ? <EmptyState compact title={t('ps.noPeriods')} message={t('ps.noPeriodsBody')} /> : <ul className="lp-list" data-testid="ps-cal-list">{x.rows.map((r) => <li key={r.id} className="mdm-panel" style={card}><div style={row}><strong>{r.period}</strong><span>{t(`ps.cs.${r.status}`)}</span></div><span className="small">{t('ps.cutoffs', { att: r.attendanceCutoff, inp: r.inputsCutoff, pay: r.payDate })}</span>
      {x.canConfigure && r.status === 'OPEN' && <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy} onClick={() => { const d = globalThis.prompt?.(t('ps.newPayDate'), r.payDate); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) run(() => setup.updatePeriod(r.id, { payDate: d, version: r.version }), t('ps.saved')); }}>{t('ps.changePayDate')}</button></div>}</li>)}</ul>}
  </section>);
}
