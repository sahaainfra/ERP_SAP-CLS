import { useState } from 'react';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, qa } from './api.js';
import { sel, useRecord, useRunner } from './QaParts.jsx';

// Cube register (part 18.05): the samples with the QR label, the next test that is due, and the results at 7 and 28 days judged by IS 456; a failed result is raised as an NCR from here.
const ACC_TONE = { INDICATIVE: 'DRAFT', WATCH: 'RETURNED', PASS: 'APPROVED', FAIL: 'REJECTED' }; const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
function Sample({ id }) {
  const t = useT('qa'); const { q, guard } = useRecord('/cube-samples', id, t('cube.title'), 'qa.pour_card.view'); const { error, run, busy, note } = useRunner(); const [f, setF] = useState({ ageDays: '28', strengths: '', testedOn: today() }); usePageTitle(t('cube.title')); if (guard) return guard; const x = q.data;
  const save = () => run(() => qa.act('/cube-samples', x.id, 'results', { ageDays: Number(f.ageDays), strengths: f.strengths.split(/[\s,;]+/).filter(Boolean).map(Number), testedOn: f.testedOn }), t('cube.saved'));
  const raise = async (resultId) => { const d = await run(() => qa.post(`/cube-results/${resultId}/raise-ncr`, {}), t('cube.ncrRaised')); if (d) navigateTo(`/qa/ncrs?id=${d.ncrId}`); };
  return (
    <div data-testid="qa-cube-object" data-overdue={String(x.overdue)}><h1 id="cube-h">{x.sampleNo}</h1>
      <p><Link to="/qa/cubes">{t('cube.title')}</Link> · <Link to={`/qa/pour-cards?id=${x.pourCardId}`}>{x.pourNo}</Link> · {x.project} · {x.element} · {x.grade} (fck {x.fck}) · {t('pc.cubeCount')} {x.cubes} · {t('pc.castDate')} {fmtDate(x.castDate)}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="cube-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="cube-note">{note}</p>}
      <figure className="mdm-panel" data-testid="cube-qr"><img src={`data:image/svg+xml;utf8,${encodeURIComponent(x.qrSvg)}`} alt={t('cube.qrAlt', { code: x.sampleNo })} width={160} height={160} /><figcaption>{x.qrCode}</figcaption></figure>
      <p data-testid="cube-next">{x.nextAge ? `${t('cube.next')}: ${t('cube.age', { n: x.nextAge })} · ${fmtDate(x.nextDue)}${x.overdue ? ` · ${t('ir.overdue')}` : ''}` : t('cube.allTested')}</p>
      <div className="table-scroll"><table className="data-table" data-testid="cube-results"><caption>{t('cube.results')}</caption><thead><tr><th>{t('cube.ageHeader')}</th><th>{t('cube.strengths')}</th><th className="num">{t('cube.mean')}</th><th>{t('cube.testedOn')}</th><th>{t('ins.verdict')}</th><th /></tr></thead>
        <tbody>{x.results.length === 0 ? <tr><td colSpan={6}>{t('cube.noResults')}</td></tr> : x.results.map((r) => <tr key={r.id} data-testid="cube-result" data-acceptance={r.acceptance}><td>{r.ageDays}</td><td>{r.strengths.join(', ')}</td><td className="num">{r.mean}</td><td>{fmtDate(r.testedOn)}</td><td><StatusBadge status={ACC_TONE[r.acceptance]} label={t(`acc.${r.acceptance}`)} /></td><td>{r.acceptance === 'FAIL' && !r.ncrId && x.can.test && <button type="button" className="btn" disabled={busy} onClick={() => raise(r.id)} data-testid="cube-raise-ncr">{t('cube.raiseNcr')}</button>}{r.ncrId && <Link to={`/qa/ncrs?id=${r.ncrId}`}>{t('cube.ncr')}</Link>}</td></tr>)}</tbody></table></div>
      {x.can.test && x.nextAge && <div className="mdm-panel no-print" data-testid="cube-entry"><h2>{t('cube.enter')}</h2><div className="form-grid">
        <Field label={t('cube.ageHeader')} name="ageDays" error={error}><select value={f.ageDays} onChange={(e) => setF({ ...f, ageDays: e.target.value })} style={sel} data-testid="cube-age"><option value="7">7</option><option value="28">28</option></select></Field>
        <Field label={t('cube.strengthsHint')} name="strengths" error={error}><input value={f.strengths} onChange={(e) => setF({ ...f, strengths: e.target.value })} style={sel} inputMode="decimal" data-testid="cube-strengths" /></Field>
        <Field label={t('cube.testedOn')} name="testedOn" error={error}><input type="date" max={today()} value={f.testedOn} onChange={(e) => setF({ ...f, testedOn: e.target.value })} style={sel} data-testid="cube-tested" /></Field></div>
        <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !f.strengths} onClick={save} data-testid="cube-save">{t('save')}</button></div>}
    </div>
  );
}
export default function CubeRegisterPage() {
  const t = useT('qa'); usePageTitle(t('cube.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="cube-h"><Sample id={id} /></section>;
  return (
    <section aria-labelledby="cubl-h" data-testid="qa-cubes"><h1 id="cubl-h">{t('cube.title')}</h1><p className="muted">{t('cube.intro')}</p>
      <div className="actions-row no-print"><Link to="/qa/pour-cards">{t('pc.title')}</Link><Link to="/qa/concrete-acceptance">{t('ca.title')}</Link><button type="button" className="btn" onClick={() => qa.exportFile('/cube-samples/export', 'cube-register.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="cube-export">{t('export')}</button></div>
      <ListReport listCode="qa.cube_samples" endpoint="/qa/cube-samples" title={t('cube.title')} session={session.data} rowHref={(r) => `/qa/cubes?id=${r.id}`} onOpen={(r) => navigateTo(`/qa/cubes?id=${r.id}`)} cardFields={['sampleNo', 'element', 'grade', 'nextDue']} dateKey="nextDue" empty={{ title: t('cube.emptyTitle'), text: t('cube.emptyBody') }} />
    </section>
  );
}
