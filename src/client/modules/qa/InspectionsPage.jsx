import { useState } from 'react';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { RESULT_TONE, fmtDate, qa } from './api.js';
import { DocBar, Status, sel, useRecord, useRunner } from './QaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Inspections register and inspection object (part 18.01, FR-04): the answers with the tolerance verdicts, photographs and signatures, the failed items that become defects, and the approval by the owner of the module.
const transport = browserTransport(authHeaders);
function Inspection({ id }) {
  const t = useT('qa'); const { q, guard } = useRecord('/inspections', id, t('ins.title'), 'qa.inspection.view'); const { error, run, busy } = useRunner(); const [name, setName] = useState(''); const [role, setRole] = useState('INSPECTOR'); usePageTitle(t('ins.title')); if (guard) return guard; const x = q.data;
  const addPhoto = (code) => async (ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (!f) return; await run(async () => { const up = await uploadFile(f, { transport, entity: 'qa_inspections', entityId: x.id }); return qa.photo(x.id, { questionCode: code, fileId: up.id }); }, t('ins.photoAdded')); };
  const qtext = Object.fromEntries(x.sections.flatMap((s) => s.questions.map((y) => [y.code, y])));
  return (
    <div data-testid="qa-inspection-object" data-status={x.status} data-result={x.result ?? ''}><PageHeader id="ins-h" title={<>{x.docNo} <Status x={x} /> {x.result && <StatusBadge status={RESULT_TONE[x.result]} label={t(`res.${x.result}`)} />}</>} meta={<><Link to="/qa/inspections">{t('ins.title')}</Link> · {x.template} v{x.templateVersion} · {x.project} · {fmtDate(String(x.inspectedAt).slice(0, 10))} · {x.inspectedBy}{x.scorePct != null ? ` · ${x.scorePct} %` : ''}{x.subject ? ` · ${x.subject}` : ''}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="ins-error">{error.form}</p>}
      <DocBar kind="/inspections" x={x} printName={`${x.docNo.replaceAll('/', '-')}.pdf`} />
      {x.defects.length > 0 && <div className="mdm-panel" data-testid="ins-defects"><h2>{t('ins.defects')}</h2><ul>{x.defects.map((d) => <li key={d.questionCode}>{d.questionCode} {d.text}{d.value != null ? ` (${d.value}${d.unit ? ` ${d.unit}` : ''})` : ''}{d.critical ? ` · ${t('tpl.critical')}` : ''}</li>)}</ul></div>}
      <div className="table-scroll"><table className="data-table" data-testid="ins-answers"><thead><tr><th>{t('code')}</th><th>{t('tpl.question')}</th><th>{t('ins.answer')}</th><th>{t('ins.verdict')}</th><th>{t('ins.photos')}</th><th /></tr></thead>
        <tbody>{x.answers.map((a) => <tr key={a.questionCode} data-testid="ins-answer" data-passed={a.passed == null ? '' : String(a.passed)}><td>{a.questionCode}</td><td>{qtext[a.questionCode]?.text}</td><td>{a.answer ?? (a.numValue != null ? a.numValue / 1000 : a.textValue ?? '')}</td><td>{a.passed == null ? '' : a.passed ? t('ins.ok') : t('ins.failed')}</td><td>{a.photoFileIds.length}</td>
          <td>{x.can.edit && <label className="btn">{t('perf.photo')}<input type="file" accept="image/*" capture="environment" hidden onChange={addPhoto(a.questionCode)} disabled={busy} data-testid={`ins-photo-${a.questionCode}`} /></label>}</td></tr>)}</tbody></table></div>
      <div className="mdm-panel" data-testid="ins-signatures"><h2>{t('ins.signatures')}</h2><ul>{x.signatures.map((s) => <li key={s.role}>{t(`sig.${s.role}`)}: {s.name}</li>)}</ul>
        {x.can.edit && <div className="form-grid"><Field label={t('ins.signerRole')} name="role" error={error}><select value={role} onChange={(e) => setRole(e.target.value)} style={sel} data-testid="sign-role">{['INSPECTOR', 'CONTRACTOR', 'CONSULTANT', 'CLIENT'].map((r) => <option key={r} value={r}>{t(`sig.${r}`)}</option>)}</select></Field><Field label={t('name')} name="name" error={error}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} style={sel} data-testid="sign-name" /></Field><button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy || name.length < 2} onClick={() => run(() => qa.sign(x.id, { role, name }), t('ins.signed'))} data-testid="sign-add">{t('ins.sign')}</button></div>}</div>
    </div>
  );
}
export default function InspectionsPage() {
  const t = useT('qa'); usePageTitle(t('ins.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="ins-h"><Inspection id={id} /></section>;
  return (
    <section aria-labelledby="in-h" data-testid="qa-inspections"><PageHeader id="in-h" title={t('ins.title')} subtitle={t('ins.intro')} />
      <div className="actions-row no-print"><Link to="/qa/perform">{t('perf.title')}</Link><button type="button" className="btn" onClick={() => qa.exportFile('/export?kind=inspections', 'inspections.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="ins-export">{t('export')}</button></div>
      <ListReport listCode="qa.inspections" endpoint="/qa/inspections" exportEndpoint="/ui/lists/qa.inspections/export" title={t('ins.title')} session={session.data} rowHref={(r) => `/qa/inspections?id=${r.id}`} onOpen={(r) => navigateTo(`/qa/inspections?id=${r.id}`)} cardFields={['docNo', 'template', 'result', 'status']} statusKey="status" dateKey="inspected" empty={{ title: t('ins.emptyTitle'), text: t('ins.emptyBody') }} />
    </section>
  );
}
