import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { RESULT_TONE, qa } from './api.js';
import { DocBar, Status, sel, useRecord, useRunner } from './QaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Test requests (part 18.03): the register, the request form for a receipt line, and the test with its results. Each value is judged against the limits by the server; equipment out of calibration is refused;
// a failed result can only be accepted through a concession reference, which also goes to the quality control manager.
const transport = browserTransport(authHeaders);
function Test({ id }) {
  const t = useT('qa'); const { q, guard } = useRecord('/test-requests', id, t('tr.title'), 'qa.test_request.view'); const { error, run, busy } = useRunner(); const [vals, setVals] = useState(null); const [meta, setMeta] = useState(null);
  const eq = useQuery({ queryKey: ['qa', 'lab-equipment-pick'], queryFn: () => qa.get('/lab-equipment?pageSize=100'), retry: false, enabled: Boolean(q.data?.can?.edit) }); usePageTitle(t('tr.title')); if (guard) return guard; const x = q.data;
  if (x.can.edit && !vals) { setVals(Object.fromEntries(x.parameters.map((p) => { const r = x.results.find((y) => y.parameter === p.code); return [p.code, { value: r ? String(r.value) : '', equipmentId: r?.equipmentId ? String(r.equipmentId) : '' }]; }))); setMeta({ visualOk: x.visualOk, documentsOk: x.documentsOk, concessionRef: x.concessionRef ?? '', concessionReason: x.concessionReason ?? '', sampleRef: x.sampleRef ?? '', labName: x.labName ?? '' }); }
  const save = () => run(() => qa.edit('/test-requests', x.id, { visualOk: meta.visualOk, documentsOk: meta.documentsOk, sampleRef: meta.sampleRef || null, labName: meta.labName || null, concessionRef: meta.concessionRef || null, concessionReason: meta.concessionReason || null, rowVersion: x.version, results: x.parameters.filter((p) => vals[p.code]?.value !== '').map((p) => ({ parameter: p.code, value: Number(vals[p.code].value), equipmentId: vals[p.code].equipmentId ? Number(vals[p.code].equipmentId) : null })) }), t('saved'));
  const upload = async (ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (!f) return; await run(async () => { const up = await uploadFile(f, { transport, entity: 'qa_test_requests', entityId: x.id }); return qa.edit('/test-requests', x.id, { certificateFileId: up.id, rowVersion: x.version }); }, t('tr.certAdded')); };
  const pc = (code) => x.results.find((r) => r.parameter === code);
  return (
    <div data-testid="qa-test-object" data-status={x.status} data-result={x.result ?? ''} data-outcome={x.outcome ?? ''}><PageHeader id="tr-h" title={<>{x.docNo} <Status x={x} /> {x.result && <StatusBadge status={RESULT_TONE[x.result]} label={t(`res.${x.result}`)} />}</>} meta={<><Link to="/qa/test-requests">{t('tr.title')}</Link> · {x.project} · {x.test ?? t('tr.receivingOnly')}{x.standard ? ` · ${x.standard}` : ''} · {x.material}{x.grnNo ? ` · ${x.grnNo}` : ''} · {x.lotQty} {x.uom ?? ''}{x.outcomeLabel ? ` · ${x.outcomeLabel}` : ''}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="tr-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {x.can.edit && vals && (
        <div className="mdm-panel no-print" data-testid="tr-entry"><h2>{t('tr.enter')}</h2>
          <div className="form-grid">
            <Field label={t('tr.sampleRef')} name="sampleRef" error={error}><input value={meta.sampleRef} onChange={(e) => setMeta({ ...meta, sampleRef: e.target.value })} maxLength={80} style={sel} data-testid="tr-sample" /></Field>
            {x.labType === 'THIRD_PARTY' && <Field label={t('tr.labName')} name="labName" error={error}><input value={meta.labName} onChange={(e) => setMeta({ ...meta, labName: e.target.value })} maxLength={120} style={sel} /></Field>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={meta.visualOk === true} onChange={(e) => setMeta({ ...meta, visualOk: e.target.checked })} data-testid="tr-visual" />{t('tr.visualOk')}</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={meta.documentsOk === true} onChange={(e) => setMeta({ ...meta, documentsOk: e.target.checked })} data-testid="tr-docs" />{t('tr.documentsOk')}</label></div>
          {x.parameters.length > 0 && <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('tr.parameter')}</th><th>{t('tr.limits')}</th><th>{t('tr.value')}</th><th>{t('tr.equipment')}</th></tr></thead>
            <tbody>{x.parameters.map((p) => <tr key={p.code} data-testid="tr-param" data-passed={pc(p.code) ? String(pc(p.code).passed) : ''}><td>{p.name}</td><td>{p.min ?? '—'} … {p.max ?? '—'} {p.unit ?? ''}</td>
              <td><input type="number" step="any" aria-label={p.name} value={vals[p.code]?.value ?? ''} onChange={(e) => setVals({ ...vals, [p.code]: { ...vals[p.code], value: e.target.value } })} style={sel} data-testid={`tr-value-${p.code}`} /></td>
              <td><select aria-label={t('tr.equipment')} value={vals[p.code]?.equipmentId ?? ''} onChange={(e) => setVals({ ...vals, [p.code]: { ...vals[p.code], equipmentId: e.target.value } })} style={sel} data-testid={`tr-equipment-${p.code}`}><option value="">—</option>{(eq.data ?? []).map((q2) => <option key={q2.id} value={q2.id}>{q2.code} ({t(`cal.${q2.calibration}`)})</option>)}</select></td></tr>)}</tbody></table></div>}
          {x.result === 'FAIL' && <div className="form-grid" data-testid="tr-concession"><Field label={t('tr.concessionRef')} name="concessionRef" error={error}><input value={meta.concessionRef} onChange={(e) => setMeta({ ...meta, concessionRef: e.target.value })} maxLength={80} style={sel} data-testid="tr-concession-ref" /></Field><Field label={t('tr.concessionReason')} name="concessionReason" error={error}><textarea rows={2} value={meta.concessionReason} onChange={(e) => setMeta({ ...meta, concessionReason: e.target.value })} maxLength={1000} style={{ width: '100%' }} data-testid="tr-concession-reason" /></Field></div>}
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={save} data-testid="tr-save">{t('save')}</button>{x.labType === 'THIRD_PARTY' && <label className="btn" style={{ minHeight: 48 }}>{t('tr.uploadCert')}<input type="file" hidden onChange={upload} disabled={busy} data-testid="tr-cert" /></label>}</div></div>)}
      {!x.can.edit && x.results.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="tr-results"><thead><tr><th>{t('tr.parameter')}</th><th>{t('tr.limits')}</th><th>{t('tr.value')}</th><th>{t('tr.equipment')}</th><th>{t('ins.verdict')}</th></tr></thead><tbody>{x.results.map((r) => <tr key={r.parameter} data-passed={String(r.passed)}><td>{r.name}</td><td>{r.min ?? '—'} … {r.max ?? '—'} {r.unit ?? ''}</td><td>{r.value}</td><td>{r.equipment ?? '—'}</td><td>{r.passed ? t('ins.ok') : t('ins.failed')}</td></tr>)}</tbody></table></div>}
      {x.concessionRef && !x.can.edit && <p data-testid="tr-concession-view">{t('tr.concessionRef')}: {x.concessionRef} · {x.concessionReason}</p>}
      {x.releaseHint && <p className="muted">{t('tr.stillUnder', { n: x.releaseHint.openQty })}</p>}
      <DocBar kind="/test-requests" x={x} printName={`${x.docNo.replaceAll('/', '-')}.pdf`} />
    </div>
  );
}
function NewTest() {
  const t = useT('qa'); usePageTitle(t('tr.new')); const sp = useSearch(); const { error, run, busy } = useRunner(); const rq = useQuery({ queryKey: ['qa', 'receiving'], queryFn: () => qa.get('/receiving'), retry: false }); const cq = useQuery({ queryKey: ['qa', 'catalogue-pick'], queryFn: () => qa.get('/test-catalogue/options'), retry: false });
  const [f, setF] = useState({ grnLineId: sp.get('grnLineId') ?? '', catalogueId: '', samplingDecision: 'TEST', lotQty: '', sampleRef: '' }); const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const create = async () => { const d = await run(() => qa.make('/test-requests', { grnLineId: Number(f.grnLineId), catalogueId: f.catalogueId ? Number(f.catalogueId) : null, samplingDecision: f.samplingDecision, lotQty: f.lotQty ? Number(f.lotQty) : null, sampleRef: f.sampleRef || null }), t('saved')); if (d) navigateTo(`/qa/test-requests?id=${d.id}`); };
  const big = { minHeight: 48, fontSize: '1rem' };
  return (
    <section aria-labelledby="trn-h" data-testid="qa-test-new"><PageHeader id="trn-h" title={t('tr.new')} subtitle={<Link to="/qa/receiving">{t('rcv.title')}</Link>} />
      {error?.form && <p className="field-error" role="alert" data-testid="trn-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('rcv.item')} name="grnLineId" error={error}><select value={f.grnLineId} onChange={(e) => set('grnLineId', e.target.value)} style={big} data-testid="trn-line"><option value="">—</option>{(rq.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.grnNo} · {x.item} · {x.openQty} {x.uom}</option>)}</select></Field>
        <Field label={t('tr.test')} name="catalogueId" error={error}><select value={f.catalogueId} onChange={(e) => set('catalogueId', e.target.value)} style={big} data-testid="trn-test"><option value="">—</option>{(cq.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></Field>
        <Field label={t('tr.sampling')} name="samplingDecision" error={error}><select value={f.samplingDecision} onChange={(e) => set('samplingDecision', e.target.value)} style={big} data-testid="trn-sampling"><option value="TEST">{t('tr.samplingTest')}</option><option value="CERTIFICATE_ONLY">{t('tr.samplingCert')}</option></select></Field>
        <Field label={t('tr.lotQty')} name="lotQty" error={error}><input type="number" step="any" min="0" value={f.lotQty} onChange={(e) => set('lotQty', e.target.value)} style={big} data-testid="trn-lot" /></Field>
        <Field label={t('tr.sampleRef')} name="sampleRef" error={error}><input value={f.sampleRef} onChange={(e) => set('sampleRef', e.target.value)} maxLength={80} style={big} data-testid="trn-sample" /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !f.grnLineId} onClick={create} data-testid="trn-create">{t('tr.create')}</button></div></div>
    </section>
  );
}
export default function TestRequestsPage() {
  const t = useT('qa'); usePageTitle(t('tr.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (sp.get('new')) return <NewTest />; if (id) return <section aria-labelledby="tr-h"><Test id={id} /></section>;
  return (
    <section aria-labelledby="trl-h" data-testid="qa-tests"><PageHeader id="trl-h" title={t('tr.title')} subtitle={t('tr.intro')} />
      <div className="actions-row no-print"><Link to="/qa/receiving">{t('rcv.title')}</Link><Link to="/qa/test-compliance">{t('tc.title')}</Link><button type="button" className="btn" onClick={() => qa.exportFile('/test-requests/export', 'test-requests.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="tr-export">{t('export')}</button></div>
      <ListReport listCode="qa.test_requests" endpoint="/qa/test-requests" title={t('tr.title')} session={session.data} rowHref={(r) => `/qa/test-requests?id=${r.id}`} onOpen={(r) => navigateTo(`/qa/test-requests?id=${r.id}`)} cardFields={['docNo', 'test', 'result', 'status']} statusKey="status" dateKey="requested" empty={{ title: t('tr.emptyTitle'), text: t('tr.emptyBody') }} />
    </section>
  );
}
