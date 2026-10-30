// "Show calculation" (FR-04): how a computed value came about, step by step, with the formula version that produced it.
export function TraceView({ trace }) {
  return (
    <div className="trace" data-testid="trace">
      <p>
        <strong><code>{trace.formula.code}</code></strong> version <strong data-testid="trace-version">{trace.formula.version}</strong>
        {trace.formula.description ? ` - ${trace.formula.description}` : ''}
      </p>
      <p className="muted small">Rounding: {trace.policy === 'bankers' ? "banker's (half even)" : trace.policy === 'down' ? 'down' : trace.policy === 'up' ? 'up' : 'half up'}. Every value is an exact decimal; only the outputs are rounded.</p>
      <h4>Inputs</h4>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Inputs of the calculation</caption>
          <thead><tr><th>Input</th><th className="num">Value</th></tr></thead>
          <tbody>{Object.entries(trace.inputs).map(([k, v]) => <tr key={k}><td data-label="Input"><code>{k}</code></td><td data-label="Value" className="num">{v}</td></tr>)}</tbody>
        </table>
      </div>
      <h4>Steps</h4>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Steps of the calculation</caption>
          <thead><tr><th>Step</th><th>Formula</th><th className="num">Value</th></tr></thead>
          <tbody>{trace.steps.map((s) => <tr key={s.name}><td data-label="Step"><code>{s.name}</code></td><td data-label="Formula"><code>{s.formula}</code></td><td data-label="Value" className="num">{s.value}</td></tr>)}</tbody>
        </table>
      </div>
      {trace.rounding.length > 0 && (
        <>
          <h4>Rounded at the end</h4>
          <ul className="plain">{trace.rounding.map((r) => <li key={r.name}><code>{r.name}</code>: {r.from} becomes <strong>{r.to}</strong> ({r.mode.toLowerCase().replace('_', ' ')}, {r.places} places)</li>)}</ul>
        </>
      )}
      <h4>Result</h4>
      <ul className="plain">{Object.entries(trace.outputs).map(([k, v]) => <li key={k}><code>{k}</code> = <strong>{v}</strong></li>)}</ul>
    </div>
  );
}
