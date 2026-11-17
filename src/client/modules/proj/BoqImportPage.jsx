import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { IMPORT_FIELDS, bq, guessField, inr, parseTable } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Import BOQ (part 10.04, FR-03, T-01): a wizard for the client's bill of quantities: paste the sheet from Excel with its header row, map each column to a field (the mapping is guessed from the headers and kept so the BOQ can be exported in the same columns),
// check it (every wrong row is listed with its row number in the sheet; nothing is made while any row is wrong) and import it as a new draft version, or into an empty draft. Large sheets are sent in chunks. A workbook can also go through the Import Center (type PROJ_BOQ_LINE).
export default function BoqImportPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  usePageTitle(t('imp2.title'));
  const sp = useSearch(); const into = Number(sp.get('versionId')) || null;
  const [step, setStep] = useState(1); const [text, setText] = useState(''); const [map, setMap] = useState({}); const [projectId, setProjectId] = useState(sp.get('projectId') ?? ''); const [vtype, setVtype] = useState('TENDER'); const [name, setName] = useState('');
  const [res, setRes] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const pq = useQuery({ queryKey: ['proj', 'boq-projects'], queryFn: bq.projects, retry: false });
  const table = parseTable(text);
  if (pq.isPending) return <Skeleton label={t('imp2.title')} rows={3} />;
  if (pq.isError) return <ErrorState error={pq.error} onRetry={pq.refetch} />;
  const fieldOf = (i) => map[i] ?? guessField(table.headers[i] ?? '');
  const colOf = (f) => table.headers.findIndex((_, i) => fieldOf(i) === f);
  const missing = ['itemCode', 'description', 'uom', 'qty'].filter((f) => colOf(f) < 0);
  const rows = table.rows.map((r, n) => { const o = { row: n + 2 }; for (const f of IMPORT_FIELDS) { const c = colOf(f); if (c >= 0) o[f] = r[c] ?? ''; } return o; });
  const columns = table.headers.map((h, i) => ({ key: fieldOf(i), header: h })).filter((c) => c.key);
  const send = async (commit) => {
    setBusy(true); setError(null); setRes(null);
    try {
      let stageId; for (let i = 0; i < rows.length; i += 150) { const s = await bq.stage({ projectId: Number(projectId), ...(stageId ? { stageId } : {}), rows: rows.slice(i, i + 150) }); stageId = s.stageId; }
      const r = await bq.importRun({ projectId: Number(projectId), vtype, name: name.trim() || undefined, stageId, columns, commit, ...(into ? { intoVersionId: into } : {}) }); setRes(r);
      if (r.committed) { qc.invalidateQueries({ queryKey: ['proj'] }); navigateTo(`/proj/version?id=${r.version.id}`, { force: true }); }
    } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  const next = () => setStep((s) => s + 1);
  return (
    <section aria-labelledby="imp2-h" data-testid="boq-import-wizard" data-step={step}>
      <PageHeader id="imp2-h" title={t('imp2.title')} subtitle={t('imp2.intro')} />
      <ol className="mdm-list" aria-label={t('imp2.steps')}>{['paste', 'map', 'check'].map((k, i) => <li key={k} aria-current={step === i + 1 ? 'step' : undefined}>{step === i + 1 ? <strong>{t(`imp2.step.${k}`)}</strong> : t(`imp2.step.${k}`)}</li>)}</ol>
      {step === 1 && (
        <div className="mdm-panel" data-testid="imp2-step1">
          <div className="form-grid">
            <Field label={t('st.project')} name="projectId"><select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={Boolean(into)} data-testid="imp2-project"><option value="">{t('st.chooseProject')}</option>{(pq.data ?? []).map((p) => <option key={p.projectId} value={p.projectId}>{p.code} · {p.name}</option>)}</select></Field>
            {!into && <Field label={t('f.type')} name="vtype"><select value={vtype} onChange={(e) => setVtype(e.target.value)} data-testid="imp2-type"><option value="TENDER">{t('bq.type.TENDER')}</option><option value="CONTRACT">{t('bq.type.CONTRACT')}</option></select></Field>}
            {!into && <Field label={t('f.name')} name="name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="imp2-name" /></Field>}
          </div>
          <Field label={t('imp2.paste')} name="text" hint={t('imp2.pasteHelp')}><textarea rows={10} value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} spellCheck={false} data-testid="imp2-text" /></Field>
          <p className="small" data-testid="imp2-count">{t('imp2.count', { n: table.rows.length })}</p>
          <div className="actions"><button type="button" className="btn btn-primary" disabled={!projectId || table.rows.length === 0} onClick={next} data-testid="imp2-next1">{t('imp2.next')}</button></div>
        </div>
      )}
      {step === 2 && (
        <div className="mdm-panel" data-testid="imp2-step2">
          <h2>{t('imp2.step.map')}</h2><p className="small muted">{t('imp2.mapHelp')}</p>
          <table className="data-table"><thead><tr><th scope="col">{t('imp2.column')}</th><th scope="col">{t('imp2.field')}</th><th scope="col">{t('imp2.sample')}</th></tr></thead>
            <tbody>{table.headers.map((h, i) => <tr key={i}><td>{h}</td><td><select aria-label={t('imp2.fieldFor', { h })} value={fieldOf(i)} onChange={(e) => setMap((m) => ({ ...m, [i]: e.target.value }))} data-testid={`imp2-map-${i}`}><option value="">{t('imp2.ignore')}</option>{IMPORT_FIELDS.map((f) => <option key={f} value={f}>{t(`imp2.f.${f}`)}</option>)}</select></td><td className="muted small">{table.rows[0]?.[i]}</td></tr>)}</tbody></table>
          {missing.length > 0 && <p className="field-error" role="alert" data-testid="imp2-missing">{t('imp2.missing', { f: missing.map((f) => t(`imp2.f.${f}`)).join(', ') })}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setStep(1)}>{t('imp2.back')}</button><button type="button" className="btn btn-primary" disabled={missing.length > 0 || busy} onClick={async () => { next(); await send(false); }} data-testid="imp2-next2">{t('imp2.check')}</button></div>
        </div>
      )}
      {step === 3 && (
        <div className="mdm-panel" data-testid="imp2-step3">
          <h2>{t('imp2.step.check')}</h2>
          {busy && <Skeleton label={t('imp2.checking')} rows={2} />}
          {error?.form && <p className="field-error" role="alert" data-testid="imp2-error">{error.form}</p>}
          {res && (
            <>
              <dl className="op-figures"><div><dt>{t('imp2.rows')}</dt><dd data-testid="imp2-rows">{res.rows}</dd></div><div><dt>{t('imp2.bills')}</dt><dd>{res.bills}</dd></div><div><dt>{t('imp2.sections')}</dt><dd>{res.sections}</dd></div>{res.total != null && <div><dt>{t('bq.total')}</dt><dd data-testid="imp2-total">{inr(res.total)}</dd></div>}<div><dt>{t('imp2.errors')}</dt><dd data-testid="imp2-errors-count">{res.errors.length}</dd></div></dl>
              {res.errors.length > 0 ? (
                <div className="table-wrap" data-testid="imp2-errors"><table className="data-table"><caption>{t('imp2.errorsTitle')}</caption><thead><tr><th scope="col">{t('imp2.row')}</th><th scope="col">{t('imp2.field')}</th><th scope="col">{t('imp2.problem')}</th></tr></thead><tbody>{res.errors.map((e, i) => <tr key={i} data-testid="imp2-error-row"><td>{e.row}</td><td>{t(`imp2.f.${e.field}`)}</td><td>{e.message}</td></tr>)}</tbody></table></div>
              ) : (
                <div className="table-wrap" data-testid="imp2-preview"><table className="data-table"><caption>{t('imp2.preview')}</caption><thead><tr><th scope="col">{t('imp2.row')}</th><th scope="col">{t('imp2.f.bill')}</th><th scope="col">{t('imp2.f.section')}</th><th scope="col">{t('bq.code')}</th><th scope="col">{t('bl.description')}</th><th scope="col">{t('bl.uom')}</th><th scope="col" className="num">{t('bl.qty')}</th><th scope="col" className="num">{t('bl.rate')}</th></tr></thead><tbody>{res.preview.slice(0, 20).map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.bill}</td><td>{r.section}</td><td>{r.itemCode}</td><td>{r.description}</td><td>{r.uom}</td><td className="num">{r.qty}</td><td className="num">{r.rate}</td></tr>)}</tbody></table></div>
              )}
            </>
          )}
          <div className="actions"><button type="button" className="btn" onClick={() => setStep(2)}>{t('imp2.back')}</button><button type="button" className="btn btn-primary" disabled={busy || !res || res.errors.length > 0} onClick={() => send(true)} data-testid="imp2-commit">{t('imp2.commit')}</button></div>
        </div>
      )}
      <p className="small"><Link to="/import">{t('imp.center')}</Link> · <Link to="/proj/versions">{t('bq.listTitle')}</Link></p>
    </section>
  );
}
