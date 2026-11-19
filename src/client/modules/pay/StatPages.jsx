import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { money } from '../fin/api.js';
import { GlError, useGlRunner } from '../fin/JournalsPage.jsx';
import { Pills, Rows, big, guardOf, istToday, lastMonth } from '../fin/finparts.jsx';
import { TONE, file, stat } from './api.js';

// Part 24.04: statutory compliance. The statutory calendar as a board (to file, in approval, to pay, paid) with the filing of each item, its approval and
// its challan; the files and reports of a month (ECR, ESI, PT, LWF, the quarterly TDS statement); the BOCW cess of the projects; the statutory rules.
// The labour registers, the Form 16 / 130 batch, bonus and gratuity are on the registers page.
const row = { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
const card = { padding: 12, margin: '6px 0' };
const fyNow = () => { const d = istToday(); const y = Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; };
const COLS = ['TO_FILE', 'IN_APPROVAL', 'TO_PAY', 'PAID'];

function Item({ it, t, busy, run, can }) {
  const [rec, setRec] = useState(false); const [ch, setCh] = useState({ challanRef: '', challanDate: istToday(), paidOn: istToday(), paymentRef: '' });
  const f = it.filing; const label = it.state !== 'ALL' ? `${it.label} · ${it.state}` : it.label;
  return (<li className="mdm-panel" style={card} data-testid={`st-item-${it.type}-${it.period}`} data-column={it.column}>
    <div style={row}><strong>{label}</strong><span className="small" style={{ color: it.overdue ? 'var(--erp-color-status-error-fg)' : undefined, fontWeight: it.overdue ? 700 : undefined }} data-testid="st-due">{t('st.dueOn', { d: it.dueDate })}{it.overdue ? ` · ${t('st.overdue')}` : it.dueIn >= 0 && it.dueIn <= 7 ? ` · ${t('st.inDays', { n: it.dueIn })}` : ''}</span></div>
    <span className="small">{t('st.period')}: {it.period}{it.amountPaise != null ? ` · ${money(it.amountPaise / 100)}` : ''}{it.ruleStatus === 'TO_CONFIRM' ? ` · ${t('st.toConfirm')}` : ''}</span>
    <span className="small muted">{it.legalRef}</span>
    {f && <span className="small"><StatusBadge status={TONE[f.status] ?? 'CANCELLED'} label={f.statusLabel} /> {f.docNo}{f.paidOn ? ` · ${t('st.paidOn', { d: f.paidOn })} · ${f.challanRef}` : ''}</span>}
    <div className="actions-row">
      {!f && it.type !== 'TDS_24Q' && it.type !== 'FORM16' && can.create && <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy || it.ruleStatus === 'TO_CONFIRM'} onClick={() => run(() => stat.createFiling({ type: it.type, period: it.period, ...(it.state !== 'ALL' ? { state: it.state } : {}) }), t('st.prepared'))} data-testid={`st-prepare-${it.type}-${it.period}`}>{t('st.prepare')}</button>}
      {f && f.status === 'DRAFT' && can.create && <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => stat.submitFiling(f.id), t('st.sent'))} data-testid={`st-submit-${f.id}`}>{t('st.submit')}</button>}
      {f && f.status === 'APPROVED' && !f.paidOn && can.record && <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} onClick={() => setRec(!rec)} data-testid={`st-record-${f.id}`}>{t('st.recordChallan')}</button>}
    </div>
    {rec && <div className="mdm-panel" data-testid="st-challan"><div className="form-grid">
      <Field label={t('st.challanRef')} name="challanRef" error={null} required><input value={ch.challanRef} onChange={(e) => setCh({ ...ch, challanRef: e.target.value })} style={big} data-testid="st-challan-ref" /></Field>
      <Field label={t('st.challanDate')} name="challanDate" error={null}><input type="date" value={ch.challanDate} onChange={(e) => setCh({ ...ch, challanDate: e.target.value })} style={big} /></Field>
      <Field label={t('st.paidOnL')} name="paidOn" error={null}><input type="date" value={ch.paidOn} onChange={(e) => setCh({ ...ch, paidOn: e.target.value })} style={big} /></Field>
      <Field label={t('st.paymentRef')} name="paymentRef" error={null}><input value={ch.paymentRef} onChange={(e) => setCh({ ...ch, paymentRef: e.target.value })} style={big} /></Field></div>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || ch.challanRef.trim().length < 3} onClick={() => run(() => stat.challan(f.id, { challanRef: ch.challanRef.trim(), challanDate: ch.challanDate, paidOn: ch.paidOn, ...(ch.paymentRef ? { paymentRef: ch.paymentRef } : {}) }), t('st.recorded')).then((r) => r && setRec(false))} data-testid="st-challan-save">{t('st.saveChallan')}</button></div></div>}
  </li>);
}

function Board({ t, fy }) {
  const q = useQuery({ queryKey: ['gl', 'st-cal', fy], queryFn: () => stat.calendar(fy), retry: false }); const { error, note, busy, run } = useGlRunner(); const [col, setCol] = useState('TO_FILE');
  const g = guardOf(q, t('st.board'), 'pay.stat.calendar.view'); if (g) return g; const x = q.data; const by = (c) => x.items.filter((i) => i.column === c);
  const counts = { TO_FILE: by('TO_FILE').length, IN_APPROVAL: by('IN_APPROVAL').length, TO_PAY: by('TO_PAY').length, PAID: by('PAID').length };
  return (<div data-testid="st-board"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <KpiRow label={t('st.summary')}><KpiTile label={t('st.toFile')} value={String(counts.TO_FILE)} valueTestid="st-count-tofile" /><KpiTile label={t('st.inApproval')} value={String(counts.IN_APPROVAL)} /><KpiTile label={t('st.toPay')} value={String(counts.TO_PAY)} /><KpiTile label={t('st.overdueN')} value={String(x.items.filter((i) => i.overdue).length)} valueTestid="st-overdue" /></KpiRow>
    <Pills tabs={COLS.map((c) => [c, `${t(`st.col.${c}`)} (${counts[c]})`])} tab={col} setTab={setCol} label={t('st.board')} prefix="st-col" />
    {by(col).length === 0 ? <EmptyState compact title={t('st.none')} message={t('st.noneBody')} /> : <ul className="lp-list">{by(col).map((it) => <Item key={`${it.type}-${it.period}-${it.state}`} it={it} t={t} busy={busy} run={run} can={{ create: x.can.create, record: x.can.create }} />)}</ul>}
  </div>);
}

function Files({ t }) {
  const [f, setF] = useState({ registerType: 'ECR_FILE', period: lastMonth(), state: 'TS', quarter: 'Q1 2026-27' }); const { error, note, busy, run } = useGlRunner();
  const lq = useQuery({ queryKey: ['gl', 'st-regs'], queryFn: () => stat.registers({}), retry: false });
  const body = () => { const b = { registerType: f.registerType }; if (f.registerType === 'TDS_24Q_FILE') b.quarter = f.quarter; else b.period = f.period; if (f.registerType === 'PT_REPORT' || f.registerType === 'LWF_REPORT') b.state = f.state; return b; };
  return (<div data-testid="st-files"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <div className="mdm-panel"><h2>{t('st.generateFile')}</h2><p className="small">{t('st.fileHelp')}</p><div className="form-grid">
      <Field label={t('st.fileType')} name="registerType" error={null}><select value={f.registerType} onChange={(e) => setF({ ...f, registerType: e.target.value })} style={big} data-testid="st-file-type">{['ECR_FILE', 'ESI_FILE', 'PT_REPORT', 'LWF_REPORT', 'TDS_24Q_FILE'].map((k) => <option key={k} value={k}>{t(`st.rt.${k}`)}</option>)}</select></Field>
      {f.registerType === 'TDS_24Q_FILE' ? <Field label={t('st.quarter')} name="quarter" error={null}><input value={f.quarter} onChange={(e) => setF({ ...f, quarter: e.target.value })} style={big} data-testid="st-quarter" /></Field> : <Field label={t('st.month')} name="period" error={null}><input type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} style={big} data-testid="st-period" /></Field>}
      {(f.registerType === 'PT_REPORT' || f.registerType === 'LWF_REPORT') && <Field label={t('st.state')} name="state" error={null}><input value={f.state} maxLength={2} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} style={big} /></Field>}</div>
      <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy} onClick={() => run(() => stat.generate(body()), t('st.generated')).then(() => lq.refetch())} data-testid="st-generate">{t('st.generate')}</button></div></div>
    <h2 className="small" style={{ margin: '16px 0 4px' }}>{t('st.files')}</h2>
    {guardOf(lq, t('st.files'), 'pay.stat.register.view') ?? (lq.data.length === 0 ? <EmptyState compact title={t('st.noFiles')} message={t('st.noFilesBody')} /> : <ul className="lp-list" data-testid="st-file-list">{lq.data.map((r) => <li key={r.id} className="mdm-panel" style={card}><div style={row}><strong>{r.typeLabel}</strong><span className="small">{r.period}{r.state ? ` · ${r.state}` : ''}</span></div><span className="small">{t('st.rows', { n: r.rows })} · {r.fileName} · {String(r.generatedAt).slice(0, 16).replace('T', ' ')}</span>
      <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => file(`/stat/registers/${r.id}/download`, r.fileName).catch(() => globalThis.alert?.(t('st.fileFailed')))} data-testid={`st-download-${r.id}`}>{t('st.download')}</button></div></li>)}</ul>)}
  </div>);
}

function Bocw({ t, fy }) {
  const [period, setPeriod] = useState(lastMonth()); const [f, setF] = useState({ projectId: '', constructionCost: '', source: '' }); const { error, note, busy, run } = useGlRunner();
  const lq = useQuery({ queryKey: ['gl', 'st-bocw', period], queryFn: () => stat.bocw({ period }), retry: false }); const g = guardOf(lq, t('st.bocw'), 'pay.stat.bocw.view'); if (g) return g;
  return (<div data-testid="st-bocw"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <p className="small muted">{t('st.bocwHelp', { fy })}</p>
    <Field label={t('st.month')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="st-bocw-period" /></Field>
    <div className="mdm-panel"><h2>{t('st.recordCost')}</h2><div className="form-grid">
      <Field label={t('st.projectId')} name="projectId" error={null} required><input inputMode="numeric" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} style={big} data-testid="st-bocw-project" /></Field>
      <Field label={t('st.cost')} name="constructionCost" error={null} required><input inputMode="decimal" value={f.constructionCost} onChange={(e) => setF({ ...f, constructionCost: e.target.value })} style={big} data-testid="st-bocw-cost" /></Field>
      <Field label={t('st.costSource')} name="source" error={null} required hint={t('st.costSourceHint')}><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} style={big} data-testid="st-bocw-source" /></Field></div>
      <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy || !f.projectId || !f.constructionCost || f.source.trim().length < 5} onClick={() => run(() => stat.saveBocw({ projectId: Number(f.projectId), period, constructionCost: Number(f.constructionCost), source: f.source.trim() }), t('st.costSaved'))} data-testid="st-bocw-save">{t('st.saveCost')}</button></div></div>
    {(lq.data ?? []).length === 0 ? <EmptyState compact title={t('st.noBocw')} message={t('st.noBocwBody')} /> : <ul className="lp-list" data-testid="st-bocw-list">{lq.data.map((b) => <li key={b.id} className="mdm-panel" style={card}><div style={row}><strong>{b.project}</strong><span className="num">{b.cess == null ? t('st.masked') : money(b.cess)}</span></div><span className="small">{t('st.costOf', { c: b.cost == null ? t('st.masked') : money(b.cost), r: b.rateBp / 100 })} · {b.costSource} · {t(`st.cs.${b.status}`)}</span></li>)}</ul>}
  </div>);
}

function Rules({ t }) {
  const q = useQuery({ queryKey: ['gl', 'st-rules'], queryFn: () => stat.rules(), retry: false }); const { error, note, busy, run } = useGlRunner(); const [f, setF] = useState({ type: 'PT', state: 'TS', offset: '1', day: '10', effectiveFrom: istToday(), legalRef: '' });
  const g = guardOf(q, t('st.rules'), 'pay.stat.rule.view'); if (g) return g;
  return (<div data-testid="st-rules"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <p className="small muted">{t('st.rulesHelp')}</p>
    <ul className="lp-list">{q.data.map((r) => <li key={r.id} className="mdm-panel" style={card} data-testid={`st-rule-${r.id}`}><div style={row}><strong>{r.type} · {r.state}</strong><StatusBadge status={r.status === 'APPROVED' ? 'APPROVED' : 'IN_REVIEW'} label={t(`st.rs.${r.status}`)} /></div><span className="small">{t('st.from', { d: r.effectiveFrom })} · {JSON.stringify(r.params)}</span><span className="small muted">{r.legalRef}</span></li>)}</ul>
    <div className="mdm-panel"><h2>{t('st.addRule')}</h2><p className="small">{t('st.addRuleHelp')}</p><div className="form-grid">
      <Field label={t('st.ruleType')} name="type" error={null}><input value={f.type} onChange={(e) => setF({ ...f, type: e.target.value.toUpperCase() })} style={big} data-testid="st-rule-type" /></Field>
      <Field label={t('st.state')} name="state" error={null}><input value={f.state} maxLength={2} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} style={big} /></Field>
      <Field label={t('st.offset')} name="offset" error={null}><input inputMode="numeric" value={f.offset} onChange={(e) => setF({ ...f, offset: e.target.value })} style={big} /></Field>
      <Field label={t('st.day')} name="day" error={null}><input inputMode="numeric" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} style={big} /></Field>
      <Field label={t('st.effectiveFrom')} name="effectiveFrom" error={null}><input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} style={big} /></Field>
      <Field label={t('st.legalRef')} name="legalRef" error={null} required><input value={f.legalRef} onChange={(e) => setF({ ...f, legalRef: e.target.value })} style={big} data-testid="st-rule-ref" /></Field></div>
      <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy || f.legalRef.trim().length < 10} onClick={() => run(() => stat.saveRule({ type: f.type, state: f.state, params: { offset: Number(f.offset), day: Number(f.day) }, effectiveFrom: f.effectiveFrom, legalRef: f.legalRef.trim(), status: 'APPROVED' }), t('st.ruleSaved'))} data-testid="st-rule-save">{t('st.saveRule')}</button></div></div>
  </div>);
}

export function ComplianceBoardPage() {
  const t = useT('st'); usePageTitle(t('st.title')); const sp = useSearch(); const [fy, setFy] = useState(sp.get('fy') || fyNow()); const [tab, setTab] = useState('board');
  return (<section aria-labelledby="st-h" data-testid="st-page"><PageHeader id="st-h" title={t('st.title')} subtitle={t('st.intro')} meta={<Link to="/payroll/registers">{t('st.toRegisters')}</Link>} />
    <Field label={t('st.fy')} name="fy" error={null}><input value={fy} onChange={(e) => setFy(e.target.value)} style={big} data-testid="st-fy" /></Field>
    <Pills tabs={[['board', t('st.tabBoard')], ['files', t('st.tabFiles')], ['bocw', t('st.tabBocw')], ['rules', t('st.tabRules')]]} tab={tab} setTab={setTab} label={t('st.title')} prefix="st-tab" />
    {tab === 'board' && <Board t={t} fy={fy} />}{tab === 'files' && <Files t={t} />}{tab === 'bocw' && <Bocw t={t} fy={fy} />}{tab === 'rules' && <Rules t={t} />}
  </section>);
}

export function RegistersPage() {
  const t = useT('st'); usePageTitle(t('rg.title')); const [fy, setFy] = useState(fyNow()); const [tab, setTab] = useState('labour'); const [site, setSite] = useState({ siteId: '', period: lastMonth(), registerType: 'WORKMEN_REGISTER' }); const { error, note, busy, run } = useGlRunner();
  const [bon, setBon] = useState({ pct: '8.33' }); const [gr, setGr] = useState({ employeeId: '', leavingDate: istToday() });
  const lq = useQuery({ queryKey: ['gl', 'st-regs2'], queryFn: () => stat.registers({}), retry: false });
  const bq = useQuery({ queryKey: ['gl', 'st-bonus', fy, bon.pct], queryFn: () => stat.bonus({ fy, pct: bon.pct }), retry: false, enabled: tab === 'bonus' });
  const pq = useQuery({ queryKey: ['gl', 'st-prov', fy], queryFn: () => stat.provision({ fy }), retry: false, enabled: tab === 'gratuity' });
  return (<section aria-labelledby="rg-h" data-testid="rg-page"><PageHeader id="rg-h" title={t('rg.title')} subtitle={t('rg.intro')} meta={<Link to="/payroll/compliance">{t('st.title')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <Field label={t('st.fy')} name="fy" error={null}><input value={fy} onChange={(e) => setFy(e.target.value)} style={big} data-testid="rg-fy" /></Field>
    <Pills tabs={[['labour', t('rg.tabLabour')], ['form16', t('rg.tabForm16')], ['bonus', t('rg.tabBonus')], ['gratuity', t('rg.tabGratuity')]]} tab={tab} setTab={setTab} label={t('rg.title')} prefix="rg-tab2" />
    {tab === 'labour' && <div data-testid="rg-labour"><div className="mdm-panel"><h2>{t('rg.generate')}</h2><p className="small">{t('rg.labourHelp')}</p><div className="form-grid">
      <Field label={t('rg.register')} name="registerType" error={null}><select value={site.registerType} onChange={(e) => setSite({ ...site, registerType: e.target.value })} style={big} data-testid="rg-type">{['WORKMEN_REGISTER', 'OVERTIME_REGISTER', 'DEDUCTION_REGISTER', 'ADVANCE_REGISTER'].map((k) => <option key={k} value={k}>{t(`st.rt.${k}`)}</option>)}</select></Field>
      <Field label={t('rg.siteId')} name="siteId" error={null} required><input inputMode="numeric" value={site.siteId} onChange={(e) => setSite({ ...site, siteId: e.target.value })} style={big} data-testid="rg-site" /></Field>
      <Field label={t('st.month')} name="period" error={null}><input type="month" value={site.period} onChange={(e) => setSite({ ...site, period: e.target.value })} style={big} /></Field></div>
      <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy || !site.siteId} onClick={() => run(() => stat.generate({ registerType: site.registerType, siteId: Number(site.siteId), period: site.period }), t('st.generated'))} data-testid="rg-generate">{t('rg.generateBtn')}</button></div></div>
      <ul className="lp-list" data-testid="rg-list">{(lq.data ?? []).filter((r) => ['WORKMEN_REGISTER', 'OVERTIME_REGISTER', 'DEDUCTION_REGISTER', 'ADVANCE_REGISTER'].includes(r.type)).map((r) => <li key={r.id} className="mdm-panel" style={card}><div style={row}><strong>{r.typeLabel}</strong><span className="small">{r.period}</span></div><div className="actions-row"><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => file(`/stat/registers/${r.id}/download`, r.fileName).catch(() => globalThis.alert?.(t('st.fileFailed')))}>{t('st.download')}</button></div></li>)}</ul></div>}
    {tab === 'form16' && <div className="mdm-panel" data-testid="rg-form16"><h2>{t('rg.form16Title', { fy })}</h2><p className="small">{t('rg.form16Help')}</p>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => stat.generate({ registerType: 'FORM16_BATCH', fy }), t('st.generated'))} data-testid="rg-form16-generate">{t('rg.form16Gen')}</button><button type="button" className="btn" style={big} onClick={() => file(`/stat/form16/pdf?fy=${fy}`, `form-16-${fy}.pdf`).catch(() => globalThis.alert?.(t('st.fileFailed')))} data-testid="rg-form16-pdf">{t('rg.form16Pdf')}</button></div></div>}
    {tab === 'bonus' && <div data-testid="rg-bonus"><Field label={t('rg.pct')} name="pct" error={null} hint={t('rg.pctHint')}><input inputMode="decimal" value={bon.pct} onChange={(e) => setBon({ pct: e.target.value })} style={big} data-testid="rg-pct" /></Field>
      {guardOf(bq, t('rg.bonus'), 'pay.stat.register.view') ?? (<><KpiRow label={t('rg.bonus')}><KpiTile label={t('rg.eligible')} value={String(bq.data.totals.eligible)} valueTestid="rg-eligible" /><KpiTile label={t('rg.bonusTotal')} value={money(bq.data.totals.bonus)} amount={bq.data.totals.bonus} kind="money" /></KpiRow>
        <ul className="lp-list" data-testid="rg-bonus-rows">{bq.data.rows.map((r) => <li key={r.employee} className="mdm-panel" style={card}><div style={row}><strong>{r.employee}</strong><span className="num">{r.eligible ? money(r.bonus) : t('rg.notEligible')}</span></div><span className="small">{t('rg.months', { n: r.months })} · {t('rg.base', { b: money(r.bonusBase) })}</span></li>)}</ul></>)}</div>}
    {tab === 'gratuity' && <div data-testid="rg-gratuity"><div className="mdm-panel"><h2>{t('rg.gratuityTitle')}</h2><p className="small">{t('rg.gratuityHelp')}</p><div className="form-grid">
      <Field label={t('rg.employeeId')} name="employeeId" error={null} required><input inputMode="numeric" value={gr.employeeId} onChange={(e) => setGr({ ...gr, employeeId: e.target.value })} style={big} data-testid="rg-emp" /></Field>
      <Field label={t('rg.leavingDate')} name="leavingDate" error={null}><input type="date" value={gr.leavingDate} onChange={(e) => setGr({ ...gr, leavingDate: e.target.value })} style={big} /></Field></div>
      <GratuityResult t={t} gr={gr} /></div>
      {guardOf(pq, t('rg.provision'), 'pay.stat.register.view') ?? <div className="mdm-panel" data-testid="rg-provision"><h2>{t('rg.provisionTitle', { fy })}</h2><KpiRow label={t('rg.provision')}><KpiTile label={t('rg.provision')} value={money(pq.data.totals.provision)} amount={pq.data.totals.provision} kind="money" valueTestid="rg-prov-total" /></KpiRow></div>}</div>}
  </section>);
}

function GratuityResult({ t, gr }) {
  const q = useQuery({ queryKey: ['gl', 'st-grat', gr.employeeId, gr.leavingDate], queryFn: () => stat.gratuity({ employeeId: Number(gr.employeeId), leavingDate: gr.leavingDate }), retry: false, enabled: Boolean(gr.employeeId) && gr.leavingDate.length === 10 });
  if (!gr.employeeId) return null; const g = guardOf(q, t('rg.gratuity'), 'pay.stat.register.view'); if (g) return g; if (!q.data) return null; const x = q.data;
  return (<div className="mdm-panel" data-testid="rg-grat-result"><Rows rows={[[t('rg.employee'), x.employee], [t('rg.years'), String(x.completedYears)], [t('rg.eligibleL'), x.eligible ? t('rg.yes') : x.reason], [t('rg.lastWages'), x.lastWages == null ? t('st.masked') : money(x.lastWages)], [t('rg.formula'), x.formula], [t('rg.capL'), money(x.capPaise / 100)], [t('rg.amount'), x.amount == null ? t('st.masked') : money(x.amount)]]} />{x.capped && <p className="small">{t('rg.capped')}</p>}</div>);
}

