import { useEffect, useState } from 'react';
import { useCompareVersions, useFormula, useFormulas, useShadowSummary } from '../api/index.js';
import { toCsv } from '../../../platform/format.js';
import { Field, Link, QueryState, Tile, downloadCsv, errorInfo, usePageTitle } from './ui.jsx';

/**
 * Differences between two versions of a formula on sample data (FR-05): the cases you paste plus the inputs of recent real
 * calculations. Below it, what a version running in shadow mode has found on live calculations so far.
 */
export default function ShadowReportPage() {
  usePageTitle('Shadow Comparison Report');
  const params = new URLSearchParams(window.location.search);
  const [code, setCode] = useState(params.get('code') ?? '');
  const [baseline, setBaseline] = useState('');
  const [candidate, setCandidate] = useState(params.get('candidate') ?? '');
  const [casesText, setCasesText] = useState('[\n  { "quantity": "12.5", "rate": "101.2345" }\n]');
  const [recent, setRecent] = useState(20);
  const [error, setError] = useState(null);
  const formulas = useFormulas({});
  const detail = useFormula(code || null);
  const compare = useCompareVersions();
  const live = useShadowSummary(code || null, candidate ? Number(candidate) : null);
  const versions = detail.data?.versions ?? [];

  useEffect(() => {
    if (!code && formulas.data?.data.length) setCode(formulas.data.data[0].code);
  }, [formulas.data, code]);
  useEffect(() => {
    if (versions.length && !baseline) setBaseline(String((versions.find((v) => v.state === 'current') ?? versions.at(-1)).version));
    if (versions.length && !candidate) setCandidate(String(versions[0].version));
  }, [versions, baseline, candidate]);

  const run = async (e) => {
    e.preventDefault();
    setError(null);
    let cases;
    try {
      cases = casesText.trim() ? JSON.parse(casesText) : [];
      if (!Array.isArray(cases)) throw new Error('not a list');
    } catch {
      setError({ form: 'The cases must be a JSON list of input objects, for example [ { "quantity": "1", "rate": "2" } ].', fields: {} });
      return;
    }
    try {
      await compare.mutateAsync({ code, baselineVersion: Number(baseline), candidateVersion: Number(candidate), cases, useRecent: Number(recent) });
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const r = compare.data;
  const exportCsv = () =>
    downloadCsv('shadow-comparison.csv', toCsv(['Case', 'Inputs', 'Field', `v${r.baselineVersion}`, `v${r.candidateVersion}`, 'Difference'], r.results.flatMap((x) => (x.differences.length ? x.differences.map((d) => [x.index, JSON.stringify(x.inputs), d.field, d.baseline, d.candidate, d.difference]) : [[x.index, JSON.stringify(x.inputs), x.baselineError || x.candidateError ? 'error' : '', x.baselineError ?? '', x.candidateError ?? '', '']]))));

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Calculations &rsaquo; Shadow Comparison</nav>
      <div className="page-head"><h1 id="page-title">Shadow Comparison Report</h1><Link to="/admin/formulas">Back to the registry</Link></div>
      <p className="muted">Run two versions of a formula on the same inputs and see exactly where they disagree, before the new one is switched on.</p>

      <form onSubmit={run} className="form-grid" aria-label="Comparison parameters">
        <div className="row">
          <Field label="Formula" name="code" error={error}>
            <select value={code} onChange={(e) => { setCode(e.target.value); setBaseline(''); setCandidate(''); }} data-testid="cmp-code">{(formulas.data?.data ?? []).map((f) => <option key={f.code} value={f.code}>{f.code}</option>)}</select>
          </Field>
          <Field label="Baseline version" name="baselineVersion" error={error}><select value={baseline} onChange={(e) => setBaseline(e.target.value)} data-testid="cmp-baseline">{versions.map((v) => <option key={v.version} value={v.version}>v{v.version} ({v.state})</option>)}</select></Field>
          <Field label="Candidate version" name="candidateVersion" error={error}><select value={candidate} onChange={(e) => setCandidate(e.target.value)} data-testid="cmp-candidate">{versions.map((v) => <option key={v.version} value={v.version}>v{v.version} ({v.state})</option>)}</select></Field>
          <Field label="Recent real calculations" name="useRecent" error={error} hint="0 to 200"><input type="number" min="0" max="200" value={recent} onChange={(e) => setRecent(e.target.value)} /></Field>
        </div>
        <Field label="Sample cases (JSON list of inputs)" name="cases" error={error}><textarea rows="6" className="mono" value={casesText} onChange={(e) => setCasesText(e.target.value)} data-testid="cmp-cases" /></Field>
        {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={compare.isPending || !code || !baseline || !candidate}>{compare.isPending ? 'Comparing...' : 'Compare'}</button></div>
      </form>

      {r && (
        <section aria-labelledby="result-title" data-testid="cmp-result">
          <h2 id="result-title">v{r.baselineVersion} against v{r.candidateVersion}</h2>
          <div className="tiles" role="group" aria-label="Summary">
            <Tile label="Cases" value={r.summary.cases} testId="cmp-cases-count" />
            <Tile label="Identical" value={r.summary.identical} status="ok" testId="cmp-identical" />
            <Tile label="Different" value={r.summary.differing} status={r.summary.differing ? 'warn' : 'ok'} testId="cmp-differing" />
            <Tile label="Errors" value={r.summary.errors} status={r.summary.errors ? 'error' : 'ok'} />
            <Tile label="Largest difference" value={r.summary.maxDifference} />
          </div>
          <div className="actions"><button type="button" className="btn" onClick={exportCsv}>Export CSV</button></div>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Each case with the outputs of both versions</caption>
              <thead><tr><th className="num">Case</th><th>Inputs</th><th>Field</th><th className="num">v{r.baselineVersion}</th><th className="num">v{r.candidateVersion}</th><th className="num">Difference</th></tr></thead>
              <tbody>
                {r.results.map((x) => {
                  const inputs = Object.entries(x.inputs).map(([k, v]) => `${k}=${v}`).join(', ');
                  if (x.differences.length === 0) {
                    return (
                      <tr key={x.index} data-testid={`case-${x.index}`} className={x.baselineError || x.candidateError ? 'row-bad' : ''}>
                        <td data-label="Case" className="num">{x.index}</td><td data-label="Inputs">{inputs}</td>
                        <td colSpan="4" data-label="Result">{x.baselineError || x.candidateError ? <span className="field-error">{x.baselineError ?? x.candidateError}</span> : <span className="chip chip-on">identical</span>}</td>
                      </tr>
                    );
                  }
                  return x.differences.map((d, i) => (
                    <tr key={`${x.index}-${d.field}`} data-testid={`case-${x.index}`} className="row-bad">
                      <td data-label="Case" className="num">{i === 0 ? x.index : ''}</td><td data-label="Inputs">{i === 0 ? inputs : ''}</td><td data-label="Field"><code>{d.field}</code></td>
                      <td data-label={`v${r.baselineVersion}`} className="num">{d.baseline}</td><td data-label={`v${r.candidateVersion}`} className="num">{d.candidate}</td><td data-label="Difference" className="num">{d.difference ?? '-'}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="live-title" className="card">
        <h2 id="live-title">Live shadow results {candidate ? `for v${candidate}` : ''}</h2>
        <QueryState query={live} what="the live shadow results" permission="core.calc.view" />
        {live.data && (
          live.data.runs === 0 ? (
            <p className="muted" data-testid="live-empty">Nothing has been compared yet. Put a draft in shadow mode on the registry page and the calculations that run from then on are compared here.</p>
          ) : (
            <>
              <p data-testid="live-summary">{live.data.runs} real calculation(s) compared; <strong>{live.data.differing}</strong> differ{live.data.errors ? `, ${live.data.errors} failed in the candidate` : ''}.</p>
              {live.data.latestDifferences.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Latest differences found on live calculations</caption>
                    <thead><tr><th>Inputs</th><th>Active version</th><th>Candidate</th></tr></thead>
                    <tbody>{live.data.latestDifferences.map((d) => <tr key={d.id}><td data-label="Inputs">{Object.entries(d.inputs).map(([k, v]) => `${k}=${v}`).join(', ')}</td><td data-label="Active version"><code>{JSON.stringify(d.baseline)}</code></td><td data-label="Candidate"><code>{d.candidateError ?? JSON.stringify(d.candidate)}</code></td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </>
          )
        )}
      </section>
    </section>
  );
}
