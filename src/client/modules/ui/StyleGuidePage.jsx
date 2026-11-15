import { useMemo, useState } from 'react';
import Icon, { ICON_KEYS, SIZES } from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { QueryState, downloadCsv, usePageTitle } from '../core/pages/ui.jsx';
import { useStyleGuide } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow } from '../../platform/design/Kpi.jsx';

const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['high-contrast', 'High contrast']];
const kebab = (k) => k.replace(/\./g, '-');
const groupOf = (k) => k.split('.')[0];
const SAMPLE_STATUSES = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'COMPLETED', 'RETURNED', 'AT_RISK', 'REJECTED', 'OVERDUE', 'CRITICAL', 'CANCELLED'];

/** One small screen drawn with the tokens, inside a container that carries a theme, so the three themes sit side by side. */
function ThemeSample({ theme, label }) {
  return (
    <div className="theme-preview" data-theme={theme} data-testid={`preview-${theme}`}>
      <strong>{label}</strong>
      <div className="card">
        <h3>Running bill RA-07</h3>
        <p>Primary text. <span className="muted">Secondary text.</span> <a href="#preview">A link</a></p>
        <p><StatusBadge status="SUBMITTED" /> <StatusBadge status="APPROVED" /> <StatusBadge status="OVERDUE" /></p>
        <div className="actions"><button type="button" className="btn btn-primary"><Icon name="erp.action.approve" size={16} />Approve</button><button type="button" className="btn"><Icon name="erp.action.return" size={16} />Return</button></div>
      </div>
    </div>
  );
}

/** The living style guide (part 03.01, FR-07): every token, the three themes, the densities, the contrast report and the icon registry. */
export default function StyleGuidePage() {
  usePageTitle('Design System');
  const q = useStyleGuide();
  const [theme, setTheme] = useState('');
  const [onlyFail, setOnlyFail] = useState(false);
  const [iconQ, setIconQ] = useState('');
  const [iconGroup, setIconGroup] = useState('');
  const d = q.data;
  const t = d?.tokens;
  const rows = (d?.contrast.rows ?? []).filter((r) => (!theme || r.theme === theme) && (!onlyFail || !r.aa));
  const icons = useMemo(() => ICON_KEYS.filter((i) => (!iconGroup || i.group === iconGroup) && (!iconQ || `${i.key} ${i.meaning}`.toLowerCase().includes(iconQ.toLowerCase()))), [iconQ, iconGroup]);
  const colourGroups = t ? [...new Set(Object.keys(t.color.light).map(groupOf))] : [];

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Design System</nav>
      <PageHeader id="page-title" title={"Design System"} subtitle={<>The design tokens, themes and icons every screen is built from. They come from one file (<code>src/shared/design/design-tokens.json</code>); changing a token is a code change reviewed like any other, so nothing here is edited on screen.{d && (d.openToAll ? ` This ${d.environment} environment shows the page to everyone signed in.` : ' In production only people with ui.styleguide.view see it.')}</>} />
      <QueryState query={q} what="the design tokens" permission="ui.styleguide.view" />
      {t && (
        <>
          <div className="toolbar">
            <button type="button" className="btn" onClick={() => downloadCsv('design-tokens.json', JSON.stringify(t, null, 2), 'application/json')}><Icon name="erp.action.export" size={16} />Export the tokens</button>
          </div>

          <h2>Themes</h2>
          <div className="theme-previews">{THEMES.map(([v, l]) => <ThemeSample key={v} theme={v} label={l} />)}</div>

          <h2>Contrast</h2>
          <KpiRow data-testid="contrast-summary">
            <div className={`tile ${d.contrast.failures.length ? 'tile-bad' : 'tile-ok'}`}><span>Text pairs below WCAG AA</span><strong>{d.contrast.failures.length}</strong><span className="muted small">of {d.contrast.rows.length} pairs in three themes</span></div>
            {THEMES.map(([v, l]) => <div key={v} className="tile"><span>{l}: meets AAA</span><strong>{d.contrast.aaaShare[v]}%</strong></div>)}
          </KpiRow>
          <div className="toolbar">
            <label className="field field-inline"><span className="sr-only">Theme</span><select aria-label="Contrast theme" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="">Every theme</option>{THEMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label><input type="checkbox" checked={onlyFail} onChange={(e) => setOnlyFail(e.target.checked)} /> Only pairs that fail</label>
          </div>
          {rows.length === 0 ? <div className="state"><h3>No pairs</h3><p>{onlyFail ? 'Every text pair meets WCAG AA.' : 'Nothing matches.'}</p></div> : (
            <div className="table-wrap"><table data-testid="contrast-table"><caption className="sr-only">Contrast of text and background tokens</caption>
              <thead><tr><th>Theme</th><th>Text</th><th>Background</th><th>Sample</th><th className="num">Ratio</th><th>AA</th><th>AAA</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={`${r.theme}${r.fg}${r.bg}`}>
                  <td data-label="Theme">{r.theme}</td><td data-label="Text"><code>{r.fg}</code></td><td data-label="Background"><code>{r.bg}</code></td>
                  <td data-label="Sample"><span data-theme={r.theme} style={/border/.test(r.fg) ? { border: `3px solid var(--erp-color-${kebab(r.fg)})`, color: 'var(--erp-color-text-primary)', background: `var(--erp-color-${kebab(r.bg)})`, padding: '2px 8px', display: 'inline-block' } : { color: `var(--erp-color-${kebab(r.fg)})`, background: `var(--erp-color-${kebab(r.bg)})`, padding: '2px 8px', display: 'inline-block' }}>Aa 123</span></td>
                  <td data-label="Ratio" className="num">{r.ratio.toFixed(2)}:1</td>
                  <td data-label="AA"><StatusBadge status={r.aa ? 'PASS' : 'FAIL'} label={r.aa ? 'Pass' : 'Fail'} /></td>
                  <td data-label="AAA">{r.aaa ? 'Yes' : 'No'}</td>
                </tr>
              ))}</tbody></table></div>
          )}

          <h2>Colours</h2>
          {colourGroups.map((g) => (
            <section key={g} aria-label={`${g} colours`}>
              <h3>{g}</h3>
              <div className="swatches">{Object.keys(t.color.light).filter((k) => groupOf(k) === g).map((k) => (
                <div key={k} className="swatch" data-testid={`swatch-${k}`}>
                  <div className="swatch-chip" style={{ background: `var(--erp-color-${kebab(k)})` }} />
                  <p><code>--erp-color-{kebab(k)}</code></p>
                  <p className="muted">{THEMES.map(([v]) => t.color[v][k]).join(' / ')}</p>
                </div>
              ))}</div>
            </section>
          ))}
          <h3>Chart palette (colour-blind safe, fixed order)</h3>
          <div className="swatches">{t.chart.categorical.light.map((c, i) => <div key={c} className="swatch"><div className="swatch-chip" style={{ background: `var(--erp-chart-${i + 1})` }} /><p><code>--erp-chart-{i + 1}</code></p><p className="muted">{c} / {t.chart.categorical.dark[i]}</p></div>)}</div>
          <p className="muted small">{t.chart.rules}</p>

          <h2>Status</h2>
          <p className="muted">One meaning per tone, with an icon and the word, so colour is never the only signal.</p>
          <p data-testid="status-samples">{SAMPLE_STATUSES.map((s) => <span key={s}><StatusBadge status={s} /> </span>)}</p>

          <h2>Typography</h2>
          <p className="muted">IBM Plex Sans; IBM Plex Sans Devanagari for Hindi; IBM Plex Mono for codes. Served by the application.</p>
          {Object.entries(t.typography.scale).map(([k, s]) => (
            <p key={k} className="type-sample" style={{ font: `var(--erp-type-${k})` }}>{k} · {s.size}/{s.lineHeight} · {s.weight}: Measurement book MB-114 ₹ 12,45,000.00</p>
          ))}
          <p className="type-sample" lang="hi" style={{ font: 'var(--erp-type-body-lg)', fontFamily: 'var(--erp-font-indic)' }}>हिन्दी: माप पुस्तिका और चालू बिल की स्वीकृति</p>
          <p className="type-sample"><code>PO/2026-27/0042 · 0123456789</code></p>

          <h2>Density</h2>
          <div className="theme-previews">
            {[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([v, l]) => (
              <div key={v} data-density={v} data-testid={`density-${v}`}>
                <strong>{l}: rows {t.density[v].row}px, controls {t.density[v].control}px</strong>
                <div className="table-wrap"><table><caption className="sr-only">{l} rows</caption><thead><tr><th>Item</th><th className="num">Qty</th></tr></thead><tbody><tr><td data-label="Item">Cement OPC 53</td><td data-label="Qty" className="num">120.000</td></tr><tr><td data-label="Item">TMT 12 mm</td><td data-label="Qty" className="num">4.500</td></tr></tbody></table></div>
                <p><input aria-label={`${l} sample field`} defaultValue="Sample" /> <button type="button" className="btn">Button</button></p>
              </div>
            ))}
          </div>

          <h2>Spacing, radius, elevation, motion, layers</h2>
          <div className="table-wrap"><table><caption className="sr-only">Spacing</caption><thead><tr><th>Space</th><th>Value</th><th>Scale</th></tr></thead>
            <tbody>{Object.entries(t.space).map(([k, v]) => <tr key={k}><td data-label="Space"><code>--erp-space-{k}</code></td><td data-label="Value">{v}px</td><td data-label="Scale"><span className="bar" style={{ width: `var(--erp-space-${k})` }} /></td></tr>)}</tbody></table></div>
          <p>{Object.entries(t.radius).map(([k, v]) => <span key={k} className="elev" style={{ borderRadius: `var(--erp-radius-${k})`, border: '1px solid var(--erp-color-border-strong)', margin: '0 8px 8px 0', textAlign: 'center' }}><code>{k} {v}</code></span>)}</p>
          <p>{Object.keys(t.elevation).map((k) => <span key={k} className="elev" style={{ boxShadow: `var(--erp-elevation-${k})`, margin: '0 16px 16px 0', textAlign: 'center' }}><code>elevation {k}</code></span>)}</p>
          <div className="table-wrap"><table><caption className="sr-only">Motion and layers</caption><thead><tr><th>Token</th><th>Value</th></tr></thead>
            <tbody>
              {Object.entries(t.motion).map(([k, v]) => <tr key={k}><td data-label="Token"><code>--erp-motion-{kebab(k)}</code></td><td data-label="Value">{v}</td></tr>)}
              {Object.entries(t.zIndex).map(([k, v]) => <tr key={k}><td data-label="Token"><code>--erp-z-{k}</code></td><td data-label="Value">{v}</td></tr>)}
              {Object.entries(t.breakpoint).map(([k, v]) => <tr key={k}><td data-label="Token"><code>breakpoint {k}</code></td><td data-label="Value">{v}px</td></tr>)}
            </tbody></table></div>

          <h2>Icons</h2>
          <p className="muted">One outline set on a {d.icons.grid} px grid with a {d.icons.stroke} px stroke, in sizes {SIZES.join(', ')}. Pages use the key, never a glyph: <code>{'<Icon name="erp.action.approve" />'}</code>.</p>
          <p>{SIZES.map((s) => <span key={s} style={{ marginRight: 'var(--erp-space-5)' }}><Icon name="erp.cx.crane" size={s} label={`Crane at ${s} pixels`} /> {s}px</span>)}</p>
          <div className="toolbar">
            <label className="field field-inline"><span className="sr-only">Search icons</span><input type="search" placeholder="Search icons" value={iconQ} onChange={(e) => setIconQ(e.target.value)} /></label>
            <label className="field field-inline"><span className="sr-only">Icon group</span><select aria-label="Icon group" value={iconGroup} onChange={(e) => setIconGroup(e.target.value)}><option value="">Every group</option>{[...new Set(ICON_KEYS.map((i) => i.group))].map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
            <span className="muted">{icons.length} icons</span>
          </div>
          {icons.length === 0 ? <div className="state"><h3>No icons</h3><p>Nothing matches that search.</p></div> : (
            <ul className="icon-grid" data-testid="icon-grid">{icons.slice(0, 400).map((i) => <li key={i.key} data-testid={`icon-${i.key}`}><Icon name={i.key} size={24} /><code>{i.key}</code><span className="muted small">{i.meaning}</span></li>)}</ul>
          )}
        </>
      )}
    </section>
  );
}
