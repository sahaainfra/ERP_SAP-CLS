import { useState } from 'react';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, qa } from './api.js';
import { sel, useRecord, useRunner } from './QaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Lab Equipment & Calibration (part 18.03, FR-06): the register with the calibration due date; a calibration with its certificate moves the date; equipment past its date cannot be used for tests.
const transport = browserTransport(authHeaders); const CAL_TONE = { OK: 'APPROVED', DUE_SOON: 'RETURNED', OVERDUE: 'REJECTED', NONE: 'DRAFT', NOT_IN_USE: 'CANCELLED' };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
function Equipment({ id }) {
  const t = useT('qa'); const { q, guard } = useRecord('/lab-equipment', id, t('le.title'), 'qa.lab_equipment.view'); const { error, run, busy, note } = useRunner(); const [on, setOn] = useState(today()); const [file, setFile] = useState(null); usePageTitle(t('le.title')); if (guard) return guard; const x = q.data;
  const calibrate = () => run(async () => { let fileId = null; if (file) { const up = await uploadFile(file, { transport, entity: 'qa_lab_equipment', entityId: x.id }); fileId = up.id; } return qa.act('/lab-equipment', x.id, 'calibrate', { calibratedOn: on, fileId }); }, t('le.calibrated'));
  return (
    <div data-testid="qa-equipment-object" data-calibration={x.calibration}><PageHeader id="le-h" title={<>{x.code} {x.name} <StatusBadge status={CAL_TONE[x.calibration]} label={t(`cal.${x.calibration}`)} /></>} meta={<><Link to="/qa/lab-equipment">{t('le.title')}</Link> · {x.project ?? t('le.company')} · {x.serialNo ?? '—'} · {t('le.due')} {x.calibrationDue ? fmtDate(x.calibrationDue) : '—'}{x.daysToDue != null ? ` (${x.daysToDue})` : ''}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="le-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="le-note">{note}</p>}
      <div className="mdm-panel no-print" data-testid="le-calibrate"><h2>{t('le.calibrate')}</h2><div className="form-grid"><Field label={t('le.calibratedOn')} name="calibratedOn" error={error}><input type="date" max={today()} value={on} onChange={(e) => setOn(e.target.value)} style={sel} data-testid="le-date" /></Field>
        <label className="btn" style={{ minHeight: 44 }}>{t('le.certificate')}<input type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="le-file" /></label>{file && <span className="muted">{file.name}</span>}</div>
        <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={calibrate} data-testid="le-go">{t('le.calibrate')}</button></div>
    </div>
  );
}
function NewEquipment() {
  const t = useT('qa'); usePageTitle(t('le.new')); const { error, run, busy } = useRunner(); const [f, setF] = useState({ code: '', name: '', serialNo: '', lastCalibrated: '', intervalDays: '365' }); const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => { const d = await run(() => qa.make('/lab-equipment', { code: f.code, name: f.name, serialNo: f.serialNo || null, lastCalibrated: f.lastCalibrated || null, intervalDays: Number(f.intervalDays) || 365 }), t('saved')); if (d) navigateTo(`/qa/lab-equipment?id=${d.id}`); };
  return (
    <section aria-labelledby="len-h" data-testid="qa-equipment-new"><PageHeader id="len-h" title={t('le.new')} subtitle={<Link to="/qa/lab-equipment">{t('le.title')}</Link>} />
      {error?.form && <p className="field-error" role="alert" data-testid="len-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('code')} name="code" error={error}><input value={f.code} onChange={(e) => set('code', e.target.value)} maxLength={40} style={sel} data-testid="len-code" /></Field>
        <Field label={t('name')} name="name" error={error}><input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={200} style={sel} data-testid="len-name" /></Field>
        <Field label={t('le.serial')} name="serialNo" error={error}><input value={f.serialNo} onChange={(e) => set('serialNo', e.target.value)} maxLength={80} style={sel} /></Field>
        <Field label={t('le.lastCalibrated')} name="lastCalibrated" error={error}><input type="date" max={today()} value={f.lastCalibrated} onChange={(e) => set('lastCalibrated', e.target.value)} style={sel} data-testid="len-last" /></Field>
        <Field label={t('le.interval')} name="intervalDays" error={error}><input type="number" min="1" value={f.intervalDays} onChange={(e) => set('intervalDays', e.target.value)} style={sel} /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={save} data-testid="len-save">{t('save')}</button></div></div>
    </section>
  );
}
export default function LabEquipmentPage() {
  const t = useT('qa'); usePageTitle(t('le.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (sp.get('new')) return <NewEquipment />; if (id) return <section aria-labelledby="le-h"><Equipment id={id} /></section>;
  return (
    <section aria-labelledby="lel-h" data-testid="qa-equipment"><PageHeader id="lel-h" title={t('le.title')} subtitle={t('le.intro')} />
      <div className="actions-row no-print"><Link to="/qa/lab-equipment?new=1">{t('le.new')}</Link><button type="button" className="btn" onClick={() => qa.exportFile('/lab-equipment/export', 'lab-equipment.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="le-export">{t('export')}</button></div>
      <ListReport listCode="qa.lab_equipment" endpoint="/qa/lab-equipment" title={t('le.title')} session={session.data} rowHref={(r) => `/qa/lab-equipment?id=${r.id}`} onOpen={(r) => navigateTo(`/qa/lab-equipment?id=${r.id}`)} cardFields={['code', 'name', 'calibrationDue', 'status']} statusKey="status" dateKey="calibrationDue" empty={{ title: t('le.emptyTitle'), text: t('le.emptyBody') }} />
    </section>
  );
}
